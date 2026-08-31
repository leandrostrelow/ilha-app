import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

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
    phone: profile.phone || "",
    role: profile.role || "bar",
    active: profile.active !== false,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    notes: profile.notes || "",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 25000) {
    return json(request, { error: "Dados enviados são muito grandes." }, 413);
  }

  let failureStage = "setup";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Configuração do Supabase ausente.");

    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(request, { error: "Sessão inválida." }, 401);

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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
    if (!caller || caller.active === false) {
      return json(request, { error: "Você não tem permissão para gerenciar acessos." }, 403);
    }
    const callerEmail = String(userData.user.email || "").trim().toLowerCase();
    if (!callerEmail) {
      return json(request, { error: "Você não tem permissão para gerenciar acessos." }, 403);
    }
    const { data: protectedCaller, error: protectedCallerError } = await adminClient
      .from("protected_access_accounts")
      .select("email, permissions")
      .eq("email", callerEmail)
      .eq("role", String(caller.role || ""))
      .eq("active", true)
      .maybeSingle();
    if (protectedCallerError) throw protectedCallerError;
    if (!protectedCaller) {
      return json(request, { error: "Você não tem permissão para gerenciar acessos." }, 403);
    }
    const callerPermissions = Array.isArray(caller.permissions) ? caller.permissions.map(String) : [];
    const protectedCallerPermissions = Array.isArray(protectedCaller.permissions)
      ? protectedCaller.permissions.map(String)
      : [];
    const canManage = caller.role === "admin" || (
      callerPermissions.includes("bar.access") && protectedCallerPermissions.includes("bar.access")
    );
    if (!canManage) return json(request, { error: "Você não tem permissão para gerenciar acessos." }, 403);

    failureStage = "payload";
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 25000) {
      return json(request, { error: "Dados enviados são muito grandes." }, 413);
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, { error: "Dados inválidos." }, 400);
      }
      payload = parsed as Record<string, unknown>;
    } catch (_error) {
      return json(request, { error: "Dados inválidos." }, 400);
    }
    const action = String(payload.action || "list");

    if (action === "list") {
      failureStage = "list_profiles";
      const [profileResult, protectedResult] = await Promise.all([
        adminClient.from("profiles")
          .select("id, full_name, email, phone, role, active, permissions, notes, created_at")
          .order("created_at", { ascending: true }),
        adminClient.from("protected_access_accounts").select("email, role").eq("active", true),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (protectedResult.error) throw protectedResult.error;
      const protectedKeys = new Set((protectedResult.data || []).map((account) =>
        `${String(account.email || "").trim().toLowerCase()}\u0000${String(account.role || "")}`
      ));
      const profiles = profileResult.data || [];
      const users = (profiles || []).filter((profile) => {
        const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
        const isProtected = protectedKeys.has(
          `${String(profile.email || "").trim().toLowerCase()}\u0000${String(profile.role || "")}`,
        );
        return isProtected && (
          profile.role === "admin" || profile.role === "bar" || permissions.includes("bar") ||
          permissions.some((permission) => String(permission).startsWith("bar."))
        );
      }).map(publicProfile);
      return json(request, { users });
    }

    const fullName = normalizeText(payload.full_name, 80);
    const notes = normalizeText(payload.notes, 180);
    const phone = normalizeText(payload.phone, 24).replace(/\D/g, "");
    const permissions = normalizePermissions(payload.permissions);
    const active = payload.active !== false;
    if (fullName.length < 2) return json(request, { error: "Informe o nome da pessoa." }, 400);
    if (phone.length < 10 || phone.length > 13) return json(request, { error: "Informe um WhatsApp válido com DDD." }, 400);
    if (!permissions.length) return json(request, { error: "Selecione pelo menos uma área." }, 400);

    if (action === "create") {
      failureStage = "create_user";
      const email = normalizeText(payload.email, 180).toLowerCase();
      const password = String(payload.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
      if (password.length < 8) return json(request, { error: "A senha provisória deve ter 8 caracteres." }, 400);

      const protectedLookup = await adminClient.from("protected_access_accounts")
        .select("email, role, active")
        .eq("email", email)
        .maybeSingle();
      if (protectedLookup.error) throw protectedLookup.error;
      if (protectedLookup.data) {
        return json(request, { error: "Esta conta possui acesso protegido. Use o fluxo de recuperação de acesso." }, 409);
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // The legacy Auth trigger skips app_context=admin when creating Ilha
        // Play clients. Staff authorization itself comes only from the
        // protected allowlist/profile written below, never from this metadata.
        user_metadata: { full_name: fullName, app_context: "admin", staff_surface: "bar" },
      });
      if (createError || !created.user) {
        const message = String(createError?.message || "Não foi possível criar o usuário.");
        return json(request, {
          error: message.toLowerCase().includes("registered")
            ? "Este e-mail já possui um acesso. Atualize o cadastro existente."
            : "Não foi possível criar o acesso do Bar.",
        }, 400);
      }

      const profile = {
        id: created.user.id,
        full_name: fullName,
        email,
        phone,
        role: "bar",
        active,
        permissions,
        notes,
        updated_at: new Date().toISOString(),
      };
      failureStage = "create_profile";
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
        .select("id, email, role, active, full_name, phone, permissions, notes")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json(request, { error: "Usuário não encontrado." }, 404);
      const targetPermissions = Array.isArray(target.permissions) ? target.permissions.map(String) : [];
      const targetHasBarAccess = target.role === "admin" || target.role === "bar" ||
        targetPermissions.includes("bar") || targetPermissions.some((permission) => permission.startsWith("bar."));
      if (!targetHasBarAccess) return json(request, { error: "Usuário do Bar não encontrado." }, 404);
      const targetUserResult = await adminClient.auth.admin.getUserById(targetId);
      if (targetUserResult.error) throw targetUserResult.error;
      const targetEmail = String(targetUserResult.data.user?.email || "").trim().toLowerCase();
      const { data: protectedTarget, error: protectedTargetError } = targetEmail
        ? await adminClient.from("protected_access_accounts")
          .select("role, permissions")
          .eq("email", targetEmail)
          .eq("role", String(target.role || ""))
          .eq("active", true)
          .maybeSingle()
        : { data: null, error: null };
      if (protectedTargetError) throw protectedTargetError;
      if (!protectedTarget) return json(request, { error: "Usuário do Bar não encontrado." }, 404);
      if ((target.role === "admin" || protectedTarget?.role === "admin") && caller.role !== "admin") {
        return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      }
      if (targetId === caller.id && (!active || !permissions.includes("bar.access")) && caller.role !== "admin") {
        return json(request, { error: "Você não pode remover o próprio acesso de administração." }, 400);
      }

      const trustedTargetPermissions = Array.isArray(protectedTarget.permissions)
        ? protectedTarget.permissions.map(String)
        : [];
      const nonBarPermissions = trustedTargetPermissions.filter((permission) =>
        permission !== "bar" && !permission.startsWith("bar.")
      );
      // A profile may keep role=bar while also being linked to the Club. In
      // that case a Bar access manager must not change global identity fields,
      // disable the whole account, or reset its password.
      const targetIsBarOnly = target.role === "bar" && nonBarPermissions.length === 0;
      const callerIsClubAdmin = caller.role === "admin";
      const mergedPermissions = Array.from(new Set([...nonBarPermissions, ...permissions]));
      const effectiveActive = callerIsClubAdmin || targetIsBarOnly ? active : target.active !== false;
      const password = String(payload.password || "");
      if (password && password.length < 8) return json(request, { error: "A nova senha deve ter 8 caracteres." }, 400);
      if (password && !callerIsClubAdmin && !targetIsBarOnly) {
        return json(request, { error: "Somente a administração do Clube pode alterar a senha desta conta vinculada." }, 403);
      }
      failureStage = "update_profile";
      const profilePatch = callerIsClubAdmin || targetIsBarOnly
        ? {
          full_name: fullName,
          phone,
          active: effectiveActive,
          permissions: mergedPermissions,
          notes,
          updated_at: new Date().toISOString(),
        }
        : {
          active: effectiveActive,
          permissions: mergedPermissions,
          updated_at: new Date().toISOString(),
        };
      const { data: saved, error: saveError } = await adminClient
        .from("profiles")
        .update(profilePatch)
        .eq("id", targetId)
        .select()
        .single();
      if (saveError) throw saveError;
      if (password) {
        failureStage = "update_password";
        const { error: passwordError } = await adminClient.auth.admin.updateUserById(targetId, { password });
        if (passwordError) {
          await adminClient.from("profiles").update({
            full_name: target.full_name,
            phone: target.phone,
            role: target.role,
            active: target.active,
            permissions: target.permissions,
            notes: target.notes,
            updated_at: new Date().toISOString(),
          }).eq("id", targetId);
          throw passwordError;
        }
      }
      return json(request, { user: publicProfile(saved) });
    }

    return json(request, { error: "Ação inválida." }, 400);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as Record<string, unknown>).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("bar-user-access failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível concluir a alteração de acesso.", code: failureStage }, 500);
  }
});
