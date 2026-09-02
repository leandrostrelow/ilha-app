import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type Dispatch = {
  dispatch_id: string;
  notification_id: string;
  user_id: string;
  title: string;
  body: string;
  link_url: string;
  event_type: string;
  attempts: number;
};

function notificationTtlSeconds(eventType: string) {
  const normalized = String(eventType || "").toUpperCase();
  if (normalized === "LEMBRETE_QUADRA") return 2 * 60 * 60;
  if (normalized === "CONVITE_QUADRA" || normalized === "CONVITE_QUADRA_ABERTO") {
    return 12 * 60 * 60;
  }
  return 24 * 60 * 60;
}

function notificationSurface(eventType: string) {
  const adminOnlyEvents = new Set(["NOVO_ALUNO", "TORNEIO_INSCRICAO"]);
  return adminOnlyEvents.has(String(eventType || "").toUpperCase()) ? "ADM" : "ILHA_PLAY";
}

function deliveryErrorCode(error: unknown) {
  if (error && typeof error === "object" && "statusCode" in error) {
    return String((error as { statusCode?: unknown }).statusCode || "delivery_error").slice(0, 40);
  }
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code || "delivery_error").slice(0, 40);
  }
  return "delivery_error";
}

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
    if (!dispatches.length) {
      return json({ processed: 0, sent: 0, partial: 0, without_subscription: 0, failed: 0 });
    }

    // Fetch VAPID only when a claimed recipient actually has a browser
    // subscription. In-app notifications must still be finalized truthfully
    // when Push has not been configured in an environment (for example a
    // freshly-created staging branch), instead of remaining stuck in
    // PROCESSANDO until the retry limit.
    let pushConfiguration: Promise<void> | null = null;
    const ensurePushConfiguration = () => {
      if (!pushConfiguration) {
        pushConfiguration = (async () => {
          const { data: config, error: configError } = await supabase
            .from("bar_push_config")
            .select("vapid_public_key, vapid_private_key, subject")
            .eq("id", true)
            .maybeSingle();
          if (configError) throw configError;
          if (!config) throw new Error("Configuração de push não encontrada.");
          webpush.setVapidDetails(config.subject, config.vapid_public_key, config.vapid_private_key);
        })();
      }
      return pushConfiguration;
    };
    let sent = 0;
    let partial = 0;
    let withoutSubscription = 0;
    let failed = 0;

    for (const dispatch of dispatches) {
      try {
        const subscriptionSurface = notificationSurface(dispatch.event_type);
        const { data: subscriptions, error: subscriptionsError } = await supabase
          .from("app_push_subscriptions")
          .select("id, endpoint, p256dh, auth_key")
          .eq("user_id", dispatch.user_id)
          .eq("app_surface", subscriptionSurface)
          .eq("enabled", true);
        if (subscriptionsError) throw subscriptionsError;

        if ((subscriptions || []).length) await ensurePushConfiguration();

        let delivered = 0;
        let transientFailures = 0;
        let transientErrorCode = "delivery_error";
        const invalidIds: string[] = [];
        const outcomes = await Promise.allSettled((subscriptions || []).map(async (subscription) => {
          try {
            await webpush.sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
            }, JSON.stringify({
              title: dispatch.title,
              body: dispatch.body,
              url: dispatch.link_url || "/?view=notifications",
              tag: `${subscriptionSurface === "ADM" ? "ilha-adm" : "ilha-play"}-${dispatch.notification_id}`,
              icon: "/icon.png",
              badge: "/icon.png",
            }), {
              TTL: notificationTtlSeconds(dispatch.event_type),
              urgency: "high",
            });
            return { kind: "delivered" as const, subscriptionId: subscription.id };
          } catch (pushError) {
            const deliveryError = pushError as { statusCode?: number; message?: string };
            const statusCode = Number(deliveryError?.statusCode || 0);
            if (statusCode === 404 || statusCode === 410) {
              return { kind: "invalid" as const, subscriptionId: subscription.id };
            }
            throw pushError;
          }
        }));

        for (const outcome of outcomes) {
          if (outcome.status === "fulfilled") {
            if (outcome.value.kind === "delivered") delivered += 1;
            else invalidIds.push(outcome.value.subscriptionId);
          } else {
            transientFailures += 1;
            transientErrorCode = deliveryErrorCode(outcome.reason);
          }
        }

        if (invalidIds.length) {
          const invalidDelete = await supabase.from("app_push_subscriptions").delete().in("id", invalidIds);
          if (invalidDelete.error) {
            console.error("client-notification-dispatch subscription cleanup failure", {
              stage: "remove_invalid_subscription",
              code: String(invalidDelete.error.code || "database_error").slice(0, 40),
            });
          }
        }

        const now = new Date().toISOString();
        const reachedAttemptLimit = Number(dispatch.attempts || 0) >= 5;
        let status = "ENVIADO";
        let sentAt: string | null = now;
        let lastError: string | null = null;

        if (delivered > 0 && transientFailures > 0) {
          status = "PARCIAL";
          lastError = `Entrega parcial: ${delivered} aparelho(s) confirmado(s) e ${transientFailures} com falha (${transientErrorCode}).`;
          partial += 1;
        } else if (delivered === 0 && transientFailures > 0) {
          status = reachedAttemptLimit ? "FALHOU" : "PENDENTE";
          sentAt = null;
          lastError = `Falha de entrega em ${transientFailures} aparelho(s) (${transientErrorCode}).`;
          if (reachedAttemptLimit) failed += 1;
        } else if (delivered === 0) {
          status = "SEM_ASSINATURA";
          sentAt = null;
          lastError = invalidIds.length
            ? "Nenhum aparelho válido permaneceu após remover assinaturas expiradas."
            : "Nenhum aparelho com notificações ativas.";
          withoutSubscription += 1;
        }

        const completed = await supabase.from("app_client_notification_dispatches").update({
          status,
          sent_at: sentAt,
          last_error: lastError,
          updated_at: now,
        }).eq("id", dispatch.dispatch_id);
        if (completed.error) throw completed.error;
        sent += delivered;
      } catch (dispatchError) {
        const reachedAttemptLimit = Number(dispatch.attempts || 0) >= 5;
        const deliveryCode = deliveryErrorCode(dispatchError);
        const failedUpdate = await supabase.from("app_client_notification_dispatches").update({
          status: reachedAttemptLimit ? "FALHOU" : "PENDENTE",
          sent_at: null,
          last_error: `Falha de entrega (${deliveryCode}).`,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatch.dispatch_id);
        if (failedUpdate.error) {
          console.error("client-notification-dispatch state failure", {
            stage: "persist_failure",
            code: String(failedUpdate.error.code || "database_error"),
          });
        }
        if (reachedAttemptLimit) failed += 1;
      }
    }

    return json({
      processed: dispatches.length,
      sent,
      partial,
      without_subscription: withoutSubscription,
      failed,
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("client-notification-dispatch failure", { code });
    return json({ error: "Não foi possível processar as notificações." }, 500);
  }
});
