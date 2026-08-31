import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

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
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_) {
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
  } catch (_) {
    return currentKeys.startsWith("sb_publishable_") ? currentKeys : "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 25000) return json(request, { error: "Dados enviados são muito grandes." }, 413);

  let failureStage = "request";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    const authorization = request.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) return json(request, { error: "Acesso não autorizado." }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [announcementAccess, communicationAccess] = await Promise.all([
      caller.rpc("has_club_permission", { p_permission: "announcements" }),
      caller.rpc("has_club_permission", { p_permission: "communication" }),
    ]);
    const canBroadcast = (!announcementAccess.error && announcementAccess.data === true) ||
      (!communicationAccess.error && communicationAccess.data === true);
    if (!canBroadcast) {
      return json(request, { error: "Acesso não autorizado." }, 403);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 25000) {
      return json(request, { error: "Dados enviados são muito grandes." }, 413);
    }
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, { error: "Dados inválidos." }, 400);
      }
      input = parsed as Record<string, unknown>;
    } catch (_error) {
      return json(request, { error: "Dados inválidos." }, 400);
    }
    const action = String(input.action || "broadcast").trim().toLowerCase();
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === "status") {
      const announcementIds = Array.isArray(input.announcement_ids)
        ? [...new Set(input.announcement_ids.map((value) => String(value || "").trim()))].slice(0, 50)
        : [];
      if (!announcementIds.length || announcementIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
        return json(request, { error: "Comunicados inválidos." }, 400);
      }

      const { data: notifications, error: notificationsError } = await supabase
        .from("app_client_notifications")
        .select("id, dedupe_key, created_at")
        .eq("event_type", "COMUNICADO")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (notificationsError) throw notificationsError;

      const latestBatchByAnnouncement = new Map<string, { key: string; createdAt: string }>();
      for (const notification of notifications || []) {
        const dedupeKey = String(notification.dedupe_key || "");
        const announcementId = announcementIds.find((id) => dedupeKey.startsWith(`client-broadcast:announcement-${id}`));
        if (!announcementId || latestBatchByAnnouncement.has(announcementId)) continue;
        const separator = dedupeKey.lastIndexOf(":");
        if (separator < 0) continue;
        latestBatchByAnnouncement.set(announcementId, {
          key: dedupeKey.slice(0, separator),
          createdAt: String(notification.created_at || ""),
        });
      }

      const selectedNotifications = (notifications || []).filter((notification) => {
        const dedupeKey = String(notification.dedupe_key || "");
        return [...latestBatchByAnnouncement.values()].some((batch) => dedupeKey.startsWith(`${batch.key}:`));
      });
      const notificationIds = selectedNotifications.map((notification) => String(notification.id));
      let dispatches: Array<{ notification_id: string; status: string }> = [];
      if (notificationIds.length) {
        const { data, error } = await supabase
          .from("app_client_notification_dispatches")
          .select("notification_id, status")
          .in("notification_id", notificationIds);
        if (error) throw error;
        dispatches = (data || []) as Array<{ notification_id: string; status: string }>;
      }
      const statusByNotification = new Map(dispatches.map((dispatch) => [String(dispatch.notification_id), String(dispatch.status || "PENDENTE")]));
      const statuses: Record<string, unknown> = {};
      for (const announcementId of announcementIds) {
        const batch = latestBatchByAnnouncement.get(announcementId);
        if (!batch) continue;
        const batchNotifications = selectedNotifications.filter((notification) => String(notification.dedupe_key || "").startsWith(`${batch.key}:`));
        const counts = { recipients: batchNotifications.length, delivered: 0, partial: 0, without_subscription: 0, pending: 0, failed: 0 };
        for (const notification of batchNotifications) {
          const status = statusByNotification.get(String(notification.id)) || "PENDENTE";
          if (status === "ENVIADO") counts.delivered += 1;
          else if (status === "PARCIAL") { counts.delivered += 1; counts.partial += 1; }
          else if (status === "SEM_ASSINATURA") counts.without_subscription += 1;
          else if (status === "FALHOU") counts.failed += 1;
          else counts.pending += 1;
        }
        statuses[announcementId] = { ...counts, broadcast_at: batch.createdAt };
      }
      return json(request, { statuses });
    }

    if (action !== "broadcast") return json(request, { error: "Ação inválida." }, 400);

    const title = String(input.title || "Ilha Play").trim().slice(0, 90);
    const body = String(input.body || "").trim().slice(0, 280);
    const requestedUrl = String(input.url || "/").trim();
    const url = requestedUrl.startsWith("/") && !requestedUrl.startsWith("//") ? requestedUrl.slice(0, 1000) : "/";
    const userId = String(input.user_id || "").trim();
    const targetType = String(input.target_type || "todos").trim().toLowerCase();
    const targetPlanCode = String(input.target_plan_code || "").trim();
    if (!title || !body) return json(request, { error: "Informe título e mensagem." }, 400);
    if (userId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return json(request, { error: "Cliente inválido." }, 400);
    }
    if (!new Set(["todos", "plano", "aluno", "mensalista", "avulso"]).has(targetType)) {
      return json(request, { error: "Público da notificação inválido." }, 400);
    }
    if (targetType === "plano" && !targetPlanCode) return json(request, { error: "Escolha o plano da notificação." }, 400);

    const eventType = String(input.event_type || "COMUNICADO").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 50) || "COMUNICADO";
    const requestTag = String(input.tag || crypto.randomUUID()).trim().replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 120) || crypto.randomUUID();
    failureStage = "enqueue";
    const { data: enqueueRows, error: enqueueError } = await supabase.rpc("enqueue_app_client_broadcast", {
      p_title: title,
      p_body: body,
      p_link_url: url,
      p_event_type: eventType,
      p_tag: requestTag,
      p_target_type: targetType,
      p_target_plan_code: targetPlanCode || null,
      p_user_id: userId || null,
    });
    if (enqueueError) throw enqueueError;
    const enqueueResult = Array.isArray(enqueueRows) && enqueueRows.length
      ? enqueueRows[0] as Record<string, unknown>
      : {};
    const queued = Number(enqueueResult.queued || 0);
    const recipients = Number(enqueueResult.recipients || 0);
    const pushEnabledRecipients = Number(enqueueResult.push_enabled_recipients || 0);
    if (!recipients) return json(request, { queued: 0, recipients: 0, reason: "no_recipients" });

    failureStage = "dispatch";
    const dispatchRequest = await supabase.rpc("invoke_app_client_notification_dispatch");
    if (dispatchRequest.error) {
      console.error("client-broadcast-push dispatch request failure", {
        code: String(dispatchRequest.error.code || "database_error").slice(0, 40),
      });
    }
    return json(request, {
      queued,
      recipients,
      push_enabled_recipients: pushEnabledRecipients,
      without_push_recipients: Math.max(0, recipients - pushEnabledRecipients),
      delivery: "queued",
      processing_requested: !dispatchRequest.error && dispatchRequest.data !== null,
      tag: requestTag,
    }, 202);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as Record<string, unknown>).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("client-broadcast-push failure", { code, stage: failureStage });
    return json(request, { error: "Não foi possível enviar a notificação.", error_code: code, stage: failureStage }, 500);
  }
});
