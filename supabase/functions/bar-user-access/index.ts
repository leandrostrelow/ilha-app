import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

const allowedPermissions = new Set([
  "bar.overview",
  "bar.orders",
  "bar.kitchen",
  "bar.customers",
  "bar.products",
  "bar.menu",
  "bar.finance",
  "bar.qrcodes",
  "bar.events",
  "bar.access",
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

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter((permission) => allowedPermissions.has(permission))));
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function publicProfile(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    full_name: profile.full_name || "",
    email: profile.email || "",
    role: profile.role || "bar",
    active: profile.active !== false,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    notes: profile.notes || "",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);

  let failureStage = "setup";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    if (!supabaseUrl || !anonKey) throw new Error("Configuração do Supabase ausente.");

    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(request, { error: "Sessão inválida." }, 401);

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    failureStage = "session";
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json(request, { error: "Sessão inválida." }, 401);

    failureStage = "caller_profile";
    const { data: caller, error: callerError } = await supabase
      .from("profiles")
      .select("id, role, active, permissions")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError) throw callerError;
    const callerPermissions = Array.isArray(caller?.permissions) ? caller.permissions : [];
    const canManage = caller?.active !== false && (caller?.role === "admin" || callerPermissions.includes("bar.access"));
    if (!canManage) return json(request, { error: "Você não tem permissão para gerenciar acessos." }, 403);

    failureStage = "payload";
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "list");

    if (action === "list") {
      failureStage = "list_profiles";
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, permissions, notes, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const users = (profiles || []).filter((profile) => {
        const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
        return profile.role === "admin" || profile.role === "bar" || permissions.includes("bar") || permissions.some((permission) => String(permission).startsWith("bar."));
      }).map(publicProfile);
      return json(request, { users });
    }

    const fullName = normalizeText(payload.full_name, 80);
    const notes = normalizeText(payload.notes, 180);
    const permissions = normalizePermissions(payload.permissions);
    const active = payload.active !== false;
    if (fullName.length < 2) return json(request, { error: "Informe o nome da pessoa." }, 400);
    if (!permissions.length) return json(request, { error: "Selecione pelo menos uma área." }, 400);

    if (action === "create") {
      failureStage = "create_user";
      const email = normalizeText(payload.email, 180).toLowerCase();
      const password = String(payload.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
      if (password.length < 8) return json(request, { error: "A senha provisória deve ter 8 caracteres." }, 400);

      const supabaseKey = serviceRoleKey();
      if (!supabaseKey) throw new Error("Configuração administrativa do Supabase ausente.");
      const adminClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, app_context: "bar" },
      });
      if (createError || !created.user) {
        const message = String(createError?.message || "Não foi possível criar o usuário.");
        return json(request, { error: message.toLowerCase().includes("registered") ? "Este e-mail já possui um acesso." : message }, 400);
      }

      const profile = {
        id: created.user.id,
        full_name: fullName,
        email,
        role: "bar",
        active,
        permissions,
        notes,
        updated_at: new Date().toISOString(),
      };
      failureStage = "create_profile";
      const { data: saved, error: saveError } = await supabase.from("profiles").upsert(profile).select().single();
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
      const { data: target, error: targetError } = await supabase.from("profiles").select("id, role").eq("id", targetId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json(request, { error: "Usuário não encontrado." }, 404);
      if (target.role === "admin" && caller.role !== "admin") return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      if (targetId === caller.id && (!active || !permissions.includes("bar.access")) && caller.role !== "admin") {
        return json(request, { error: "Você não pode remover o próprio acesso de administração." }, 400);
      }

      const password = String(payload.password || "");
      if (password && password.length < 8) return json(request, { error: "A nova senha deve ter 8 caracteres." }, 400);
      if (password) {
        failureStage = "update_password";
        const supabaseKey = serviceRoleKey();
        if (!supabaseKey) throw new Error("Configuração administrativa do Supabase ausente.");
        const adminClient = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error: passwordError } = await adminClient.auth.admin.updateUserById(targetId, { password });
        if (passwordError) throw passwordError;
      }
      failureStage = "update_profile";
      const { data: saved, error: saveError } = await supabase
        .from("profiles")
        .update({ full_name: fullName, active, permissions, notes, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .select()
        .single();
      if (saveError) throw saveError;
      return json(request, { user: publicProfile(saved) });
    }

    return json(request, { error: "Ação inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("bar-user-access failure", { stage: failureStage, message });
    return json(request, { error: "Não foi possível concluir a alteração de acesso.", code: failureStage }, 500);
  }
});
