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

const preservedBarPermissions = [
  "bar.overview",
  "bar.orders",
  "bar.kitchen",
  "bar.customers",
  "bar.products",
  "bar.menu",
  "bar.finance",
  "bar.qrcodes",
  "bar.events",
];

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

async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((user) => String(user.email || "").toLowerCase() === normalizedEmail);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

function permissionsForLinkedAccount(existingProfile: Record<string, unknown> | null, clubPermissions: string[]) {
  const currentPermissions = Array.isArray(existingProfile?.permissions)
    ? existingProfile.permissions.map(String)
    : [];
  const barPermissions = String(existingProfile?.role || "") === "bar"
    ? preservedBarPermissions
    : currentPermissions.filter((permission) => permission === "bar" || permission.startsWith("bar."));
  return Array.from(new Set([...clubPermissions, ...barPermissions]));
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
    const callerIsClubAdmin = caller?.role === "admin" ||
      Array.from(allowedPermissions).every((permission) => callerPermissions.includes(permission));
    const canManage = caller?.active !== false &&
      (allowedRoles.has(String(caller?.role || "")) || callerPermissions.some((permission) => allowedPermissions.has(String(permission)))) &&
      (callerIsClubAdmin || callerPermissions.includes("team"));
    if (!canManage) return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);

    failureStage = "payload";
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "list");

    if (action === "list") {
      failureStage = "list_profiles";
      const { data: profiles, error } = await adminClient
        .from("profiles")
        .select("id, full_name, email, phone, role, active, permissions, notes, created_at")
        .order("full_name", { ascending: true });
      if (error) throw error;
      const clubProfiles = (profiles || []).filter((profile) => {
        const profilePermissions = Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
        return allowedRoles.has(String(profile.role || "")) || profilePermissions.some((permission) => allowedPermissions.has(permission));
      });
      return json(request, { users: clubProfiles.map(publicProfile) });
    }

    if (action === "delete") {
      failureStage = "delete_lookup";
      const targetId = String(payload.user_id || "");
      if (!targetId) return json(request, { error: "Usuário não encontrado." }, 400);
      if (targetId === caller.id) return json(request, { error: "Você não pode excluir o próprio acesso." }, 400);
      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, email, role, permissions")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      const deletePermissions = Array.isArray(target?.permissions) ? target.permissions.map(String) : [];
      const targetHasClubAccess = allowedRoles.has(String(target?.role || "")) || deletePermissions.some((permission) => allowedPermissions.has(permission));
      if (!target || !targetHasClubAccess) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      if (target.role === "admin" && !callerIsClubAdmin) return json(request, { error: "Somente um administrador pode excluir outro administrador." }, 403);
      if (target.role === "admin") {
        const { count, error: countError } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if (countError) throw countError;
        if ((count || 0) <= 1) return json(request, { error: "O último administrador ativo não pode ser excluído." }, 400);
      }
      const currentPermissions = Array.isArray(target.permissions) ? target.permissions.map(String) : [];
      const barPermissions = currentPermissions.filter((permission) => permission === "bar" || permission.startsWith("bar."));
      const { data: clientAccount, error: clientLookupError } = await adminClient
        .from("app_clients")
        .select("id")
        .eq("id", targetId)
        .maybeSingle();
      if (clientLookupError) throw clientLookupError;
      if (barPermissions.length) {
        failureStage = "restore_bar_access";
        const { error: restoreError } = await adminClient
          .from("profiles")
          .update({ role: "bar", permissions: barPermissions, active: true, updated_at: new Date().toISOString() })
          .eq("id", targetId);
        if (restoreError) throw restoreError;
        return json(request, { deleted: true, user_id: targetId, preserved_access: "bar" });
      }
      if (clientAccount) {
        failureStage = "remove_club_profile";
        const { error: profileDeleteError } = await adminClient.from("profiles").delete().eq("id", targetId);
        if (profileDeleteError) throw profileDeleteError;
        return json(request, { deleted: true, user_id: targetId, preserved_access: "client" });
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
    if (role === "admin" && !callerIsClubAdmin) return json(request, { error: "Somente um administrador pode liberar outro administrador." }, 403);

    if (action === "create") {
      failureStage = "create_user";
      const email = normalizeText(payload.email, 180).toLowerCase();
      const password = String(payload.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
      if (password.length < 8) return json(request, { error: "A senha provisória deve ter pelo menos 8 caracteres." }, 400);
      let authUser = await findAuthUserByEmail(adminClient, email);
      const linkedExisting = Boolean(authUser);
      if (!authUser) {
        const { data: created, error: createError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, phone, app_context: "admin" },
        });
        if (createError || !created.user) {
          const message = String(createError?.message || "Não foi possível criar o usuário.");
          return json(request, { error: message }, 400);
        }
        authUser = created.user;
      }
      failureStage = "existing_profile";
      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("profiles")
        .select("id, role, permissions")
        .eq("id", authUser.id)
        .maybeSingle();
      if (existingProfileError) throw existingProfileError;
      failureStage = "create_profile";
      const profile = {
        id: authUser.id,
        full_name: fullName,
        email,
        phone,
        role: existingProfile?.role === "bar" ? "bar" : role,
        active,
        permissions: permissionsForLinkedAccount(existingProfile, permissions),
        notes,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: saveError } = await adminClient.from("profiles").upsert(profile).select().single();
      if (saveError) {
        if (!linkedExisting) await adminClient.auth.admin.deleteUser(authUser.id);
        throw saveError;
      }
      return json(request, {
        user: publicProfile(saved),
        linked_existing: linkedExisting,
        message: linkedExisting
          ? "Conta existente vinculada ao Clube. A senha atual foi mantida."
          : "Acesso do Clube criado.",
      }, linkedExisting ? 200 : 201);
    }

    if (action === "update") {
      failureStage = "update_lookup";
      const targetId = String(payload.user_id || "");
      if (!targetId) return json(request, { error: "Usuário não encontrado." }, 400);
      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, role, active, permissions")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      const targetPermissions = Array.isArray(target?.permissions) ? target.permissions.map(String) : [];
      const targetHasClubAccess = allowedRoles.has(String(target?.role || "")) || targetPermissions.some((permission) => allowedPermissions.has(permission));
      if (!target || !targetHasClubAccess) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      if (target.role === "admin" && !callerIsClubAdmin) return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
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
        .update({
          full_name: fullName,
          phone,
          role: target.role === "bar" ? "bar" : role,
          active,
          permissions: permissionsForLinkedAccount(target, permissions),
          notes,
          updated_at: new Date().toISOString(),
        })
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
