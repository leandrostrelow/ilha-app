import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type Dispatch = {
  dispatch_id: string;
  notification_id: string;
  user_id: string;
  title: string;
  body: string;
  link_url: string;
  attempts: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
  } catch (_) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

function safeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = serviceRoleKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "Configuração indisponível." }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const dispatchToken = request.headers.get("x-dispatch-token") || "";
    const { data: dispatchConfig, error: dispatchConfigError } = await supabase
      .from("app_notification_dispatch_config")
      .select("dispatch_secret")
      .eq("id", true)
      .maybeSingle();
    if (dispatchConfigError) throw dispatchConfigError;
    if (!dispatchConfig?.dispatch_secret || !safeEqual(dispatchToken, dispatchConfig.dispatch_secret)) {
      return json({ error: "Acesso não autorizado." }, 401);
    }

    const { data, error } = await supabase.rpc("claim_app_client_push_dispatches", { p_limit: 100 });
    if (error) throw error;
    const dispatches = (data || []) as Dispatch[];
    if (!dispatches.length) return json({ processed: 0, sent: 0 });

    const { data: config, error: configError } = await supabase
      .from("bar_push_config")
      .select("vapid_public_key, vapid_private_key, subject")
      .eq("id", true)
      .maybeSingle();
    if (configError) throw configError;
    if (!config) throw new Error("Configuração de push não encontrada.");

    webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
    let sent = 0;

    for (const dispatch of dispatches) {
      try {
        const { data: subscriptions, error: subscriptionsError } = await supabase
          .from("app_push_subscriptions")
          .select("id, endpoint, p256dh, auth_key")
          .eq("user_id", dispatch.user_id)
          .eq("enabled", true);
        if (subscriptionsError) throw subscriptionsError;

        const invalidIds: string[] = [];
        let delivered = 0;
        await Promise.all((subscriptions || []).map(async (subscription) => {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
            }, JSON.stringify({
              title: dispatch.title,
              body: dispatch.body,
              url: dispatch.link_url || "/?view=notifications",
              tag: `ilha-play-${dispatch.notification_id}`,
              icon: "/icon.png",
              badge: "/icon.png",
            }), { TTL: 7200, urgency: "high" });
            delivered += 1;
          } catch (pushError) {
            const statusCode = Number(pushError?.statusCode || 0);
            if (statusCode === 404 || statusCode === 410) invalidIds.push(subscription.id);
            else throw pushError;
          }
        }));

        if (invalidIds.length) {
          await supabase.from("app_push_subscriptions").delete().in("id", invalidIds);
        }
        await supabase.from("app_client_notification_dispatches").update({
          status: "ENVIADO",
          sent_at: new Date().toISOString(),
          last_error: delivered ? null : "Nenhum aparelho com notificações ativas.",
          updated_at: new Date().toISOString(),
        }).eq("id", dispatch.dispatch_id);
        sent += delivered;
      } catch (dispatchError) {
        const failed = Number(dispatch.attempts || 0) >= 5;
        await supabase.from("app_client_notification_dispatches").update({
          status: failed ? "FALHOU" : "PENDENTE",
          last_error: String(dispatchError?.message || dispatchError).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", dispatch.dispatch_id);
      }
    }

    return json({ processed: dispatches.length, sent });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível processar as notificações." }, 500);
  }
});
