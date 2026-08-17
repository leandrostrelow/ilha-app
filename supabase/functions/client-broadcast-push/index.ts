import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.ilhatenis.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = serviceRoleKey();
    const authorization = request.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) return json({ error: "Acesso não autorizado." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: allowed, error: permissionError } = await caller.rpc("is_club_office");
    if (permissionError || allowed !== true) return json({ error: "Acesso não autorizado." }, 403);

    const input = await request.json();
    const title = String(input.title || "Ilha Play").trim().slice(0, 90);
    const body = String(input.body || "").trim().slice(0, 280);
    const url = String(input.url || "/clientes/");
    const userId = String(input.user_id || "").trim();
    if (!title || !body) return json({ error: "Informe título e mensagem." }, 400);
    if (userId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return json({ error: "Cliente inválido." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let subscriptionsQuery = supabase
      .from("app_push_subscriptions")
      .select("id, endpoint, p256dh, auth_key")
      .eq("enabled", true);
    if (userId) subscriptionsQuery = subscriptionsQuery.eq("user_id", userId);
    const [{ data: config, error: configError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
      supabase.from("bar_push_config").select("vapid_public_key, vapid_private_key, subject").eq("id", true).maybeSingle(),
      subscriptionsQuery,
    ]);
    if (configError) throw configError;
    if (subscriptionsError) throw subscriptionsError;
    if (!config || !subscriptions?.length) return json({ sent: 0, reason: "no_subscriptions" });

    webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
    const payload = JSON.stringify({
      title,
      body,
      url,
      tag: input.tag || `ilha-play-${Date.now()}`,
      icon: "/icon.png",
      badge: "/icon.png",
    });
    let sent = 0;
    const invalidIds: string[] = [];
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
        }, payload, { TTL: 86400, urgency: "high" });
        sent += 1;
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) invalidIds.push(subscription.id);
        else console.error("Falha ao enviar push do Ilha Play", statusCode, error?.message || error);
      }
    }));
    if (invalidIds.length) await supabase.from("app_push_subscriptions").delete().in("id", invalidIds);
    return json({ sent, invalid: invalidIds.length });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível enviar a notificação." }, 500);
  }
});
