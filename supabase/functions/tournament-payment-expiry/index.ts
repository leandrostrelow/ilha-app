import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

type Row = Record<string, unknown>;
type DbClient = SupabaseClient<any, "public", "public", any>;

const MAX_BATCH = 12;
const MAX_CONCURRENCY = 3;
const MAX_RUNTIME_MS = 20_000;
const PROVIDER_TIMEOUT_MS = 4_000;
const CONFIRMED_REVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;
const reconciliationDelaysSeconds = [300, 600, 1_800, 3_600, 10_800, 21_600];
const EXPIRY_REMOVABLE_PROVIDER_STATUSES = new Set(["PENDING", "OVERDUE"]);

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
  return { apiKey, baseUrl, environment };
}

async function asaasRequest(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "IlhaTenis-Torneios/1.0",
        "access_token": apiKey,
        ...(init.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({})) as Row;
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function providerStatus(payment: Row) {
  const chargeback = payment.chargeback && typeof payment.chargeback === "object" && !Array.isArray(payment.chargeback)
    ? payment.chargeback as Row
    : {};
  const chargebackStatus = String(chargeback.status || "").trim().toUpperCase();
  if (["REQUESTED", "IN_DISPUTE", "DISPUTE_LOST", "DONE"].includes(chargebackStatus)) {
    return "CHARGEBACK";
  }
  const status = String(payment.status || "").trim().toUpperCase();
  if (status === "RECEIVED_IN_CASH") return "RECEIVED";
  if (["DELETED", "CANCELLED"].includes(status)) return "CANCELLED";
  return status;
}

function paymentExpiryRemoteDisposition(
  hasStoredProviderPaymentId: boolean,
  remoteOk: boolean,
  remoteHttpStatus: number,
  remoteBodyIsEmpty: boolean,
  remoteProviderPaymentId: string,
  remoteProviderStatus: string,
) {
  if (remoteHttpStatus === 404) return "ARCHIVE_REMOTE_ABSENT";
  if (remoteOk && !hasStoredProviderPaymentId && remoteBodyIsEmpty) return "ARCHIVE_REMOTE_ABSENT";
  if (
    remoteOk &&
    Boolean(remoteProviderPaymentId) &&
    EXPIRY_REMOVABLE_PROVIDER_STATUSES.has(remoteProviderStatus)
  ) {
    return "DELETE_THEN_ARCHIVE";
  }
  return "DEFER";
}

function chargebackStatus(payment: Row) {
  const chargeback = payment.chargeback && typeof payment.chargeback === "object" && !Array.isArray(payment.chargeback)
    ? payment.chargeback as Row
    : {};
  return String(chargeback.status || "").trim().toUpperCase();
}

function isoAfter(seconds: number) {
  return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
}

function isExpired(payment: Row, now = Date.now()) {
  const expiresAt = Date.parse(String(payment.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function paidAt(payment: Row) {
  const raw = String(payment.clientPaymentDate || payment.paymentDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00-03:00`;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function completedRefundAmountCents(payment: Row) {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  return refunds.reduce((total: number, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const refund = item as Row;
    if (String(refund.status || "").trim().toUpperCase() !== "DONE") return total;
    const value = moneyCents(refund.value);
    return total + (value !== null && value > 0 ? value : 0);
  }, 0);
}

function reviewWindowStartedAt(payment: Row) {
  if (!["CONFIRMED", "REVIEW_REQUIRED"].includes(String(payment.status || ""))) return Date.now();
  for (const value of [payment.reconciliation_started_at, payment.updated_at]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

async function scheduleReconciliation(client: DbClient, payment: Row, status?: string, delayOverride?: number) {
  const attempts = Math.max(0, Number(payment.reconciliation_attempts || 0)) + 1;
  const delay = delayOverride || reconciliationDelaysSeconds[Math.min(attempts - 1, reconciliationDelaysSeconds.length - 1)];
  const update: Row = {
    reconciliation_attempts: attempts,
    reconciliation_started_at: payment.reconciliation_started_at || new Date().toISOString(),
    next_reconciliation_at: isoAfter(delay),
    updated_at: new Date().toISOString(),
  };
  if (status) update.status = status;
  const result = await client.from("tournament_payments").update(update)
    .eq("id", payment.id)
    .eq("status", payment.status)
    .eq("provider_environment", asaasConfig().environment)
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

function safeProviderSnapshot(payment: Row) {
  const chargeback = payment.chargeback && typeof payment.chargeback === "object" && !Array.isArray(payment.chargeback)
    ? payment.chargeback as Row
    : {};
  return {
    id: String(payment.id || "").trim().slice(0, 120),
    status: String(payment.status || "").trim().slice(0, 40),
    value: Number.isFinite(Number(payment.value)) ? Number(payment.value) : null,
    customer: String(payment.customer || "").trim().slice(0, 120),
    billing_type: String(payment.billingType || "").trim().slice(0, 30),
    external_reference: String(payment.externalReference || "").trim().slice(0, 180),
    payment_date: String(payment.paymentDate || "").trim().slice(0, 40),
    client_payment_date: String(payment.clientPaymentDate || "").trim().slice(0, 40),
    chargeback: Object.keys(chargeback).length
      ? {
        status: String(chargeback.status || "").trim().slice(0, 40),
        reason: String(chargeback.reason || "").trim().slice(0, 80),
      }
      : null,
    refunds: (Array.isArray(payment.refunds) ? payment.refunds : [])
      .filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .slice(0, 50)
      .map((refund) => ({
        status: String(refund.status || "").trim().slice(0, 30),
        value: Number.isFinite(Number(refund.value)) ? Number(refund.value) : null,
        date_created: String(refund.dateCreated || "").trim().slice(0, 40),
      })),
  };
}

function remoteMismatch(payment: Row, providerPayment: Row) {
  const providerPaymentId = String(providerPayment.id || "").trim();
  const expectedProviderPaymentId = String(payment.provider_payment_id || "").trim();
  if (!providerPaymentId || (expectedProviderPaymentId && expectedProviderPaymentId !== providerPaymentId)) {
    return "provider_payment_id";
  }
  if (String(providerPayment.externalReference || "").trim() !== String(payment.external_reference || "").trim()) {
    return "external_reference";
  }
  const remoteAmount = moneyCents(providerPayment.value);
  if (remoteAmount === null || remoteAmount !== moneyCents(payment.amount)) return "amount";
  if (String(providerPayment.billingType || "").trim().toUpperCase() !== "PIX") return "billing_type";
  return "";
}

function registrationState(payment: Row, providerPayment: Row, status: string) {
  const cancelledAt = new Date().toISOString();
  if (status === "RECEIVED") {
    const confirmedAt = paidAt(providerPayment);
    return { status: "CONFIRMED", paymentStatus: "PAID", paidAmount: Number(payment.amount), confirmedAt, cancelledAt: null };
  }
  if (status === "PARTIALLY_REFUNDED") {
    const confirmedAt = String(payment.paid_at || "").trim() || paidAt(providerPayment);
    return {
      status: "CONFIRMED",
      paymentStatus: "PARTIALLY_REFUNDED",
      paidAmount: null,
      confirmedAt,
      cancelledAt: null,
    };
  }
  if (["CONFIRMED", "REVIEW_REQUIRED", "PENDING"].includes(status)) {
    return { status: "PENDING", paymentStatus: "PENDING", paidAmount: 0, confirmedAt: null, cancelledAt: null };
  }
  if (status === "OVERDUE") {
    return { status: null, paymentStatus: "OVERDUE", paidAmount: null, confirmedAt: null, cancelledAt: null };
  }
  if (status === "REFUNDED") {
    return { status: "REFUNDED", paymentStatus: "REFUNDED", paidAmount: 0, confirmedAt: null, cancelledAt };
  }
  if (["CHARGEBACK", "CANCELLED"].includes(status)) {
    return { status: "CANCELLED", paymentStatus: "CANCELLED", paidAmount: 0, confirmedAt: null, cancelledAt };
  }
  return { status: null, paymentStatus: null, paidAmount: null, confirmedAt: null, cancelledAt: null };
}

async function applyPaymentState(
  client: DbClient,
  payment: Row,
  providerPayment: Row,
  status: string,
  options: {
    mismatchReason?: string;
    nextAt?: string | null;
    startedAt?: string | null;
    attempts?: number;
    registrationPaidAmount?: number;
  } = {},
) {
  const mismatch = options.mismatchReason || "";
  const providerPaymentId = mismatch ? null : String(providerPayment.id || "").trim() || null;
  const state = registrationState(payment, providerPayment, status);
  const applied = await client.rpc("apply_tournament_payment_reconciliation", {
    p_payment_id: payment.id,
    p_expected_status: payment.status,
    p_expected_updated_at: payment.updated_at,
    p_status: status,
    p_provider_environment: asaasConfig().environment,
    p_provider_payment_id: providerPaymentId,
    p_provider_customer_id: mismatch ? null : String(providerPayment.customer || "").trim() || null,
    p_billing_type: mismatch ? "PIX" : String(providerPayment.billingType || payment.billing_type || "PIX"),
    p_invoice_url: mismatch ? payment.invoice_url || null : String(providerPayment.invoiceUrl || providerPayment.bankSlipUrl || "").trim() || null,
    p_pix_payload: null,
    p_pix_encoded_image: null,
    p_pix_expires_at: null,
    p_raw_response: mismatch
      ? { error_code: "provider_payment_mismatch", reason: mismatch, payment: safeProviderSnapshot(providerPayment) }
      : { payment: safeProviderSnapshot(providerPayment) },
    p_paid_at: ["RECEIVED", "PARTIALLY_REFUNDED"].includes(status) ? state.confirmedAt : null,
    p_reconciliation_started_at: options.startedAt ?? null,
    p_reconciliation_attempts: options.attempts ?? 0,
    p_next_reconciliation_at: options.nextAt ?? null,
    p_registration_status: state.status,
    p_registration_payment_status: state.paymentStatus,
    p_registration_paid_amount: options.registrationPaidAmount ?? state.paidAmount,
    p_confirmed_at: state.confirmedAt,
    p_cancelled_at: state.cancelledAt,
  });
  if (applied.error) throw applied.error;
  const result = applied.data && typeof applied.data === "object" && !Array.isArray(applied.data)
    ? applied.data as Row
    : {};
  return result.applied === true;
}

async function confirmLocally(client: DbClient, payment: Row, providerPayment: Row) {
  return await applyPaymentState(client, payment, providerPayment, "RECEIVED", {
    nextAt: isoAfter(24 * 60 * 60),
  });
}

async function persistConfirmedReview(
  client: DbClient,
  payment: Row,
  providerPayment: Row,
): Promise<"review_required" | "under_review"> {
  const reviewExpired = Date.now() - reviewWindowStartedAt(payment) >= CONFIRMED_REVIEW_WINDOW_MS;
  const now = new Date().toISOString();
  const confirmedStartedAt = ["CONFIRMED", "REVIEW_REQUIRED"].includes(String(payment.status || ""))
    ? String(payment.reconciliation_started_at || now)
    : now;
  await applyPaymentState(client, payment, providerPayment, reviewExpired ? "REVIEW_REQUIRED" : "CONFIRMED", {
    startedAt: confirmedStartedAt,
    attempts: Math.max(0, Number(payment.reconciliation_attempts || 0)) + 1,
    nextAt: reviewExpired ? isoAfter(6 * 60 * 60) : isoAfter(300),
  });
  return reviewExpired ? "review_required" : "under_review";
}

async function reconcileReversal(client: DbClient, payment: Row, providerPayment: Row) {
  await applyPaymentState(client, payment, providerPayment, "REFUNDED");
}

async function reconcileCancellation(client: DbClient, payment: Row, providerPayment: Row, reversible = false) {
  await applyPaymentState(client, payment, providerPayment, "CANCELLED", {
    nextAt: reversible ? isoAfter(6 * 60 * 60) : null,
  });
}

async function quarantineProviderEnvironment(
  client: DbClient,
  payment: Row,
  providerEnvironment: string,
  reason: string,
) {
  let candidate = payment;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await client.rpc("quarantine_tournament_payment_environment", {
      p_payment_id: candidate.id,
      p_expected_status: candidate.status,
      p_expected_updated_at: candidate.updated_at,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Row
      : {};
    const latest = payload.payment && typeof payload.payment === "object" && !Array.isArray(payload.payment)
      ? payload.payment as Row
      : {};
    if (!latest.id) throw new Error("O resultado da quarentena da cobrança é inválido.");
    if (payload.applied === true || String(latest.provider_environment || "").toUpperCase() === providerEnvironment) {
      return true;
    }
    candidate = latest;
  }
  throw new Error("A cobrança mudou durante a quarentena de ambiente.");
}

async function archiveLocally(client: DbClient, payment: Row) {
  if (!isExpired(payment)) return false;
  const result = await client.rpc("archive_expired_tournament_payment", { p_payment_id: payment.id });
  if (result.error) throw result.error;
  return result.data === true;
}

async function findRemotePayment(payment: Row) {
  const providerPaymentId = String(payment.provider_payment_id || "").trim();
  if (providerPaymentId) return await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}`);
  const externalReference = String(payment.external_reference || "").trim();
  if (!externalReference) return { ok: true, status: 200, body: {} as Row };
  const result = await asaasRequest(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=2`);
  if (!result.ok) return result;
  const rows = Array.isArray(result.body.data) ? result.body.data : [];
  const exact = rows.filter((row) => row && typeof row === "object" &&
    String((row as Row).externalReference || "").trim() === externalReference) as Row[];
  if (exact.length > 1) return { ok: true, status: 200, body: { duplicate_external_reference: true } as Row };
  return { ok: true, status: 200, body: (exact[0] || {}) as Row };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const configuredToken = Deno.env.get("TOURNAMENT_PAYMENT_EXPIRY_TOKEN") || "";
  const receivedToken = request.headers.get("x-tournament-expiry-token") || "";
  if (configuredToken.length < 32 || !receivedToken || !(await secureEquals(receivedToken, configuredToken))) {
    return json({ error: "Rotina não autorizada." }, 401);
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = serviceRoleKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "Serviço indisponível." }, 503);
  let providerEnvironment = "";
  try {
    providerEnvironment = asaasConfig().environment;
  } catch (_error) {
    return json({ error: "Configuração de pagamento indisponível." }, 503);
  }
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const selectColumns = "id,registration_id,provider,provider_environment,provider_payment_id,provider_customer_id,external_reference,billing_type,status,amount,paid_at,expires_at,created_at,updated_at,provider_attempted_at,reconciliation_started_at,reconciliation_attempts,next_reconciliation_at";

  const expired = await client.from("tournament_payments")
    .select(selectColumns)
    .eq("provider", "ASAAS")
    .in("status", ["CREATED", "RECONCILING", "PENDING", "FAILED", "OVERDUE"])
    .not("expires_at", "is", null)
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(Math.ceil(MAX_BATCH / 2));
  if (expired.error) {
    console.error("tournament-payment-expiry lookup failed", { code: expired.error.code || "database_error" });
    return json({ error: "Não foi possível verificar as cobranças." }, 500);
  }

  const work = new Map<string, Row>();
  for (const payment of (expired.data || []) as Row[]) work.set(String(payment.id), payment);
  if (work.size < MAX_BATCH) {
    const due = await client.from("tournament_payments")
      .select(selectColumns)
      .eq("provider", "ASAAS")
      .in("status", ["RECONCILING", "PENDING", "CONFIRMED", "REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "RECEIVED", "CANCELLED", "OVERDUE"])
      .not("next_reconciliation_at", "is", null)
      .lte("next_reconciliation_at", now)
      .order("next_reconciliation_at", { ascending: true })
      .limit(MAX_BATCH - work.size);
    if (due.error) {
      console.error("tournament-payment-expiry reconciliation lookup failed", { code: due.error.code || "database_error" });
      return json({ error: "Não foi possível reconciliar as cobranças." }, 500);
    }
    for (const payment of (due.data || []) as Row[]) work.set(String(payment.id), payment);
  }

  const items = [...work.values()];
  const summary = {
    checked: items.length,
    expired: 0,
    confirmed: 0,
    under_review: 0,
    review_required: 0,
    reversed: 0,
    partial_refund: 0,
    deferred: 0,
    skipped_for_runtime: 0,
  };
  let cursor = 0;

  const processPayment = async (payment: Row) => {
    try {
      const storedEnvironment = String(payment.provider_environment || "UNKNOWN").trim().toUpperCase();
      if (storedEnvironment !== providerEnvironment) {
        await quarantineProviderEnvironment(
          client,
          payment,
          providerEnvironment,
          storedEnvironment === "UNKNOWN" ? "provider_environment_unknown" : "provider_environment_mismatch",
        );
        summary.review_required += 1;
        return;
      }
      const remote = await findRemotePayment(payment);
      if (!remote.ok && remote.status !== 404) {
        await scheduleReconciliation(client, payment);
        summary.deferred += 1;
        return;
      }

      const remotePayment = remote.ok ? remote.body : {};
      if (remotePayment.duplicate_external_reference === true) {
        await applyPaymentState(client, payment, remotePayment, "REVIEW_REQUIRED", {
          mismatchReason: "duplicate_external_reference",
          startedAt: String(payment.reconciliation_started_at || new Date().toISOString()),
          attempts: Math.max(0, Number(payment.reconciliation_attempts || 0)) + 1,
          nextAt: isoAfter(6 * 60 * 60),
        });
        summary.review_required += 1;
        return;
      }
      const recoveredProviderPaymentId = String(remotePayment.id || "").trim();
      if (recoveredProviderPaymentId) {
        const mismatch = remoteMismatch(payment, remotePayment);
        if (mismatch) {
          await applyPaymentState(client, payment, remotePayment, "REVIEW_REQUIRED", {
            mismatchReason: mismatch,
            startedAt: String(payment.reconciliation_started_at || new Date().toISOString()),
            attempts: Math.max(0, Number(payment.reconciliation_attempts || 0)) + 1,
            nextAt: isoAfter(6 * 60 * 60),
          });
          summary.review_required += 1;
          return;
        }
      }
      const status = providerStatus(remotePayment);
      const remoteDisposition = paymentExpiryRemoteDisposition(
        Boolean(String(payment.provider_payment_id || "").trim()),
        remote.ok,
        remote.status,
        Object.keys(remotePayment).length === 0,
        recoveredProviderPaymentId,
        status,
      );
      const currentStatus = String(payment.status || "");
      if (currentStatus === "RECEIVED" && !["RECEIVED", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK", "CANCELLED"].includes(status)) {
        await scheduleReconciliation(client, payment, undefined, 24 * 60 * 60);
        summary.deferred += 1;
        return;
      }
      if (currentStatus === "REVIEW_REQUIRED" && !["RECEIVED", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK", "CANCELLED", "CONFIRMED"].includes(status)) {
        await scheduleReconciliation(client, payment, undefined, 6 * 60 * 60);
        summary.deferred += 1;
        return;
      }
      if (currentStatus === "CONFIRMED" && ["CREATED", "PENDING", "OVERDUE", ""].includes(status)) {
        const outcome = await persistConfirmedReview(client, payment, remotePayment);
        summary[outcome] += 1;
        return;
      }
      const refundTotalCents = completedRefundAmountCents(remotePayment);
      const paymentAmountCents = moneyCents(payment.amount) || 0;
      if (["RECEIVED", "PARTIALLY_REFUNDED"].includes(status) && paymentAmountCents > 0 && refundTotalCents >= paymentAmountCents) {
        await reconcileReversal(client, payment, remotePayment);
        summary.reversed += 1;
        return;
      }
      const preserveKnownPartial = currentStatus === "PARTIALLY_REFUNDED" &&
        !["REFUNDED", "CHARGEBACK", "CANCELLED"].includes(status);
      if (status === "PARTIALLY_REFUNDED" || refundTotalCents > 0 || preserveKnownPartial) {
        await applyPaymentState(client, payment, remotePayment, "PARTIALLY_REFUNDED", {
          nextAt: isoAfter(refundTotalCents > 0 ? 24 * 60 * 60 : 5 * 60),
          registrationPaidAmount: refundTotalCents > 0
            ? Math.max(0, paymentAmountCents - refundTotalCents) / 100
            : undefined,
        });
        summary.partial_refund += 1;
        return;
      }
      if (status === "RECEIVED") {
        if (await confirmLocally(client, payment, remotePayment)) summary.confirmed += 1;
        return;
      }
      if (status === "CONFIRMED") {
        const outcome = await persistConfirmedReview(client, payment, remotePayment);
        summary[outcome] += 1;
        return;
      }
      if (status === "REFUNDED") {
        await reconcileReversal(client, payment, remotePayment);
        summary.reversed += 1;
        return;
      }
      if (status === "CHARGEBACK") {
        const disputeStatus = chargebackStatus(remotePayment);
        const reversible = ["REQUESTED", "IN_DISPUTE"].includes(disputeStatus);
        await reconcileCancellation(client, payment, remotePayment, reversible);
        summary.reversed += 1;
        return;
      }
      if (status === "CANCELLED") {
        await reconcileCancellation(client, payment, remotePayment);
        summary.reversed += 1;
        return;
      }

      if (!isExpired(payment)) {
        if (remoteDisposition === "DELETE_THEN_ARCHIVE") {
          const nextStatus = status === "OVERDUE" ? "OVERDUE" : "PENDING";
          await applyPaymentState(client, payment, remotePayment, nextStatus, {
            startedAt: String(payment.reconciliation_started_at || new Date().toISOString()),
            attempts: Math.max(0, Number(payment.reconciliation_attempts || 0)) + 1,
            nextAt: isoAfter(300),
          });
        } else {
          await scheduleReconciliation(client, payment);
        }
        summary.deferred += 1;
        return;
      }

      if (!["DELETE_THEN_ARCHIVE", "ARCHIVE_REMOTE_ABSENT"].includes(remoteDisposition)) {
        await scheduleReconciliation(client, payment);
        summary.deferred += 1;
        return;
      }

      const providerPaymentId = String(payment.provider_payment_id || recoveredProviderPaymentId || "").trim();
      if (remoteDisposition === "DELETE_THEN_ARCHIVE") {
        const removed = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: "DELETE" });
        if (!removed.ok && removed.status !== 404) {
          await scheduleReconciliation(client, payment);
          summary.deferred += 1;
          return;
        }
      }
      if (await archiveLocally(client, payment)) summary.expired += 1;
    } catch (error) {
      summary.deferred += 1;
      console.error("tournament-payment-expiry item deferred", {
        payment_id: payment.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  };

  const worker = async () => {
    while (cursor < items.length) {
      if (Date.now() - startedAt >= MAX_RUNTIME_MS) return;
      const index = cursor;
      cursor += 1;
      await processPayment(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, () => worker()));
  summary.skipped_for_runtime = Math.max(0, items.length - cursor);

  return json(summary);
});
