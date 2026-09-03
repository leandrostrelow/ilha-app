import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import { appCorsHeaders } from "../_shared/cors.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  try {
    return JSON.parse(currentKeys).default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

function publicApiKey() {
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  try {
    return JSON.parse(currentKeys).default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_publishable_") ? currentKeys : "";
  }
}

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || corsHeaders(request)["Access-Control-Allow-Origin"] === origin;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parseBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 12000) throw new Error("payload_too_large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 12000) throw new Error("payload_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error("invalid_payload");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_payload");
  return parsed as Record<string, unknown>;
}

function safeAppUrl(value: unknown) {
  const requested = String(value || "/torneios/ilha-open-2026").trim();
  return requested.startsWith("/torneios/") && !requested.startsWith("//")
    ? requested.slice(0, 1000)
    : "/torneios/ilha-open-2026";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  if (!validOrigin(request)) return json(request, { error: "Origem não autorizada." }, 403);

  try {
    const input = await parseBody(request);
    const action = String(input.action || "").trim().toLowerCase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("missing_configuration");

    if (action === "subscribe" || action === "unsubscribe") {
      if (request.headers.get("apikey") !== anonKey) return json(request, { error: "Acesso não autorizado." }, 401);
      const slug = String(input.tournament_slug || "").trim().toLowerCase();
      const endpoint = String(input.endpoint || "").trim();
      const token = String(input.subscription_token || "").trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || endpoint.length < 20 || endpoint.length > 4000 || !/^[0-9a-f]{64}$/i.test(token)) {
        return json(request, { error: "Assinatura inválida." }, 400);
      }
      let endpointUrl: URL;
      try {
        endpointUrl = new URL(endpoint);
      } catch (_error) {
        return json(request, { error: "Assinatura inválida." }, 400);
      }
      if (endpointUrl.protocol !== "https:") return json(request, { error: "Assinatura inválida." }, 400);

      const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: tournament, error: tournamentError } = await service
        .from("tournaments")
        .select("id, is_published")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
      if (tournamentError) throw tournamentError;
      if (!tournament) return json(request, { error: "Torneio não encontrado." }, 404);

      const endpointHash = await sha256(endpoint);
      const tokenHash = await sha256(token.toLowerCase());
      if (action === "unsubscribe") {
        const { error } = await service.from("tournament_push_subscriptions").delete()
          .eq("tournament_id", tournament.id)
          .eq("endpoint_hash", endpointHash)
          .eq("subscription_token_hash", tokenHash);
        if (error) throw error;
        return json(request, { ok: true, enabled: false });
      }

      const p256dh = String(input.p256dh || "").trim();
      const authKey = String(input.auth_key || "").trim();
      const userAgent = String(input.user_agent || "").trim().slice(0, 500) || null;
      if (p256dh.length < 20 || p256dh.length > 500 || authKey.length < 8 || authKey.length > 200) {
        return json(request, { error: "Assinatura inválida." }, 400);
      }
      const { error } = await service.from("tournament_push_subscriptions").upsert({
        tournament_id: tournament.id,
        endpoint,
        endpoint_hash: endpointHash,
        p256dh,
        auth_key: authKey,
        subscription_token_hash: tokenHash,
        user_agent: userAgent,
        enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tournament_id,endpoint_hash" });
      if (error) throw error;
      return json(request, { ok: true, enabled: true });
    }

    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json(request, { error: "Acesso não autorizado." }, 401);
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const permission = await caller.rpc("has_club_permission", { p_permission: "tournaments" });
    if (permission.error || permission.data !== true) return json(request, { error: "Acesso não autorizado." }, 403);

    const tournamentId = String(input.tournament_id || "").trim();
    if (!uuidPattern.test(tournamentId)) return json(request, { error: "Torneio inválido." }, 400);
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: tournament, error: tournamentError } = await service.from("tournaments").select("id, name, slug").eq("id", tournamentId).maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament) return json(request, { error: "Torneio não encontrado." }, 404);

    if (action === "status") {
      const { count, error } = await service.from("tournament_push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournament.id)
        .eq("enabled", true);
      if (error) throw error;
      return json(request, { ok: true, subscribers: count || 0 });
    }
    if (action !== "broadcast") return json(request, { error: "Ação inválida." }, 400);

    const title = String(input.title || tournament.name || "Ilha Open").trim().slice(0, 90);
    const body = String(input.body || "").trim().slice(0, 280);
    if (!title || !body) return json(request, { error: "Informe título e mensagem." }, 400);
    const [{ data: config, error: configError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
      service.from("bar_push_config").select("vapid_public_key, vapid_private_key, subject").eq("id", true).maybeSingle(),
      service.from("tournament_push_subscriptions").select("id, endpoint, p256dh, auth_key")
        .eq("tournament_id", tournament.id).eq("enabled", true),
    ]);
    if (configError) throw configError;
    if (subscriptionsError) throw subscriptionsError;
    if (!config || !subscriptions?.length) return json(request, { ok: true, sent: 0, failed: 0, subscribers: 0 });

    webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
    const payload = JSON.stringify({
      title,
      body,
      url: safeAppUrl(input.url),
      icon: "/icons/ilha-open-192.png",
      badge: "/icons/ilha-open-192.png",
      tag: `ilha-open-${crypto.randomUUID()}`,
    });
    let sent = 0;
    let failed = 0;
    const invalidIds: number[] = [];
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
        }, payload, { TTL: 86400, urgency: "normal" });
        sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) invalidIds.push(Number(subscription.id));
        else failed += 1;
      }
    }));
    if (invalidIds.length) {
      const { error } = await service.from("tournament_push_subscriptions").delete().in("id", invalidIds);
      if (error) throw error;
    }
    return json(request, { ok: true, sent, failed, invalid: invalidIds.length, subscribers: subscriptions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    if (message === "payload_too_large") return json(request, { error: "Dados enviados são muito grandes." }, 413);
    if (message === "invalid_payload") return json(request, { error: "Dados inválidos." }, 400);
    console.error("tournament-public-push failure", { code: message.slice(0, 80) });
    return json(request, { error: "Não foi possível processar as notificações." }, 500);
  }
});
