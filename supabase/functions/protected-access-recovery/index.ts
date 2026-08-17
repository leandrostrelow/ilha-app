import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.ilhatenis.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizedEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

const oneTimeRecoveryEmail = "kikostrelow@gmail.com";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);

  let failureStage = "request";
  try {
    const payload = await request.json().catch(() => ({}));
    const email = normalizedEmail(payload.email);
    const genericMessage = "Se este e-mail tiver acesso de equipe, enviaremos as instruções para recuperá-lo.";
    if (!/^\S+@\S+\.\S+$/.test(email)) return response({ message: genericMessage }, 202);
    if (email !== oneTimeRecoveryEmail) return response({ message: genericMessage }, 202);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error("Configuração administrativa ausente.");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    failureStage = "protected_lookup";
    const { data: protectedAccount, error: protectedError } = await admin
      .from("protected_access_accounts")
      .select("email, full_name, role, permissions, active, last_recovery_at")
      .eq("email", email)
      .maybeSingle();
    if (protectedError) throw protectedError;
    if (!protectedAccount?.active) return response({ message: genericMessage }, 202);
    if (protectedAccount.last_recovery_at) {
      return response({ message: genericMessage }, 202);
    }

    const recoveryStartedAt = new Date().toISOString();
    failureStage = "claim";
    const { data: claimed, error: claimError } = await admin
      .from("protected_access_accounts")
      .update({ last_recovery_at: recoveryStartedAt, updated_at: recoveryStartedAt })
      .eq("email", email)
      .is("last_recovery_at", null)
      .select("email")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return response({ message: genericMessage }, 202);

    failureStage = "user_lookup";
    const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    let user = usersPage.users.find((item) => normalizedEmail(item.email) === email) || null;

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
    const { error: profileError } = await admin.rpc("restore_protected_profile", { p_email: email });
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

    return response({ message: genericMessage }, 202);
  } catch (error) {
    console.error("protected-access-recovery", failureStage, error);
    return response({ error: "Não foi possível enviar a recuperação agora.", stage: failureStage }, 500);
  }
});
