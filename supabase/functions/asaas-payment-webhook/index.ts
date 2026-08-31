import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

type JsonRecord = Record<string, unknown>;
type DbClient = SupabaseClient<any, "public", "public", any>;

const paymentEventStatuses: Record<string, string> = {
  PAYMENT_CREATED: "PENDING",
  PAYMENT_UPDATED: "PENDING",
  PAYMENT_CONFIRMED: "CONFIRMED",
  PAYMENT_RECEIVED: "RECEIVED",
  PAYMENT_RECEIVED_IN_CASH: "RECEIVED",
  PAYMENT_DUNNING_RECEIVED: "RECEIVED",
  PAYMENT_OVERDUE: "OVERDUE",
  PAYMENT_REFUNDED: "REFUNDED",
  PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  PAYMENT_REFUND_IN_PROGRESS: "REFUND_PENDING",
  PAYMENT_DELETED: "CANCELLED",
  PAYMENT_CHARGEBACK_REQUESTED: "DISPUTED",
  PAYMENT_CHARGEBACK_DISPUTE: "DISPUTED",
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: "DISPUTED",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "FAILED",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "FAILED",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
  } catch (_error) {
    return currentKeys.startsWith("sb_secret_") ? currentKeys : "";
  }
}

function text(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

async function secureEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function statusFromProvider(payment: JsonRecord) {
  const value = text(payment.status, 40).toUpperCase();
  if (["RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED", "PENDING"].includes(value)) return value;
  if (["DELETED", "CANCELLED"].includes(value)) return "CANCELLED";
  return "PENDING";
}

function paidAt(payment: JsonRecord) {
  const value = text(payment.clientPaymentDate || payment.paymentDate || payment.confirmedDate, 40);
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00-03:00`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function refundedAmount(payment: JsonRecord) {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  return refunds.reduce((total: number, refund: unknown) => {
    if (!refund || typeof refund !== "object") return total;
    const row = refund as JsonRecord;
    if (text(row.status, 30).toUpperCase() !== "DONE") return total;
    const value = Number(row.value);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeProviderPaymentSnapshot(payment: JsonRecord) {
  const refunds = Array.isArray(payment.refunds)
    ? payment.refunds
      .filter((refund): refund is JsonRecord => Boolean(refund) && typeof refund === "object" && !Array.isArray(refund))
      .slice(0, 50)
      .map((refund) => ({
        status: text(refund.status, 30),
        value: finiteNumber(refund.value),
        date_created: text(refund.dateCreated, 40),
      }))
    : [];
  return {
    id: text(payment.id, 120),
    status: text(payment.status, 40),
    value: finiteNumber(payment.value),
    net_value: finiteNumber(payment.netValue),
    billing_type: text(payment.billingType, 30),
    external_reference: text(payment.externalReference, 180),
    date_created: text(payment.dateCreated, 40),
    due_date: text(payment.dueDate, 40),
    payment_date: text(payment.paymentDate, 40),
    client_payment_date: text(payment.clientPaymentDate, 40),
    confirmed_date: text(payment.confirmedDate, 40),
    credit_date: text(payment.creditDate, 40),
    original_due_date: text(payment.originalDueDate, 40),
    deleted: payment.deleted === true,
    anticipated: payment.anticipated === true,
    refunds,
  };
}

function preservesStrongerPaymentState(currentStatus: string, nextStatus: string, eventType: string) {
  if (currentStatus === "REFUNDED") return nextStatus !== "REFUNDED";
  if (currentStatus === "CHARGEBACK") {
    // DISPUTED is persisted locally as CHARGEBACK. It is therefore an
    // equivalent/retryable state, not a regression: a previous attempt may
    // have updated the payment and failed before reconciling the registration.
    if (["DISPUTED", "CHARGEBACK"].includes(nextStatus)) return false;
    const chargebackResolved = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"].includes(eventType);
    return nextStatus !== "REFUNDED" && !chargebackResolved;
  }
  if (currentStatus === "RECEIVED") {
    return ["CREATED", "PENDING", "OVERDUE", "FAILED", "CANCELLED"].includes(nextStatus);
  }
  if (currentStatus === "CONFIRMED") {
    return ["CREATED", "PENDING", "OVERDUE", "FAILED", "CANCELLED"].includes(nextStatus);
  }
  if (currentStatus === "OVERDUE") return ["CREATED", "PENDING"].includes(nextStatus);
  if (currentStatus === "CANCELLED") return !["CANCELLED", "REFUNDED"].includes(nextStatus);
  return false;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 1000000) {
    return json({ error: "Payload muito grande." }, 413);
  }

  let failureStage = "authentication";
  let eventId = "";
  let processingToken = "";
  let supabase: DbClient | null = null;
  try {
    const configuredToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
    const receivedToken = request.headers.get("asaas-access-token") || "";
    if (configuredToken.length < 32 || !receivedToken || !(await secureEquals(receivedToken, configuredToken))) {
      return json({ error: "Webhook não autorizado." }, 401);
    }

    failureStage = "payload";
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1000000) return json({ error: "Payload muito grande." }, 413);
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody) as unknown;
    } catch (_error) {
      return json({ error: "Evento inválido." }, 400);
    }
    if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
      return json({ error: "Evento inválido." }, 400);
    }
    const payload = parsedPayload as JsonRecord;
    eventId = text(payload.id, 160);
    const eventType = text(payload.event, 100).toUpperCase();
    const providerPayment = payload.payment as JsonRecord | undefined;
    const providerPaymentId = text(providerPayment?.id, 120);
    if (!eventId || !eventType || !providerPayment || !providerPaymentId) {
      return json({ error: "Evento inválido." }, 400);
    }
    const safePaymentSnapshot = safeProviderPaymentSnapshot(providerPayment);
    const safeEventSnapshot = {
      id: eventId,
      event: eventType,
      date_created: text(payload.dateCreated, 40),
      payment: safePaymentSnapshot,
    };

    failureStage = "database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "event_persist";
    processingToken = crypto.randomUUID();
    const claim = await supabase.rpc("claim_asaas_webhook_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_provider_payment_id: providerPaymentId,
      p_payload: safeEventSnapshot,
      p_processing_token: processingToken,
    });
    if (claim.error) throw claim.error;
    const claimStatus = text(claim.data, 20).toUpperCase();
    if (claimStatus === "DONE") return json({ received: true, duplicate: true });
    if (claimStatus === "BUSY") return json({ received: true, duplicate: true, processing: true }, 409);
    if (claimStatus !== "CLAIMED") throw new Error("Não foi possível obter a posse do evento.");

    failureStage = "event_classification";
    let paymentStatus = paymentEventStatuses[eventType];
    if (eventType === "PAYMENT_UPDATED" || eventType === "PAYMENT_CREATED") {
      paymentStatus = statusFromProvider(providerPayment);
    }
    if (!paymentStatus) {
      const ignored = await supabase.from("asaas_webhook_events").update({
        status: "IGNORED",
        processed_at: new Date().toISOString(),
        error: null,
        processing_token: null,
        processing_started_at: null,
      }).eq("event_id", eventId).eq("processing_token", processingToken).select("id").maybeSingle();
      if (ignored.error) throw ignored.error;
      if (!ignored.data) throw new Error("A posse do processamento do evento foi perdida.");
      return json({ received: true, ignored: true });
    }

    failureStage = "payment_lookup";
    let paymentResult = await supabase.from("tournament_payments")
      .select("*")
      .eq("provider", "ASAAS")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();
    if (paymentResult.error) throw paymentResult.error;
    let localPayment = paymentResult.data as JsonRecord | null;
    const externalReference = text(providerPayment.externalReference, 180);
    if (!localPayment && externalReference.startsWith("tournament-registration:")) {
      paymentResult = await supabase.from("tournament_payments")
        .select("*")
        .eq("provider", "ASAAS")
        .eq("external_reference", externalReference)
        .maybeSingle();
      if (paymentResult.error) throw paymentResult.error;
      localPayment = paymentResult.data as JsonRecord | null;
    }
    if (!localPayment) {
      const ignored = await supabase.from("asaas_webhook_events").update({
        status: "IGNORED",
        processed_at: new Date().toISOString(),
        error: "Cobrança não pertence a uma inscrição deste sistema.",
        processing_token: null,
        processing_started_at: null,
      }).eq("event_id", eventId).eq("processing_token", processingToken).select("id").maybeSingle();
      if (ignored.error) throw ignored.error;
      if (!ignored.data) throw new Error("A posse do processamento do evento foi perdida.");
      return json({ received: true, ignored: true });
    }

    failureStage = "payment_reconciliation";
    const receivedAmount = Number(providerPayment.value);
    const expectedAmount = Number(localPayment.amount);
    if (!Number.isFinite(receivedAmount) || Math.abs(receivedAmount - expectedAmount) > 0.01) {
      throw new Error("Valor do evento diverge da inscrição.");
    }
    if (localPayment.provider_payment_id && localPayment.provider_payment_id !== providerPaymentId) {
      throw new Error("Identificador da cobrança diverge da inscrição.");
    }
    if (externalReference && externalReference !== localPayment.external_reference) {
      throw new Error("Referência externa da cobrança diverge da inscrição.");
    }

    const currentPaymentStatus = text(localPayment.status, 40).toUpperCase();
    if (preservesStrongerPaymentState(currentPaymentStatus, paymentStatus, eventType)) {
      const completed = await supabase.from("asaas_webhook_events").update({
        status: "IGNORED",
        processed_at: new Date().toISOString(),
        error: `Transição regressiva ignorada: ${currentPaymentStatus} -> ${paymentStatus}`,
        processing_token: null,
        processing_started_at: null,
      }).eq("event_id", eventId).eq("processing_token", processingToken).select("id").maybeSingle();
      if (completed.error) throw completed.error;
      if (!completed.data) throw new Error("A posse do processamento do evento foi perdida.");
      return json({ received: true, ignored: true, reason: "stale_transition" });
    }

    const settled = ["RECEIVED", "CONFIRMED"].includes(paymentStatus);
    const reversed = paymentStatus === "REFUNDED";
    const disputed = paymentStatus === "DISPUTED";
    const partialRefund = paymentStatus === "PARTIALLY_REFUNDED";
    const refundPending = paymentStatus === "REFUND_PENDING";
    const cancelled = paymentStatus === "CANCELLED";
    const completedRefundAmount = refundedAmount(providerPayment);
    const persistedPaymentStatus = disputed
      ? "CHARGEBACK"
      : partialRefund || refundPending
      ? (currentPaymentStatus || "PENDING")
      : paymentStatus;
    const paymentUpdate: JsonRecord = {
      provider_payment_id: providerPaymentId,
      provider_customer_id: text(providerPayment.customer, 120) || localPayment.provider_customer_id,
      billing_type: text(providerPayment.billingType, 30) || localPayment.billing_type,
      status: persistedPaymentStatus,
      invoice_url: text(providerPayment.invoiceUrl || providerPayment.bankSlipUrl, 1000) || localPayment.invoice_url,
      // Provider responses can contain customer documents, e-mail and bearer
      // links. Persist only the fields required for reconciliation/auditing.
      raw_response: safePaymentSnapshot,
      paid_at: settled ? paidAt(providerPayment) : (reversed || disputed ? null : localPayment.paid_at),
      updated_at: new Date().toISOString(),
    };
    let paymentUpdateQuery = supabase.from("tournament_payments")
      .update(paymentUpdate)
      .eq("id", localPayment.id)
      .eq("status", localPayment.status);
    paymentUpdateQuery = localPayment.updated_at
      ? paymentUpdateQuery.eq("updated_at", localPayment.updated_at)
      : paymentUpdateQuery.is("updated_at", null);
    const paymentUpdateResult = await paymentUpdateQuery.select("id").maybeSingle();
    if (paymentUpdateResult.error) throw paymentUpdateResult.error;
    if (!paymentUpdateResult.data) throw new Error("A cobrança mudou durante a reconciliação; o evento será tentado novamente.");

    failureStage = "registration_reconciliation";
    let registrationUpdate: JsonRecord | null = null;
    if (settled) {
      registrationUpdate = {
        status: "CONFIRMED",
        payment_status: "PAID",
        paid_amount: Number.isFinite(receivedAmount) ? receivedAmount : expectedAmount,
        confirmed_at: paymentUpdate.paid_at,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      };
    } else if (reversed) {
      registrationUpdate = {
        status: "REFUNDED",
        payment_status: "REFUNDED",
        paid_amount: 0,
        updated_at: new Date().toISOString(),
      };
    } else if (partialRefund) {
      registrationUpdate = {
        payment_status: "PAID",
        paid_amount: Math.max(0, expectedAmount - completedRefundAmount),
        updated_at: new Date().toISOString(),
      };
    } else if (disputed) {
      registrationUpdate = {
        status: "PENDING",
        payment_status: "PENDING",
        paid_amount: 0,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      };
    } else if (refundPending) {
      registrationUpdate = null;
    } else if (paymentStatus === "OVERDUE") {
      registrationUpdate = { payment_status: "OVERDUE", updated_at: new Date().toISOString() };
    } else if (cancelled) {
      registrationUpdate = {
        status: "CANCELLED",
        payment_status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else if (["PENDING", "FAILED"].includes(paymentStatus)) {
      registrationUpdate = { payment_status: "PENDING", updated_at: new Date().toISOString() };
    }
    if (registrationUpdate) {
      const registrationResult = await supabase.rpc("sync_tournament_registration_payment_group", {
        p_primary_registration_id: localPayment.registration_id,
        p_registration_status: registrationUpdate.status || null,
        p_payment_status: registrationUpdate.payment_status || null,
        p_paid_amount: Object.prototype.hasOwnProperty.call(registrationUpdate, "paid_amount")
          ? registrationUpdate.paid_amount
          : null,
        p_confirmed_at: registrationUpdate.confirmed_at || null,
        p_cancelled_at: registrationUpdate.cancelled_at || null,
      });
      if (registrationResult.error) throw registrationResult.error;
      if (Number(registrationResult.data || 0) < 1) throw new Error("Nenhuma inscrição foi reconciliada.");
    }

    failureStage = "event_complete";
    const completed = await supabase.from("asaas_webhook_events").update({
      status: "PROCESSED",
      processed_at: new Date().toISOString(),
      error: null,
      processing_token: null,
      processing_started_at: null,
    }).eq("event_id", eventId).eq("processing_token", processingToken).select("id").maybeSingle();
    if (completed.error) throw completed.error;
    if (!completed.data) throw new Error("A posse do processamento do evento foi perdida.");
    return json({ received: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as JsonRecord).code || "internal_error").slice(0, 40)
      : "internal_error";
    console.error("asaas-payment-webhook failure", { stage: failureStage, code });
    if (supabase && eventId && processingToken) {
      await supabase.from("asaas_webhook_events").update({
        status: "FAILED",
        processed_at: new Date().toISOString(),
        error: `${failureStage}:${code}`.slice(0, 120),
        processing_token: null,
        processing_started_at: null,
      }).eq("event_id", eventId).eq("processing_token", processingToken);
    }
    return json({ error: "Falha ao processar webhook.", code: failureStage }, 500);
  }
});
