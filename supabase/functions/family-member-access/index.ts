import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

type DbClient = SupabaseClient<any, "public", "public", any>;

function corsHeaders(request: Request) {
  return appCorsHeaders(request, "POST, OPTIONS");
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
    return JSON.parse(currentKeys).default || "";
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
    return JSON.parse(currentKeys).default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_publishable_") ? currentKeys : "";
  }
}

function normalizedEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : "";
}

function validUuid(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : "";
}

function playRedirectUrl(request: Request) {
  const configured = String(Deno.env.get("ILHA_PLAY_URL") || "").trim();
  const origin = String(request.headers.get("origin") || "").trim();
  for (const candidate of [configured, origin, "https://app.ilhatenis.com"]) {
    try {
      const url = new URL(candidate);
      const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
      if ((url.protocol === "https:" || local) && !url.username && !url.password) return `${url.origin}/`;
    } catch (_error) {
      // Tenta a próxima origem segura.
    }
  }
  return "https://app.ilhatenis.com/";
}

async function findAuthUserByEmail(adminClient: DbClient, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((user) => String(user.email || "").trim().toLowerCase() === email);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 10000) {
    return json(request, { error: "Dados enviados são muito grandes." }, 413);
  }

  let stage = "setup";
  let createdAuthUserId = "";
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
    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    stage = "session";
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json(request, { error: "Sessão inválida." }, 401);

    stage = "permission";
    const callerEmail = String(userData.user.email || "").trim().toLowerCase();
    const [profileResult, protectedResult] = await Promise.all([
      adminClient.from("profiles").select("id, role, active, permissions").eq("id", userData.user.id).maybeSingle(),
      callerEmail
        ? adminClient.from("protected_access_accounts").select("role, active, permissions").eq("email", callerEmail).eq("active", true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (protectedResult.error) throw protectedResult.error;
    const profile = profileResult.data;
    const protectedAccount = protectedResult.data;
    const profilePermissions = Array.isArray(profile?.permissions) ? profile.permissions.map(String) : [];
    const protectedPermissions = Array.isArray(protectedAccount?.permissions)
      ? protectedAccount.permissions.map(String)
      : [];
    const isAdmin = profile?.role === "admin" && protectedAccount?.role === "admin";
    const canManageClients = profile?.active !== false && protectedAccount &&
      (isAdmin || (profilePermissions.includes("clients.write") && protectedPermissions.includes("clients.write")));
    if (!canManageClients) return json(request, { error: "Você não tem permissão para liberar membros da família." }, 403);

    stage = "payload";
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 10000) {
      return json(request, { error: "Dados enviados são muito grandes." }, 413);
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
      payload = parsed as Record<string, unknown>;
    } catch (_error) {
      return json(request, { error: "Dados inválidos." }, 400);
    }
    if (String(payload.action || "") !== "enable_access") {
      return json(request, { error: "Ação inválida." }, 400);
    }
    const familyMemberId = validUuid(payload.family_member_id);
    const email = normalizedEmail(payload.email);
    if (!familyMemberId) return json(request, { error: "Membro da família inválido." }, 400);
    if (!email) return json(request, { error: "Informe um e-mail válido e exclusivo." }, 400);

    stage = "member";
    const { data: member, error: memberError } = await adminClient
      .from("app_family_members")
      .select("id, full_name, status, member_client_id")
      .eq("id", familyMemberId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return json(request, { error: "Membro da família não encontrado." }, 404);
    if (String(member.status || "").toUpperCase() !== "ATIVO") {
      return json(request, { error: "Aprove o membro antes de liberar o Ilha Play." }, 409);
    }

    stage = "auth_user";
    let authUser = await findAuthUserByEmail(adminClient, email);
    let delivery: "invite_sent" | "recovery_sent";
    if (!authUser) {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: playRedirectUrl(request),
        data: { full_name: String(member.full_name || ""), app_context: "client", client_type: "cliente" },
      });
      if (error || !data.user) throw error || new Error("O serviço de autenticação não criou o convite.");
      authUser = data.user;
      createdAuthUserId = authUser.id;
      delivery = "invite_sent";
    } else {
      delivery = "recovery_sent";
    }

    stage = "link";
    const { data: linkedData, error: linkError } = await adminClient.rpc("admin_enable_family_member_access", {
      p_family_member_id: familyMemberId,
      p_auth_user_id: authUser.id,
      p_email: email,
    });
    if (linkError) {
      if (createdAuthUserId) await adminClient.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
      throw linkError;
    }

    if (delivery === "recovery_sent") {
      stage = "recovery_email";
      const { error: recoveryError } = await publicClient.auth.resetPasswordForEmail(email, {
        redirectTo: playRedirectUrl(request),
      });
      if (recoveryError) {
        return json(request, {
          ok: true,
          member: Array.isArray(linkedData) ? linkedData[0] : linkedData,
          delivery: "linked_email_failed",
          warning: "O acesso foi vinculado, mas o e-mail de criação de senha não foi enviado. Tente novamente.",
        });
      }
    }

    return json(request, {
      ok: true,
      member: Array.isArray(linkedData) ? linkedData[0] : linkedData,
      delivery,
    });
  } catch (error) {
    console.error("family-member-access failure", {
      stage,
      code: String((error as { code?: unknown })?.code || "unexpected_error").slice(0, 80),
    });
    return json(request, { error: "Não foi possível liberar o acesso do membro agora." }, 500);
  }
});
