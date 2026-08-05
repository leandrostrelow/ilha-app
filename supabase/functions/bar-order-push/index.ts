import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys);
      if (parsed.default) return parsed.default;
    } catch (error) {
      if (currentKeys.startsWith("sb_secret_")) return currentKeys;
    }
  }
  return "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);

  let failureStage = "request";
  try {
    const { order_id: orderId, tracking_token: trackingToken } = await request.json();
    if (!orderId || !trackingToken) return json({ error: "Pedido inválido." }, 400);

    failureStage = "database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "order_lookup";
    const { data: order, error: orderError } = await supabase
      .from("bar_orders")
      .select("id, table_id, command_number, customer_name, source, public_tracking_token")
      .eq("id", orderId)
      .eq("public_tracking_token", String(trackingToken))
      .in("source", ["QR_MESA", "QR_CARTAO"])
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json({ error: "Pedido não encontrado." }, 404);

    failureStage = "item_lookup";
    const recentLimit = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: items, error: itemError } = await supabase
      .from("bar_order_items")
      .select("id, product_name, quantity, created_at")
      .eq("order_id", orderId)
      .in("source", ["QR_MESA", "QR_CARTAO"])
      .eq("status", "SOLICITADO")
      .gte("created_at", recentLimit)
      .order("created_at", { ascending: false });
    if (itemError) throw itemError;
    if (!items?.length) return json({ sent: 0, reason: "no_recent_items" });

    failureStage = "dispatch";
    const dispatchKey = `${orderId}:${items[0].created_at}`;
    const { error: dispatchError } = await supabase
      .from("bar_push_dispatches")
      .insert({ dispatch_key: dispatchKey, order_id: orderId });
    if (dispatchError?.code === "23505") return json({ sent: 0, reason: "already_sent" });
    if (dispatchError) throw dispatchError;

    failureStage = "subscription_lookup";
    const [{ data: config, error: configError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      supabase.from("bar_push_config").select("vapid_public_key, vapid_private_key, subject").eq("id", true).maybeSingle(),
      supabase.from("bar_push_subscriptions").select("id, endpoint, p256dh, auth_key").eq("enabled", true),
    ]);
    if (configError) throw configError;
    if (subscriptionError) throw subscriptionError;
    if (!config || !subscriptions?.length) return json({ sent: 0, reason: "no_subscriptions" });

    failureStage = "push_delivery";
    webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
    let table = null;
    if (order.table_id) {
      const tableResult = await supabase.from("bar_tables").select("name, number").eq("id", order.table_id).maybeSingle();
      table = tableResult.data;
    }
    const location = table?.name || (table?.number ? `Mesa ${table.number}` : "Comanda avulsa");
    const products = items
      .slice()
      .reverse()
      .map((item) => `${Number(item.quantity)}x ${item.product_name}`)
      .join(" · ");
    const payload = JSON.stringify({
      title: "NOVO PEDIDO NO BAR",
      body: `${order.customer_name || "Cliente"} · ${location}\n${products}`,
      url: "/admbar/?tab=kitchen",
      tag: `ilha-bar-pedido-${dispatchKey}`,
      orderId,
    });

    let sent = 0;
    const invalidIds: string[] = [];
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
        }, payload, { TTL: 300, urgency: "high" });
        sent += 1;
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) invalidIds.push(subscription.id);
        else console.error("Falha ao enviar push", statusCode, error?.message || error);
      }
    }));

    if (invalidIds.length) await supabase.from("bar_push_subscriptions").delete().in("id", invalidIds);
    return json({ sent, invalid: invalidIds.length });
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível enviar a notificação.", reference: failureStage }, 500);
  }
});
