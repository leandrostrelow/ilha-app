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
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys);
      if (parsed.default) return parsed.default;
    } catch (_error) {
      if (currentKeys.startsWith("sb_secret_")) return currentKeys;
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function asaasConfig() {
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const baseUrl = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  const environment = baseUrl === "https://api-sandbox.asaas.com/v3"
    ? "SANDBOX"
    : baseUrl === "https://api.asaas.com/v3"
    ? "PRODUCTION"
    : "UNKNOWN";
  const keyMatchesEnvironment = environment === "SANDBOX"
    ? apiKey.startsWith("$aact_hmlg_")
    : environment === "PRODUCTION"
    ? apiKey.startsWith("$aact_prod_")
    : false;
  if (!apiKey || !keyMatchesEnvironment) throw new Error("Configuração de pagamento indisponível.");
  return { environment };
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
  if (value === "RECEIVED_IN_CASH") return "RECEIVED";
  if (["RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED", "PARTIALLY_REFUNDED", "PENDING"].includes(value)) return value;
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

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function refundedAmountCents(payment: JsonRecord) {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  return refunds.reduce((total: number, refund: unknown) => {
    if (!refund || typeof refund !== "object") return total;
    const row = refund as JsonRecord;
    if (text(row.status, 30).toUpperCase() !== "DONE") return total;
    const value = moneyCents(row.value);
    return total + (value !== null && value > 0 ? value : 0);
  }, 0);
}

function refundTransitionState(
  currentPaymentStatus: string,
  paymentStatus: string,
  expectedCents: number | null,
  completedRefundCents: number,
) {
  const fullRefund = expectedCents !== null && expectedCents > 0 && completedRefundCents >= expectedCents;
  const preserveKnownPartial = currentPaymentStatus === "PARTIALLY_REFUNDED" &&
    paymentStatus === "RECEIVED" && completedRefundCents === 0;
  const partialRefund = !fullRefund && (paymentStatus === "PARTIALLY_REFUNDED" ||
    (paymentStatus === "RECEIVED" && (completedRefundCents > 0 || preserveKnownPartial)));
  const manualReview = currentPaymentStatus === "PARTIALLY_REFUNDED" && paymentStatus === "CANCELLED";
  return {
    fullRefund,
    partialRefund,
    reversed: paymentStatus === "REFUNDED" || fullRefund,
    refundPending: paymentStatus === "REFUND_PENDING",
    manualReview,
    remainingPaidCents: fullRefund
      ? 0
      : partialRefund && expectedCents !== null && completedRefundCents > 0
      ? Math.max(0, expectedCents - completedRefundCents)
      : null,
  };
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
  const chargeback = payment.chargeback && typeof payment.chargeback === "object" && !Array.isArray(payment.chargeback)
    ? payment.chargeback as JsonRecord
    : {};
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
    chargeback: Object.keys(chargeback).length
      ? { status: text(chargeback.status, 40), reason: text(chargeback.reason, 80) }
      : null,
    refunds,
  };
}

function preservesStrongerPaymentState(
  currentStatus: string,
  nextStatus: string,
  eventType: string,
  reversibleCancellation = false,
) {
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
    return ["CREATED", "PENDING", "CONFIRMED", "OVERDUE", "FAILED", "CANCELLED"].includes(nextStatus);
  }
  if (currentStatus === "PARTIALLY_REFUNDED") {
    return ["CREATED", "PENDING", "CONFIRMED", "OVERDUE", "FAILED"].includes(nextStatus);
  }
  if (currentStatus === "CONFIRMED") {
    return ["CREATED", "PENDING", "OVERDUE", "FAILED", "CANCELLED"].includes(nextStatus);
  }
  if (currentStatus === "REVIEW_REQUIRED") {
    return !["RECEIVED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED", "DISPUTED", "CHARGEBACK"].includes(nextStatus);
  }
  if (currentStatus === "OVERDUE") return ["CREATED", "PENDING"].includes(nextStatus);
  if (currentStatus === "CANCELLED") {
    const chargebackResolved = reversibleCancellation &&
      ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH", "PAYMENT_UPDATED"].includes(eventType);
    return !["CANCELLED", "REFUNDED", "DISPUTED"].includes(nextStatus) && !chargebackResolved;
  }
  return false;
}

async function quarantineProviderEnvironment(
  supabase: DbClient,
  localPayment: JsonRecord,
  providerEnvironment: string,
  reason: string,
) {
  let candidate = localPayment;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const quarantined = await supabase.rpc("quarantine_tournament_payment_environment", {
      p_payment_id: candidate.id,
      p_expected_status: candidate.status,
      p_expected_updated_at: candidate.updated_at,
      p_reason: reason,
    });
    if (quarantined.error) throw quarantined.error;
    const result = quarantined.data && typeof quarantined.data === "object" && !Array.isArray(quarantined.data)
      ? quarantined.data as JsonRecord
      : {};
    const payment = result.payment && typeof result.payment === "object" && !Array.isArray(result.payment)
      ? result.payment as JsonRecord
      : {};
    if (!payment.id) throw new Error("O resultado da quarentena da cobrança é inválido.");
    if (result.applied === true || text(payment.provider_environment, 20).toUpperCase() === providerEnvironment) return;
    candidate = payment;
  }
  throw new Error("A cobrança mudou durante a quarentena de ambiente.");
}

async function findTournamentPayment(
  supabase: DbClient,
  providerEnvironment: string,
  providerPaymentId: string,
  externalReference: string,
) {
  let paymentResult = await supabase.from("tournament_payments")
    .select("*")
    .eq("provider", "ASAAS")
    .eq("provider_environment", providerEnvironment)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();
  if (paymentResult.error) throw paymentResult.error;

  const recognizedExternalReference = [
    "tournament-registration:",
    "tournament-family:",
    "tournament-spatial-addon:",
  ]
    .some((prefix) => externalReference.startsWith(prefix));
  if (!paymentResult.data && recognizedExternalReference) {
    paymentResult = await supabase.from("tournament_payments")
      .select("*")
      .eq("provider", "ASAAS")
      .eq("provider_environment", providerEnvironment)
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (paymentResult.error) throw paymentResult.error;
  }

  return paymentResult.data as JsonRecord | null;
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
    failureStage = "provider_configuration";
    const providerEnvironment = asaasConfig().environment;

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
    // Do not acknowledge an event until a worker has completed it. If the
    // current owner crashes, this non-2xx response makes Asaas retry; the
    // database claim becomes available again after its stale window.
    if (claimStatus === "BUSY") return json({ received: false, processing: true }, 503);
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
    const externalReference = text(providerPayment.externalReference, 180);
    const localPayment = await findTournamentPayment(
      supabase,
      providerEnvironment,
      providerPaymentId,
      externalReference,
    );
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

    const storedEnvironment = text(localPayment.provider_environment, 20).toUpperCase() || "UNKNOWN";
    if (storedEnvironment !== providerEnvironment) {
      failureStage = "provider_environment";
      await quarantineProviderEnvironment(
        supabase,
        localPayment,
        providerEnvironment,
        storedEnvironment === "UNKNOWN" ? "provider_environment_unknown" : "provider_environment_mismatch",
      );
      const completed = await supabase.from("asaas_webhook_events").update({
        status: "PROCESSED",
        processed_at: new Date().toISOString(),
        error: "Cobrança isolada por divergência de ambiente.",
        processing_token: null,
        processing_started_at: null,
      }).eq("event_id", eventId).eq("processing_token", processingToken).select("id").maybeSingle();
      if (completed.error) throw completed.error;
      if (!completed.data) throw new Error("A posse do processamento do evento foi perdida.");
      return json({ received: true, review_required: true });
    }

    failureStage = "payment_reconciliation";
    const receivedAmount = Number(providerPayment.value);
    const expectedAmount = Number(localPayment.amount);
    const receivedCents = moneyCents(receivedAmount);
    const expectedCents = moneyCents(expectedAmount);
    const providerBillingType = text(providerPayment.billingType, 30).toUpperCase();
    const mismatchReason = providerBillingType !== "PIX"
      ? "billing_type"
      : receivedCents === null || expectedCents === null || receivedCents !== expectedCents
      ? "amount"
      : localPayment.provider_payment_id && localPayment.provider_payment_id !== providerPaymentId
      ? "provider_payment_id"
      : !externalReference || externalReference !== localPayment.external_reference
      ? "external_reference"
      : "";

    const currentPaymentStatus = text(localPayment.status, 40).toUpperCase();
    const reversibleCancellation = currentPaymentStatus === "CANCELLED" && Boolean(localPayment.next_reconciliation_at);
    if (!mismatchReason && preservesStrongerPaymentState(
      currentPaymentStatus,
      paymentStatus,
      eventType,
      reversibleCancellation,
    )) {
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

    // PAYMENT_CONFIRMED can mean a precautionary Pix review in Asaas. A
    // provider snapshot is settled only when its actual status is RECEIVED;
    // this also safely handles PAYMENT_UPDATED carrying a received payment.
    const completedRefundCents = refundedAmountCents(providerPayment);
    const refundTransition = refundTransitionState(
      currentPaymentStatus,
      paymentStatus,
      expectedCents,
      completedRefundCents,
    );
    const { partialRefund, reversed, refundPending, manualReview } = refundTransition;
    const settled = !mismatchReason && paymentStatus === "RECEIVED" && !partialRefund;
    const disputed = paymentStatus === "DISPUTED";
    const cancelled = paymentStatus === "CANCELLED";
    const persistedPaymentStatus = mismatchReason
      ? "REVIEW_REQUIRED"
      : manualReview
      ? "REVIEW_REQUIRED"
      : reversed
      ? "REFUNDED"
      : disputed
      ? "CANCELLED"
      : partialRefund
      ? "PARTIALLY_REFUNDED"
      : refundPending
      ? (currentPaymentStatus || "PENDING")
      : paymentStatus;
    const paymentUpdate: JsonRecord = {
      provider_payment_id: mismatchReason ? localPayment.provider_payment_id : providerPaymentId,
      provider_customer_id: mismatchReason
        ? localPayment.provider_customer_id
        : text(providerPayment.customer, 120) || localPayment.provider_customer_id,
      billing_type: mismatchReason
        ? "PIX"
        : text(providerPayment.billingType, 30) || localPayment.billing_type,
      status: persistedPaymentStatus,
      invoice_url: mismatchReason
        ? localPayment.invoice_url
        : text(providerPayment.invoiceUrl || providerPayment.bankSlipUrl, 1000) || localPayment.invoice_url,
      // Provider responses can contain customer documents, e-mail and bearer
      // links. Persist only the fields required for reconciliation/auditing.
      raw_response: mismatchReason
        ? { error_code: "provider_payment_mismatch", reason: mismatchReason, payment: safePaymentSnapshot }
        : manualReview
        ? {
          error_code: "partial_refund_cancelled",
          requires_manual_review: true,
          payment: safePaymentSnapshot,
        }
        : safePaymentSnapshot,
      paid_at: settled || partialRefund
        ? localPayment.paid_at || paidAt(providerPayment)
        : reversed || disputed || persistedPaymentStatus === "CONFIRMED"
        ? null
        : localPayment.paid_at,
      reconciliation_started_at: persistedPaymentStatus === "REVIEW_REQUIRED"
        ? localPayment.reconciliation_started_at || new Date().toISOString()
        : persistedPaymentStatus === "CONFIRMED"
        ? currentPaymentStatus === "CONFIRMED"
          ? localPayment.reconciliation_started_at || new Date().toISOString()
          : new Date().toISOString()
        : null,
      reconciliation_attempts: 0,
      next_reconciliation_at: manualReview
        ? null
      : persistedPaymentStatus === "REVIEW_REQUIRED"
        ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
      : refundPending
        ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : persistedPaymentStatus === "RECEIVED"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : persistedPaymentStatus === "PARTIALLY_REFUNDED"
        ? new Date(Date.now() + (completedRefundCents > 0 ? 24 * 60 * 60 : 5 * 60) * 1000).toISOString()
      : disputed
        ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        : ["PENDING", "CONFIRMED", "OVERDUE"].includes(persistedPaymentStatus)
        ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    };
    failureStage = "registration_reconciliation";
    let registrationUpdate: JsonRecord | null = null;
    if (mismatchReason) {
      registrationUpdate = {
        status: "PENDING",
        payment_status: "PENDING",
        paid_amount: 0,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      };
    } else if (manualReview) {
      // A provider-side deletion after money was partially refunded is not a
      // safe cancellation. Keep the confirmed/net-paid registration intact and
      // require an operator to reconcile the remaining amount explicitly.
      registrationUpdate = null;
    } else if (settled) {
      registrationUpdate = {
        status: "CONFIRMED",
        payment_status: "PAID",
        paid_amount: (expectedCents || 0) / 100,
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
        status: "CONFIRMED",
        payment_status: "PARTIALLY_REFUNDED",
        paid_amount: refundTransition.remainingPaidCents !== null
          ? refundTransition.remainingPaidCents / 100
          : null,
        confirmed_at: paymentUpdate.paid_at,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      };
    } else if (disputed) {
      registrationUpdate = {
        status: "CANCELLED",
        payment_status: "CANCELLED",
        paid_amount: 0,
        cancelled_at: new Date().toISOString(),
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
    } else if (["PENDING", "CONFIRMED", "FAILED"].includes(paymentStatus)) {
      registrationUpdate = {
        status: "PENDING",
        payment_status: "PENDING",
        paid_amount: 0,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      };
    }
    const reconciliation = await supabase.rpc("apply_tournament_payment_reconciliation", {
      p_payment_id: localPayment.id,
      p_expected_status: localPayment.status,
      p_expected_updated_at: localPayment.updated_at,
      p_status: paymentUpdate.status,
      p_provider_environment: providerEnvironment,
      p_provider_payment_id: paymentUpdate.provider_payment_id,
      p_provider_customer_id: paymentUpdate.provider_customer_id,
      p_billing_type: paymentUpdate.billing_type,
      p_invoice_url: paymentUpdate.invoice_url,
      p_pix_payload: null,
      p_pix_encoded_image: null,
      p_pix_expires_at: null,
      p_raw_response: paymentUpdate.raw_response,
      p_paid_at: paymentUpdate.paid_at,
      p_reconciliation_started_at: paymentUpdate.reconciliation_started_at,
      p_reconciliation_attempts: paymentUpdate.reconciliation_attempts,
      p_next_reconciliation_at: paymentUpdate.next_reconciliation_at,
      p_registration_status: registrationUpdate?.status || null,
      p_registration_payment_status: registrationUpdate?.payment_status || null,
      p_registration_paid_amount: registrationUpdate && Object.prototype.hasOwnProperty.call(registrationUpdate, "paid_amount")
        ? registrationUpdate.paid_amount
        : null,
      p_confirmed_at: registrationUpdate?.confirmed_at || null,
      p_cancelled_at: registrationUpdate?.cancelled_at || null,
    });
    if (reconciliation.error) throw reconciliation.error;
    const reconciliationResult = reconciliation.data && typeof reconciliation.data === "object" &&
        !Array.isArray(reconciliation.data)
      ? reconciliation.data as JsonRecord
      : {};
    if (reconciliationResult.applied !== true) {
      throw new Error("A cobrança mudou durante a reconciliação; o evento será tentado novamente.");
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
