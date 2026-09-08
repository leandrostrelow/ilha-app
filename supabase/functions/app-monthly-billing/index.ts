// deno-lint-ignore-file no-import-prefix no-explicit-any
import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

type JsonRecord = Record<string, unknown>;
type DbClient = SupabaseClient<any, "public", "public", any>;

const MAX_BODY_BYTES = 25_000;
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_CONCURRENCY = 3;
const MAX_MANUAL_CLAIMS = 50;
const MAX_SCHEDULED_CLAIMS = 50;
const EXECUTION_BUDGET_MS = 105_000;
const MIN_SAFE_BATCH_BUDGET_MS = 72_000;
const SUPPORTED_PROVIDER_STATUSES = new Set([
  "PENDING",
  "CONFIRMED",
  "RECEIVED",
  "OVERDUE",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
  "DISPUTED",
]);
const PIX_REQUIRED_STATUSES = new Set(["PENDING", "CONFIRMED", "OVERDUE"]);

function corsHeaders(request: Request) {
  return appCorsHeaders(
    request,
    "POST, OPTIONS",
    "authorization, apikey, content-type, x-client-info, x-monthly-billing-token",
  );
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function invoiceMonth(value: unknown) {
  const normalized = text(value, 10);
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : "";
}

function saoPauloCycle(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  const year = part("year");
  const month = part("month");
  const day = Number(part("day"));
  return { month: `${year}-${month}-01`, day };
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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  if (!apiKey || !keyMatchesEnvironment) {
    throw new Error("Configuração de pagamento indisponível.");
  }
  return { apiKey, baseUrl, environment };
}

class AsaasRequestError extends Error {
  status: number;
  codes: string[];

  constructor(status: number, codes: string[], message: string) {
    super(message);
    this.name = "AsaasRequestError";
    this.status = status;
    this.codes = codes;
  }
}

class DuplicateProviderRecordsError extends Error {
  constructor(kind: "customer" | "payment") {
    super(
      `Mais de um ${
        kind === "customer" ? "cliente" : "pagamento"
      } foi encontrado para a mesma referência.`,
    );
    this.name = "DuplicateProviderRecordsError";
  }
}

class AmbiguousProviderResultError extends Error {
  override cause: unknown;

  constructor(cause: unknown) {
    super(
      "O provedor pode ter concluído a operação, mas a resposta não foi confirmada.",
    );
    this.name = "AmbiguousProviderResultError";
    this.cause = cause;
  }
}

class ProviderInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderInvariantError";
  }
}

function isAmbiguousProviderFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof AsaasRequestError) {
    return error.status >= 500 || [408, 409, 425, 429].includes(error.status);
  }
  return !(error instanceof ProviderInvariantError ||
    error instanceof DuplicateProviderRecordsError);
}

function publicError(error: unknown) {
  if (error instanceof DuplicateProviderRecordsError) return error.message;
  if (error instanceof ProviderInvariantError) return error.message;
  if (error instanceof AsaasRequestError && error.status < 500) {
    if ([401, 403].includes(error.status)) {
      return "A integração Asaas não autorizou a emissão. Revise a configuração financeira.";
    }
    return "O Asaas recusou os dados da cobrança. Revise o cadastro do responsável no Financeiro.";
  }
  return "Não foi possível concluir a emissão agora. A cobrança ficou segura para nova tentativa.";
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
        "User-Agent": "IlhaTenis-Mensalidades/1.0",
        "access_token": apiKey,
        ...(init.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const errors = Array.isArray(body.errors) ? body.errors : [];
      const codes = errors.map((item) => text(record(item).code, 80)).filter(
        Boolean,
      );
      const message = errors.map((item) =>
        text(record(item).description, 180)
      ).filter(Boolean).join(" ") ||
        `Asaas respondeu com status ${response.status}.`;
      throw new AsaasRequestError(response.status, codes, message);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function exactRows(body: JsonRecord, field: string, expected: string) {
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.filter((item) => text(record(item)[field], 180) === expected).map(
    record,
  );
}

async function findAsaasCustomer(externalReference: string) {
  const body = await asaasRequest(
    `/customers?externalReference=${
      encodeURIComponent(externalReference)
    }&limit=2`,
  );
  const matches = exactRows(body, "externalReference", externalReference);
  if (matches.length > 1) throw new DuplicateProviderRecordsError("customer");
  return matches[0] || null;
}

async function findAsaasCustomerByDocument(cpfCnpj: string) {
  const body = await asaasRequest(
    `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=2`,
  );
  const rows = Array.isArray(body.data) ? body.data : [];
  const matches = rows.map(record).filter((customer) =>
    text(customer.cpfCnpj, 20).replace(/\D/g, "") === cpfCnpj
  );
  if (matches.length > 1) throw new DuplicateProviderRecordsError("customer");
  return matches[0] || null;
}

async function findAsaasPayment(externalReference: string) {
  const body = await asaasRequest(
    `/payments?externalReference=${
      encodeURIComponent(externalReference)
    }&limit=2`,
  );
  const matches = exactRows(body, "externalReference", externalReference);
  if (matches.length > 1) throw new DuplicateProviderRecordsError("payment");
  return matches[0] || null;
}

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function providerStatus(payment: JsonRecord) {
  const chargebackStatus = text(record(payment.chargeback).status, 40)
    .toUpperCase();
  if (
    ["REQUESTED", "IN_DISPUTE", "DISPUTE_LOST", "DONE"].includes(
      chargebackStatus,
    )
  ) {
    return chargebackStatus === "IN_DISPUTE" ? "DISPUTED" : "CHARGEBACK";
  }
  const status = text(payment.status, 40).toUpperCase();
  if (status === "RECEIVED_IN_CASH") return "RECEIVED";
  if (status === "DELETED") return "CANCELLED";
  return status;
}

function providerPaidAt(payment: JsonRecord) {
  const value = text(payment.clientPaymentDate || payment.paymentDate, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00-03:00`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

function safePaymentSnapshot(payment: JsonRecord) {
  return {
    payment: {
      id: text(payment.id, 120),
      status: text(payment.status, 40).toUpperCase(),
      value: moneyCents(payment.value) === null ? null : Number(payment.value),
      customer: text(payment.customer, 120),
      billing_type: text(payment.billingType, 30).toUpperCase(),
      external_reference: text(payment.externalReference, 180),
      due_date: text(payment.dueDate, 20),
      invoice_url: text(payment.invoiceUrl, 500),
      payment_date: text(payment.paymentDate, 40),
      client_payment_date: text(payment.clientPaymentDate, 40),
    },
  };
}

function validateRemotePayment(
  payment: JsonRecord,
  claim: JsonRecord,
  customerId: string,
) {
  const providerPaymentId = text(payment.id, 120);
  const externalReference = text(payment.externalReference, 180);
  const billingType = text(payment.billingType, 30).toUpperCase();
  const providerCustomerId = text(payment.customer, 120);
  if (!providerPaymentId) {
    throw new ProviderInvariantError(
      "O Asaas não retornou o identificador da cobrança.",
    );
  }
  if (externalReference !== text(claim.external_reference, 180)) {
    throw new ProviderInvariantError(
      "A referência da cobrança divergiu do snapshot local.",
    );
  }
  if (billingType !== "PIX") {
    throw new ProviderInvariantError("A cobrança retornada não é Pix.");
  }
  if (moneyCents(payment.value) !== moneyCents(claim.expected_amount)) {
    throw new ProviderInvariantError(
      "O valor retornado pelo Asaas divergiu da fatura.",
    );
  }
  if (providerCustomerId !== customerId) {
    throw new ProviderInvariantError(
      "A cobrança retornada pertence a outro cliente Asaas.",
    );
  }
}

async function syncAsaasCustomerContact(
  customerId: string,
  client: JsonRecord,
  cpf: string,
  environment: string,
) {
  try {
    const updated = await asaasRequest(
      `/customers/${encodeURIComponent(customerId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: text(client.full_name, 120),
          cpfCnpj: cpf,
          email: text(client.email, 160) || undefined,
          mobilePhone: text(client.phone, 20).replace(/\D/g, "") || undefined,
          // Production delivery remains enabled at Asaas. We intentionally do
          // not overwrite externalReference on customers discovered by CPF.
          notificationDisabled: environment !== "PRODUCTION",
        }),
      },
    );
    const updatedCpf = text(updated.cpfCnpj, 20).replace(/\D/g, "");
    if (
      text(updated.id, 120) !== customerId ||
      (updatedCpf && updatedCpf !== cpf)
    ) {
      throw new ProviderInvariantError(
        "O Asaas não confirmou a atualização do customer reutilizado.",
      );
    }
    return true;
  } catch (error) {
    if (error instanceof ProviderInvariantError) throw error;
    // Contact synchronization is idempotent and best-effort. It must never be
    // mistaken for an ambiguous payment creation: the in-app invoice and its
    // own notification remain the delivery fallback.
    console.warn("monthly billing customer contact sync deferred", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

async function ensureAsaasCustomer(
  adminClient: DbClient,
  client: JsonRecord,
  environment: string,
) {
  const clientId = text(client.id, 60);
  const cpf = text(client.cpf, 20).replace(/\D/g, "");
  if (cpf.length !== 11) {
    throw new ProviderInvariantError(
      "O responsável financeiro precisa de um CPF válido.",
    );
  }
  const externalReference = `ilha-monthly-customer:${clientId}`;
  const identityFingerprint = await sha256Hex(`${environment}:${cpf}`);
  const resolution = await adminClient.rpc(
    "claim_app_payment_customer_resolution",
    {
      p_client_id: clientId,
      p_provider_environment: environment,
      p_external_reference: externalReference,
      p_identity_fingerprint: identityFingerprint,
    },
  );
  if (resolution.error) throw resolution.error;
  const resolutionState = record(resolution.data);
  const mappedId = text(resolutionState.providerCustomerId, 120);
  if (resolutionState.status === "REVIEW_REQUIRED") {
    throw new ProviderInvariantError(
      "O CPF do responsável mudou e o vínculo Asaas exige revisão.",
    );
  }
  if (resolutionState.status === "ACTIVE" && mappedId) {
    await syncAsaasCustomerContact(mappedId, client, cpf, environment);
    return mappedId;
  }
  if (resolutionState.claimed !== true) {
    throw new AmbiguousProviderResultError(
      new Error("Outro lote está resolvendo este cliente Asaas."),
    );
  }
  const resolutionToken = text(resolutionState.resolutionToken, 60);
  const allowProviderCreate = resolutionState.allowProviderCreate === true;
  if (!isUuid(resolutionToken)) {
    throw new ProviderInvariantError(
      "A reserva do cliente Asaas não retornou um token válido.",
    );
  }

  let customer = await findAsaasCustomer(externalReference);
  if (!customer) customer = await findAsaasCustomerByDocument(cpf);
  let reusedCustomer = Boolean(customer);
  if (!customer) {
    if (!allowProviderCreate) {
      throw new ProviderInvariantError(
        "O customer Asaas não foi localizado e exige revisão manual.",
      );
    }
    const marked = await adminClient.rpc(
      "mark_app_payment_customer_create_attempt",
      {
        p_client_id: clientId,
        p_provider_environment: environment,
        p_resolution_token: resolutionToken,
      },
    );
    if (marked.error) throw marked.error;
    if (marked.data !== true) {
      throw new ProviderInvariantError(
        "Não foi possível registrar a tentativa de criação do customer Asaas.",
      );
    }
    try {
      customer = await asaasRequest("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: text(client.full_name, 120),
          cpfCnpj: cpf,
          email: text(client.email, 160) || undefined,
          mobilePhone: text(client.phone, 20).replace(/\D/g, "") || undefined,
          externalReference,
          notificationDisabled: environment === "SANDBOX",
        }),
      });
    } catch (error) {
      if (!isAmbiguousProviderFailure(error)) throw error;
      const recovered = await findAsaasCustomer(externalReference).catch(() =>
        null
      ) ||
        await findAsaasCustomerByDocument(cpf).catch(() => null);
      if (!recovered) throw new AmbiguousProviderResultError(error);
      customer = recovered;
      reusedCustomer = true;
    }
  }
  const customerId = text(customer.id, 120);
  if (!customerId) {
    throw new ProviderInvariantError(
      "O Asaas não retornou o cliente da cobrança.",
    );
  }
  // Persist a recovered remote ID before any best-effort contact PUT. If the
  // PUT times out, the next run can still reuse this exact customer safely.
  const saved = await adminClient.rpc("save_app_payment_customer", {
    p_client_id: clientId,
    p_provider_environment: environment,
    p_provider_customer_id: customerId,
    p_external_reference: externalReference,
    p_identity_fingerprint: identityFingerprint,
    p_resolution_token: resolutionToken,
  });
  if (saved.error) throw saved.error;
  if (reusedCustomer) {
    await syncAsaasCustomerContact(customerId, client, cpf, environment);
  }
  return customerId;
}

async function createOrRecoverPayment(
  claim: JsonRecord,
  invoice: JsonRecord,
  customerId: string,
) {
  const externalReference = text(claim.external_reference, 180);
  // This lookup is mandatory before every POST. It makes a retry safe after a
  // timeout, 5xx or worker interruption whose remote result is unknown.
  let payment = await findAsaasPayment(externalReference);
  const storedProviderPaymentId = text(claim.provider_payment_id, 120);
  if (!payment && storedProviderPaymentId) {
    const byId = await asaasRequest(
      `/payments/${encodeURIComponent(storedProviderPaymentId)}`,
    );
    if (text(byId.externalReference, 180) !== externalReference) {
      throw new ProviderInvariantError(
        "O pagamento já vinculado usa outra referência.",
      );
    }
    payment = byId;
  }
  if (!payment) {
    // READY is a never-dispatched invoice and FAILED is an explicit operator
    // retry. Automatic polling of a remotely ambiguous attempt may only
    // recover by id/reference; it must never issue a second POST.
    if (claim.allow_provider_create !== true) {
      throw new ProviderInvariantError(
        "A cobrança remota não foi localizada; é necessária revisão manual.",
      );
    }
    try {
      payment = await asaasRequest("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "PIX",
          value: Number(claim.expected_amount),
          dueDate: text(invoice.due_date, 10),
          description: text(
            invoice.description || "Mensalidade Ilha Tênis",
            120,
          ),
          externalReference,
        }),
      });
    } catch (error) {
      if (!isAmbiguousProviderFailure(error)) throw error;
      const recovered = await findAsaasPayment(externalReference).catch(() =>
        null
      );
      if (!recovered) throw new AmbiguousProviderResultError(error);
      payment = recovered;
    }
  }
  validateRemotePayment(payment, claim, customerId);
  return payment;
}

async function fetchPix(paymentId: string) {
  const pix = await asaasRequest(
    `/payments/${encodeURIComponent(paymentId)}/pixQrCode`,
  );
  const payload = text(pix.payload, 8000);
  if (!payload) {
    throw new AmbiguousProviderResultError(
      new Error("Pix ainda indisponível."),
    );
  }
  const expirationRaw = text(pix.expirationDate, 60);
  const expiration = Date.parse(expirationRaw);
  return {
    payload,
    expiresAt: Number.isFinite(expiration)
      ? new Date(expiration).toISOString()
      : null,
  };
}

function reusableStoredPix(claim: JsonRecord) {
  const payload = text(claim.stored_pix_payload, 8000);
  const expiresAt = text(claim.stored_pix_expires_at, 60);
  const expiration = Date.parse(expiresAt);
  if (
    payload && Number.isFinite(expiration) && expiration > Date.now() + 60_000
  ) {
    return { payload, expiresAt: new Date(expiration).toISOString() };
  }
  return null;
}

function requireAppliedRpcOutcome(
  value: unknown,
  invoiceId: string,
  providerPaymentId: string,
  stage: string,
  allowDuplicateEvent = false,
  expectedStatus = "",
) {
  const outcome = record(value);
  const outcomeStatus = text(outcome.status, 40).toUpperCase();
  const isCoherentDuplicate = allowDuplicateEvent &&
    outcome.applied === false &&
    text(outcome.reason, 60) === "DUPLICATE_EVENT" &&
    outcomeStatus === expectedStatus;
  if (
    (outcome.applied !== true && !isCoherentDuplicate) ||
    text(outcome.invoice_id, 60) !== invoiceId ||
    text(outcome.provider_payment_id, 120) !== providerPaymentId ||
    outcomeStatus === "REVIEW_REQUIRED"
  ) {
    throw new ProviderInvariantError(
      `A ${stage} da cobrança exige revisão financeira.`,
    );
  }
  return outcome;
}

async function processClaim(adminClient: DbClient, claim: JsonRecord) {
  const invoiceId = text(claim.invoice_id, 60);
  const clientId = text(claim.client_id, 60);
  try {
    const config = asaasConfig();
    if (text(claim.provider_environment, 20) !== config.environment) {
      throw new ProviderInvariantError(
        "A cobrança pertence a outro ambiente Asaas.",
      );
    }
    const [invoiceResult, clientResult] = await Promise.all([
      adminClient.from("app_payment_invoices")
        .select("id, client_id, amount, due_date, description, status")
        .eq("id", invoiceId)
        .single(),
      adminClient.from("app_clients")
        .select("id, full_name, email, phone, cpf")
        .eq("id", clientId)
        .single(),
    ]);
    if (invoiceResult.error) throw invoiceResult.error;
    if (clientResult.error) throw clientResult.error;
    const invoice = record(invoiceResult.data);
    const client = record(clientResult.data);
    const customerId = await ensureAsaasCustomer(
      adminClient,
      client,
      config.environment,
    );
    const payment = await createOrRecoverPayment(claim, invoice, customerId);
    const paymentId = text(payment.id, 120);
    const snapshot = safePaymentSnapshot(payment);
    const status = providerStatus(payment);
    if (!SUPPORTED_PROVIDER_STATUSES.has(status)) {
      throw new ProviderInvariantError(
        `Status Asaas não suportado: ${status || "VAZIO"}.`,
      );
    }
    const pix = PIX_REQUIRED_STATUSES.has(status)
      ? reusableStoredPix(claim) || await fetchPix(paymentId)
      : { payload: "", expiresAt: null };

    const completed = await adminClient.rpc(
      "complete_app_invoice_provider_dispatch",
      {
        p_invoice_id: invoiceId,
        p_provider_environment: config.environment,
        p_provider_customer_id: customerId,
        p_provider_payment_id: paymentId,
        p_provider_status: status,
        p_external_reference: text(claim.external_reference, 180),
        p_remote_amount: Number(payment.value),
        p_billing_type: text(payment.billingType, 30).toUpperCase(),
        p_invoice_url: text(payment.invoiceUrl, 500) || null,
        p_pix_payload: pix.payload,
        p_pix_expires_at: pix.expiresAt,
        p_snapshot: snapshot,
      },
    );
    if (completed.error) throw completed.error;
    requireAppliedRpcOutcome(
      completed.data,
      invoiceId,
      paymentId,
      "vinculação ao Asaas",
    );

    const reconciled = await adminClient.rpc(
      "apply_app_invoice_payment_reconciliation",
      {
        p_provider_payment_id: paymentId,
        p_provider_environment: config.environment,
        p_provider_status: status,
        p_external_reference: text(claim.external_reference, 180),
        p_expected_amount: Number(payment.value),
        p_paid_at: status === "RECEIVED" ? providerPaidAt(payment) : null,
        p_event_id: `dispatch:${paymentId}:${status}`,
        p_snapshot: snapshot,
      },
    );
    if (reconciled.error) throw reconciled.error;
    const reconciliationOutcome = requireAppliedRpcOutcome(
      reconciled.data,
      invoiceId,
      paymentId,
      "reconciliação",
      true,
      status,
    );
    const reconciledStatus = text(
      reconciliationOutcome.status,
      40,
    ).toUpperCase();
    const needsReview = new Set([
      "FAILED",
      "REVIEW_REQUIRED",
      "REFUND_PENDING",
      "PARTIALLY_REFUNDED",
      "CHARGEBACK",
      "DISPUTED",
    ]).has(reconciledStatus);

    return {
      invoiceId,
      clientId,
      state: needsReview ? "FAILED" : "DISPATCHED",
      providerStatus: reconciledStatus,
      error: needsReview ? "A cobrança exige revisão financeira." : null,
    };
  } catch (error) {
    const ambiguous = error instanceof AmbiguousProviderResultError ||
      isAmbiguousProviderFailure(error);
    const message = publicError(error);
    const failed = await adminClient.rpc("fail_app_invoice_provider_dispatch", {
      p_invoice_id: invoiceId,
      p_error: message,
      p_ambiguous: ambiguous,
    });
    if (failed.error) {
      console.error("monthly billing failure persistence error", {
        invoice_id: invoiceId,
        message: text(failed.error.message, 300),
      });
    }
    const failureOutcome = record(failed.data);
    const persistedStatus = text(failureOutcome.status, 40).toUpperCase();
    const financialStatePreserved =
      failureOutcome.reason === "FINANCIAL_STATE_PRESERVED";
    const preservedNeedsReview = new Set([
      "FAILED",
      "REVIEW_REQUIRED",
      "REFUND_PENDING",
      "PARTIALLY_REFUNDED",
      "CHARGEBACK",
      "DISPUTED",
    ]).has(persistedStatus);
    console.warn("monthly billing dispatch deferred", {
      invoice_id: invoiceId,
      ambiguous,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      invoiceId,
      clientId,
      state: financialStatePreserved
        ? preservedNeedsReview ? "FAILED" : "DISPATCHED"
        : ambiguous
        ? "RECONCILING"
        : "FAILED",
      providerStatus: persistedStatus ||
        (ambiguous ? "RECONCILING" : "FAILED"),
      error: financialStatePreserved && !preservedNeedsReview ? null : message,
    };
  }
}

async function processInBatches(adminClient: DbClient, claims: JsonRecord[]) {
  const results: JsonRecord[] = [];
  for (let index = 0; index < claims.length; index += MAX_CONCURRENCY) {
    const batch = claims.slice(index, index + MAX_CONCURRENCY);
    results.push(
      ...await Promise.all(
        batch.map((claim) => processClaim(adminClient, claim)),
      ),
    );
  }
  return results;
}

async function authenticate(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  adminClient: DbClient,
) {
  const suppliedInternalToken =
    request.headers.get("x-monthly-billing-token") || "";
  if (suppliedInternalToken) {
    if (suppliedInternalToken.length < 32) return null;
    const verified = await adminClient.rpc(
      "verify_app_monthly_billing_internal_token",
      { p_token: suppliedInternalToken },
    );
    if (verified.error || verified.data !== true) return null;
    return { kind: "INTERNAL", userId: null, canWrite: true };
  }

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const userResult = await userClient.auth.getUser(token);
  if (userResult.error || !userResult.data.user) return null;
  const [readPermission, writePermission] = await Promise.all([
    userClient.rpc("has_club_permission", { p_permission: "finance.read" }),
    userClient.rpc("has_club_permission", { p_permission: "finance.write" }),
  ]);
  const canRead = !readPermission.error && readPermission.data === true;
  const canWrite = !writePermission.error && writePermission.data === true;
  if (!canRead && !canWrite) {
    return {
      kind: "FORBIDDEN",
      userId: userResult.data.user.id,
      canWrite: false,
    };
  }
  return { kind: "USER", userId: userResult.data.user.id, canWrite };
}

Deno.serve(async (request: Request) => {
  const executionDeadline = Date.now() + EXECUTION_BUDGET_MS;
  let executionStage = "REQUEST";
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Método inválido." }, 405);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return json(request, { error: "Dados enviados são muito grandes." }, 413);
  }
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return json(
      request,
      { error: "Não foi possível ler os dados enviados." },
      400,
    );
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(request, { error: "Dados enviados são muito grandes." }, 413);
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return json(request, { error: "JSON inválido." }, 400);
  }

  let runId = "";
  let adminClient: DbClient | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error("Configuração do Supabase ausente.");
    }
    adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await authenticate(
      request,
      supabaseUrl,
      anonKey,
      adminClient,
    );
    if (!auth) return json(request, { error: "Credencial inválida." }, 401);
    if (auth.kind === "FORBIDDEN") {
      return json(
        request,
        { error: "Seu acesso não permite gerar cobranças." },
        403,
      );
    }

    const body = record(parsedBody);
    const action = text(body.action, 20).toLowerCase();
    if (
      !new Set(["preview", "generate", "retry", "scheduled", "reconcile"])
        .has(action)
    ) {
      return json(request, { error: "Ação inválida." }, 400);
    }
    const isInternalOnlyAction = ["scheduled", "reconcile"].includes(action);
    const isInternalAllowedAction = ["scheduled", "reconcile", "retry"]
      .includes(action);
    if (auth.kind === "INTERNAL" && !isInternalAllowedAction) {
      return json(request, {
        error:
          "O token interno aceita somente geração agendada, reconciliação ou retentativa individual.",
      }, 403);
    }
    if (auth.kind !== "INTERNAL" && isInternalOnlyAction) {
      return json(request, {
        error: "A execução interna exige o token de cobrança mensal.",
      }, 403);
    }
    if (action !== "preview" && !auth.canWrite) {
      return json(request, {
        error: "Seu acesso permite consultar, mas não gerar cobranças.",
      }, 403);
    }
    const currentCycle = saoPauloCycle();
    const requestedMonth = isInternalOnlyAction
      ? currentCycle.month
      : invoiceMonth(body.invoiceMonth);
    const requestedInvoiceId = text(body.invoiceId, 60);
    const requestedClientId = text(body.clientId, 60);
    if (["preview", "generate"].includes(action) && !requestedMonth) {
      return json(request, {
        error: "Informe a competência no formato YYYY-MM-01.",
      }, 400);
    }
    if (action === "retry" && !isUuid(requestedInvoiceId)) {
      return json(request, {
        error: "Informe a fatura que deve ser reenviada.",
      }, 400);
    }
    if (requestedClientId && !isUuid(requestedClientId)) {
      return json(request, { error: "O cliente informado é inválido." }, 400);
    }

    if (action === "preview") {
      const preview = await adminClient.rpc("preview_app_monthly_pix_billing", {
        p_invoice_month: requestedMonth,
        p_client_id: requestedClientId || null,
      });
      if (preview.error) throw preview.error;
      return json(request, { action, ...record(preview.data), results: [] });
    }

    executionStage = "SETTINGS";
    const settings = await adminClient.from("app_monthly_billing_settings")
      .select("enabled, generation_day, max_batch_size")
      .eq("singleton", true)
      .single();
    if (settings.error) throw settings.error;
    const billingEnabled = settings.data.enabled === true;
    const generationDayReached = currentCycle.day >=
      Number(settings.data.generation_day || 1);
    const shouldGenerate = action === "generate" ||
      (action === "scheduled" && billingEnabled && generationDayReached);
    const maxBatchSize = Math.max(
      1,
      Math.min(25, Number(settings.data.max_batch_size) || 10),
    );

    let month = requestedMonth;
    if (action === "retry") {
      executionStage = "INVOICE_LOOKUP";
      const invoiceResult = await adminClient.from("app_payment_invoices")
        .select("invoice_month")
        .eq("id", requestedInvoiceId)
        .single();
      if (invoiceResult.error) throw invoiceResult.error;
      month = String(invoiceResult.data.invoice_month || "").slice(0, 10);
    }

    executionStage = "RUN_START";
    const run = await adminClient.from("app_monthly_billing_runs").insert({
      action: action.toUpperCase(),
      invoice_month: month,
      requested_invoice_id: action === "retry" ? requestedInvoiceId : null,
      requested_by: auth.userId,
      authorization_kind: auth.kind,
      status: "STARTED",
    }).select("id").single();
    if (run.error) throw run.error;
    runId = String(run.data.id || "");

    executionStage = "PROVIDER_CONFIG";
    const config = asaasConfig();
    let generatedInvoiceId = "";
    let individualGenerationFailure: JsonRecord | null = null;
    if (shouldGenerate) {
      const generated = await adminClient.rpc(
        "generate_enrolled_app_monthly_pix_billing",
        {
          p_invoice_month: month,
          p_client_id: requestedClientId || null,
          p_provider_environment: config.environment,
        },
      );
      if (generated.error) throw generated.error;
      if (action === "generate" && requestedClientId) {
        const generatedResults = Array.isArray(record(generated.data).results)
          ? record(generated.data).results as unknown[]
          : [];
        const generatedForClient = generatedResults.map(record).find((item) =>
          text(item.clientId || item.client_id, 60) === requestedClientId
        );
        generatedInvoiceId = text(
          generatedForClient?.invoiceId || generatedForClient?.invoice_id,
          60,
        );
        if (!isUuid(generatedInvoiceId)) {
          individualGenerationFailure = {
            invoiceId: "",
            clientId: requestedClientId,
            state: "FAILED",
            providerStatus: "",
            error: text(
              generatedForClient?.error,
              300,
            ) || "O cadastro deixou de estar elegível antes da emissão.",
          };
        }
      }
    }

    const results: JsonRecord[] = individualGenerationFailure
      ? [individualGenerationFailure]
      : [];
    let deadlineReached = false;
    const maxClaims = isInternalOnlyAction
      ? MAX_SCHEDULED_CLAIMS
      : action === "generate" && !requestedClientId
      ? MAX_MANUAL_CLAIMS
      : 1;
    do {
      const remainingCapacity = maxClaims - results.length;
      if (remainingCapacity <= 0) break;
      if (Date.now() + MIN_SAFE_BATCH_BUDGET_MS > executionDeadline) {
        deadlineReached = true;
        break;
      }
      // Never lease more rows than the worker can process concurrently. A new
      // batch is claimed only while there is enough wall-clock budget for the
      // worst supported provider call sequence.
      const claimLimit = Math.min(
        maxBatchSize,
        remainingCapacity,
        MAX_CONCURRENCY,
      );
      executionStage = "CLAIM";
      const claimed = await adminClient.rpc(
        "claim_app_invoice_provider_dispatch",
        {
          p_invoice_id: action === "retry"
            ? requestedInvoiceId
            : generatedInvoiceId || null,
          p_invoice_month: action === "generate" && !generatedInvoiceId
            ? month
            : null,
          p_batch_limit: claimLimit,
          p_include_ready: action === "retry" || shouldGenerate,
        },
      );
      if (claimed.error) throw claimed.error;
      const claims = Array.isArray(claimed.data)
        ? claimed.data.map(record)
        : [];
      if (!claims.length) break;
      executionStage = "PROVIDER_DISPATCH";
      results.push(...await processInBatches(adminClient, claims));
      if (action === "retry" || claims.length < claimLimit) break;
    } while (results.length < maxClaims);

    executionStage = "FINAL_PREVIEW";
    const preview = await adminClient.rpc("preview_app_monthly_pix_billing", {
      p_invoice_month: month,
      p_client_id: requestedClientId || null,
    });
    if (preview.error) throw preview.error;
    const failedCount = results.filter((result) =>
      result.state === "FAILED"
    ).length;
    const partialCount = results.filter((result) =>
      result.state === "RECONCILING"
    ).length;
    const remainingReady = Number(
      record(record(preview.data).summary).ready || 0,
    );
    const actionableReady = action === "generate" || shouldGenerate
      ? remainingReady
      : 0;
    const capacityReached = action !== "retry" && results.length >= maxClaims;
    const isPartial = Boolean(
      failedCount || partialCount || actionableReady ||
        capacityReached || deadlineReached,
    );
    const reconciliationMayRemain = isInternalOnlyAction &&
      (deadlineReached || results.length >= maxClaims);
    const payload = {
      action,
      ...record(preview.data),
      results,
      partial: isPartial,
      remainingReady,
      reconciliationMayRemain,
      generationPaused: action === "scheduled" && !billingEnabled,
      generationDeferred: action === "scheduled" && billingEnabled &&
          !generationDayReached
        ? "GENERATION_DAY_NOT_REACHED"
        : null,
    };
    executionStage = "RUN_COMPLETE";
    const completedRun = await adminClient.from("app_monthly_billing_runs")
      .update({
        status: isPartial ? "PARTIAL" : "SUCCEEDED",
        summary: record(preview.data).summary || {},
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    if (completedRun.error) throw completedRun.error;
    return json(request, payload);
  } catch (error) {
    console.error("app-monthly-billing failed", {
      error_type: error instanceof Error ? error.name : "UnknownError",
      run_id: runId || null,
    });
    if (runId && adminClient) {
      const failedRun = await adminClient.from("app_monthly_billing_runs")
        .update({
          status: "FAILED",
          last_error: "Falha operacional na execução mensal.",
          completed_at: new Date().toISOString(),
        }).eq("id", runId);
      if (failedRun.error) {
        console.error("monthly billing run status persistence failed", {
          run_id: runId,
          code: text(failedRun.error.code, 80),
        });
      }
    }
    return json(request, {
      error: "Não foi possível concluir o financeiro mensal agora.",
      code: "MONTHLY_BILLING_OPERATION_FAILED",
      stage: executionStage,
    }, 500);
  }
});
