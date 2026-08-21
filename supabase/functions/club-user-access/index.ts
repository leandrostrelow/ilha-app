import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

const allowedRoles = new Set(["admin", "secretaria", "professor"]);
const allowedPermissions = new Set([
  "dashboard",
  "clients.read",
  "clients.write",
  "plans",
  "finance.read",
  "finance.write",
  "classes",
  "store",
  "announcements",
  "tournaments",
  "communication",
  "team",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://app.ilhatenis.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

function publicApiKey() {
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_publishable_") ? currentKeys : "";
  }
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter((permission) => allowedPermissions.has(permission))));
}

function publicProfile(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    full_name: profile.full_name || "",
    email: profile.email || "",
    phone: profile.phone || "",
    role: profile.role || "secretaria",
    active: profile.active !== false,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    notes: profile.notes || "",
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);

  let failureStage = "setup";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Configuração do Supabase ausente.");

    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(request, { error: "Sessão inválida." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "session";
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json(request, { error: "Sessão inválida." }, 401);

    failureStage = "caller_profile";
    const { data: caller, error: callerError } = await adminClient
      .from("profiles")
      .select("id, role, active, permissions")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError) throw callerError;
    const callerPermissions = Array.isArray(caller?.permissions) ? caller.permissions : [];
    const canManage = caller?.active !== false &&
      allowedRoles.has(String(caller?.role || "")) &&
      (caller?.role === "admin" || callerPermissions.includes("team"));
    if (!canManage) return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);

    failureStage = "payload";
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "list");

    if (action === "list") {
      failureStage = "list_profiles";
      const { data: profiles, error } = await adminClient
        .from("profiles")
        .select("id, full_name, email, phone, role, active, permissions, notes, created_at")
        .in("role", Array.from(allowedRoles))
        .order("full_name", { ascending: true });
      if (error) throw error;
      return json(request, { users: (profiles || []).map(publicProfile) });
    }

    if (action === "delete") {
      failureStage = "delete_lookup";
      const targetId = String(payload.user_id || "");
      if (!targetId) return json(request, { error: "Usuário não encontrado." }, 400);
      if (targetId === caller.id) return json(request, { error: "Você não pode excluir o próprio acesso." }, 400);
      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, email, role")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || !allowedRoles.has(String(target.role))) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      if (target.role === "admin" && caller.role !== "admin") return json(request, { error: "Somente um administrador pode excluir outro administrador." }, 403);
      if (target.role === "admin") {
        const { count, error: countError } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if (countError) throw countError;
        if ((count || 0) <= 1) return json(request, { error: "O último administrador ativo não pode ser excluído." }, 400);
      }
      failureStage = "delete_user";
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
      if (deleteError) throw deleteError;
      await adminClient.from("profiles").delete().eq("id", targetId);
      return json(request, { deleted: true, user_id: targetId });
    }

    const fullName = normalizeText(payload.full_name, 80);
    const notes = normalizeText(payload.notes, 240);
    const phone = normalizeText(payload.phone, 24).replace(/\D/g, "");
    const role = String(payload.role || "secretaria").toLowerCase();
    const permissions = normalizePermissions(payload.permissions);
    const active = payload.active !== false;
    if (fullName.length < 2) return json(request, { error: "Informe o nome da pessoa." }, 400);
    if (!allowedRoles.has(role)) return json(request, { error: "Escolha uma função válida do Clube." }, 400);
    if (!permissions.length) return json(request, { error: "Selecione pelo menos uma permissão." }, 400);
    if (role === "admin" && caller.role !== "admin") return json(request, { error: "Somente um administrador pode liberar outro administrador." }, 403);

    if (action === "create") {
      failureStage = "create_user";
      const email = normalizeText(payload.email, 180).toLowerCase();
      const password = String(payload.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
      if (password.length < 8) return json(request, { error: "A senha provisória deve ter pelo menos 8 caracteres." }, 400);
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone, app_context: "admin" },
      });
      if (createError || !created.user) {
        const message = String(createError?.message || "Não foi possível criar o usuário.");
        return json(request, { error: message.toLowerCase().includes("registered") ? "Este e-mail já possui um acesso." : message }, 400);
      }
      failureStage = "create_profile";
      const profile = {
        id: created.user.id,
        full_name: fullName,
        email,
        phone,
        role,
        active,
        permissions,
        notes,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: saveError } = await adminClient.from("profiles").upsert(profile).select().single();
      if (saveError) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        throw saveError;
      }
      return json(request, { user: publicProfile(saved) }, 201);
    }

    if (action === "update") {
      failureStage = "update_lookup";
      const targetId = String(payload.user_id || "");
      if (!targetId) return json(request, { error: "Usuário não encontrado." }, 400);
      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, role, active")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || !allowedRoles.has(String(target.role))) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      if (target.role === "admin" && caller.role !== "admin") return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      if (targetId === caller.id && (!active || !permissions.includes("team") || role !== "admin")) {
        return json(request, { error: "Você não pode remover o próprio acesso de administração." }, 400);
      }
      if (target.role === "admin" && (!active || role !== "admin")) {
        const { count, error: countError } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if (countError) throw countError;
        if ((count || 0) <= 1) return json(request, { error: "O último administrador ativo não pode ser bloqueado ou rebaixado." }, 400);
      }
      const password = String(payload.password || "");
      if (password && password.length < 8) return json(request, { error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
      if (password) {
        failureStage = "update_password";
        const { error: passwordError } = await adminClient.auth.admin.updateUserById(targetId, { password });
        if (passwordError) throw passwordError;
      }
      failureStage = "update_profile";
      const { data: saved, error: saveError } = await adminClient
        .from("profiles")
        .update({ full_name: fullName, phone, role, active, permissions, notes, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .select()
        .single();
      if (saveError) throw saveError;
      return json(request, { user: publicProfile(saved) });
    }

    return json(request, { error: "Ação inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("club-user-access failure", { stage: failureStage, message });
    return json(request, { error: "Não foi possível concluir a alteração de acesso do Clube.", code: failureStage }, 500);
  }
});
