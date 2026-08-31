import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appCorsHeaders } from "../_shared/cors.ts";

type DbClient = SupabaseClient<any, "public", "public", any>;

type RateWindow = { count: number; resetAt: number };
const recoveryRateWindows = new Map<string, RateWindow>();
const genericMessage = "Se este e-mail tiver acesso de equipe, enviaremos as instruções para recuperá-lo.";
const throttledMessage = "Solicitação recebida. Aguarde alguns minutos antes de tentar novamente e confira também o spam.";

function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = recoveryRateWindows.get(key);
  if (!current || current.resetAt <= now) {
    recoveryRateWindows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  if (recoveryRateWindows.size > 2000) {
    for (const [entryKey, entry] of recoveryRateWindows) {
      if (entry.resetAt <= now) recoveryRateWindows.delete(entryKey);
    }
  }
  return current.count > limit;
}

function corsHeaders(request: Request) {
  return appCorsHeaders(request, "POST, OPTIONS", "authorization, x-client-info, apikey, content-type");
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizedEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
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

async function findAuthUserByEmail(admin: DbClient, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((item) => normalizedEmail(item.email) === email);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, { error: "Método não permitido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 5000) {
    return response(request, { error: "Dados enviados são muito grandes." }, 413);
  }

  const forwardedAddress = String(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      "unknown",
  ).trim().slice(0, 80);
  const rateLimited = consumeRateLimit("global", 100, 10 * 60 * 1000) ||
    consumeRateLimit(`ip:${forwardedAddress}`, 20, 10 * 60 * 1000);
  if (rateLimited) return response(request, { message: throttledMessage }, 202);

  let failureStage = "request";
  let admin: DbClient | null = null;
  let claimedEmail = "";
  let recoveryStartedAt = "";
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 5000) {
      return response(request, { error: "Dados enviados são muito grandes." }, 413);
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return response(request, { error: "Dados inválidos." }, 400);
      }
      payload = parsed as Record<string, unknown>;
    } catch (_error) {
      return response(request, { error: "Dados inválidos." }, 400);
    }
    const email = normalizedEmail(payload.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) return response(request, { message: genericMessage }, 202);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = serviceRoleKey();
    const anonKey = publicApiKey();
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Configuração administrativa ausente.");

    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    failureStage = "protected_lookup";
    const { data: protectedAccount, error: protectedError } = await admin
      .from("protected_access_accounts")
      .select("email, full_name, role, permissions, active")
      .eq("email", email)
      .maybeSingle();
    if (protectedError) throw protectedError;
    if (!protectedAccount?.active) return response(request, { message: genericMessage }, 202);

    failureStage = "claim";
    const claimedAt = new Date().toISOString();
    const cooldownThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: claimedRows, error: claimError } = await admin
      .from("protected_access_accounts")
      .update({ last_recovery_at: claimedAt, updated_at: claimedAt })
      .eq("email", email)
      .eq("active", true)
      .or(`last_recovery_at.is.null,last_recovery_at.lte.${cooldownThreshold}`)
      .select("last_recovery_at")
      .limit(1);
    if (claimError) throw claimError;
    if (!claimedRows?.length) return response(request, { message: throttledMessage }, 202);
    recoveryStartedAt = String(claimedRows[0].last_recovery_at || claimedAt);
    claimedEmail = email;

    failureStage = "user_lookup";
    let user = await findAuthUserByEmail(admin, email);

    if (!user) {
      failureStage = "user_create";
      const generatedPassword = `${crypto.randomUUID()}Aa1!`;
      const appContext = protectedAccount.role === "bar" ? "bar" : "admin";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: {
          full_name: protectedAccount.full_name,
          app_context: appContext,
          protected_access: true,
        },
      });
      if (createError || !created.user) throw createError || new Error("Não foi possível restaurar o usuário.");
      user = created.user;
    }

    failureStage = "profile_restore";
    const { data: existingProfile, error: existingProfileError } = await admin
      .from("profiles")
      .select("permissions")
      .eq("id", user.id)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;
    const protectedPermissions = Array.isArray(protectedAccount.permissions)
      ? protectedAccount.permissions.map(String)
      : [];
    const existingPermissions = Array.isArray(existingProfile?.permissions)
      ? existingProfile.permissions.map(String)
      : [];
    const linkedBarPermissions = existingPermissions.filter((permission) =>
      permission === "bar" || permission.startsWith("bar.")
    );
    const { error: profileError } = await admin.from("profiles").upsert({
      id: user.id,
      full_name: protectedAccount.full_name,
      email,
      role: protectedAccount.role,
      active: true,
      permissions: Array.from(new Set([...protectedPermissions, ...linkedBarPermissions])),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    failureStage = "recovery_email";
    const { error: recoveryError } = await publicClient.auth.resetPasswordForEmail(email, {
      redirectTo: "https://app.ilhatenis.com/adm?recovery=1",
    });
    if (recoveryError) {
      await admin.from("protected_access_accounts")
        .update({ last_recovery_at: null, updated_at: new Date().toISOString() })
        .eq("email", email)
        .eq("last_recovery_at", recoveryStartedAt);
      throw recoveryError;
    }

    return response(request, { message: genericMessage }, 202);
  } catch (error) {
    if (admin && claimedEmail && recoveryStartedAt) {
      await admin.from("protected_access_accounts")
        .update({ last_recovery_at: null, updated_at: new Date().toISOString() })
        .eq("email", claimedEmail)
        .eq("last_recovery_at", recoveryStartedAt);
    }
    const code = error && typeof error === "object" && "code" in error
      ? String((error as Record<string, unknown>).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("protected-access-recovery failure", { stage: failureStage, code });
    return response(request, { error: "Não foi possível enviar a recuperação agora." }, 500);
  }
});
