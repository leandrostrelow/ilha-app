import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import { appCorsHeaders } from "../_shared/cors.ts";

const pushPermissions = new Set(["bar.overview", "bar.orders", "bar.kitchen"]);

function corsHeaders(request: Request) {
  return appCorsHeaders(request, "POST, OPTIONS");
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store" },
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
    } catch (_error) {
      if (currentKeys.startsWith("sb_secret_")) return currentKeys;
    }
  }
  return "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 10000) return json(request, { error: "Dados enviados são muito grandes." }, 413);

  let failureStage = "request";
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 10000) {
      return json(request, { error: "Dados enviados são muito grandes." }, 413);
    }
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, { error: "Pedido inválido." }, 400);
      }
      input = parsed as Record<string, unknown>;
    } catch (_error) {
      return json(request, { error: "Pedido inválido." }, 400);
    }
    const { order_id: orderId, tracking_token: trackingToken, card_token: cardToken } = input;
    if (!orderId || (!trackingToken && !cardToken)) return json(request, { error: "Pedido inválido." }, 400);

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
      .select("id, table_id, public_access_id, command_number, customer_name, source, public_tracking_token")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(request, { error: "Pedido não encontrado." }, 404);

    if (trackingToken) {
      if (order.public_tracking_token !== String(trackingToken)) return json(request, { error: "Pedido não encontrado." }, 404);
    } else {
      const accessToken = String(cardToken);
      if (order.table_id) {
        const { data: table, error: tableError } = await supabase
          .from("bar_tables")
          .select("id")
          .eq("qr_token", accessToken)
          .eq("active", true)
          .maybeSingle();
        if (tableError) throw tableError;
        if (!table || table.id !== order.table_id) return json(request, { error: "Mesa inválida." }, 404);
      } else {
        const { data: card, error: cardError } = await supabase
          .from("bar_public_cards")
          .select("id")
          .eq("token", accessToken)
          .eq("active", true)
          .maybeSingle();
        if (cardError) throw cardError;
        if (!card || card.id !== order.public_access_id) return json(request, { error: "Cartão inválido." }, 404);
      }
    }

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
    if (!items?.length) return json(request, { sent: 0, reason: "no_recent_items" });

    const dispatchKey = `${orderId}:${items[0].created_at}`;
    failureStage = "subscription_lookup";
    const [{ data: config, error: configError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      supabase.from("bar_push_config").select("vapid_public_key, vapid_private_key, subject").eq("id", true).maybeSingle(),
      supabase.from("bar_push_subscriptions").select("id, user_id, endpoint, p256dh, auth_key").eq("enabled", true),
    ]);
    if (configError) throw configError;
    if (subscriptionError) throw subscriptionError;
    if (!config || !subscriptions?.length) return json(request, { sent: 0, reason: "no_subscriptions" });

    // RLS prevents new unauthorized subscriptions, but an old endpoint can
    // remain enabled after a permission is revoked. Recheck profile, Auth and
    // allowlist at delivery time before sending customer/order details.
    failureStage = "recipient_authorization";
    const subscriptionUserIds = Array.from(new Set(subscriptions.map((subscription) => String(subscription.user_id || "")).filter(Boolean)));
    if (!subscriptionUserIds.length) return json(request, { sent: 0, reason: "no_authorized_subscriptions" });
    const [{ data: profiles, error: profilesError }, { data: protectedAccounts, error: protectedError }, authResults] = await Promise.all([
      supabase.from("profiles").select("id, role, active, permissions").in("id", subscriptionUserIds),
      supabase.from("protected_access_accounts").select("email, role, active, permissions").eq("active", true),
      Promise.all(subscriptionUserIds.map(async (userId) => ({
        userId,
        result: await supabase.auth.admin.getUserById(userId),
      }))),
    ]);
    if (profilesError) throw profilesError;
    if (protectedError) throw protectedError;
    const authEmailById = new Map(authResults
      .filter(({ result }) => !result.error && result.data.user?.email)
      .map(({ userId, result }) => [userId, String(result.data.user?.email || "").trim().toLowerCase()]));
    const protectedByKey = new Map((protectedAccounts || []).map((account) => [
      `${String(account.email || "").trim().toLowerCase()}\u0000${String(account.role || "")}`,
      account,
    ]));
    const eligibleUserIds = new Set((profiles || []).filter((profile) => {
      if (profile.active === false) return false;
      const authEmail = authEmailById.get(String(profile.id));
      const protectedAccount = authEmail
        ? protectedByKey.get(`${authEmail}\u0000${String(profile.role || "")}`)
        : null;
      if (!protectedAccount) return false;
      if (profile.role === "admin") return true;
      const profilePermissions = Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
      const protectedPermissions = Array.isArray(protectedAccount.permissions) ? protectedAccount.permissions.map(String) : [];
      return profilePermissions.some((permission) =>
        pushPermissions.has(permission) && protectedPermissions.includes(permission)
      );
    }).map((profile) => String(profile.id)));
    const eligibleSubscriptions = subscriptions.filter((subscription) => eligibleUserIds.has(String(subscription.user_id || "")));
    if (!eligibleSubscriptions.length) return json(request, { sent: 0, reason: "no_authorized_subscriptions" });

    failureStage = "dispatch";
    const { error: dispatchError } = await supabase
      .from("bar_push_dispatches")
      .insert({ dispatch_key: dispatchKey, order_id: orderId });
    if (dispatchError?.code === "23505") return json(request, { sent: 0, reason: "already_sent" });
    if (dispatchError) throw dispatchError;

    failureStage = "push_delivery";
    webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
    let table = null;
    if (order.table_id) {
      const tableResult = await supabase.from("bar_tables").select("name, number").eq("id", order.table_id).maybeSingle();
      if (tableResult.error) throw tableResult.error;
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
    let failed = 0;
    const invalidIds: string[] = [];
    await Promise.all(eligibleSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
        }, payload, { TTL: 300, urgency: "high" });
        sent += 1;
      } catch (error) {
        const pushError = error as { statusCode?: number; message?: string };
        const statusCode = Number(pushError?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) invalidIds.push(subscription.id);
        else {
          failed += 1;
          console.error("bar-order-push delivery failure", { statusCode: statusCode || "unknown" });
        }
      }
    }));

    if (invalidIds.length) {
      const invalidDelete = await supabase.from("bar_push_subscriptions").delete().in("id", invalidIds);
      if (invalidDelete.error) throw invalidDelete.error;
    }
    if (failed > 0 && sent === 0) {
      const release = await supabase.from("bar_push_dispatches").delete().eq("dispatch_key", dispatchKey);
      if (release.error) throw release.error;
      return json(request, { error: "Não foi possível entregar a notificação agora.", sent, failed }, 502);
    }
    return json(request, { sent, invalid: invalidIds.length, failed });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as Record<string, unknown>).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("bar-order-push failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível enviar a notificação.", reference: failureStage }, 500);
  }
});
