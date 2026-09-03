import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const defaultAllowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

const syntheticStagingRef = "ohndgphxtwhokekjyobu";
const cloudflareTestSiteKey = "1x00000000000000000000AA";
const cloudflareTestSecretKey = "1x0000000000000000000000000000000AA";

function isSyntheticStagingProject() {
  try {
    return new URL(Deno.env.get("SUPABASE_URL") || "").hostname === `${syntheticStagingRef}.supabase.co`;
  } catch (_error) {
    return false;
  }
}

function publicRegistrationAllowedOrigins() {
  const origins = new Set(defaultAllowedOrigins);
  const configured = (Deno.env.get("PUBLIC_REGISTRATION_ALLOWED_ORIGINS") || "").trim();
  if (!configured) return origins;
  for (const value of configured.split(",")) {
    const candidate = value.trim();
    if (!candidate || candidate === "*") return null;
    try {
      const url = new URL(candidate);
      const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
      origins.add(url.origin);
    } catch (_error) {
      return null;
    }
  }
  return origins;
}

const configuredAllowedOrigins = publicRegistrationAllowedOrigins();

const allowedBillingTypes = new Set(["PIX"]);
const allowedGenders = new Set(["MALE", "FEMALE"]);
const allowedAvailabilityDays = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"]);
const allowedParticipantTypes = new Set(["CINCATE", "ILHA_STUDENT", "NON_MEMBER", "COURTESY"]);
const participantLabels: Record<string, string> = { CINCATE: "CINCATE", ILHA_STUDENT: "Aluno Ilha Tênis", NON_MEMBER: "Não associado", COURTESY: "Cortesia (isento)" };
const retryablePaymentStatuses = new Set(["CREATED", "FAILED"]);
const pixRepairablePaymentStatuses = new Set(["CREATED", "RECONCILING", "PENDING", "OVERDUE"]);
const paymentReconciliationDelaysSeconds = [5, 15, 30, 60, 120, 300, 600];
const publicRegistrationRuleErrors = new Set([
  "A Espacial A e a Espacial B são exclusivas para quem já está inscrito da 2ª à 6ª Classe Masculina.",
  "A Espacial A é exclusiva para atletas inscritos na 2ª, 3ª ou 4ª Classe Masculina.",
  "A Espacial B é exclusiva para atletas inscritos na 5ª, 6ª ou 7ª Classe Masculina.",
  "Este atleta já atingiu o limite de duas inscrições neste torneio.",
  "Somente atletas da 2ª à 6ª Classe Masculina podem fazer uma segunda inscrição, exclusivamente na Espacial A ou B.",
  "A segunda inscrição só é permitida na Espacial A para atletas da 2ª, 3ª e 4ª Classe Masculina ou na Espacial B para atletas da 5ª, 6ª e 7ª Classe Masculina.",
  "Escolha primeiro sua classe principal e use a opção de Classe Espacial.",
  "Esta classe não permite inscrição adicional na Classe Espacial.",
  "A Classe Espacial selecionada não corresponde à sua classe principal.",
  "A Classe Espacial selecionada atingiu o limite de vagas.",
]);

type JsonRecord = Record<string, unknown>;
type DbClient = SupabaseClient<any, "public", "public", any>;

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const responseOrigin = configuredAllowedOrigins?.has(origin)
    ? origin
    : origin
    ? "null"
    : "https://app.ilhatenis.com";
  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
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

function text(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function nullableText(value: unknown, maxLength: number) {
  return text(value, maxLength) || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type PublicRegistrationSecurityConfig = {
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  turnstileAllowedHostnames: Set<string>;
  rateLimitSalt: string;
};

function publicRegistrationSecurityConfig(): PublicRegistrationSecurityConfig | null {
  const turnstileSiteKey = (Deno.env.get("TURNSTILE_SITE_KEY") || "").trim();
  const turnstileSecretKey = (Deno.env.get("TURNSTILE_SECRET_KEY") || "").trim();
  const rateLimitSalt = Deno.env.get("PUBLIC_REGISTRATION_RATE_LIMIT_SALT") || "";
  const turnstileAllowedHostnames = new Set(
    (Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES") || "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter((hostname) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)),
  );
  if (!configuredAllowedOrigins || !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSiteKey) ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSecretKey) ||
    rateLimitSalt.length < 32 ||
    turnstileAllowedHostnames.size === 0) return null;
  return { turnstileSiteKey, turnstileSecretKey, turnstileAllowedHostnames, rateLimitSalt };
}

function trustedClientIp(request: Request) {
  // This header must be overwritten by the trusted edge gateway. Do not fall
  // back to client-controlled forwarding headers; when it is absent or invalid
  // the database applies only the global pre-CAPTCHA bucket.
  const candidate = text(request.headers.get("cf-connecting-ip"), 64).toLowerCase();
  if (!candidate || (!candidate.includes(".") && !candidate.includes(":"))) return null;
  return /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null;
}

async function hmacSha256(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function secureStringEquals(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

type SpatialCandidateProof = {
  v: 1;
  s: string;
  a: string;
  r: string;
  c: string;
  e: number;
};

async function createSpatialCandidateProof(
  config: PublicRegistrationSecurityConfig,
  tournamentSlug: string,
  cpf: string,
  athleteId: string,
  primaryRegistrationId: string,
) {
  const proof: SpatialCandidateProof = {
    v: 1,
    s: tournamentSlug,
    a: athleteId,
    r: primaryRegistrationId,
    c: await hmacSha256(config.rateLimitSalt, `spatial-addon-proof-cpf:${cpf}`),
    e: Date.now() + 15 * 60 * 1000,
  };
  const encoded = base64UrlEncode(JSON.stringify(proof));
  const signature = await hmacSha256(config.rateLimitSalt, `spatial-addon-proof:${encoded}`);
  return `${encoded}.${signature}`;
}

async function verifySpatialCandidateProof(
  config: PublicRegistrationSecurityConfig,
  proofValue: string,
  tournamentSlug: string,
  cpf: string,
) {
  const [encoded, signature, extra] = proofValue.split(".");
  if (!encoded || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null;
  }
  const expected = await hmacSha256(config.rateLimitSalt, `spatial-addon-proof:${encoded}`);
  if (!secureStringEquals(signature, expected)) return null;
  let parsed: SpatialCandidateProof;
  try {
    parsed = JSON.parse(base64UrlDecode(encoded)) as SpatialCandidateProof;
  } catch (_error) {
    return null;
  }
  const expectedCpfBinding = await hmacSha256(config.rateLimitSalt, `spatial-addon-proof-cpf:${cpf}`);
  if (parsed.v !== 1 || parsed.s !== tournamentSlug || !isUuid(parsed.a) || !isUuid(parsed.r) ||
    !/^[0-9a-f]{64}$/.test(parsed.c) || !secureStringEquals(parsed.c, expectedCpfBinding) ||
    !Number.isFinite(parsed.e) || parsed.e < Date.now() ||
    parsed.e > Date.now() + 16 * 60 * 1000) return null;
  return parsed;
}

async function verifyTurnstile(
  request: Request,
  token: string,
  config: PublicRegistrationSecurityConfig,
) {
  const form = new FormData();
  form.set("secret", config.turnstileSecretKey);
  form.set("response", token);
  const ip = trustedClientIp(request);
  if (ip) form.set("remoteip", ip);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("turnstile_unavailable");
    const outcome = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const usesOfficialTestKeys = isSyntheticStagingProject() &&
      config.turnstileSiteKey === cloudflareTestSiteKey &&
      config.turnstileSecretKey === cloudflareTestSecretKey;
    // Cloudflare's official dummy keys intentionally return synthetic metadata
    // (currently example.com and no action). Accept that response only in the
    // isolated staging project with the exact published test-key pair.
    if (usesOfficialTestKeys) return outcome.success === true;
    const actionMatches = outcome.action === "tournament_registration";
    const hostnameMatches = config.turnstileAllowedHostnames.has(
      String(outcome.hostname || "").toLowerCase(),
    );
    return outcome.success === true && actionMatches && hostnameMatches;
  } finally {
    clearTimeout(timeout);
  }
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calculateDigit(9) === Number(value[9]) && calculateDigit(10) === Number(value[10]);
}

async function publicAthleteSourceKey(email: string, phone: string) {
  const bytes = new TextEncoder().encode(`${email}|${phone}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `public:${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function registrationNotes(participantType: string, days: string[], notes: string | null) {
  const labels: Record<string, string> = {
    MONDAY: "segunda-feira",
    TUESDAY: "terça-feira",
    WEDNESDAY: "quarta-feira",
    THURSDAY: "quinta-feira",
  };
  const details = `Tipo de inscrição: ${participantLabels[participantType]}.\nDisponibilidade: ${days.map((day) => labels[day]).join(", ")}.`;
  return notes ? `${details}\nObservação: ${notes}`.slice(0, 500) : details;
}

function normalizeBillingType(value: unknown) {
  const normalized = text(value || "PIX", 30).toUpperCase().replace(/[- ]/g, "_");
  if (normalized === "CARTAO" || normalized === "CARTAO_CREDITO" || normalized === "CARD") return "CREDIT_CARD";
  if (normalized === "ESCOLHER" || normalized === "ALL") return "UNDEFINED";
  return normalized;
}

function saoPauloDate(reference: Date | string | number = new Date()) {
  const referenceDate = reference instanceof Date ? reference : new Date(reference);
  if (!Number.isFinite(referenceDate.getTime())) {
    throw new Error("Não foi possível calcular a data da cobrança.");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!/^\d{4}$/.test(values.year || "") || !/^\d{2}$/.test(values.month || "") ||
    !/^\d{2}$/.test(values.day || "")) {
    throw new Error("Não foi possível calcular a data da cobrança.");
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function asaasSafeDescription(value: unknown) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return normalized || "Inscricao em torneio";
}

function safeRegistration(row: JsonRecord) {
  return {
    id: row.id,
    public_code: row.public_code,
    public_name: row.public_name,
    tournament_id: row.tournament_id,
    category_id: row.category_id,
    status: row.status,
    payment_status: row.payment_status,
    total_amount: row.total_amount,
    created_at: row.created_at,
  };
}

function safePayment(row: JsonRecord | null) {
  if (!row) return null;
  const paymentStatus = String(row.status || "").trim().toUpperCase();
  const reservationExpiresAt = Date.parse(String(row.expires_at || ""));
  // Payment instructions fail closed. Only a provider-confirmed PENDING Pix
  // with an active local reservation can be shown to the browser. This keeps
  // stale, paid, ambiguous and manually reviewed charges from being payable.
  const paymentInstructionsAllowed = paymentStatus === "PENDING" &&
    Number.isFinite(reservationExpiresAt) && reservationExpiresAt > Date.now();
  return {
    id: row.id,
    status: row.status,
    billing_type: row.billing_type,
    amount: row.amount,
    invoice_url: paymentInstructionsAllowed ? row.invoice_url || null : null,
    pix_payload: paymentInstructionsAllowed ? row.pix_payload || null : null,
    pix_encoded_image: paymentInstructionsAllowed ? row.pix_encoded_image || null : null,
    pix_expires_at: paymentInstructionsAllowed ? row.pix_expires_at || null : null,
    expires_at: row.expires_at || null,
  };
}

function safeTrackingRegistration(row: JsonRecord) {
  return {
    category_id: row.category_id,
    status: row.status,
    payment_status: row.payment_status,
    total_amount: row.total_amount,
    paid_amount: row.paid_amount,
    confirmed_at: row.confirmed_at || null,
    cancelled_at: row.cancelled_at || null,
    created_at: row.created_at,
  };
}

function safeTrackingPayment(row: JsonRecord | null) {
  if (!row) return null;
  return {
    status: row.status,
    billing_type: row.billing_type,
    amount: row.amount,
    paid_at: row.paid_at || null,
    expires_at: row.expires_at || null,
    pix_expires_at: row.pix_expires_at || null,
  };
}

function hasDeferredPixRepair(payment: JsonRecord | null) {
  if (!payment || !payment.provider_payment_id || String(payment.billing_type || "").toUpperCase() !== "PIX") {
    return false;
  }
  const status = String(payment.status || "").trim().toUpperCase();
  return pixRepairablePaymentStatuses.has(status) && !(payment.pix_payload && payment.pix_encoded_image);
}

function deferredPixRepairResponse(payment: JsonRecord | null): JsonRecord {
  if (!hasDeferredPixRepair(payment)) return {};
  return {
    retryable: true,
    pix_retryable: true,
    warning: payment?.invoice_url
      ? "A cobrança foi criada e o link de pagamento continua válido. O QR Code Pix ainda está sendo preparado; tente carregá-lo novamente em alguns segundos."
      : "A cobrança foi criada no Asaas, mas o QR Code Pix ainda está sendo preparado. Tente carregá-lo novamente em alguns segundos.",
  };
}

function asaasConfig() {
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const configuredUrl = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  const environment = configuredUrl === "https://api-sandbox.asaas.com/v3"
    ? "SANDBOX"
    : configuredUrl === "https://api.asaas.com/v3"
    ? "PRODUCTION"
    : "UNKNOWN";
  const keyMatchesEnvironment = environment === "SANDBOX"
    ? apiKey.startsWith("$aact_hmlg_")
    : environment === "PRODUCTION"
    ? apiKey.startsWith("$aact_prod_")
    : false;
  if (!apiKey || !keyMatchesEnvironment) throw new Error("Configuração de pagamento indisponível.");
  return { apiKey, baseUrl: configuredUrl, environment };
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

class AmbiguousPaymentCreationError extends Error {
  override cause: unknown;

  constructor(cause: unknown) {
    super("A criação da cobrança ficou com resultado indeterminado.");
    this.name = "AmbiguousPaymentCreationError";
    this.cause = cause;
  }
}

class DuplicateProviderPaymentsError extends Error {
  constructor() {
    super("Mais de uma cobrança foi encontrada para a mesma inscrição.");
    this.name = "DuplicateProviderPaymentsError";
  }
}

function isAmbiguousProviderFailure(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof AsaasRequestError) {
    return error.status >= 500 || [408, 409, 425, 429].includes(error.status);
  }
  return true;
}

function providerErrorSnapshot(error: unknown): JsonRecord {
  if (error instanceof AmbiguousPaymentCreationError) {
    return { ...providerErrorSnapshot(error.cause), ambiguous_result: true };
  }
  if (error instanceof AsaasRequestError) {
    return {
      error_code: "asaas_request_failed",
      provider_status: error.status,
      provider_codes: error.codes.slice(0, 5),
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { error_code: "provider_timeout", provider_status: null, provider_codes: [] };
  }
  return { error_code: "provider_request_failed", provider_status: null, provider_codes: [] };
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
}

function reconciliationDelaySeconds(attempts: number) {
  const index = Math.max(0, Math.min(paymentReconciliationDelaysSeconds.length - 1, attempts));
  return paymentReconciliationDelaysSeconds[index];
}

async function asaasRequest(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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
    const body = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const errors = Array.isArray(body.errors) ? body.errors : [];
      const codes = errors.map((item: JsonRecord) => text(item.code, 80)).filter(Boolean);
      const message = errors.map((item: JsonRecord) => text(item.description, 180)).filter(Boolean).join(" ") ||
        `Asaas respondeu com status ${response.status}.`;
      throw new AsaasRequestError(response.status, codes, message);
    }
    return body as JsonRecord;
  } finally {
    clearTimeout(timer);
  }
}

async function findAsaasPayment(externalReference: string) {
  const result = await asaasRequest(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=2`);
  const rows = Array.isArray(result.data) ? result.data : [];
  const exact = rows.filter((row) => row && typeof row === "object" &&
    text((row as JsonRecord).externalReference, 180) === externalReference) as JsonRecord[];
  if (exact.length > 1) throw new DuplicateProviderPaymentsError();
  return exact[0] || null;
}

async function claimProviderPaymentAttempt(
  supabase: DbClient,
  localPayment: JsonRecord,
  billingType: string,
) {
  const now = new Date().toISOString();
  let claim = supabase.from("tournament_payments").update({
    status: "RECONCILING",
    billing_type: billingType,
    provider_attempted_at: now,
    reconciliation_started_at: localPayment.reconciliation_started_at || now,
    reconciliation_attempts: 0,
    next_reconciliation_at: secondsFromNow(paymentReconciliationDelaysSeconds[0]),
    updated_at: now,
  }).eq("id", localPayment.id).eq("status", localPayment.status);
  claim = claim.eq("provider_environment", asaasConfig().environment);
  // The expiry worker may race this claim at the two-hour boundary. Make the
  // active reservation check part of the same database CAS so no Asaas request
  // can begin after the local checkout became archivable.
  claim = claim.gt("expires_at", now);
  claim = localPayment.updated_at
    ? claim.eq("updated_at", localPayment.updated_at)
    : claim.is("updated_at", null);
  const result = await claim.select("*").maybeSingle();
  if (result.error) throw result.error;
  return result.data as JsonRecord | null;
}

async function deferPaymentReconciliation(
  supabase: DbClient,
  localPayment: JsonRecord,
  error: unknown = null,
) {
  const attempts = Math.max(0, Number(localPayment.reconciliation_attempts || 0)) + 1;
  const providerError = error ? providerErrorSnapshot(error) : null;
  const now = new Date().toISOString();
  const update: JsonRecord = {
    status: "RECONCILING",
    reconciliation_started_at: localPayment.reconciliation_started_at || now,
    reconciliation_attempts: attempts,
    next_reconciliation_at: secondsFromNow(reconciliationDelaySeconds(attempts)),
    updated_at: now,
  };
  if (providerError) update.raw_response = { ...providerError, stage: "asaas_payment_reconciliation" };
  const result = await supabase.from("tournament_payments").update(update)
    .eq("id", localPayment.id)
    .eq("status", "RECONCILING")
    .eq("provider_environment", asaasConfig().environment)
    .select("*")
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return result.data as JsonRecord;
  const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
  if (latest.error) throw latest.error;
  return latest.data as JsonRecord;
}

async function markClaimedProviderFailure(
  supabase: DbClient,
  claimedPayment: JsonRecord,
  rawResponse: JsonRecord,
) {
  const update = supabase.from("tournament_payments").update({
    status: "FAILED",
    raw_response: rawResponse,
    reconciliation_started_at: null,
    reconciliation_attempts: 0,
    next_reconciliation_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", claimedPayment.id).eq("status", claimedPayment.status);
  const guarded = claimedPayment.updated_at
    ? update.eq("updated_at", claimedPayment.updated_at)
    : update.is("updated_at", null);
  const failed = await guarded.select("*").maybeSingle();
  if (failed.error) throw failed.error;
  if (failed.data) return { payment: failed.data as JsonRecord, applied: true };

  // A webhook or the reconciliation cron may have completed while the
  // provider request was failing. Never overwrite that newer state.
  const latest = await supabase.from("tournament_payments")
    .select("*")
    .eq("id", claimedPayment.id)
    .single();
  if (latest.error) throw latest.error;
  return { payment: latest.data as JsonRecord, applied: false };
}

async function reconcileAmbiguousPayment(supabase: DbClient, localPayment: JsonRecord) {
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (text(localPayment.provider_environment, 20).toUpperCase() !== asaasConfig().environment) return localPayment;
  const nextAt = Date.parse(String(localPayment.next_reconciliation_at || ""));
  if (Number.isFinite(nextAt) && nextAt > Date.now()) return localPayment;
  try {
    const recovered = await findAsaasPayment(String(localPayment.external_reference || ""));
    if (recovered) return await saveProviderPayment(supabase, localPayment, recovered);
    return await deferPaymentReconciliation(supabase, localPayment);
  } catch (error) {
    if (error instanceof DuplicateProviderPaymentsError) {
      return await markProviderMismatchForReview(supabase, localPayment, {}, "duplicate_external_reference");
    }
    console.warn("tournament-register payment reconciliation deferred", {
      payment_id: localPayment.id,
      ...providerErrorSnapshot(error),
    });
    return await deferPaymentReconciliation(supabase, localPayment, error);
  }
}

async function ensureAsaasCustomer(supabase: DbClient, athlete: JsonRecord) {
  const cpf = String(athlete.cpf || "");
  if (!cpf) throw new Error("O pagamento online ainda precisa ser concluído pela organização.");
  // Customer IDs belong to one Asaas environment. Always resolve the CPF in
  // the currently configured environment instead of trusting a stale ID from
  // a previous sandbox/production configuration.
  const existing = await asaasRequest(`/customers?cpfCnpj=${encodeURIComponent(cpf)}&limit=1`);
  const rows = Array.isArray(existing.data) ? existing.data : [];
  let customer = (rows[0] || null) as JsonRecord | null;
  if (!customer) {
    customer = await asaasRequest("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: athlete.full_name,
        cpfCnpj: cpf,
        email: athlete.email || undefined,
        mobilePhone: athlete.phone || undefined,
        externalReference: `tournament-athlete:${athlete.id}`,
        // Sandbox fixtures must never notify a synthetic e-mail or phone. Keep
        // the production behavior unchanged for real tournament customers.
        notificationDisabled: asaasConfig().environment === "SANDBOX",
      }),
    });
  }
  const customerId = text(customer?.id, 80);
  if (!customerId) throw new Error("O Asaas não retornou o cliente da cobrança.");
  const { error } = await supabase.from("tournament_athletes")
    .update({ asaas_customer_id: customerId, updated_at: new Date().toISOString() })
    .eq("id", athlete.id);
  if (error) throw error;
  return customerId;
}

function mapAsaasPaymentStatus(value: unknown) {
  const status = text(value, 40).toUpperCase();
  if (["RECEIVED", "RECEIVED_IN_CASH"].includes(status)) return "RECEIVED";
  if (status === "CONFIRMED") return "CONFIRMED";
  if (status === "OVERDUE") return "OVERDUE";
  if (status === "REFUNDED") return "REFUNDED";
  if (status === "PARTIALLY_REFUNDED") return "PARTIALLY_REFUNDED";
  if (status === "DELETED") return "CANCELLED";
  if (status === "PENDING") return "PENDING";
  return "CREATED";
}

function providerPaidAt(payment: JsonRecord) {
  const value = text(payment.clientPaymentDate || payment.paymentDate, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00-03:00`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function moneyCents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function completedRefundAmountCents(payment: JsonRecord) {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  return refunds.reduce((total: number, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return total;
    const refund = item as JsonRecord;
    if (text(refund.status, 30).toUpperCase() !== "DONE") return total;
    const value = moneyCents(refund.value);
    return total + (value !== null && value > 0 ? value : 0);
  }, 0);
}

function providerChargebackStatus(payment: JsonRecord) {
  const chargeback = payment.chargeback && typeof payment.chargeback === "object" && !Array.isArray(payment.chargeback)
    ? payment.chargeback as JsonRecord
    : {};
  return text(chargeback.status, 40).toUpperCase();
}

async function quarantineProviderEnvironment(
  supabase: DbClient,
  localPayment: JsonRecord,
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
    const result = record(quarantined.data);
    const payment = record(result.payment);
    if (!payment.id) throw new Error("O resultado da quarentena da cobrança é inválido.");
    if (result.applied === true || text(payment.provider_environment, 20).toUpperCase() === asaasConfig().environment) {
      return payment;
    }
    candidate = payment;
  }
  throw new Error("A cobrança mudou durante a quarentena de ambiente.");
}

async function ensurePaymentProviderEnvironment(
  supabase: DbClient,
  localPayment: JsonRecord,
) {
  const currentEnvironment = asaasConfig().environment;
  const storedEnvironment = text(localPayment.provider_environment, 20).toUpperCase() || "UNKNOWN";
  if (storedEnvironment === currentEnvironment) return localPayment;

  const pristine = storedEnvironment === "UNKNOWN" && !localPayment.provider_payment_id &&
    !localPayment.provider_attempted_at && ["CREATED", "FAILED"].includes(String(localPayment.status || ""));
  if (pristine) {
    let update = supabase.from("tournament_payments")
      .update({ provider_environment: currentEnvironment, updated_at: new Date().toISOString() })
      .eq("id", localPayment.id)
      .eq("status", localPayment.status);
    update = localPayment.updated_at
      ? update.eq("updated_at", localPayment.updated_at)
      : update.is("updated_at", null);
    const bound = await update.select("*").maybeSingle();
    if (bound.error) throw bound.error;
    if (bound.data) return bound.data as JsonRecord;
    const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
    if (latest.error) throw latest.error;
    localPayment = latest.data as JsonRecord;
    if (text(localPayment.provider_environment, 20).toUpperCase() === currentEnvironment) return localPayment;
  }

  return await quarantineProviderEnvironment(
    supabase,
    localPayment,
    storedEnvironment === "UNKNOWN" ? "provider_environment_unknown" : "provider_environment_mismatch",
  );
}

async function markProviderMismatchForReview(
  supabase: DbClient,
  localPayment: JsonRecord,
  providerPayment: JsonRecord,
  reason: string,
) {
  const now = new Date().toISOString();
  const applied = await supabase.rpc("apply_tournament_payment_reconciliation", {
    p_payment_id: localPayment.id,
    p_expected_status: localPayment.status,
    p_expected_updated_at: localPayment.updated_at,
    p_status: "REVIEW_REQUIRED",
    p_provider_environment: asaasConfig().environment,
    p_provider_payment_id: localPayment.provider_payment_id || null,
    p_provider_customer_id: localPayment.provider_customer_id || null,
    p_billing_type: localPayment.billing_type || "PIX",
    p_invoice_url: localPayment.invoice_url || null,
    p_pix_payload: localPayment.pix_payload || null,
    p_pix_encoded_image: localPayment.pix_encoded_image || null,
    p_pix_expires_at: localPayment.pix_expires_at || null,
    p_raw_response: {
      error_code: "provider_payment_mismatch",
      reason,
      provider_payment_id: text(providerPayment.id, 100),
      provider_external_reference: text(providerPayment.externalReference, 180),
      provider_amount: Number.isFinite(Number(providerPayment.value)) ? Number(providerPayment.value) : null,
    },
    p_paid_at: null,
    p_reconciliation_started_at: now,
    p_reconciliation_attempts: Number(localPayment.reconciliation_attempts || 0),
    p_next_reconciliation_at: secondsFromNow(6 * 60 * 60),
    p_registration_status: "PENDING",
    p_registration_payment_status: "PENDING",
    p_registration_paid_amount: 0,
    p_confirmed_at: null,
    p_cancelled_at: null,
  });
  if (applied.error) throw applied.error;
  const result = record(applied.data);
  const payment = record(result.payment);
  if (!payment.id) throw new Error("O resultado da revisão da cobrança é inválido.");
  return payment;
}

function registrationReconciliationForStatus(
  localPayment: JsonRecord,
  providerPayment: JsonRecord,
  status: string,
) {
  let registrationStatus: string | null = null;
  let paymentStatus: string | null = null;
  let paidAmount: number | null = null;
  let confirmedAt: string | null = null;
  let cancelledAt: string | null = null;
  if (status === "RECEIVED") {
    registrationStatus = "CONFIRMED";
    paymentStatus = "PAID";
    paidAmount = Number(localPayment.amount || providerPayment.value || 0);
    confirmedAt = providerPaidAt(providerPayment);
  } else if (status === "CONFIRMED") {
    registrationStatus = "PENDING";
    paymentStatus = "PENDING";
    paidAmount = 0;
  } else if (status === "PARTIALLY_REFUNDED") {
    registrationStatus = "CONFIRMED";
    paymentStatus = "PARTIALLY_REFUNDED";
    const refundCents = completedRefundAmountCents(providerPayment);
    const amountCents = moneyCents(localPayment.amount) || 0;
    if (refundCents > 0) paidAmount = Math.max(0, amountCents - refundCents) / 100;
    confirmedAt = nullableText(localPayment.paid_at, 80) || providerPaidAt(providerPayment);
  } else if (status === "REFUNDED") {
    registrationStatus = "REFUNDED";
    paymentStatus = "REFUNDED";
    paidAmount = 0;
    cancelledAt = new Date().toISOString();
  } else if (status === "CANCELLED") {
    registrationStatus = "CANCELLED";
    paymentStatus = "CANCELLED";
    paidAmount = 0;
    cancelledAt = new Date().toISOString();
  }
  return { registrationStatus, paymentStatus, paidAmount, confirmedAt, cancelledAt };
}

async function saveProviderPayment(
  supabase: DbClient,
  localPayment: JsonRecord,
  providerPayment: JsonRecord,
) {
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (String(localPayment.status) === "REVIEW_REQUIRED" &&
    text(localPayment.provider_environment, 20).toUpperCase() !== asaasConfig().environment) {
    return localPayment;
  }
  const providerPaymentId = text(providerPayment.id, 100);
  if (!providerPaymentId) throw new Error("Cobrança sem identificador no Asaas.");
  const externalReference = text(providerPayment.externalReference, 180);
  const providerAmount = Number(providerPayment.value);
  const providerBillingType = text(providerPayment.billingType, 40).toUpperCase();
  const mismatchedProviderId = localPayment.provider_payment_id && localPayment.provider_payment_id !== providerPaymentId;
  const mismatchedReference = !externalReference || externalReference !== String(localPayment.external_reference || "");
  const mismatchedAmount = moneyCents(providerAmount) === null ||
    moneyCents(providerAmount) !== moneyCents(localPayment.amount);
  const mismatchedBillingType = providerBillingType !== "PIX";
  if (mismatchedProviderId || mismatchedReference || mismatchedAmount || mismatchedBillingType) {
    const reason = mismatchedProviderId
      ? "provider_payment_id"
      : mismatchedReference
      ? "external_reference"
      : mismatchedAmount
      ? "amount"
      : "billing_type";
    return await markProviderMismatchForReview(supabase, localPayment, providerPayment, reason);
  }
  const chargebackStatus = providerChargebackStatus(providerPayment);
  const activeChargeback = ["REQUESTED", "IN_DISPUTE", "DISPUTE_LOST", "DONE"].includes(chargebackStatus);
  const refundCents = completedRefundAmountCents(providerPayment);
  const amountCents = moneyCents(localPayment.amount) || 0;
  const providerStatus = activeChargeback
    ? "CANCELLED"
    : refundCents >= amountCents && amountCents > 0
    ? "REFUNDED"
    : mapAsaasPaymentStatus(providerPayment.status) === "RECEIVED" && refundCents > 0
    ? "PARTIALLY_REFUNDED"
    : mapAsaasPaymentStatus(providerPayment.status);
  let pix: JsonRecord = {};
  let pixRetrievalError: JsonRecord | null = null;
  const activePixStatus = ["CREATED", "PENDING", "CONFIRMED", "OVERDUE"].includes(providerStatus);
  if (String(localPayment.billing_type) === "PIX" && activePixStatus &&
    !(localPayment.pix_payload && localPayment.pix_encoded_image)) {
    try {
      pix = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`);
    } catch (error) {
      // The charge is already known to exist. Losing only the QR lookup must
      // never turn it into FAILED or allow a second provider charge on retry.
      pixRetrievalError = providerErrorSnapshot(error);
      console.warn("tournament-register provider PIX retrieval deferred", {
        payment_id: localPayment.id,
        provider_error: pixRetrievalError,
      });
    }
  }
  const localStatus = String(localPayment.status || "");
  const terminalProviderStatus = ["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(providerStatus);
  const status = localStatus === "RECEIVED" && !terminalProviderStatus
    ? "RECEIVED"
    : localStatus === "REVIEW_REQUIRED" && ["CREATED", "PENDING", "CONFIRMED", "OVERDUE"].includes(providerStatus)
    ? "REVIEW_REQUIRED"
    : localStatus === "CONFIRMED" && ["CREATED", "PENDING", "OVERDUE"].includes(providerStatus)
    ? "CONFIRMED"
    : localStatus === "PARTIALLY_REFUNDED" && ["CREATED", "PENDING", "CONFIRMED", "RECEIVED", "OVERDUE"].includes(providerStatus)
    ? "PARTIALLY_REFUNDED"
    : providerStatus;
  const settledAt = status === "RECEIVED"
    ? providerStatus === "RECEIVED"
      ? providerPaidAt(providerPayment)
      : nullableText(localPayment.paid_at, 80)
    : status === "PARTIALLY_REFUNDED"
    ? nullableText(localPayment.paid_at, 80) || providerPaidAt(providerPayment)
    : null;
  const reconciliationStartedAt = status === "REVIEW_REQUIRED"
    ? localPayment.reconciliation_started_at || null
    : status === "CONFIRMED"
    ? localStatus === "CONFIRMED"
      ? localPayment.reconciliation_started_at || new Date().toISOString()
      : new Date().toISOString()
    : null;
  const nextReconciliationAt = status === "REVIEW_REQUIRED"
    ? secondsFromNow(6 * 60 * 60)
    : status === "RECEIVED"
    ? secondsFromNow(24 * 60 * 60)
    : status === "PARTIALLY_REFUNDED"
    ? secondsFromNow(refundCents > 0 ? 24 * 60 * 60 : 5 * 60)
    : status === "CANCELLED" && ["REQUESTED", "IN_DISPUTE"].includes(chargebackStatus)
    ? secondsFromNow(6 * 60 * 60)
    : ["CREATED", "PENDING", "CONFIRMED", "OVERDUE"].includes(status)
    ? secondsFromNow(300)
    : null;
  const registration = registrationReconciliationForStatus(localPayment, providerPayment, status);
  const rawResponse = {
      payment: {
        id: providerPaymentId,
        status: text(providerPayment.status, 40),
        billing_type: text(providerPayment.billingType, 40),
        due_date: text(providerPayment.dueDate, 20),
        external_reference: text(providerPayment.externalReference, 160),
        chargeback_status: chargebackStatus,
        completed_refund_cents: refundCents,
      },
      pix: {
        expiration_date: text(pix.expirationDate, 80),
        ...(pixRetrievalError
          ? { retrieval_error: { ...pixRetrievalError, stage: "asaas_pix_qr_code" } }
          : {}),
      },
  };
  const applied = await supabase.rpc("apply_tournament_payment_reconciliation", {
    p_payment_id: localPayment.id,
    p_expected_status: localPayment.status,
    p_expected_updated_at: localPayment.updated_at,
    p_status: status,
    p_provider_environment: asaasConfig().environment,
    p_provider_payment_id: providerPaymentId,
    p_provider_customer_id: nullableText(providerPayment.customer || localPayment.provider_customer_id, 100),
    p_billing_type: nullableText(providerPayment.billingType || localPayment.billing_type, 40),
    p_invoice_url: nullableText(providerPayment.invoiceUrl || providerPayment.bankSlipUrl || localPayment.invoice_url, 1000),
    p_pix_payload: nullableText(pix.payload || localPayment.pix_payload, 4000),
    p_pix_encoded_image: nullableText(pix.encodedImage || localPayment.pix_encoded_image, 500000),
    p_pix_expires_at: nullableText(pix.expirationDate || localPayment.pix_expires_at, 80),
    p_raw_response: rawResponse,
    p_paid_at: settledAt,
    p_reconciliation_started_at: reconciliationStartedAt,
    p_reconciliation_attempts: status === "REVIEW_REQUIRED"
      ? Number(localPayment.reconciliation_attempts || 0)
      : 0,
    p_next_reconciliation_at: nextReconciliationAt,
    p_registration_status: registration.registrationStatus,
    p_registration_payment_status: registration.paymentStatus,
    p_registration_paid_amount: registration.paidAmount,
    p_confirmed_at: registration.confirmedAt,
    p_cancelled_at: registration.cancelledAt,
  });
  if (applied.error) throw applied.error;
  const result = record(applied.data);
  const payment = record(result.payment);
  if (!payment.id) throw new Error("O resultado da reconciliação da cobrança é inválido.");
  return payment;
}

async function repairExistingPixPayment(supabase: DbClient, localPayment: JsonRecord) {
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (text(localPayment.provider_environment, 20).toUpperCase() !== asaasConfig().environment) return localPayment;
  const providerPaymentId = text(localPayment.provider_payment_id, 100);
  if (!providerPaymentId || String(localPayment.billing_type) !== "PIX") return localPayment;
  if (localPayment.pix_payload && localPayment.pix_encoded_image) return localPayment;
  const providerPayment = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}`);
  return await saveProviderPayment(supabase, localPayment, providerPayment);
}

async function createOrRecoverPayment(
  supabase: DbClient,
  localPayment: JsonRecord,
  athlete: JsonRecord,
  tournament: JsonRecord,
  category: JsonRecord,
  additionalCategory: JsonRecord | null,
  providerCustomerId: string | null = null,
) {
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (text(localPayment.provider_environment, 20).toUpperCase() !== asaasConfig().environment) return localPayment;
  const externalReference = String(localPayment.external_reference);
  let recovered: JsonRecord | null;
  try {
    recovered = await findAsaasPayment(externalReference);
  } catch (error) {
    if (error instanceof DuplicateProviderPaymentsError) {
      return await markProviderMismatchForReview(supabase, localPayment, {}, "duplicate_external_reference");
    }
    throw error;
  }
  if (recovered) {
    try {
      return await saveProviderPayment(supabase, localPayment, recovered);
    } catch (error) {
      throw new AmbiguousPaymentCreationError(error);
    }
  }

  const customerId = providerCustomerId || text(localPayment.provider_customer_id, 80) ||
    await ensureAsaasCustomer(supabase, athlete);
  try {
    const providerPayment = await asaasRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: localPayment.billing_type,
        value: Number(localPayment.amount),
        dueDate: saoPauloDate(String(localPayment.expires_at || "")),
        description: asaasSafeDescription(
          `Inscrição ${tournament.name} ${category.name}${additionalCategory ? ` ${additionalCategory.name}` : ""}`,
        ),
        externalReference,
      }),
    });
    return await saveProviderPayment(supabase, { ...localPayment, provider_customer_id: customerId }, providerPayment);
  } catch (error) {
    if (isAmbiguousProviderFailure(error)) throw new AmbiguousPaymentCreationError(error);
    throw error;
  }
}

async function bindPaymentProviderCustomer(
  supabase: DbClient,
  localPayment: JsonRecord,
  providerCustomerId: string,
) {
  const customerId = text(providerCustomerId, 80);
  if (!customerId) throw new Error("O responsável pela cobrança não foi identificado.");
  const existingCustomerId = text(localPayment.provider_customer_id, 80);
  if (existingCustomerId) {
    if (existingCustomerId !== customerId) {
      throw new Error("A cobrança está vinculada a outro responsável e precisa de revisão.");
    }
    return localPayment;
  }

  let update = supabase.from("tournament_payments")
    .update({ provider_customer_id: customerId, updated_at: new Date().toISOString() })
    .eq("id", localPayment.id)
    .eq("status", localPayment.status)
    .eq("provider_environment", localPayment.provider_environment);
  update = localPayment.updated_at
    ? update.eq("updated_at", localPayment.updated_at)
    : update.is("updated_at", null);
  const bound = await update.select("*").maybeSingle();
  if (bound.error) throw bound.error;
  if (bound.data) return bound.data as JsonRecord;

  const latest = await supabase.from("tournament_payments")
    .select("*")
    .eq("id", localPayment.id)
    .single();
  if (latest.error) throw latest.error;
  const latestPayment = latest.data as JsonRecord;
  if (text(latestPayment.provider_customer_id, 80) !== customerId) {
    throw new Error("A cobrança mudou durante a vinculação do responsável.");
  }
  return latestPayment;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function ageOnDate(birthDate: string, referenceDate = saoPauloDate()) {
  if (!validBirthDate(birthDate) || !validBirthDate(referenceDate)) return null;
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = referenceDate.split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

async function familyAthleteSourceKey(
  payerEmail: string,
  payerPhone: string,
  fullName: string,
  birthDate: string,
  cpf: string,
) {
  const identity = [payerEmail, payerPhone, fullName.toLowerCase(), birthDate, cpf].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return `tournament-family:${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function safeRegistrationGroup(row: JsonRecord) {
  return {
    id: row.id,
    public_token: row.public_token,
    primary_registration_id: row.primary_registration_id,
    status: row.status,
    total_amount: row.total_amount,
  };
}

async function ensureAsaasFamilyCustomer(supabase: DbClient, group: JsonRecord) {
  const cpf = digits(group.payer_cpf);
  if (!isValidCpf(cpf)) throw new Error("O CPF do responsável pela cobrança é inválido.");
  const existing = await asaasRequest(`/customers?cpfCnpj=${encodeURIComponent(cpf)}&limit=1`);
  const rows = Array.isArray(existing.data) ? existing.data : [];
  let customer = (rows[0] || null) as JsonRecord | null;
  if (!customer) {
    customer = await asaasRequest("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: group.payer_name,
        cpfCnpj: cpf,
        email: group.payer_email,
        mobilePhone: group.payer_phone,
        externalReference: `tournament-family:${group.id}`,
        // Family fixtures follow the same isolation rule as individual ones.
        notificationDisabled: asaasConfig().environment === "SANDBOX",
      }),
    });
  }
  const customerId = text(customer?.id, 80);
  if (!customerId) throw new Error("O Asaas não retornou o responsável pela cobrança.");
  const update = await supabase.from("tournament_registration_groups").update({
    provider_customer_id: customerId,
    updated_at: new Date().toISOString(),
  }).eq("id", group.id);
  if (update.error) throw update.error;
  return customerId;
}

async function createOrRecoverFamilyPayment(
  supabase: DbClient,
  localPayment: JsonRecord,
  group: JsonRecord,
  tournament: JsonRecord,
  athleteCount: number,
) {
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (text(localPayment.provider_environment, 20).toUpperCase() !== asaasConfig().environment) return localPayment;
  const externalReference = String(localPayment.external_reference);
  let recovered: JsonRecord | null;
  try {
    recovered = await findAsaasPayment(externalReference);
  } catch (error) {
    if (error instanceof DuplicateProviderPaymentsError) {
      return await markProviderMismatchForReview(supabase, localPayment, {}, "duplicate_external_reference");
    }
    throw error;
  }
  if (recovered) {
    try {
      return await saveProviderPayment(supabase, localPayment, recovered);
    } catch (error) {
      throw new AmbiguousPaymentCreationError(error);
    }
  }

  const customerId = await ensureAsaasFamilyCustomer(supabase, group);
  try {
    const providerPayment = await asaasRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: localPayment.billing_type,
        value: Number(localPayment.amount),
        dueDate: saoPauloDate(String(localPayment.expires_at || "")),
        description: asaasSafeDescription(
          `Inscrição familiar ${tournament.name} - ${athleteCount} atleta${athleteCount === 1 ? "" : "s"}`,
        ),
        externalReference,
      }),
    });
    return await saveProviderPayment(supabase, { ...localPayment, provider_customer_id: customerId }, providerPayment);
  } catch (error) {
    if (isAmbiguousProviderFailure(error)) throw new AmbiguousPaymentCreationError(error);
    throw error;
  }
}

async function finishFamilyCheckout(
  request: Request,
  supabase: DbClient,
  group: JsonRecord,
  registrations: JsonRecord[],
  tournament: JsonRecord,
  billingType: string,
  preparedPayment: JsonRecord | null = null,
  paymentCreated = false,
) {
  const primaryRegistrationId = text(group.primary_registration_id, 80);
  const amount = Number(group.total_amount || 0);
  if (!isUuid(primaryRegistrationId) || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Grupo de inscrição familiar inválido.");
  }
  const responseBody = (payment: JsonRecord | null, extra: JsonRecord = {}) => ({
    registration_group: safeRegistrationGroup(group),
    registration: registrations[0] ? safeRegistration(registrations[0]) : null,
    registrations: registrations.map(safeRegistration),
    payment: safePayment(payment),
    tracking_token: group.public_token,
    family_checkout: true,
    ...extra,
  });
  if (amount === 0) return json(request, responseBody(null), 201);
  const providerEnvironment = asaasConfig().environment;

  let localPayment = preparedPayment;
  let ownsPaymentCreation = paymentCreated;
  if (!localPayment) {
    const paymentLookup = await supabase.from("tournament_payments")
      .select("*")
      .eq("registration_group_id", group.id)
      .maybeSingle();
    if (paymentLookup.error) throw paymentLookup.error;
    localPayment = paymentLookup.data as JsonRecord | null;
  }
  if (!localPayment) {
    throw new Error("A transação da inscrição familiar não criou a cobrança local.");
  }
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (String(localPayment.status) === "REVIEW_REQUIRED" &&
    text(localPayment.provider_environment, 20).toUpperCase() !== providerEnvironment) {
    return json(request, responseBody(localPayment, {
      retryable: false,
      warning: "A cobrança pertence a outro ambiente do Asaas e precisa de revisão da organização.",
    }), 202);
  }

  if (localPayment.provider_payment_id) {
    try {
      localPayment = await repairExistingPixPayment(supabase, localPayment);
    } catch (error) {
      console.warn("tournament-register family PIX repair deferred", {
        payment_id: localPayment.id,
        provider_error: providerErrorSnapshot(error),
      });
    }
    return json(request, responseBody(localPayment, deferredPixRepairResponse(localPayment)));
  }
  if (localPayment.status === "RECONCILING") {
    localPayment = await reconcileAmbiguousPayment(supabase, localPayment);
    if (localPayment.provider_payment_id) {
      return json(request, responseBody(localPayment, deferredPixRepairResponse(localPayment)));
    }
    return json(request, responseBody(localPayment, {
      retryable: false,
      warning: "Estamos conferindo a cobrança no Asaas. Não gere outro pagamento; esta tela será liberada assim que a resposta for confirmada.",
    }), 202);
  }
  if (!retryablePaymentStatuses.has(String(localPayment.status))) {
    return json(request, responseBody(localPayment));
  }
  if (!ownsPaymentCreation) {
    const age = Date.now() - Date.parse(String(localPayment.updated_at || localPayment.created_at));
    if (localPayment.status === "FAILED" || age > 120000) {
      const claim = await supabase.from("tournament_payments")
        .update({ status: "CREATED", billing_type: billingType, updated_at: new Date().toISOString() })
        .eq("id", localPayment.id)
        .eq("status", localPayment.status)
        .eq("provider_environment", providerEnvironment)
        .eq("updated_at", localPayment.updated_at)
        .select("*")
        .maybeSingle();
      if (claim.error) throw claim.error;
      if (claim.data) {
        localPayment = claim.data as JsonRecord;
        ownsPaymentCreation = true;
      }
    }
  }
  if (!ownsPaymentCreation) {
    return json(request, responseBody(localPayment, {
      error: "A cobrança familiar ainda está sendo preparada. Tente novamente em alguns segundos.",
    }), 409);
  }

  const providerClaim = await claimProviderPaymentAttempt(supabase, localPayment, billingType);
  if (!providerClaim) {
    const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
    if (latest.error) throw latest.error;
    return json(request, responseBody(latest.data as JsonRecord, {
      error: "A cobrança familiar ainda está sendo preparada. Tente novamente em alguns segundos.",
    }), 409);
  }
  const claimedPayment = providerClaim;
  try {
    localPayment = await createOrRecoverFamilyPayment(
      supabase,
      claimedPayment,
      group,
      tournament,
      new Set(registrations.map((row) => String(row.athlete_id || ""))).size,
    );
  } catch (error) {
    const providerError = providerErrorSnapshot(error);
    console.error("tournament-register family provider failure", { stage: "asaas_family_payment", ...providerError });
    if (error instanceof AmbiguousPaymentCreationError) {
      const reconciling = await deferPaymentReconciliation(supabase, claimedPayment, error);
      return json(request, responseBody(reconciling, {
        retryable: false,
        warning: "O Asaas ainda não confirmou se a cobrança foi criada. Não tente gerar outra: faremos a conferência automaticamente.",
      }), 202);
    }
    const failed = await markClaimedProviderFailure(
      supabase,
      claimedPayment,
      { ...providerError, stage: "asaas_family_payment" },
    );
    if (!failed.applied) return json(request, responseBody(failed.payment));
    return json(request, responseBody(failed.payment, {
      retryable: true,
      warning: "As inscrições foram reservadas, mas a cobrança não ficou pronta. Tente gerar o pagamento novamente.",
    }), 202);
  }
  const deferredPix = hasDeferredPixRepair(localPayment);
  return json(
    request,
    responseBody(localPayment, deferredPixRepairResponse(localPayment)),
    deferredPix ? 202 : 201,
  );
}

type TrackedCheckout = {
  tournament: JsonRecord;
  group: JsonRecord | null;
  registrations: JsonRecord[];
  payment: JsonRecord | null;
  familyCheckout: boolean;
};

class PaymentTrackingRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Muitas consultas deste pagamento. Aguarde um pouco e tente novamente.");
    this.name = "PaymentTrackingRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function activePaymentReservation(payment: JsonRecord | null) {
  if (!payment) return false;
  const expiresAt = Date.parse(String(payment.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function trackingCheckoutResponse(
  checkout: TrackedCheckout,
  payment: JsonRecord | null = checkout.payment,
  includePaymentInstructions = false,
  extra: JsonRecord = {},
) {
  const registrations = checkout.registrations.map(safeTrackingRegistration);
  const paymentStatus = text(payment?.status, 40).toUpperCase();
  const registrationConfirmed = registrations.length > 0 && registrations.every((row) =>
    String(row.status || "").toUpperCase() === "CONFIRMED" &&
    String(row.payment_status || "").toUpperCase() === "PAID"
  );
  const noPayment = !payment && registrations.length > 0 && registrations.every((row) =>
    ["NOT_REQUIRED", "PAID"].includes(String(row.payment_status || "").toUpperCase())
  );
  const waitlisted = registrations.length > 0 && registrations.every((row) =>
    String(row.status || "").toUpperCase() === "WAITLIST"
  );
  const terminalPayment = [
    "REVIEW_REQUIRED",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
    "CANCELLED",
    "CHARGEBACK",
    "OVERDUE",
  ]
    .includes(paymentStatus);
  const terminalRegistration = registrations.some((row) =>
    ["CANCELLED", "REFUNDED"].includes(String(row.status || "").toUpperCase())
  );
  const reservationActive = activePaymentReservation(payment);
  const expirableUnpaidPayment = ["CREATED", "RECONCILING", "PENDING", "FAILED"].includes(paymentStatus);
  const reservationExpired = Boolean(payment) && expirableUnpaidPayment && !reservationActive &&
    !registrationConfirmed && !noPayment && !waitlisted && !terminalPayment && !terminalRegistration;
  return {
    registration_group: checkout.group
      ? { status: checkout.group.status, total_amount: checkout.group.total_amount }
      : null,
    registration: registrations[0] || null,
    registrations,
    payment: includePaymentInstructions ? safePayment(payment) : safeTrackingPayment(payment),
    family_checkout: checkout.familyCheckout,
    confirmed: paymentStatus === "RECEIVED" && registrationConfirmed,
    terminal: registrationConfirmed || noPayment || waitlisted || terminalPayment || terminalRegistration ||
      reservationExpired,
    reservation_active: reservationActive,
    reservation_expired: reservationExpired,
    ...extra,
  };
}

async function loadTrackedCheckout(
  supabase: DbClient,
  tournament: JsonRecord,
  trackingToken: string,
): Promise<TrackedCheckout | null> {
  const groupResult = await supabase.from("tournament_registration_groups")
    .select("*")
    .eq("tournament_id", tournament.id)
    .eq("public_token", trackingToken)
    .maybeSingle();
  if (groupResult.error) throw groupResult.error;
  const group = groupResult.data as JsonRecord | null;
  if (group) {
    const registrationsResult = await supabase.from("tournament_registrations")
      .select("*")
      .eq("registration_group_id", group.id)
      .order("created_at", { ascending: true });
    if (registrationsResult.error) throw registrationsResult.error;
    const paymentResult = await supabase.from("tournament_payments")
      .select("*")
      .eq("registration_group_id", group.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentResult.error) throw paymentResult.error;
    return {
      tournament,
      group,
      registrations: (registrationsResult.data || []) as JsonRecord[],
      payment: paymentResult.data as JsonRecord | null,
      familyCheckout: true,
    };
  }

  const registrationResult = await supabase.from("tournament_registrations")
    .select("*")
    .eq("tournament_id", tournament.id)
    .eq("public_token", trackingToken)
    .maybeSingle();
  if (registrationResult.error) throw registrationResult.error;
  const registration = registrationResult.data as JsonRecord | null;
  if (!registration) return null;
  const childResult = await supabase.from("tournament_registrations")
    .select("*")
    .eq("parent_registration_id", registration.id)
    .order("created_at", { ascending: true });
  if (childResult.error) throw childResult.error;
  const paymentResult = await supabase.from("tournament_payments")
    .select("*")
    .eq("registration_id", registration.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentResult.error) throw paymentResult.error;
  return {
    tournament,
    group: null,
    registrations: [registration, ...((childResult.data || []) as JsonRecord[])],
    payment: paymentResult.data as JsonRecord | null,
    familyCheckout: false,
  };
}

async function trackedCheckoutFromPayload(
  request: Request,
  payload: JsonRecord,
  action: "payment_status" | "retry_payment",
  securityConfig: PublicRegistrationSecurityConfig,
) {
  const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
  const trackingToken = text(payload.tracking_token, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(trackingToken)) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = serviceRoleKey();
  if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const clientIp = trustedClientIp(request);
  const trackingHash = await hmacSha256(
    securityConfig.rateLimitSalt,
    `payment-tracking:${action}:${trackingToken}`,
  );
  const ipHash = clientIp
    ? await hmacSha256(securityConfig.rateLimitSalt, `payment-tracking-ip:${action}:${clientIp}`)
    : null;
  const rateLimitResult = await supabase.rpc("consume_tournament_payment_tracking_rate_limits", {
    p_tracking_hash: trackingHash,
    p_ip_hash: ipHash,
    p_action: action,
  });
  if (rateLimitResult.error) throw rateLimitResult.error;
  const rateLimit = (
    Array.isArray(rateLimitResult.data) ? rateLimitResult.data[0] : rateLimitResult.data
  ) as { allowed?: boolean; retry_after_seconds?: number } | null;
  if (!rateLimit?.allowed) {
    throw new PaymentTrackingRateLimitError(
      Math.max(1, Math.min(600, Number(rateLimit?.retry_after_seconds || 60))),
    );
  }
  const tournamentResult = await supabase.from("tournaments")
    .select("id,name,slug,is_published,settings")
    .eq("slug", tournamentSlug)
    .maybeSingle();
  if (tournamentResult.error) throw tournamentResult.error;
  if (!tournamentResult.data) return null;
  const checkout = await loadTrackedCheckout(supabase, tournamentResult.data as JsonRecord, trackingToken);
  return checkout ? { supabase, checkout } : null;
}

function trackingRateLimitResponse(request: Request, error: PaymentTrackingRateLimitError) {
  return json(request, { error: error.message }, 429, {
    "Retry-After": String(error.retryAfterSeconds),
  });
}

async function handlePaymentStatus(
  request: Request,
  payload: JsonRecord,
  securityConfig: PublicRegistrationSecurityConfig,
) {
  let tracked;
  try {
    tracked = await trackedCheckoutFromPayload(request, payload, "payment_status", securityConfig);
  } catch (error) {
    if (error instanceof PaymentTrackingRateLimitError) return trackingRateLimitResponse(request, error);
    throw error;
  }
  if (!tracked) return json(request, { error: "Acompanhamento não encontrado." }, 404);
  return json(request, trackingCheckoutResponse(tracked.checkout));
}

async function resumeTrackedSpatialAddon(
  supabase: DbClient,
  checkout: TrackedCheckout,
  registration: JsonRecord,
  localPayment: JsonRecord,
  providerEnvironment: string,
) {
  const externalReference = text(localPayment.external_reference, 180);
  if (!externalReference.startsWith("tournament-spatial-addon:")) {
    return { spatial: false, payment: localPayment, error: "" };
  }
  if (externalReference !== `tournament-spatial-addon:${registration.id}`) {
    return { spatial: true, payment: localPayment, error: "Esta cobrança da Classe Espacial precisa de revisão." };
  }

  const spatialCategoryResult = await supabase.from("tournament_categories")
    .select("id,code")
    .eq("id", registration.category_id)
    .eq("tournament_id", checkout.tournament.id)
    .maybeSingle();
  if (spatialCategoryResult.error) throw spatialCategoryResult.error;
  const spatialCode = text(spatialCategoryResult.data?.code, 40);
  if (!spatialCode) {
    return { spatial: true, payment: localPayment, error: "A Classe Espacial desta cobrança não foi encontrada." };
  }

  const addonMap = record(tournamentSettings(checkout.tournament).spatial_addons);
  const eligiblePrimaryCodes = Object.entries(addonMap)
    .filter(([, value]) => text(record(value).category_code, 40) === spatialCode)
    .map(([code]) => code);
  if (!eligiblePrimaryCodes.length) {
    return { spatial: true, payment: localPayment, error: "A classe principal desta inscrição precisa de revisão." };
  }

  const primaryCategoriesResult = await supabase.from("tournament_categories")
    .select("id")
    .eq("tournament_id", checkout.tournament.id)
    .in("code", eligiblePrimaryCodes);
  if (primaryCategoriesResult.error) throw primaryCategoriesResult.error;
  const primaryCategoryIds = (primaryCategoriesResult.data || []).map((row) => String(row.id)).filter(isUuid);
  if (!primaryCategoryIds.length) {
    return { spatial: true, payment: localPayment, error: "A classe principal desta inscrição não foi encontrada." };
  }

  const primaryRegistrationResult = await supabase.from("tournament_registrations")
    .select("id")
    .eq("tournament_id", checkout.tournament.id)
    .eq("athlete_id", registration.athlete_id)
    .eq("status", "CONFIRMED")
    .in("payment_status", ["PAID", "NOT_REQUIRED"])
    .in("category_id", primaryCategoryIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (primaryRegistrationResult.error) throw primaryRegistrationResult.error;
  if (!primaryRegistrationResult.data?.id) {
    return { spatial: true, payment: localPayment, error: "A inscrição principal confirmada não foi encontrada." };
  }

  const resume = await supabase.rpc("resume_private_tournament_spatial_addon_checkout", {
    p_tournament_id: checkout.tournament.id,
    p_athlete_id: registration.athlete_id,
    p_primary_registration_id: primaryRegistrationResult.data.id,
    p_spatial_registration_id: registration.id,
    p_provider_environment: providerEnvironment,
  });
  if (resume.error?.code === "P0001" || resume.error?.code === "P0002" || resume.error?.code === "42501") {
    return { spatial: true, payment: localPayment, error: resume.error.message };
  }
  if (resume.error) throw resume.error;
  const resumedPayment = record(record(resume.data).payment);
  if (!resumedPayment.id) throw new Error("A retomada da Classe Espacial retornou uma cobrança inválida.");
  return { spatial: true, payment: resumedPayment, error: "" };
}

async function handleIndividualPaymentRetry(
  request: Request,
  payload: JsonRecord,
  securityConfig: PublicRegistrationSecurityConfig,
) {
  let tracked;
  try {
    tracked = await trackedCheckoutFromPayload(request, payload, "retry_payment", securityConfig);
  } catch (error) {
    if (error instanceof PaymentTrackingRateLimitError) return trackingRateLimitResponse(request, error);
    throw error;
  }
  if (!tracked) return json(request, { error: "Acompanhamento não encontrado." }, 404);
  const { supabase, checkout } = tracked;
  if (checkout.familyCheckout) {
    return json(request, { error: "Retome a inscrição familiar pelo formulário original." }, 409);
  }
  const response = (payment: JsonRecord | null, extra: JsonRecord = {}, status = 200) =>
    json(request, trackingCheckoutResponse(checkout, payment, true, extra), status);
  let localPayment = checkout.payment;
  const registration = checkout.registrations[0];
  if (!registration || !localPayment) {
    return json(request, { error: "A cobrança reservada não foi encontrada." }, 409);
  }
  const localStatus = text(localPayment.status, 40).toUpperCase();
  const registrationStatus = text(registration.status, 40).toUpperCase();
  const registrationPaymentStatus = text(registration.payment_status, 40).toUpperCase();
  if (["WAITLIST", "CANCELLED", "REFUNDED"].includes(registrationStatus) ||
    registrationPaymentStatus === "PAID" ||
    ["RECEIVED", "CONFIRMED", "REVIEW_REQUIRED", "PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED", "CHARGEBACK", "OVERDUE"]
      .includes(localStatus)) {
    return response(localPayment);
  }
  if (!activePaymentReservation(localPayment)) {
    return json(request, {
      ...trackingCheckoutResponse(checkout),
      error: "Sua reserva de 2 horas expirou. Inicie uma nova inscrição quando as vagas estiverem abertas.",
    }, 410);
  }

  const providerEnvironment = asaasConfig().environment;
  const spatialResume = await resumeTrackedSpatialAddon(
    supabase,
    checkout,
    registration,
    localPayment,
    providerEnvironment,
  );
  if (spatialResume.error) {
    return json(request, {
      ...trackingCheckoutResponse(checkout),
      error: spatialResume.error,
      retryable: false,
    }, 409);
  }
  localPayment = spatialResume.payment;
  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (text(localPayment.provider_environment, 20).toUpperCase() !== providerEnvironment) {
    return response(localPayment, {
      retryable: false,
      warning: "A cobrança pertence a outro ambiente do Asaas e precisa de revisão da organização.",
    }, 202);
  }
  if (localPayment.provider_payment_id) {
    try {
      localPayment = await repairExistingPixPayment(supabase, localPayment);
    } catch (error) {
      console.warn("tournament-register tracked PIX repair deferred", {
        payment_id: localPayment.id,
        provider_error: providerErrorSnapshot(error),
      });
    }
    return response(localPayment, deferredPixRepairResponse(localPayment));
  }
  if (localPayment.status === "RECONCILING") {
    localPayment = await reconcileAmbiguousPayment(supabase, localPayment);
    if (localPayment.provider_payment_id) {
      return response(localPayment, deferredPixRepairResponse(localPayment));
    }
    return response(localPayment, {
      retryable: false,
      warning: "Estamos conferindo a cobrança no Asaas. Não gere outro pagamento.",
    }, 202);
  }
  if (!retryablePaymentStatuses.has(String(localPayment.status))) return response(localPayment);

  const paymentAge = Date.now() - Date.parse(String(localPayment.updated_at || localPayment.created_at));
  if (localPayment.status !== "FAILED" && paymentAge <= 120000) {
    return response(localPayment, {
      retryable: true,
      warning: "A cobrança ainda está sendo preparada. Tente atualizar novamente em alguns segundos.",
    }, 202);
  }

  const claim = await supabase.from("tournament_payments")
    .update({ status: "CREATED", billing_type: "PIX", updated_at: new Date().toISOString() })
    .eq("id", localPayment.id)
    .eq("status", localPayment.status)
    .eq("provider_environment", providerEnvironment)
    .eq("updated_at", localPayment.updated_at)
    .select("*")
    .maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) {
    const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
    if (latest.error) throw latest.error;
    return response(latest.data as JsonRecord, {
      retryable: true,
      warning: "A cobrança ainda está sendo preparada. Tente atualizar novamente em alguns segundos.",
    }, 202);
  }
  localPayment = claim.data as JsonRecord;
  const providerClaim = await claimProviderPaymentAttempt(supabase, localPayment, "PIX");
  if (!providerClaim) {
    const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
    if (latest.error) throw latest.error;
    return response(latest.data as JsonRecord, {
      retryable: true,
      warning: "A cobrança ainda está sendo preparada. Tente atualizar novamente em alguns segundos.",
    }, 202);
  }

  const athleteResult = await supabase.from("tournament_athletes")
    .select("*")
    .eq("id", registration.athlete_id)
    .single();
  if (athleteResult.error) throw athleteResult.error;
  const categoryResult = await supabase.from("tournament_categories")
    .select("id,name")
    .eq("id", registration.category_id)
    .eq("tournament_id", checkout.tournament.id)
    .single();
  if (categoryResult.error) throw categoryResult.error;
  const additionalRegistration = checkout.registrations.find((row) => row.parent_registration_id === registration.id);
  let additionalCategory: JsonRecord | null = null;
  if (additionalRegistration?.category_id) {
    const additionalResult = await supabase.from("tournament_categories")
      .select("id,name")
      .eq("id", additionalRegistration.category_id)
      .eq("tournament_id", checkout.tournament.id)
      .single();
    if (additionalResult.error) throw additionalResult.error;
    additionalCategory = additionalResult.data as JsonRecord;
  }

  try {
    localPayment = await createOrRecoverPayment(
      supabase,
      providerClaim as JsonRecord,
      athleteResult.data as JsonRecord,
      checkout.tournament,
      categoryResult.data as JsonRecord,
      additionalCategory,
    );
  } catch (error) {
    const providerError = providerErrorSnapshot(error);
    console.error("tournament-register tracked provider failure", {
      stage: "asaas_payment_retry",
      ...providerError,
    });
    if (error instanceof AmbiguousPaymentCreationError) {
      const reconciling = await deferPaymentReconciliation(supabase, providerClaim as JsonRecord, error);
      return response(reconciling, {
        retryable: false,
        warning: "O Asaas ainda não confirmou se a cobrança foi criada. Não tente gerar outra.",
      }, 202);
    }
    const failed = await markClaimedProviderFailure(
      supabase,
      providerClaim as JsonRecord,
      { ...providerError, stage: "asaas_payment_retry" },
    );
    return response(failed.payment, failed.applied
      ? {
        retryable: true,
        warning: "A cobrança não ficou pronta. Você pode tentar novamente enquanto a reserva estiver ativa.",
      }
      : {}, failed.applied ? 202 : 200);
  }
  const deferredPix = hasDeferredPixRepair(localPayment);
  return response(localPayment, deferredPixRepairResponse(localPayment), deferredPix ? 202 : 200);
}

async function handleFamilyRegistration(
  request: Request,
  payload: JsonRecord,
  securityConfig: PublicRegistrationSecurityConfig,
) {
  let failureStage = "family_payload";
  try {
    const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
    const payer = record(payload.payer);
    const payerName = text(payer.full_name, 120);
    const payerEmail = text(payer.email, 180).toLowerCase();
    const payerPhone = digits(payer.phone);
    const payerCpf = digits(payer.cpf);
    const billingType = normalizeBillingType(payload.payment_method);
    const requestToken = text(payload.request_token, 80);
    const inviteToken = text(payload.invite_token, 80);
    const inviteMode = Boolean(inviteToken);
    const captchaToken = text(payload.captcha_token, 2048);
    const termsAccepted = payload.terms_accepted === true;
    const athleteInputs = Array.isArray(payload.athletes) ? payload.athletes.map(record) : [];

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(requestToken)) {
      return json(request, { error: "Torneio ou solicitação inválidos." }, 400);
    }
    if (inviteMode && !isUuid(inviteToken)) return json(request, { error: "Este convite é inválido." }, 403);
    if (payerName.length < 2) return json(request, { error: "Informe o nome completo do responsável." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(payerEmail)) return json(request, { error: "Informe o e-mail do responsável." }, 400);
    if (payerPhone.length < 10 || payerPhone.length > 13) {
      return json(request, { error: "Informe um telefone válido do responsável." }, 400);
    }
    if (!isValidCpf(payerCpf)) return json(request, { error: "Informe um CPF válido do responsável." }, 400);
    if (athleteInputs.length < 1 || athleteInputs.length > 6) {
      return json(request, { error: "Adicione de um a seis atletas à inscrição." }, 400);
    }
    if (billingType !== "PIX") return json(request, { error: "Forma de pagamento inválida. Use Pix." }, 400);
    if (!termsAccepted) return json(request, { error: "Confirme os dados e a autorização da inscrição familiar." }, 400);
    if (!captchaToken) return json(request, { error: "Confirme que você não é um robô." }, 400);

    type ValidatedAthlete = {
      fullName: string;
      birthDate: string;
      isMinor: boolean;
      isPayer: boolean;
      cpf: string;
      phone: string;
      participantType: string;
      gender: string;
      availabilityDays: string[];
      city: string | null;
      partnerName: string | null;
      notes: string | null;
      categoryId: string;
      additionalCategoryId: string;
    };
    const validatedAthletes: ValidatedAthlete[] = [];
    const submittedCpfs = new Set<string>();
    let payerAthleteCount = 0;
    for (const input of athleteInputs) {
      const isPayer = input.is_payer === true;
      const isMinor = input.is_minor === true;
      const fullName = isPayer ? payerName : text(input.full_name, 120);
      const birthDate = text(input.birth_date, 10);
      const computedAge = birthDate ? ageOnDate(birthDate) : null;
      const cpf = isPayer ? payerCpf : digits(input.cpf);
      const phone = isPayer ? payerPhone : digits(input.phone);
      const participantType = text(input.participant_type, 30).toUpperCase();
      const gender = text(input.gender, 20).toUpperCase();
      const availabilityDays = Array.isArray(input.availability_days)
        ? input.availability_days.map((day) => text(day, 20).toUpperCase()).filter(Boolean)
        : [];
      const categoryId = text(input.category_id, 80);
      const additionalCategoryId = text(input.additional_category_id, 80);
      if (fullName.length < 2) return json(request, { error: "Informe o nome completo de cada atleta." }, 400);
      if (isPayer) payerAthleteCount += 1;
      if (payerAthleteCount > 1) return json(request, { error: "O responsável pode aparecer apenas uma vez como atleta." }, 400);
      if (isMinor) {
        if (!validBirthDate(birthDate) || computedAge === null || computedAge < 0 || computedAge >= 18) {
          return json(request, { error: `Informe uma data de nascimento válida para ${fullName}.` }, 400);
        }
        if (cpf && !isValidCpf(cpf)) return json(request, { error: `Confira o CPF opcional de ${fullName}.` }, 400);
        if (phone && (phone.length < 10 || phone.length > 13)) {
          return json(request, { error: `Confira o telefone opcional de ${fullName}.` }, 400);
        }
      } else {
        if (birthDate && (!validBirthDate(birthDate) || computedAge === null || computedAge < 18)) {
          return json(request, { error: `${fullName} deve ser marcado como menor de idade.` }, 400);
        }
        if (!isValidCpf(cpf)) return json(request, { error: `Informe um CPF válido para ${fullName}.` }, 400);
        if (!isPayer && (phone.length < 10 || phone.length > 13)) {
          return json(request, { error: `Informe um telefone válido para ${fullName}.` }, 400);
        }
      }
      if (cpf) {
        if (submittedCpfs.has(cpf)) return json(request, { error: "Cada atleta precisa ter seus próprios dados." }, 400);
        submittedCpfs.add(cpf);
      }
      if ((inviteMode && participantType !== "COURTESY") ||
        (!inviteMode && (!allowedParticipantTypes.has(participantType) || participantType === "COURTESY"))) {
        return json(request, { error: `Escolha o tipo de inscrição de ${fullName}.` }, 400);
      }
      if (!allowedGenders.has(gender)) return json(request, { error: `Escolha o sexo de ${fullName}.` }, 400);
      if (!availabilityDays.length || availabilityDays.some((day) => !allowedAvailabilityDays.has(day))) {
        return json(request, { error: `Informe os dias disponíveis de ${fullName}.` }, 400);
      }
      if (!isUuid(categoryId) || (additionalCategoryId && !isUuid(additionalCategoryId))) {
        return json(request, { error: `Escolha uma classe válida para ${fullName}.` }, 400);
      }
      validatedAthletes.push({
        fullName,
        birthDate,
        isMinor,
        isPayer,
        cpf,
        phone,
        participantType,
        gender,
        availabilityDays,
        city: nullableText(input.city, 100),
        partnerName: nullableText(input.partner_name, 120),
        notes: nullableText(input.notes, 500),
        categoryId,
        additionalCategoryId,
      });
    }

    const atomicAthleteEntry = async (athleteInput: ValidatedAthlete) => ({
      athlete_source_key: await familyAthleteSourceKey(
        payerEmail,
        payerPhone,
        athleteInput.fullName,
        athleteInput.birthDate,
        athleteInput.cpf,
      ),
      athlete_full_name: athleteInput.fullName,
      athlete_email: athleteInput.isMinor ? payerEmail : (athleteInput.isPayer ? payerEmail : null),
      athlete_phone: athleteInput.phone || null,
      athlete_cpf: athleteInput.cpf || null,
      athlete_birth_date: athleteInput.birthDate || null,
      athlete_gender: athleteInput.gender,
      athlete_city: athleteInput.city,
      athlete_is_minor: athleteInput.isMinor,
      athlete_guardian_name: athleteInput.isMinor ? payerName : null,
      athlete_guardian_phone: athleteInput.isMinor ? payerPhone : null,
    });

    failureStage = "family_database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "family_network_rate_limit";
    const clientIp = trustedClientIp(request);
    const ipHash = clientIp ? await hmacSha256(securityConfig.rateLimitSalt, `ip:${clientIp}`) : null;
    const networkResult = await supabase.rpc("consume_tournament_registration_network_rate_limits", { p_ip_hash: ipHash });
    if (networkResult.error) throw networkResult.error;
    const networkLimit = (Array.isArray(networkResult.data) ? networkResult.data[0] : networkResult.data) as
      | { allowed?: boolean; retry_after_seconds?: number }
      | null;
    if (!networkLimit?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(networkLimit?.retry_after_seconds || 60)));
      return json(request, { error: "Muitas tentativas de inscrição. Aguarde um pouco e tente novamente." }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    failureStage = "family_captcha_verification";
    let captchaAccepted = false;
    try {
      captchaAccepted = await verifyTurnstile(request, captchaToken, securityConfig);
    } catch (_error) {
      return json(request, { error: "Não foi possível validar a proteção anti-robô agora. Tente novamente." }, 503);
    }
    if (!captchaAccepted) {
      return json(request, { error: "A validação anti-robô expirou ou não foi aceita. Tente novamente." }, 400);
    }

    failureStage = "family_identity_rate_limit";
    const identityHash = await hmacSha256(securityConfig.rateLimitSalt, `family:${payerEmail}|${payerPhone}`);
    const identityResult = await supabase.rpc("consume_tournament_registration_identity_rate_limit", {
      p_identity_hash: identityHash,
    });
    if (identityResult.error) throw identityResult.error;
    const identityLimit = (Array.isArray(identityResult.data) ? identityResult.data[0] : identityResult.data) as
      | { allowed?: boolean; retry_after_seconds?: number }
      | null;
    if (!identityLimit?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(identityLimit?.retry_after_seconds || 60)));
      return json(request, { error: "Muitas tentativas para estes dados. Aguarde um pouco e tente novamente." }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    failureStage = "family_tournament_lookup";
    const tournamentResult = await supabase.from("tournaments")
      .select("id,name,slug,status,registration_open,registration_opens_at,registration_closes_at,allowed_payment_methods,is_published,settings")
      .eq("slug", tournamentSlug)
      .maybeSingle();
    if (tournamentResult.error) throw tournamentResult.error;
    const tournament = tournamentResult.data as JsonRecord | null;
    if (!tournament || tournament.is_published !== true) return json(request, { error: "Torneio não encontrado." }, 404);

    failureStage = "family_payment_configuration";
    // Convites isentos não criam cobrança no provedor e devem continuar
    // funcionando durante uma rotação da chave do Asaas.
    const providerEnvironment = inviteMode ? "NOT_APPLICABLE" : asaasConfig().environment;

    const inviteTokenHash = inviteMode ? await sha256Hex(inviteToken) : "";
    let invitation: JsonRecord | null = null;
    if (inviteMode) {
      const invitationResult = await supabase.from("tournament_registration_invites")
        .select("id,tournament_id,athlete_limit,status,expires_at,used_registration_group_id")
        .eq("tournament_id", tournament.id)
        .eq("token_hash", inviteTokenHash)
        .maybeSingle();
      if (invitationResult.error) throw invitationResult.error;
      invitation = invitationResult.data as JsonRecord | null;
      if (!invitation) return json(request, { error: "Este convite é inválido." }, 403);
      if (invitation.status === "REVOKED") return json(request, { error: "Este convite foi cancelado." }, 410);
      // Um convite USED ainda pode ser uma repetição idempotente do mesmo
      // request_token. O RPC confere isso sob lock e rejeita qualquer outro.
      if (invitation.status === "ACTIVE") {
        if (Number(invitation.athlete_limit || 0) < athleteInputs.length) {
          return json(request, { error: `Este convite permite no máximo ${invitation.athlete_limit} atleta(s).` }, 409);
        }
        if (invitation.expires_at && Date.parse(String(invitation.expires_at)) < Date.now()) {
          return json(request, { error: "Este convite expirou." }, 410);
        }
      }
    }

    const claimFamilyCheckout = (entries: JsonRecord[], createIfMissing: boolean) => supabase.rpc(
      "claim_public_tournament_family_checkout",
      {
        p_tournament_id: tournament.id,
        p_request_token: requestToken,
        p_payer_name: payerName,
        p_payer_email: payerEmail,
        p_payer_phone: payerPhone,
        p_payer_cpf: payerCpf,
        p_entries: entries,
        p_billing_type: "PIX",
        p_provider_environment: providerEnvironment,
        p_invite_token_hash: inviteMode ? inviteTokenHash : null,
        p_create_if_missing: createIfMissing,
      },
    );

    const finishClaimedFamilyCheckout = async (claimed: JsonRecord) => {
      const claimedGroupSummary = record(claimed.registration_group);
      const claimedGroupId = text(claimedGroupSummary.id, 80);
      if (!isUuid(claimedGroupId)) throw new Error("Grupo de inscrição familiar inválido.");
      const groupLookup = await supabase.from("tournament_registration_groups")
        .select("*")
        .eq("id", claimedGroupId)
        .single();
      if (groupLookup.error) throw groupLookup.error;
      const claimedRegistrations = Array.isArray(claimed.registrations)
        ? claimed.registrations.map(record)
        : [];
      return await finishFamilyCheckout(
        request,
        supabase,
        groupLookup.data as JsonRecord,
        claimedRegistrations,
        tournament,
        "PIX",
        Object.keys(record(claimed.payment)).length ? record(claimed.payment) : null,
        claimed.payment_created === true,
      );
    };

    // Probe only for this request token before checking mutable tournament,
    // category or price settings. A reservation already created keeps its
    // two-hour payment recovery window even if registrations close meanwhile.
    // On a miss the RPC is read-only: it cannot create or update any record.
    const probeEntries = await Promise.all(validatedAthletes.map(async (athleteInput) => ({
      ...await atomicAthleteEntry(athleteInput),
      primary_category_id: athleteInput.categoryId,
      additional_category_id: athleteInput.additionalCategoryId || null,
      public_name: athleteInput.fullName,
      public_city: athleteInput.city,
      partner_name: athleteInput.partnerName,
    })));
    failureStage = "family_existing_checkout_probe";
    const probeResult = await claimFamilyCheckout(probeEntries, false);
    if (probeResult.error?.code === "P0001") {
      return json(request, { error: probeResult.error.message }, 409);
    }
    if (probeResult.error) throw probeResult.error;
    const probedCheckout = record(probeResult.data);
    if (probedCheckout.expired === true) {
      return json(request, {
        error: "Sua reserva de 2 horas expirou. Inicie uma nova inscrição para consultar as vagas atuais.",
      }, 410);
    }
    if (probedCheckout.found === true) {
      return await finishClaimedFamilyCheckout(probedCheckout);
    }

    const now = Date.now();
    const opensAt = tournament.registration_opens_at ? Date.parse(String(tournament.registration_opens_at)) : null;
    const closesAt = tournament.registration_closes_at ? Date.parse(String(tournament.registration_closes_at)) : null;
    if (tournament.status !== "REGISTRATION_OPEN" || tournament.registration_open !== true ||
      (opensAt && now < opensAt) || (closesAt && now > closesAt)) {
      return json(request, { error: "As inscrições deste torneio estão fechadas." }, 409);
    }
    const allowedMethods = Array.isArray(tournament.allowed_payment_methods)
      ? tournament.allowed_payment_methods.map((method) => String(method).toUpperCase())
      : ["PIX"];
    if (!inviteMode && !allowedMethods.includes("PIX")) {
      return json(request, { error: "O Pix não está disponível neste torneio." }, 400);
    }

    failureStage = "family_category_lookup";
    const categoriesResult = await supabase.from("tournament_categories")
      .select("id,tournament_id,code,name,event_type,gender,registration_fee,registration_open,max_entries,active")
      .eq("tournament_id", tournament.id);
    if (categoriesResult.error) throw categoriesResult.error;
    const categoryMap = new Map(((categoriesResult.data || []) as JsonRecord[]).map((row) => [String(row.id), row]));
    const tournamentSettings = record(tournament.settings);
    const registrationPricing = record(tournamentSettings.registration_pricing);
    const spatialAddonMap = record(tournamentSettings.spatial_addons);
    const rpcEntries: JsonRecord[] = [];

    for (const athleteInput of validatedAthletes) {
      const category = categoryMap.get(athleteInput.categoryId);
      if (!category || category.active !== true || category.registration_open !== true) {
        return json(request, { error: `A classe escolhida para ${athleteInput.fullName} não está disponível.` }, 409);
      }
      if (category.gender && ![athleteInput.gender, "MIXED", "OPEN"].includes(String(category.gender).toUpperCase())) {
        return json(request, { error: `A classe escolhida não corresponde ao sexo de ${athleteInput.fullName}.` }, 400);
      }
      if (category.event_type === "DOUBLES" && !athleteInput.partnerName) {
        return json(request, { error: `Informe a dupla de ${athleteInput.fullName}.` }, 400);
      }
      const addonRule = record(spatialAddonMap[String(category.code)]);
      let additionalCategory: JsonRecord | null = null;
      let additionalFee = 0;
      if (athleteInput.additionalCategoryId) {
        additionalCategory = categoryMap.get(athleteInput.additionalCategoryId) || null;
        if (!additionalCategory || additionalCategory.active !== true || additionalCategory.registration_open !== true ||
          String(additionalCategory.code) !== text(addonRule.category_code, 40)) {
          return json(request, { error: `A Classe Espacial escolhida para ${athleteInput.fullName} não é válida.` }, 400);
        }
        const configuredFee = Number(tournamentSettings.spatial_addon_fee);
        additionalFee = Number.isFinite(configuredFee) ? configuredFee : Number(addonRule.fee ?? additionalCategory.registration_fee);
        if (!Number.isFinite(additionalFee) || additionalFee < 0) {
          return json(request, { error: "O valor da Classe Espacial ainda não foi configurado." }, 409);
        }
      }
      const primaryAmount = inviteMode ? 0 : Number(registrationPricing[athleteInput.participantType]);
      if (!Number.isFinite(primaryAmount) || primaryAmount < 0) {
        return json(request, { error: `O valor da inscrição de ${athleteInput.fullName} ainda não foi configurado.` }, 409);
      }

      rpcEntries.push({
        ...await atomicAthleteEntry(athleteInput),
        primary_category_id: category.id,
        additional_category_id: additionalCategory?.id || null,
        public_name: athleteInput.fullName,
        public_city: athleteInput.city,
        partner_name: athleteInput.partnerName,
        primary_amount: primaryAmount,
        notes: registrationNotes(athleteInput.participantType, athleteInput.availabilityDays, athleteInput.notes) +
          (athleteInput.isMinor ? `\nMenor de idade. Responsável: ${payerName}.` : "") +
          (additionalCategory ? `\nClasse adicional: ${additionalCategory.name} (${additionalFee}).` : ""),
      });
    }

    failureStage = "family_registration_claim";
    const claimResult = await claimFamilyCheckout(rpcEntries, true);
    if (claimResult.error?.code === "P0001") {
      return json(request, { error: claimResult.error.message }, 409);
    }
    if (claimResult.error) throw claimResult.error;
    return await finishClaimedFamilyCheckout(record(claimResult.data));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? text((error as JsonRecord).code, 40)
      : "internal_error";
    console.error("tournament-register family failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível concluir a inscrição familiar.", code: failureStage }, 500);
  }
}

type SpatialAddonCandidate = {
  athlete: JsonRecord;
  primaryRegistration: JsonRecord;
  primaryCategory: JsonRecord;
  spatialCategory: JsonRecord;
  existingRegistration: JsonRecord | null;
  amount: number;
  state: "ELIGIBLE" | "PAYMENT_PENDING" | "ALREADY_REGISTERED" | "FULL" | "CLOSED" | "REVIEW_REQUIRED";
};

function tournamentSettings(tournament: JsonRecord) {
  return tournament.settings && typeof tournament.settings === "object" && !Array.isArray(tournament.settings)
    ? tournament.settings as JsonRecord
    : {};
}

async function spatialPortalAuthorized(tournament: JsonRecord, rawToken: string) {
  if (!isUuid(rawToken)) return false;
  const portal = record(tournamentSettings(tournament).spatial_addon_portal);
  const expectedHash = text(portal.token_hash, 64).toLowerCase();
  if (portal.enabled !== true || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  return secureStringEquals(await sha256Hex(rawToken), expectedHash);
}

async function loadSpatialTournament(supabase: DbClient, tournamentSlug: string) {
  const result = await supabase.from("tournaments")
    .select("id,name,slug,status,registration_open,registration_opens_at,registration_closes_at,is_published,settings")
    .eq("slug", tournamentSlug)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as JsonRecord | null;
}

function spatialTournamentIsOpen(tournament: JsonRecord) {
  const now = Date.now();
  const opensAt = tournament.registration_opens_at ? Date.parse(String(tournament.registration_opens_at)) : null;
  const closesAt = tournament.registration_closes_at ? Date.parse(String(tournament.registration_closes_at)) : null;
  return tournament.is_published === true && tournament.status === "REGISTRATION_OPEN" &&
    tournament.registration_open === true && (!opensAt || now >= opensAt) && (!closesAt || now <= closesAt);
}

async function consumeSpatialNetworkLimit(
  request: Request,
  supabase: DbClient,
  config: PublicRegistrationSecurityConfig,
  scope: string,
) {
  const clientIp = trustedClientIp(request);
  const ipHash = clientIp ? await hmacSha256(config.rateLimitSalt, `spatial-addon:${scope}:ip:${clientIp}`) : null;
  const result = await supabase.rpc("consume_tournament_registration_network_rate_limits", {
    p_ip_hash: ipHash,
  });
  if (result.error) throw result.error;
  const limit = (Array.isArray(result.data) ? result.data[0] : result.data) as
    | { allowed?: boolean; retry_after_seconds?: number }
    | null;
  return {
    allowed: limit?.allowed === true,
    retryAfter: Math.max(1, Math.min(1800, Number(limit?.retry_after_seconds || 60))),
  };
}

async function consumeSpatialIdentityLimit(
  supabase: DbClient,
  config: PublicRegistrationSecurityConfig,
  scope: string,
  portalToken: string,
  cpf: string,
) {
  const portalHash = await sha256Hex(portalToken);
  const identityHash = await hmacSha256(
    config.rateLimitSalt,
    `spatial-addon:${scope}:${portalHash}:${cpf}`,
  );
  const result = await supabase.rpc("consume_tournament_registration_identity_rate_limit", {
    p_identity_hash: identityHash,
  });
  if (result.error) throw result.error;
  const limit = (Array.isArray(result.data) ? result.data[0] : result.data) as
    | { allowed?: boolean; retry_after_seconds?: number }
    | null;
  return {
    allowed: limit?.allowed === true,
    retryAfter: Math.max(1, Math.min(1800, Number(limit?.retry_after_seconds || 60))),
  };
}

async function loadSpatialAddonCandidates(
  supabase: DbClient,
  tournament: JsonRecord,
  cpf: string,
): Promise<SpatialAddonCandidate[]> {
  const athleteIds = new Set<string>();
  // CPF is sent only in the RPC POST body. Never place it in a PostgREST
  // filter/query string, where infrastructure access logs could retain it.
  const athleteLookup = await supabase.rpc(
    "lookup_private_tournament_spatial_addon_athlete_ids",
    {
      p_tournament_id: tournament.id,
      p_cpf: cpf,
    },
  );
  if (athleteLookup.error) throw athleteLookup.error;
  for (const match of athleteLookup.data || []) {
    const athleteId = String(match.athlete_id || "");
    if (isUuid(athleteId)) athleteIds.add(athleteId);
  }
  if (!athleteIds.size) return [];

  const athletesResult = await supabase.from("tournament_athletes")
    .select("*")
    .in("id", [...athleteIds])
    .eq("active", true)
    .eq("status", "ACTIVE");
  if (athletesResult.error) throw athletesResult.error;
  const athleteMap = new Map<string, JsonRecord>(
    (athletesResult.data || []).map((athlete) => [String(athlete.id), athlete as JsonRecord]),
  );

  const registrationsResult = await supabase.from("tournament_registrations")
    .select("*")
    .eq("tournament_id", tournament.id)
    .in("athlete_id", [...athleteMap.keys()])
    .order("created_at", { ascending: true });
  if (registrationsResult.error) throw registrationsResult.error;
  const registrations = (registrationsResult.data || []) as JsonRecord[];
  if (!registrations.length) return [];

  const categoriesResult = await supabase.from("tournament_categories")
    .select("*")
    .eq("tournament_id", tournament.id);
  if (categoriesResult.error) throw categoriesResult.error;
  const categories = (categoriesResult.data || []) as JsonRecord[];
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const categoryByCode = new Map(categories.map((category) => [String(category.code), category]));
  const settings = tournamentSettings(tournament);
  const addonMap = record(settings.spatial_addons);
  const configuredFee = Number(settings.spatial_addon_fee);
  const candidates: SpatialAddonCandidate[] = [];

  for (const primaryRegistration of registrations) {
    if (primaryRegistration.status !== "CONFIRMED" ||
      !["PAID", "NOT_REQUIRED"].includes(String(primaryRegistration.payment_status))) continue;
    const athlete = athleteMap.get(String(primaryRegistration.athlete_id));
    const primaryCategory = categoryById.get(String(primaryRegistration.category_id));
    if (!athlete || !primaryCategory) continue;
    const addonRule = record(addonMap[String(primaryCategory.code)]);
    const spatialCode = text(addonRule.category_code, 40);
    if (!spatialCode) continue;
    const spatialCategory = categoryByCode.get(spatialCode);
    if (!spatialCategory) continue;
    // The archive may retain an older terminal attempt. Always evaluate the
    // newest registration, matching the database recovery RPC ordering.
    const existingRegistration = [...registrations].reverse().find((registration) =>
      String(registration.athlete_id) === String(athlete.id) &&
      String(registration.category_id) === String(spatialCategory.id)
    ) || null;
    const recoverableExisting = Boolean(existingRegistration &&
      !existingRegistration.parent_registration_id &&
      !existingRegistration.registration_group_id &&
      existingRegistration.request_token &&
      existingRegistration.source === "PUBLIC" &&
      Number(existingRegistration.total_amount) === 80 &&
      existingRegistration.status === "PENDING" &&
      existingRegistration.payment_status === "PENDING");
    const ruleFee = Number(addonRule.fee);
    const configuredAmount = Number.isFinite(configuredFee)
      ? configuredFee
      : Number.isFinite(ruleFee)
      ? ruleFee
      : Number(spatialCategory.registration_fee);
    // Preserve the server-established R$ 80 reservation on retries even if an
    // administrator edits future pricing while this Pix is still active.
    const amount = recoverableExisting ? 80 : configuredAmount;
    if (!Number.isFinite(amount) || amount !== 80) continue;
    let state: SpatialAddonCandidate["state"] = "ELIGIBLE";
    if (existingRegistration?.status === "CONFIRMED" &&
      ["PAID", "NOT_REQUIRED"].includes(String(existingRegistration.payment_status))) {
      state = "ALREADY_REGISTERED";
    } else if (recoverableExisting) {
      state = "PAYMENT_PENDING";
    } else if (existingRegistration) {
      state = "REVIEW_REQUIRED";
    } else if (primaryCategory.active !== true || spatialCategory.active !== true ||
      spatialCategory.registration_open !== true) {
      state = "CLOSED";
    } else if (spatialCategory.max_entries !== null && spatialCategory.max_entries !== undefined) {
      const occupiedResult = await supabase.from("tournament_registrations")
        .select("id", { count: "exact", head: true })
        .eq("category_id", spatialCategory.id)
        .in("status", ["PENDING", "CONFIRMED"]);
      if (occupiedResult.error) throw occupiedResult.error;
      if (Number(occupiedResult.count || 0) >= Number(spatialCategory.max_entries)) state = "FULL";
    }
    candidates.push({
      athlete,
      primaryRegistration,
      primaryCategory,
      spatialCategory,
      existingRegistration,
      amount,
      state,
    });
  }

  const unique = new Map<string, SpatialAddonCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.athlete.id}:${candidate.primaryRegistration.id}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function safeSpatialCandidate(candidate: SpatialAddonCandidate, candidateProof: string | null) {
  return {
    athlete_name: candidate.athlete.full_name,
    current_class: candidate.primaryCategory.name,
    spatial_class: candidate.spatialCategory.name,
    amount: candidate.amount,
    state: candidate.state,
    candidate_proof: candidateProof,
  };
}

async function handleSpatialLookup(
  request: Request,
  payload: JsonRecord,
  config: PublicRegistrationSecurityConfig,
) {
  const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
  const portalToken = text(payload.portal_token, 80);
  const cpf = digits(payload.cpf);
  const captchaToken = text(payload.captcha_token, 2048);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(portalToken)) {
    return json(request, { error: "Este link não é válido." }, 403);
  }
  if (!isValidCpf(cpf)) return json(request, { error: "Informe um CPF válido." }, 400);
  if (!captchaToken) return json(request, { error: "Confirme que você não é um robô." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = serviceRoleKey();
  if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const networkLimit = await consumeSpatialNetworkLimit(request, supabase, config, "lookup");
  if (!networkLimit.allowed) {
    return json(request, { error: "Muitas tentativas. Aguarde um pouco e tente novamente." }, 429, {
      "Retry-After": String(networkLimit.retryAfter),
    });
  }

  const tournament = await loadSpatialTournament(supabase, tournamentSlug);
  if (!tournament || !await spatialPortalAuthorized(tournament, portalToken)) {
    return json(request, { error: "Este link não é válido." }, 403);
  }
  if (tournament.is_published !== true) {
    return json(request, { error: "As inscrições para a Classe Espacial estão indisponíveis." }, 409);
  }
  let captchaAccepted = false;
  try {
    captchaAccepted = await verifyTurnstile(request, captchaToken, config);
  } catch (_error) {
    return json(request, { error: "Não foi possível validar a proteção anti-robô agora. Tente novamente." }, 503);
  }
  if (!captchaAccepted) {
    return json(request, { error: "A validação anti-robô expirou ou não foi aceita. Tente novamente." }, 400);
  }
  const identityLimit = await consumeSpatialIdentityLimit(supabase, config, "lookup", portalToken, cpf);
  if (!identityLimit.allowed) {
    return json(request, { error: "Muitas tentativas para este CPF. Aguarde um pouco e tente novamente." }, 429, {
      "Retry-After": String(identityLimit.retryAfter),
    });
  }

  const candidates = await loadSpatialAddonCandidates(supabase, tournament, cpf);
  if (!candidates.length) {
    return json(request, {
      error: "Não encontramos uma inscrição confirmada e elegível para este CPF.",
    }, 404);
  }
  const tournamentOpen = spatialTournamentIsOpen(tournament);
  if (!tournamentOpen && !candidates.some((candidate) => candidate.state === "PAYMENT_PENDING")) {
    return json(request, { error: "As inscrições para a Classe Espacial estão fechadas." }, 409);
  }
  const safeCandidates = [];
  for (const candidate of candidates) {
    const proof = candidate.state === "PAYMENT_PENDING" || (tournamentOpen && candidate.state === "ELIGIBLE")
      ? await createSpatialCandidateProof(
        config,
        tournamentSlug,
        cpf,
        String(candidate.athlete.id),
        String(candidate.primaryRegistration.id),
      )
      : null;
    safeCandidates.push(safeSpatialCandidate(candidate, proof));
  }
  return json(request, {
    tournament_name: tournament.name,
    candidates: safeCandidates,
  });
}

async function handleSpatialCheckout(
  request: Request,
  payload: JsonRecord,
  config: PublicRegistrationSecurityConfig,
) {
  const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
  const portalToken = text(payload.portal_token, 80);
  const cpf = digits(payload.cpf);
  const candidateProof = text(payload.candidate_proof, 2048);
  const requestToken = text(payload.request_token, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(portalToken)) {
    return json(request, { error: "Este link não é válido." }, 403);
  }
  if (!isValidCpf(cpf) || !isUuid(requestToken) || !candidateProof || payload.terms_accepted !== true) {
    return json(request, { error: "Confirme os dados antes de gerar o Pix." }, 400);
  }
  const verifiedProof = await verifySpatialCandidateProof(config, candidateProof, tournamentSlug, cpf);
  if (!verifiedProof) return json(request, { error: "Sua confirmação expirou. Consulte o CPF novamente." }, 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = serviceRoleKey();
  if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const networkLimit = await consumeSpatialNetworkLimit(request, supabase, config, "checkout");
  if (!networkLimit.allowed) {
    return json(request, { error: "Muitas tentativas. Aguarde um pouco e tente novamente." }, 429, {
      "Retry-After": String(networkLimit.retryAfter),
    });
  }
  const identityLimit = await consumeSpatialIdentityLimit(supabase, config, "checkout", portalToken, cpf);
  if (!identityLimit.allowed) {
    return json(request, { error: "Muitas tentativas para este CPF. Aguarde um pouco e tente novamente." }, 429, {
      "Retry-After": String(identityLimit.retryAfter),
    });
  }

  const tournament = await loadSpatialTournament(supabase, tournamentSlug);
  if (!tournament || !await spatialPortalAuthorized(tournament, portalToken)) {
    return json(request, { error: "Este link não é válido." }, 403);
  }
  if (tournament.is_published !== true) {
    return json(request, { error: "As inscrições para a Classe Espacial estão indisponíveis." }, 409);
  }
  const candidates = await loadSpatialAddonCandidates(supabase, tournament, cpf);
  const candidate = candidates.find((item) =>
    String(item.athlete.id) === verifiedProof.a && String(item.primaryRegistration.id) === verifiedProof.r
  );
  if (!candidate) {
    return json(request, { error: "Esta inscrição deixou de ser elegível. Fale com a organização." }, 409);
  }
  if (candidate.state === "ALREADY_REGISTERED") {
    return json(request, { error: "Este atleta já está inscrito na Classe Espacial." }, 409);
  }
  if (candidate.state === "FULL") {
    return json(request, { error: "A Classe Espacial correspondente atingiu o limite de vagas." }, 409);
  }
  if (candidate.state === "REVIEW_REQUIRED") {
    return json(request, { error: "Esta inscrição precisa de revisão da organização." }, 409);
  }
  if (candidate.state === "CLOSED") {
    return json(request, { error: "A Classe Espacial correspondente está fechada." }, 409);
  }
  if (candidate.state === "ELIGIBLE" && !spatialTournamentIsOpen(tournament)) {
    return json(request, { error: "As inscrições para a Classe Espacial estão fechadas." }, 409);
  }

  const providerEnvironment = asaasConfig().environment;
  let registration: JsonRecord;
  const category = candidate.spatialCategory;
  let localPayment: JsonRecord;
  let ownsPaymentCreation = false;

  if (candidate.state === "PAYMENT_PENDING") {
    const existingRegistration = record(candidate.existingRegistration);
    const resume = await supabase.rpc("resume_private_tournament_spatial_addon_checkout", {
      p_tournament_id: tournament.id,
      p_athlete_id: candidate.athlete.id,
      p_primary_registration_id: candidate.primaryRegistration.id,
      p_spatial_registration_id: existingRegistration.id,
      p_provider_environment: providerEnvironment,
    });
    if (resume.error?.code === "P0001" || resume.error?.code === "P0002" || resume.error?.code === "42501") {
      return json(request, { error: resume.error.message }, 409);
    }
    if (resume.error) throw resume.error;
    const checkout = record(resume.data);
    registration = record(checkout.registration);
    localPayment = record(checkout.payment);
  } else {
    const claim = await supabase.rpc("claim_private_tournament_spatial_addon_checkout", {
      p_tournament_id: tournament.id,
      p_request_token: requestToken,
      p_athlete_id: candidate.athlete.id,
      p_primary_registration_id: candidate.primaryRegistration.id,
      p_billing_type: "PIX",
      p_provider_environment: providerEnvironment,
    });
    if (claim.error?.code === "P0001" || claim.error?.code === "P0002" || claim.error?.code === "42501") {
      return json(request, { error: claim.error.message }, 409);
    }
    if (claim.error) throw claim.error;
    const checkout = record(claim.data);
    registration = record(checkout.registration);
    localPayment = record(checkout.payment);
    ownsPaymentCreation = checkout.payment_created === true;
  }
  if (!registration.id || !category.id || !localPayment.id) {
    throw new Error("O checkout do adicional retornou dados incompletos.");
  }
  const responseBody = (payment: JsonRecord, extra: JsonRecord = {}) => ({
    registration: safeRegistration(registration),
    payment: safePayment(payment),
    tracking_token: registration.public_token,
    athlete_name: candidate.athlete.full_name,
    current_class: candidate.primaryCategory.name,
    spatial_class: category.name,
    ...extra,
  });

  if (!activePaymentReservation(localPayment)) {
    return json(request, {
      error: "A reserva desta Classe Espacial expirou. Aguarde alguns minutos e consulte o CPF novamente.",
    }, 410);
  }

  localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
  if (String(localPayment.status) === "REVIEW_REQUIRED") {
    return json(request, responseBody(localPayment, {
      retryable: false,
      warning: "Não pague esta cobrança. Ela precisa de revisão da organização.",
    }), 202);
  }
  if (localPayment.provider_payment_id) {
    try {
      localPayment = await repairExistingPixPayment(supabase, localPayment);
    } catch (error) {
      console.warn("tournament-register spatial PIX repair deferred", {
        payment_id: localPayment.id,
        provider_error: providerErrorSnapshot(error),
      });
    }
    return json(request, responseBody(localPayment, deferredPixRepairResponse(localPayment)));
  }
  if (localPayment.status === "RECONCILING") {
    localPayment = await reconcileAmbiguousPayment(supabase, localPayment);
    if (localPayment.provider_payment_id) {
      return json(request, responseBody(localPayment, deferredPixRepairResponse(localPayment)));
    }
    return json(request, responseBody(localPayment, {
      retryable: false,
      warning: "Estamos conferindo a cobrança no Asaas. Não gere outro pagamento.",
    }), 202);
  }
  if (!retryablePaymentStatuses.has(String(localPayment.status))) {
    return json(request, responseBody(localPayment));
  }
  if (!ownsPaymentCreation) {
    const age = Date.now() - Date.parse(String(localPayment.updated_at || localPayment.created_at));
    if (localPayment.status === "FAILED" || age > 120000) {
      const retryClaim = await supabase.from("tournament_payments")
        .update({ status: "CREATED", billing_type: "PIX", updated_at: new Date().toISOString() })
        .eq("id", localPayment.id)
        .eq("status", localPayment.status)
        .eq("provider_environment", providerEnvironment)
        .eq("updated_at", localPayment.updated_at)
        .select("*")
        .maybeSingle();
      if (retryClaim.error) throw retryClaim.error;
      if (retryClaim.data) {
        localPayment = retryClaim.data as JsonRecord;
        ownsPaymentCreation = true;
      }
    }
  }
  if (!ownsPaymentCreation) {
    return json(request, responseBody(localPayment, {
      retryable: true,
      warning: "A cobrança ainda está sendo preparada. Tente novamente em alguns segundos.",
    }), 202);
  }

  let providerCustomerId: string | null = null;
  if (candidate.primaryRegistration.registration_group_id) {
    const groupResult = await supabase.from("tournament_registration_groups")
      .select("*")
      .eq("id", candidate.primaryRegistration.registration_group_id)
      .eq("tournament_id", tournament.id)
      .single();
    if (groupResult.error) throw groupResult.error;
    providerCustomerId = await ensureAsaasFamilyCustomer(supabase, groupResult.data as JsonRecord);
    localPayment = await bindPaymentProviderCustomer(supabase, localPayment, providerCustomerId);
  }

  const providerClaim = await claimProviderPaymentAttempt(supabase, localPayment, "PIX");
  if (!providerClaim) {
    const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
    if (latest.error) throw latest.error;
    return json(request, responseBody(latest.data as JsonRecord, {
      retryable: true,
      warning: "A cobrança ainda está sendo preparada. Tente novamente em alguns segundos.",
    }), 202);
  }

  try {
    localPayment = await createOrRecoverPayment(
      supabase,
      providerClaim as JsonRecord,
      candidate.athlete,
      tournament,
      category,
      null,
      providerCustomerId,
    );
  } catch (error) {
    const providerError = providerErrorSnapshot(error);
    console.error("tournament-register spatial provider failure", {
      stage: "asaas_spatial_addon_payment",
      ...providerError,
    });
    if (error instanceof AmbiguousPaymentCreationError) {
      const reconciling = await deferPaymentReconciliation(supabase, providerClaim as JsonRecord, error);
      return json(request, responseBody(reconciling, {
        retryable: false,
        warning: "O Asaas ainda não confirmou a cobrança. Não tente gerar outra; faremos a conferência automaticamente.",
      }), 202);
    }
    const failed = await markClaimedProviderFailure(
      supabase,
      providerClaim as JsonRecord,
      { ...providerError, stage: "asaas_spatial_addon_payment" },
    );
    return json(request, responseBody(failed.payment, failed.applied
      ? {
        retryable: true,
        warning: "A vaga foi reservada, mas o Pix não ficou pronto. Tente novamente.",
      }
      : {}), failed.applied ? 202 : 200);
  }
  const deferredPix = hasDeferredPixRepair(localPayment);
  return json(request, responseBody(localPayment, deferredPixRepairResponse(localPayment)), deferredPix ? 202 : 201);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const securityConfig = publicRegistrationSecurityConfig();
  if (request.method === "GET") {
    if (!securityConfig) {
      return json(request, { error: "As inscrições estão temporariamente indisponíveis." }, 503);
    }
    const url = new URL(request.url);
    const inviteToken = text(url.searchParams.get("invite_token"), 80);
    const tournamentSlug = text(url.searchParams.get("tournament_slug"), 100).toLowerCase();
    if (inviteToken || tournamentSlug) {
      if (!isUuid(inviteToken) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug)) {
        return json(request, { error: "Este convite é inválido." }, 403);
      }
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseKey = serviceRoleKey();
      if (!supabaseUrl || !supabaseKey) return json(request, { error: "Convites temporariamente indisponíveis." }, 503);
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const tournamentResult = await supabase.from("tournaments")
        .select("id,name,slug,status,registration_open,registration_closes_at,is_published")
        .eq("slug", tournamentSlug)
        .maybeSingle();
      if (tournamentResult.error) throw tournamentResult.error;
      if (!tournamentResult.data || tournamentResult.data.is_published !== true) {
        return json(request, { error: "Torneio não encontrado." }, 404);
      }
      const inviteResult = await supabase.from("tournament_registration_invites")
        .select("id,tournament_id,athlete_limit,status,expires_at")
        .eq("tournament_id", tournamentResult.data.id)
        .eq("token_hash", await sha256Hex(inviteToken))
        .maybeSingle();
      if (inviteResult.error) throw inviteResult.error;
      const invite = inviteResult.data as JsonRecord | null;
      if (!invite) return json(request, { error: "Este convite é inválido." }, 403);
      if (invite.status === "USED") return json(request, { error: "Este convite já foi utilizado." }, 410);
      if (invite.status === "REVOKED") return json(request, { error: "Este convite foi cancelado." }, 410);
      if (invite.expires_at && Date.parse(String(invite.expires_at)) < Date.now()) {
        return json(request, { error: "Este convite expirou." }, 410);
      }
      if (tournamentResult.data.status !== "REGISTRATION_OPEN" || tournamentResult.data.registration_open !== true) {
        return json(request, { error: "As inscrições deste torneio estão fechadas." }, 409);
      }
      return json(request, {
        captcha_provider: "turnstile",
        captcha_site_key: securityConfig.turnstileSiteKey,
        invitation: true,
        athlete_limit: invite.athlete_limit,
        tournament_name: tournamentResult.data.name,
        expires_at: invite.expires_at,
      });
    }
    return json(request, {
      captcha_provider: "turnstile",
      captcha_site_key: securityConfig.turnstileSiteKey,
    });
  }
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  if (!securityConfig) {
    return json(request, { error: "As inscrições estão temporariamente indisponíveis." }, 503);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 25000) return json(request, { error: "Dados da inscrição muito grandes." }, 413);

  let failureStage = "payload";
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 25000) {
      return json(request, { error: "Dados da inscrição muito grandes." }, 413);
    }
    let payload: JsonRecord;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, { error: "Dados da inscrição inválidos." }, 400);
      }
      payload = parsed as JsonRecord;
    } catch (_error) {
      return json(request, { error: "Dados da inscrição inválidos." }, 400);
    }

    const action = text(payload.action, 40).toLowerCase();
    if (action === "spatial_lookup") {
      failureStage = "spatial_lookup";
      return await handleSpatialLookup(request, payload, securityConfig);
    }
    if (action === "spatial_checkout") {
      failureStage = "spatial_checkout";
      return await handleSpatialCheckout(request, payload, securityConfig);
    }
    if (action === "payment_status") {
      failureStage = "payment_status";
      return await handlePaymentStatus(request, payload, securityConfig);
    }
    if (action === "retry_payment") {
      failureStage = "payment_retry";
      return await handleIndividualPaymentRetry(request, payload, securityConfig);
    }
    if (action) return json(request, { error: "Ação inválida." }, 400);

    if (Array.isArray(payload.athletes)) {
      return await handleFamilyRegistration(request, payload, securityConfig);
    }

    const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
    const categoryId = text(payload.category_id, 80);
    const additionalCategoryId = text(payload.additional_category_id, 80);
    const fullName = text(payload.full_name, 120);
    const email = text(payload.email, 180).toLowerCase();
    const phone = digits(payload.phone);
    const submittedCpf = digits(payload.cpf);
    const participantType = text(payload.participant_type, 30).toUpperCase();
    const gender = text(payload.gender, 20).toUpperCase();
    const availabilityDays = Array.isArray(payload.availability_days)
      ? payload.availability_days.map((day) => text(day, 20).toUpperCase()).filter(Boolean)
      : [];
    const city = nullableText(payload.city, 100);
    const partnerName = nullableText(payload.partner_name, 120);
    const notes = nullableText(payload.notes, 500);
    const billingType = normalizeBillingType(payload.payment_method);
    const requestToken = text(payload.request_token, 80);
    const trackingToken = text(payload.tracking_token, 80);
    const captchaToken = text(payload.captcha_token, 2048);
    const termsAccepted = payload.terms_accepted === true;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(categoryId)) {
      return json(request, { error: "Torneio ou categoria inválidos." }, 400);
    }
    if (!isUuid(requestToken)) return json(request, { error: "Tentativa de inscrição inválida." }, 400);
    if (fullName.length < 2) return json(request, { error: "Informe seu nome completo." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
    if (phone.length < 10 || phone.length > 13) return json(request, { error: "Informe um telefone válido com DDD." }, 400);
    if (submittedCpf && !isValidCpf(submittedCpf)) return json(request, { error: "Informe um CPF válido." }, 400);
    if (!allowedParticipantTypes.has(participantType)) return json(request, { error: "Escolha um tipo de inscrição válido." }, 400);
    if (participantType === "COURTESY") {
      return json(request, {
        error: "Este link de cortesia foi substituído por um convite exclusivo. Solicite um novo convite à organização.",
      }, 410);
    }
    if (participantType !== "COURTESY" && !isValidCpf(submittedCpf)) {
      return json(request, { error: "Informe seu CPF para gerar a cobrança da inscrição." }, 400);
    }
    if (!allowedGenders.has(gender)) return json(request, { error: "Escolha o sexo." }, 400);
    if (!availabilityDays.length || availabilityDays.some((day) => !allowedAvailabilityDays.has(day))) {
      return json(request, { error: "Marque pelo menos um dia disponível entre segunda e quinta." }, 400);
    }
    if (!termsAccepted) return json(request, { error: "Confirme os dados e a autorização para realizar a inscrição." }, 400);
    if (!allowedBillingTypes.has(billingType)) return json(request, { error: "Forma de pagamento inválida." }, 400);
    if (!captchaToken) return json(request, { error: "Confirme que você não é um robô." }, 400);

    failureStage = "database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "network_rate_limit";
    const clientIp = trustedClientIp(request);
    const ipHash = clientIp ? await hmacSha256(securityConfig.rateLimitSalt, `ip:${clientIp}`) : null;
    const rateLimitResult = await supabase.rpc("consume_tournament_registration_network_rate_limits", {
      p_ip_hash: ipHash,
    });
    if (rateLimitResult.error) throw rateLimitResult.error;
    const rateLimit = (Array.isArray(rateLimitResult.data) ? rateLimitResult.data[0] : rateLimitResult.data) as
      | { allowed?: boolean; retry_after_seconds?: number }
      | null;
    if (!rateLimit?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(rateLimit?.retry_after_seconds || 60)));
      return json(
        request,
        { error: "Muitas tentativas de inscrição. Aguarde um pouco e tente novamente." },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    failureStage = "captcha_verification";
    let captchaAccepted = false;
    try {
      captchaAccepted = await verifyTurnstile(request, captchaToken, securityConfig);
    } catch (_error) {
      return json(request, { error: "Não foi possível validar a proteção anti-robô agora. Tente novamente." }, 503);
    }
    if (!captchaAccepted) {
      return json(request, { error: "A validação anti-robô expirou ou não foi aceita. Tente novamente." }, 400);
    }

    failureStage = "identity_rate_limit";
    const identityHash = await hmacSha256(securityConfig.rateLimitSalt, `identity:${email}|${phone}`);
    const identityRateLimitResult = await supabase.rpc("consume_tournament_registration_identity_rate_limit", {
      p_identity_hash: identityHash,
    });
    if (identityRateLimitResult.error) throw identityRateLimitResult.error;
    const identityRateLimit = (
      Array.isArray(identityRateLimitResult.data) ? identityRateLimitResult.data[0] : identityRateLimitResult.data
    ) as { allowed?: boolean; retry_after_seconds?: number } | null;
    if (!identityRateLimit?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(identityRateLimit?.retry_after_seconds || 60)));
      return json(
        request,
        { error: "Muitas tentativas para estes dados. Aguarde um pouco e tente novamente." },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    failureStage = "tournament_lookup";
    const { data: tournament, error: tournamentError } = await supabase.from("tournaments")
      .select("id,name,slug,status,registration_open,registration_opens_at,registration_closes_at,default_fee,allowed_payment_methods,is_published,settings")
      .eq("slug", tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament || !tournament.is_published) return json(request, { error: "Torneio não encontrado." }, 404);
    const now = Date.now();
    const opensAt = tournament.registration_opens_at ? Date.parse(tournament.registration_opens_at) : null;
    const closesAt = tournament.registration_closes_at ? Date.parse(tournament.registration_closes_at) : null;
    if (tournament.status !== "REGISTRATION_OPEN" || !tournament.registration_open ||
      (opensAt && now < opensAt) || (closesAt && now > closesAt)) {
      return json(request, { error: "As inscrições deste torneio estão fechadas." }, 409);
    }

    failureStage = "category_lookup";
    const { data: category, error: categoryError } = await supabase.from("tournament_categories")
      .select("id,tournament_id,code,name,event_type,gender,registration_fee,registration_open,max_entries,active")
      .eq("id", categoryId)
      .eq("tournament_id", tournament.id)
      .maybeSingle();
    if (categoryError) throw categoryError;
    if (!category || !category.active || !category.registration_open) {
      return json(request, { error: "Esta categoria não está recebendo inscrições." }, 409);
    }
    if (category.gender && ![gender, "MIXED", "OPEN"].includes(String(category.gender).toUpperCase())) {
      return json(request, { error: "Esta classe não está disponível para o sexo selecionado." }, 400);
    }
    if (category.event_type === "DOUBLES" && !partnerName) {
      return json(request, { error: "Informe o nome da dupla para esta categoria." }, 400);
    }
    const spatialAddons = tournament.settings && typeof tournament.settings === "object" && !Array.isArray(tournament.settings)
      ? (tournament.settings as JsonRecord).spatial_addons
      : null;
    const spatialAddonMap = spatialAddons && typeof spatialAddons === "object" && !Array.isArray(spatialAddons)
      ? spatialAddons as JsonRecord
      : {};
    const spatialCategoryCodes = new Set(
      Object.values(spatialAddonMap)
        .map((rule) => rule && typeof rule === "object" && !Array.isArray(rule) ? text((rule as JsonRecord).category_code, 40) : "")
        .filter(Boolean),
    );
    if (spatialCategoryCodes.has(String(category.code))) {
      return json(request, { error: "Escolha primeiro sua classe principal e use a opção de Classe Espacial." }, 400);
    }
    let additionalCategory: JsonRecord | null = null;
    let additionalFee = 0;
    const addonRuleValue = spatialAddonMap[String(category.code)] as unknown;
    const addonRule = addonRuleValue && typeof addonRuleValue === "object" && !Array.isArray(addonRuleValue)
      ? addonRuleValue as JsonRecord
      : null;
    if (additionalCategoryId) {
      if (!isUuid(additionalCategoryId) || !addonRule) {
        return json(request, { error: "Esta classe não permite inscrição adicional na Classe Espacial." }, 400);
      }
      const expectedAdditionalCode = text(addonRule.category_code, 40);
      const additionalResult = await supabase.from("tournament_categories")
        .select("id,tournament_id,code,name,event_type,gender,registration_fee,registration_open,max_entries,active")
        .eq("id", additionalCategoryId)
        .eq("tournament_id", tournament.id)
        .eq("code", expectedAdditionalCode)
        .maybeSingle();
      if (additionalResult.error) throw additionalResult.error;
      additionalCategory = additionalResult.data as JsonRecord | null;
      if (!additionalCategory || !additionalCategory.active || !additionalCategory.registration_open) {
        return json(request, { error: "A Classe Espacial selecionada não corresponde à sua classe principal." }, 400);
      }
      const configuredSpatialFee = Number(
        tournament.settings && typeof tournament.settings === "object" && !Array.isArray(tournament.settings)
          ? (tournament.settings as JsonRecord).spatial_addon_fee
          : undefined,
      );
      additionalFee = Number.isFinite(configuredSpatialFee)
        ? configuredSpatialFee
        : Number(addonRule.fee ?? additionalCategory.registration_fee);
      if (!Number.isFinite(additionalFee) || additionalFee < 0) {
        return json(request, { error: "O valor da Classe Espacial ainda não foi configurado." }, 409);
      }
    }
    const allowedMethods = Array.isArray(tournament.allowed_payment_methods)
      ? tournament.allowed_payment_methods.map((item: unknown) => String(item).toUpperCase())
      : ["PIX", "BOLETO", "CREDIT_CARD"];
    if (participantType !== "COURTESY" && billingType === "UNDEFINED") {
      const canChoose = allowedMethods.includes("UNDEFINED") ||
        ["PIX", "BOLETO", "CREDIT_CARD"].filter((method) => allowedMethods.includes(method)).length > 1;
      if (!canChoose) return json(request, { error: "Escolha uma forma de pagamento disponível." }, 400);
    }
    if (participantType !== "COURTESY" && !allowedMethods.includes(billingType)) {
      return json(request, { error: "Esta forma de pagamento não está disponível no torneio." }, 400);
    }
    const tournamentSettings = tournament.settings && typeof tournament.settings === "object" && !Array.isArray(tournament.settings)
      ? tournament.settings as JsonRecord
      : {};
    const registrationPricing = tournamentSettings.registration_pricing && typeof tournamentSettings.registration_pricing === "object" && !Array.isArray(tournamentSettings.registration_pricing)
      ? tournamentSettings.registration_pricing as JsonRecord
      : {};
    const participantAmount = Number(registrationPricing[participantType]);
    if (participantType !== "COURTESY" && (!Number.isFinite(participantAmount) || participantAmount < 0)) {
      return json(request, { error: "O valor deste tipo de inscrição ainda não foi configurado." }, 409);
    }
    const baseAmount = participantType === "COURTESY"
      ? 0
      : participantAmount;
    const amount = participantType === "COURTESY" ? 0 : baseAmount + additionalFee;
    const providerEnvironment = asaasConfig().environment;

    failureStage = "athlete_upsert";
    const sourceKey = await publicAthleteSourceKey(email, phone);
    let { data: athlete, error: athleteError } = await supabase.from("tournament_athletes")
      .select("*")
      .eq("source_key", sourceKey)
      .maybeSingle();
    if (athleteError) throw athleteError;
    let registration: JsonRecord | null = null;
    let additionalRegistration: JsonRecord | null = null;
    let localPayment: JsonRecord | null = null;
    let ownsPaymentCreation = false;
    let registrationChecked = false;
    let athleteHasAnyRegistration = false;
    if (athlete) {
      failureStage = "registration_authorization";
      const existingRegistration = await supabase.from("tournament_registrations")
        .select("*")
        .eq("tournament_id", tournament.id)
        .eq("category_id", category.id)
        .eq("athlete_id", athlete.id)
        .maybeSingle();
      if (existingRegistration.error) throw existingRegistration.error;
      registration = existingRegistration.data as JsonRecord | null;
      athleteHasAnyRegistration = Boolean(registration);
      registrationChecked = true;
      const ownsByRequestToken = registration && requestToken === String(registration.request_token || "");
      if (registration && !ownsByRequestToken && (!trackingToken || trackingToken !== String(registration.public_token))) {
        return json(request, { error: "Já existe uma inscrição deste atleta nesta classe. Use o acompanhamento da primeira inscrição." }, 409);
      }
      if (registration) {
        const childResult = await supabase.from("tournament_registrations")
          .select("*")
          .eq("parent_registration_id", registration.id)
          .maybeSingle();
        if (childResult.error) throw childResult.error;
        additionalRegistration = childResult.data as JsonRecord | null;
      }
      if (!registration) {
        const anyRegistration = await supabase.from("tournament_registrations")
          .select("id")
          .eq("athlete_id", athlete.id)
          .limit(1)
          .maybeSingle();
        if (anyRegistration.error) throw anyRegistration.error;
        athleteHasAnyRegistration = Boolean(anyRegistration.data);
      }
    }

    const storedCpf = digits(athlete?.cpf);
    if (athlete && storedCpf && submittedCpf && storedCpf !== submittedCpf) {
      return json(request, { error: "Os dados não correspondem ao participante já cadastrado. Fale com a organização." }, 409);
    }
    // A failed attempt can leave an athlete row before a registration is
    // created. With no registration to protect, completing that orphan with a
    // valid CPF is safe and prevents a false "CPF já cadastrado" response.
    if (participantType !== "COURTESY" && athlete && !registration && athleteHasAnyRegistration) {
      if (!isValidCpf(storedCpf) || storedCpf !== submittedCpf) {
        return json(request, { error: "Confirme o CPF já cadastrado ou fale com a organização." }, 409);
      }
    }
    // The tournament-wide courtesy link proves fee exemption, not ownership
    // of an athlete record. Reusing an existing athlete in a new category also
    // requires the stored CPF; an existing category is already protected by
    // its per-registration tracking token above.
    if (participantType === "COURTESY" && athlete && !registration && athleteHasAnyRegistration) {
      if (!isValidCpf(storedCpf) || storedCpf !== submittedCpf) {
        return json(request, { error: "Confirme o CPF já cadastrado ou fale com a organização." }, 409);
      }
    }
    if (submittedCpf) {
      const cpfLookup = await supabase.from("tournament_athletes")
        .select("*")
        .eq("cpf", submittedCpf)
        .maybeSingle();
      if (cpfLookup.error) throw cpfLookup.error;
      if (cpfLookup.data && (!athlete || cpfLookup.data.id !== athlete.id)) {
        return json(request, { error: "Este CPF já está vinculado a outro participante. Fale com a organização." }, 409);
      }
    }
    const effectiveCpf = participantType === "COURTESY" ? submittedCpf || storedCpf : submittedCpf;
    const athleteValues = {
      full_name: fullName,
      source_key: sourceKey,
      email,
      phone,
      cpf: effectiveCpf || null,
      gender,
      city,
      active: true,
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
    };
    if (athlete) {
      const updated = await supabase.from("tournament_athletes").update(athleteValues).eq("id", athlete.id).select("*").single();
      if (updated.error) throw updated.error;
      athlete = updated.data;
    } else {
      const result = await supabase.from("tournament_athletes").insert(athleteValues).select("*").single();
      if (result.error?.code === "23505") {
        return json(request, { error: "Já existe um cadastro com estes dados. Confira o CPF ou tente novamente." }, 409);
      } else if (result.error) throw result.error;
      else athlete = result.data;
    }

    if (!registrationChecked) {
      failureStage = "registration_lookup";
      const registrationResult = await supabase.from("tournament_registrations")
        .select("*")
        .eq("tournament_id", tournament.id)
        .eq("category_id", category.id)
        .eq("athlete_id", athlete.id)
        .maybeSingle();
      if (registrationResult.error) throw registrationResult.error;
      registration = registrationResult.data as JsonRecord | null;
      const ownsByRequestToken = registration && requestToken === String(registration.request_token || "");
      if (registration && !ownsByRequestToken && (!trackingToken || trackingToken !== String(registration.public_token))) {
        return json(request, { error: "Já existe uma inscrição deste atleta nesta classe. Use o acompanhamento da primeira inscrição." }, 409);
      }
    }

    if (registration) {
      const existingPayment = await supabase.from("tournament_payments")
        .select("*")
        .eq("registration_id", registration.id)
        .maybeSingle();
      if (existingPayment.error) throw existingPayment.error;
      if (["WAITLIST", "CANCELLED", "REFUNDED"].includes(String(registration.status)) ||
        registration.payment_status === "PAID") {
        return json(request, {
          registration: safeRegistration(registration),
          additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
          payment: safePayment(existingPayment.data as JsonRecord | null),
          tracking_token: registration.public_token,
        });
      }
    } else {
      failureStage = "registration_capacity";
      const result = await supabase.rpc("claim_public_tournament_registration_checkout", {
        p_tournament_id: tournament.id,
        p_request_token: requestToken,
        p_primary_category_id: category.id,
        p_additional_category_id: additionalCategory?.id || null,
        p_athlete_id: athlete.id,
        p_public_name: fullName,
        p_public_city: city,
        p_public_club: null,
        p_partner_name: partnerName,
        p_shirt_size: null,
        p_primary_amount: baseAmount,
        p_billing_type: billingType,
        p_provider_environment: providerEnvironment,
        p_notes: registrationNotes(participantType, availabilityDays, notes),
      });
      if (result.error?.code === "23505") {
        return json(request, { error: "Esta inscrição já está sendo processada. Aguarde alguns segundos e use o acompanhamento da primeira solicitação." }, 409);
      }
      if (result.error?.code === "P0001" && publicRegistrationRuleErrors.has(result.error.message)) {
        return json(request, { error: result.error.message }, 409);
      }
      if (result.error) throw result.error;
      const bundle = (Array.isArray(result.data) ? result.data[0] : result.data) as JsonRecord | null;
      registration = bundle?.registration as JsonRecord | null;
      additionalRegistration = bundle?.additional_registration as JsonRecord | null;
      localPayment = bundle?.payment as JsonRecord | null;
      ownsPaymentCreation = bundle?.payment_created === true;
    }
    if (!registration) throw new Error("Não foi possível preparar a inscrição.");
    if (!additionalRegistration) {
      const childResult = await supabase.from("tournament_registrations")
        .select("*")
        .eq("parent_registration_id", registration.id)
        .limit(1)
        .maybeSingle();
      if (childResult.error) throw childResult.error;
      additionalRegistration = childResult.data as JsonRecord | null;
    }
    const registrationStatus = String(registration.status);

    if (registrationStatus === "WAITLIST" || amount === 0) {
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: null,
        tracking_token: registration.public_token,
      }, 201);
    }

    failureStage = "payment_claim";
    const externalReference = `tournament-registration:${registration.id}`;
    if (!localPayment) {
      const paymentResult = await supabase.from("tournament_payments").select("*").eq("registration_id", registration.id).maybeSingle();
      if (paymentResult.error) throw paymentResult.error;
      localPayment = paymentResult.data as JsonRecord | null;
    }
    if (!localPayment) {
      const insert = await supabase.from("tournament_payments").insert({
        tournament_id: tournament.id,
        registration_id: registration.id,
        provider: "ASAAS",
        provider_environment: providerEnvironment,
        external_reference: externalReference,
        billing_type: billingType,
        status: "CREATED",
        amount,
      }).select("*").single();
      if (insert.error?.code === "23505") {
        const retry = await supabase.from("tournament_payments").select("*").eq("registration_id", registration.id).single();
        if (retry.error) throw retry.error;
        localPayment = retry.data;
      } else if (insert.error) throw insert.error;
      else {
        localPayment = insert.data;
        ownsPaymentCreation = true;
      }
    }
    if (!localPayment) throw new Error("Não foi possível preparar a cobrança.");
    localPayment = await ensurePaymentProviderEnvironment(supabase, localPayment);
    if (String(localPayment.status) === "REVIEW_REQUIRED" &&
      text(localPayment.provider_environment, 20).toUpperCase() !== providerEnvironment) {
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
        retryable: false,
        warning: "A cobrança pertence a outro ambiente do Asaas e precisa de revisão da organização.",
      }, 202);
    }

    if (localPayment.provider_payment_id) {
      try {
        localPayment = await repairExistingPixPayment(supabase, localPayment);
      } catch (error) {
        console.warn("tournament-register PIX repair deferred", {
          payment_id: localPayment.id,
          provider_error: providerErrorSnapshot(error),
        });
      }
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
        ...deferredPixRepairResponse(localPayment),
      });
    }
    if (localPayment.status === "RECONCILING") {
      localPayment = await reconcileAmbiguousPayment(supabase, localPayment);
      const existingProviderPayment = Boolean(localPayment.provider_payment_id);
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
        ...(existingProviderPayment
          ? deferredPixRepairResponse(localPayment)
          : {
            retryable: false,
            warning: "Estamos conferindo a cobrança no Asaas. Não gere outro pagamento; esta tela será liberada assim que a resposta for confirmada.",
          }),
      }, existingProviderPayment ? 200 : 202);
    }
    if (!retryablePaymentStatuses.has(String(localPayment.status))) {
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
      });
    }
    if (!ownsPaymentCreation) {
      const age = Date.now() - Date.parse(String(localPayment.updated_at || localPayment.created_at));
      if (localPayment.status === "FAILED" || age > 120000) {
        const claim = await supabase.from("tournament_payments")
          .update({ status: "CREATED", billing_type: billingType, updated_at: new Date().toISOString() })
          .eq("id", localPayment.id)
          .eq("status", localPayment.status)
          .eq("provider_environment", providerEnvironment)
          .eq("updated_at", localPayment.updated_at)
          .select("*")
          .maybeSingle();
        if (claim.error) throw claim.error;
        if (claim.data) {
          localPayment = claim.data;
          ownsPaymentCreation = true;
        }
      }
    }
    if (!ownsPaymentCreation) {
      return json(request, {
        error: "A cobrança desta inscrição ainda está sendo preparada. Tente novamente em alguns segundos.",
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
      }, 409);
    }

    if (!localPayment) throw new Error("Não foi possível assumir a cobrança.");
    const providerClaim = await claimProviderPaymentAttempt(supabase, localPayment, billingType);
    if (!providerClaim) {
      const latest = await supabase.from("tournament_payments").select("*").eq("id", localPayment.id).single();
      if (latest.error) throw latest.error;
      return json(request, {
        error: "A cobrança desta inscrição ainda está sendo preparada. Tente novamente em alguns segundos.",
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(latest.data as JsonRecord),
        tracking_token: registration.public_token,
      }, 409);
    }
    const claimedPayment: JsonRecord = providerClaim;
    failureStage = "asaas_payment";
    try {
      localPayment = await createOrRecoverPayment(supabase, claimedPayment, athlete, tournament, category, additionalCategory);
    } catch (error) {
      const providerError = providerErrorSnapshot(error);
      console.error("tournament-register provider failure", { stage: failureStage, ...providerError });
      if (error instanceof AmbiguousPaymentCreationError) {
        const reconciling = await deferPaymentReconciliation(supabase, claimedPayment, error);
        return json(request, {
          registration: safeRegistration(registration),
          additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
          payment: safePayment(reconciling),
          tracking_token: registration.public_token,
          retryable: false,
          warning: "O Asaas ainda não confirmou se a cobrança foi criada. Não tente gerar outra: faremos a conferência automaticamente.",
        }, 202);
      }
      const failedPayment = await markClaimedProviderFailure(
        supabase,
        claimedPayment,
        { ...providerError, stage: failureStage },
      );
      if (!failedPayment.applied) {
        return json(request, {
          registration: safeRegistration(registration),
          additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
          payment: safePayment(failedPayment.payment),
          tracking_token: registration.public_token,
        });
      }
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(failedPayment.payment),
        tracking_token: registration.public_token,
        retryable: true,
        warning: "Sua inscrição foi salva, mas a cobrança não ficou pronta. Tente gerar o pagamento novamente.",
      }, 202);
    }

    const deferredPix = hasDeferredPixRepair(localPayment);
    return json(request, {
      registration: safeRegistration(registration),
      additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
      payment: safePayment(localPayment),
      tracking_token: registration.public_token,
      ...deferredPixRepairResponse(localPayment),
    }, deferredPix ? 202 : 201);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? text((error as JsonRecord).code, 40)
      : "internal_error";
    console.error("tournament-register failure", { stage: failureStage, code });
    const publicMessage = failureStage === "asaas_payment"
      ? "A inscrição foi salva, mas não foi possível gerar a cobrança agora. Tente novamente."
      : "Não foi possível concluir a inscrição.";
    return json(request, { error: publicMessage, code: failureStage }, 500);
  }
});
