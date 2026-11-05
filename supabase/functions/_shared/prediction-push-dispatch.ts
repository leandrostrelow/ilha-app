import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type DbClient = SupabaseClient<any, "public", "public", any>;
type Delivery = { id: string; tournament_id: string; notification_key: string; endpoint: string; p256dh: string; auth_key: string; title: string; body: string; link_url: string; attempts: number };

export async function dispatchPredictionPushes(client: DbClient, configure: () => Promise<void>) {
  const claim = await client.rpc("claim_tournament_prediction_push_dispatches", { p_limit: 100 });
  if (claim.error) throw claim.error;
  const rows = (claim.data || []) as Delivery[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    let status = "SENT";
    let lastError: string | null = null;
    try {
      const subscription = await client.from("tournament_push_subscriptions").select("id")
        .eq("tournament_id", row.tournament_id).eq("endpoint", row.endpoint).eq("enabled", true).maybeSingle();
      if (subscription.error) throw subscription.error;
      if (!subscription.data) status = "EXPIRED";
      else {
        await configure();
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } }, JSON.stringify({
          title: row.title, body: row.body, url: row.link_url,
          icon: "/icons/ilha-open-192.png", badge: "/icons/ilha-open-192.png", tag: row.notification_key,
        }), { TTL: 1800, urgency: "high" });
        sent += 1;
      }
    } catch (error) {
      const code = Number((error as { statusCode?: number }).statusCode || 0);
      const expired = code === 404 || code === 410;
      status = expired ? "EXPIRED" : row.attempts >= 5 ? "FAILED" : "PENDING";
      lastError = expired ? "subscription_expired" : `push_error_${code || "internal"}`;
      if (expired) {
        await client.from("tournament_push_subscriptions").update({ enabled: false })
          .eq("tournament_id", row.tournament_id).eq("endpoint", row.endpoint);
      }
      if (status === "FAILED") failed += 1;
    }
    const save = await client.from("tournament_prediction_push_dispatches").update({
      status, last_error: lastError, sent_at: status === "SENT" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("attempts", row.attempts);
    if (save.error) throw save.error;
  }
  return { processed: rows.length, sent, failed };
}
