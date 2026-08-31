import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

type DbClient = SupabaseClient<any, "public", "public", any>;

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
  return appCorsHeaders(request, "POST, OPTIONS");
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

function clubInviteRedirectUrl(request: Request) {
  const allowedOrigin = corsHeaders(request)["Access-Control-Allow-Origin"];
  const origin = allowedOrigin && allowedOrigin !== "null"
    ? allowedOrigin
    : "https://app.ilhatenis.com";
  return `${origin}/adm`;
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

async function findAuthUserByEmail(adminClient: DbClient, email: string) {
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
  const barPermissions = currentPermissions.filter((permission) => permission === "bar" || permission.startsWith("bar."));
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
    if (!caller || caller.active === false) {
      return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);
    }
    const callerEmail = String(userData.user.email || "").trim().toLowerCase();
    if (!callerEmail) {
      return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);
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
      return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);
    }
    const callerPermissions = Array.isArray(caller.permissions) ? caller.permissions.map(String) : [];
    const protectedCallerPermissions = Array.isArray(protectedCaller.permissions)
      ? protectedCaller.permissions.map(String)
      : [];
    const callerIsClubAdmin = caller.role === "admin";
    const canManage =
      (allowedRoles.has(String(caller.role || "")) || callerPermissions.some((permission) => allowedPermissions.has(String(permission)))) &&
      (callerIsClubAdmin || (
        callerPermissions.includes("team") && protectedCallerPermissions.includes("team")
      ));
    if (!canManage) return json(request, { error: "Você não tem permissão para gerenciar acessos do Clube." }, 403);

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
          .order("full_name", { ascending: true }),
        adminClient.from("protected_access_accounts").select("email, role").eq("active", true),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (protectedResult.error) throw protectedResult.error;
      const protectedKeys = new Set((protectedResult.data || []).map((account) =>
        `${String(account.email || "").trim().toLowerCase()}\u0000${String(account.role || "")}`
      ));
      const profiles = profileResult.data || [];
      const clubProfiles = (profiles || []).filter((profile) => {
        const profilePermissions = Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
        const isProtected = protectedKeys.has(
          `${String(profile.email || "").trim().toLowerCase()}\u0000${String(profile.role || "")}`,
        );
        return isProtected && (
          allowedRoles.has(String(profile.role || "")) ||
          profilePermissions.some((permission) => allowedPermissions.has(permission))
        );
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
        .select("id, email, full_name, phone, role, active, permissions, notes")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      const deletePermissions = Array.isArray(target?.permissions) ? target.permissions.map(String) : [];
      const targetHasClubAccess = allowedRoles.has(String(target?.role || "")) || deletePermissions.some((permission) => allowedPermissions.has(permission));
      if (!target || !targetHasClubAccess) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      const targetUserResult = await adminClient.auth.admin.getUserById(targetId);
      if (targetUserResult.error) throw targetUserResult.error;
      const targetEmail = String(targetUserResult.data.user?.email || "").trim().toLowerCase();
      const { data: protectedTarget, error: protectedTargetError } = targetEmail
        ? await adminClient.from("protected_access_accounts")
          .select("role, permissions")
          .eq("email", targetEmail)
          .eq("active", true)
          .maybeSingle()
        : { data: null, error: null };
      if (protectedTargetError) throw protectedTargetError;
      if (!protectedTarget) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      const targetIsProtectedAdmin = protectedTarget?.role === "admin";
      if ((target.role === "admin" || targetIsProtectedAdmin) && !callerIsClubAdmin) {
        return json(request, { error: "Somente um administrador pode excluir outro administrador." }, 403);
      }
      if (targetIsProtectedAdmin) {
        const { data: adminCount, error: countError } = await adminClient.rpc("count_active_protected_admins");
        if (countError) throw countError;
        if (Number(adminCount || 0) <= 1) return json(request, { error: "O último administrador ativo não pode ser excluído." }, 400);
      }
      const trustedPermissions = Array.isArray(protectedTarget?.permissions)
        ? protectedTarget.permissions.map(String)
        : [];
      const barPermissions = trustedPermissions.filter((permission) => permission === "bar" || permission.startsWith("bar."));
      const shouldPreserveBar = protectedTarget?.role === "bar" || barPermissions.length > 0;
      const { data: clientAccount, error: clientLookupError } = await adminClient
        .from("app_clients")
        .select("id")
        .eq("id", targetId)
        .maybeSingle();
      if (clientLookupError) throw clientLookupError;
      if (shouldPreserveBar) {
        failureStage = "restore_bar_access";
        const restoredAt = new Date().toISOString();
        const { error: restoreError } = await adminClient
          .from("profiles")
          .update({ role: "bar", permissions: barPermissions, active: true, updated_at: restoredAt })
          .eq("id", targetId);
        if (restoreError) throw restoreError;
        const { error: protectedRestoreError } = await adminClient
          .from("protected_access_accounts")
          .update({ role: "bar", permissions: barPermissions, active: true, updated_at: restoredAt })
          .eq("email", targetEmail);
        if (protectedRestoreError) {
          await adminClient.from("profiles").update({
            role: target.role,
            permissions: target.permissions,
            active: target.active,
            updated_at: new Date().toISOString(),
          }).eq("id", targetId);
          throw protectedRestoreError;
        }
        return json(request, { deleted: true, user_id: targetId, preserved_access: "bar" });
      }
      if (clientAccount) {
        failureStage = "remove_club_profile";
        const { error: profileDeleteError } = await adminClient.from("profiles").delete().eq("id", targetId);
        if (profileDeleteError) throw profileDeleteError;
        return json(request, { deleted: true, user_id: targetId, preserved_access: "client" });
      }
      failureStage = "revoke_user";
      const { error: revokeError } = await adminClient
        .from("profiles")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", targetId);
      if (revokeError) throw revokeError;
      failureStage = "delete_user";
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
      if (deleteError) {
        // Auth and Postgres are separate systems. Restore the profile snapshot
        // when Auth deletion fails so a transient provider error does not leave
        // a still-valid credential with a silently disabled staff profile.
        await adminClient.from("profiles").update({
          full_name: target.full_name,
          email: target.email,
          phone: target.phone,
          role: target.role,
          active: target.active,
          permissions: target.permissions,
          notes: target.notes,
          updated_at: new Date().toISOString(),
        }).eq("id", targetId);
        throw deleteError;
      }
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
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
      let authUser = await findAuthUserByEmail(adminClient, email);
      const protectedLookup = await adminClient.from("protected_access_accounts")
        .select("email, role, permissions, active")
        .eq("email", email)
        .maybeSingle();
      if (protectedLookup.error) throw protectedLookup.error;
      if (protectedLookup.data && !authUser) {
        return json(request, { error: "Esta conta possui acesso protegido. Use o fluxo de recuperação de acesso." }, 409);
      }
      if (protectedLookup.data?.active === false && !callerIsClubAdmin) {
        return json(request, {
          error: "Esta conta foi revogada. Somente um administrador pode reativar ou vincular o acesso.",
        }, 403);
      }
      if (protectedLookup.data?.role === "admin" && !callerIsClubAdmin) {
        return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      }
      const linkedExisting = Boolean(authUser);
      if (!authUser) {
        const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          redirectTo: clubInviteRedirectUrl(request),
          data: { full_name: fullName, phone, app_context: "admin" },
        });
        if (inviteError || !invited.user) {
          const message = String(inviteError?.message || "Não foi possível enviar o convite.");
          return json(request, {
            error: message.toLowerCase().includes("registered")
              ? "Este e-mail já possui uma conta. Atualize o cadastro existente."
              : "Não foi possível enviar o convite de acesso por e-mail. Confira o SMTP e tente novamente.",
          }, 400);
        }
        authUser = invited.user;
      }
      failureStage = "existing_profile";
      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("profiles")
        .select("id, email, full_name, phone, role, active, permissions, notes")
        .eq("id", authUser.id)
        .maybeSingle();
      if (existingProfileError) throw existingProfileError;
      if (existingProfile?.role === "admin" && !callerIsClubAdmin) {
        return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      }
      const protectedRole = String(protectedLookup.data?.role || "");
      const crossSurfaceBarLink = linkedExisting && protectedRole === "bar" && !callerIsClubAdmin;
      if (crossSurfaceBarLink && !existingProfile) {
        return json(request, {
          error: "A conta vinculada ao Bar está incompleta. Um administrador precisa revisar o acesso.",
        }, 409);
      }
      // Bar access remains represented by bar.* permissions, but an explicit
      // administrator grant must promote the primary role to admin.
      const savedRole = role === "admin"
        ? "admin"
        : ["admin", "bar"].includes(protectedRole)
        ? protectedRole
        : role;
      const savedPermissions = permissionsForLinkedAccount(protectedLookup.data, permissions);
      failureStage = "create_profile";
      const profile = {
        id: authUser.id,
        // A manager of one surface may link permissions from that surface, but
        // may not overwrite shared identity/activation owned by another one.
        full_name: crossSurfaceBarLink ? existingProfile?.full_name : fullName,
        email: crossSurfaceBarLink ? existingProfile?.email : email,
        phone: crossSurfaceBarLink ? existingProfile?.phone : phone,
        role: savedRole,
        active: crossSurfaceBarLink ? existingProfile?.active : active,
        permissions: savedPermissions,
        notes: crossSurfaceBarLink ? existingProfile?.notes : notes,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: saveError } = await adminClient.from("profiles").upsert(profile).select().single();
      if (saveError) {
        if (!linkedExisting) await adminClient.auth.admin.deleteUser(authUser.id);
        throw saveError;
      }
      failureStage = "create_protected_access";
      const { error: protectedSaveError } = await adminClient.from("protected_access_accounts").upsert({
        email,
        full_name: String(profile.full_name || fullName),
        role: savedRole,
        permissions: savedPermissions,
        active: profile.active !== false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
      if (protectedSaveError) {
        if (!linkedExisting) {
          await adminClient.from("profiles").delete().eq("id", authUser.id);
          await adminClient.auth.admin.deleteUser(authUser.id);
        } else if (existingProfile) {
          await adminClient.from("profiles").upsert(existingProfile, { onConflict: "id" });
        }
        throw protectedSaveError;
      }
      return json(request, {
        user: publicProfile(saved),
        linked_existing: linkedExisting,
        invited: !linkedExisting,
        message: linkedExisting
          ? "Conta existente vinculada ao Clube. A senha atual foi mantida."
          : "Acesso do Clube criado. A pessoa recebeu um convite por e-mail para definir a senha.",
      }, linkedExisting ? 200 : 201);
    }

    if (action === "update") {
      failureStage = "update_lookup";
      const targetId = String(payload.user_id || "");
      if (!targetId) return json(request, { error: "Usuário não encontrado." }, 400);
      const { data: target, error: targetError } = await adminClient
        .from("profiles")
        .select("id, email, full_name, phone, role, active, permissions, notes")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      const targetPermissions = Array.isArray(target?.permissions) ? target.permissions.map(String) : [];
      const targetHasClubAccess = allowedRoles.has(String(target?.role || "")) || targetPermissions.some((permission) => allowedPermissions.has(permission));
      if (!target || !targetHasClubAccess) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      const targetUserResult = await adminClient.auth.admin.getUserById(targetId);
      if (targetUserResult.error) throw targetUserResult.error;
      const targetEmail = String(targetUserResult.data.user?.email || "").trim().toLowerCase();
      const { data: protectedTarget, error: protectedTargetError } = targetEmail
        ? await adminClient.from("protected_access_accounts")
          .select("role, permissions, active")
          .eq("email", targetEmail)
          .maybeSingle()
        : { data: null, error: null };
      if (protectedTargetError) throw protectedTargetError;
      if (!protectedTarget) return json(request, { error: "Usuário do Clube não encontrado." }, 404);
      if (protectedTarget.active === false && !callerIsClubAdmin) {
        return json(request, { error: "Somente um administrador pode reativar este acesso." }, 403);
      }
      const targetIsProtectedAdmin = protectedTarget?.role === "admin";
      if ((target.role === "admin" || targetIsProtectedAdmin) && !callerIsClubAdmin) {
        return json(request, { error: "Somente um administrador pode alterar outro administrador." }, 403);
      }
      if (targetId === caller.id && (!active || !permissions.includes("team") || role !== "admin")) {
        return json(request, { error: "Você não pode remover o próprio acesso de administração." }, 400);
      }
      if (targetIsProtectedAdmin && (!active || role !== "admin")) {
        const { data: adminCount, error: countError } = await adminClient.rpc("count_active_protected_admins");
        if (countError) throw countError;
        if (Number(adminCount || 0) <= 1) return json(request, { error: "O último administrador ativo não pode ser bloqueado ou rebaixado." }, 400);
      }
      const password = String(payload.password || "");
      if (password && password.length < 8) return json(request, { error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
      const protectedPermissions = Array.isArray(protectedTarget?.permissions)
        ? protectedTarget.permissions.map(String)
        : [];
      const targetHasBarAccess = protectedTarget?.role === "bar" || protectedPermissions.some((permission) =>
        permission === "bar" || permission.startsWith("bar.")
      );
      const crossSurfaceBarTarget = targetHasBarAccess && !callerIsClubAdmin;
      if (password && crossSurfaceBarTarget) {
        return json(request, { error: "Somente um administrador pode alterar a senha de uma conta vinculada ao Bar." }, 403);
      }
      const nextRole = role === "admin"
        ? "admin"
        : protectedTarget?.role === "bar"
        ? "bar"
        : role;
      const nextPermissions = permissionsForLinkedAccount(protectedTarget, permissions);
      const barPermissions = protectedPermissions.filter((permission) =>
        permission === "bar" || permission.startsWith("bar.")
      );
      const preserveOnlyBar = targetHasBarAccess && !active;
      const effectiveRole = preserveOnlyBar ? "bar" : nextRole;
      const effectivePermissions = preserveOnlyBar ? barPermissions : nextPermissions;
      const effectiveActive = preserveOnlyBar ? true : active;
      failureStage = "update_profile";
      // A team manager owns only the Club permission subset. Shared identity,
      // global activation and credentials of a Bar-linked account remain under
      // an administrator so one surface cannot revoke the other.
      const profilePatch = crossSurfaceBarTarget
        ? {
          role: effectiveRole,
          active: effectiveActive,
          permissions: effectivePermissions,
          updated_at: new Date().toISOString(),
        }
        : {
          full_name: fullName,
          phone,
          role: effectiveRole,
          active: effectiveActive,
          permissions: effectivePermissions,
          notes,
          updated_at: new Date().toISOString(),
        };
      const { data: saved, error: saveError } = await adminClient
        .from("profiles")
        .update(profilePatch)
        .eq("id", targetId)
        .select()
        .single();
      if (saveError) throw saveError;
      failureStage = "update_protected_access";
      const { error: protectedSaveError } = await adminClient.from("protected_access_accounts").upsert({
        email: targetEmail,
        full_name: String(saved.full_name || fullName || target.full_name || targetEmail),
        role: effectiveRole,
        permissions: effectivePermissions,
        active: effectiveActive,
        updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
      if (protectedSaveError) {
        await adminClient.from("profiles").update({
          full_name: target.full_name,
          phone: target.phone,
          role: target.role,
          active: target.active,
          permissions: target.permissions,
          notes: target.notes,
          updated_at: new Date().toISOString(),
        }).eq("id", targetId);
        throw protectedSaveError;
      }
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
          await adminClient.from("protected_access_accounts").update({
            role: protectedTarget.role,
            active: protectedTarget.active,
            permissions: protectedTarget.permissions,
            updated_at: new Date().toISOString(),
          }).eq("email", targetEmail);
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
    console.error("club-user-access failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível concluir a alteração de acesso do Clube.", code: failureStage }, 500);
  }
});
