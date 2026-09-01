import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const defaultAllowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

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

const allowedBillingTypes = new Set(["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"]);
const allowedGenders = new Set(["MALE", "FEMALE"]);
const allowedAvailabilityDays = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"]);
const allowedParticipantTypes = new Set(["CINCATE", "ILHA_STUDENT", "NON_MEMBER", "COURTESY"]);
const participantLabels: Record<string, string> = { CINCATE: "CINCATE", ILHA_STUDENT: "Aluno Ilha Tênis", NON_MEMBER: "Não associado", COURTESY: "Cortesia (isento)" };
const retryablePaymentStatuses = new Set(["CREATED", "FAILED"]);
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
    return outcome.success === true &&
      outcome.action === "tournament_registration" &&
      config.turnstileAllowedHostnames.has(String(outcome.hostname || "").toLowerCase());
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

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
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
  return {
    id: row.id,
    status: row.status,
    billing_type: row.billing_type,
    amount: row.amount,
    invoice_url: row.invoice_url || null,
    pix_payload: row.pix_payload || null,
    pix_encoded_image: row.pix_encoded_image || null,
    pix_expires_at: row.pix_expires_at || null,
    expires_at: row.expires_at || null,
  };
}

function asaasConfig() {
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const configuredUrl = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  const allowedUrls = new Set(["https://api-sandbox.asaas.com/v3", "https://api.asaas.com/v3"]);
  if (!apiKey || !allowedUrls.has(configuredUrl)) throw new Error("Configuração de pagamento indisponível.");
  return { apiKey, baseUrl: configuredUrl };
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

function providerErrorSnapshot(error: unknown) {
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
  const result = await asaasRequest(`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=1`);
  const rows = Array.isArray(result.data) ? result.data : [];
  return (rows[0] || null) as JsonRecord | null;
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
        notificationDisabled: false,
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
  if (status === "RECEIVED") return "RECEIVED";
  if (status === "CONFIRMED") return "CONFIRMED";
  if (status === "OVERDUE") return "OVERDUE";
  if (status === "REFUNDED") return "REFUNDED";
  if (status === "DELETED") return "CANCELLED";
  if (status === "PENDING") return "PENDING";
  return "CREATED";
}

async function saveProviderPayment(
  supabase: DbClient,
  localPayment: JsonRecord,
  providerPayment: JsonRecord,
) {
  const providerPaymentId = text(providerPayment.id, 100);
  if (!providerPaymentId) throw new Error("Cobrança sem identificador no Asaas.");
  let pix: JsonRecord = {};
  if (String(localPayment.billing_type) === "PIX") {
    pix = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`);
  }
  const providerStatus = mapAsaasPaymentStatus(providerPayment.status);
  const localStatus = String(localPayment.status || "");
  const status = ["RECEIVED", "CONFIRMED"].includes(localStatus) &&
      !["RECEIVED", "CONFIRMED"].includes(providerStatus)
    ? localStatus
    : providerStatus;
  const update = {
    provider_payment_id: providerPaymentId,
    provider_customer_id: nullableText(providerPayment.customer || localPayment.provider_customer_id, 100),
    status,
    invoice_url: nullableText(
      providerPayment.invoiceUrl || providerPayment.bankSlipUrl || localPayment.invoice_url,
      1000,
    ),
    pix_payload: nullableText(pix.payload || localPayment.pix_payload, 4000),
    pix_encoded_image: nullableText(pix.encodedImage || localPayment.pix_encoded_image, 500000),
    pix_expires_at: nullableText(pix.expirationDate || localPayment.pix_expires_at, 80),
    raw_response: {
      payment: {
        id: providerPaymentId,
        status: text(providerPayment.status, 40),
        billing_type: text(providerPayment.billingType, 40),
        due_date: text(providerPayment.dueDate, 20),
        external_reference: text(providerPayment.externalReference, 160),
      },
      pix: { expiration_date: text(pix.expirationDate, 80) },
    },
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("tournament_payments")
    .update(update)
    .eq("id", localPayment.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as JsonRecord;
}

async function repairExistingPixPayment(supabase: DbClient, localPayment: JsonRecord) {
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
) {
  const externalReference = String(localPayment.external_reference);
  const recovered = await findAsaasPayment(externalReference);
  if (recovered) return await saveProviderPayment(supabase, localPayment, recovered);

  const customerId = await ensureAsaasCustomer(supabase, athlete);
  const providerPayment = await asaasRequest("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: localPayment.billing_type,
      value: Number(localPayment.amount),
      dueDate: saoPauloDate(),
      description: asaasSafeDescription(
        `Inscrição ${tournament.name} ${category.name}${additionalCategory ? ` ${additionalCategory.name}` : ""}`,
      ),
      externalReference,
    }),
  });
  return await saveProviderPayment(supabase, { ...localPayment, provider_customer_id: customerId }, providerPayment);
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
        notificationDisabled: false,
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
  const externalReference = String(localPayment.external_reference);
  const recovered = await findAsaasPayment(externalReference);
  if (recovered) return await saveProviderPayment(supabase, localPayment, recovered);

  const customerId = await ensureAsaasFamilyCustomer(supabase, group);
  const providerPayment = await asaasRequest("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: localPayment.billing_type,
      value: Number(localPayment.amount),
      dueDate: saoPauloDate(),
      description: asaasSafeDescription(
        `Inscrição familiar ${tournament.name} - ${athleteCount} atleta${athleteCount === 1 ? "" : "s"}`,
      ),
      externalReference,
    }),
  });
  return await saveProviderPayment(supabase, { ...localPayment, provider_customer_id: customerId }, providerPayment);
}

async function finishFamilyCheckout(
  request: Request,
  supabase: DbClient,
  group: JsonRecord,
  registrations: JsonRecord[],
  tournament: JsonRecord,
  billingType: string,
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

  const paymentLookup = await supabase.from("tournament_payments")
    .select("*")
    .eq("registration_group_id", group.id)
    .maybeSingle();
  if (paymentLookup.error) throw paymentLookup.error;
  let localPayment = paymentLookup.data as JsonRecord | null;
  let ownsPaymentCreation = false;
  if (!localPayment) {
    const insert = await supabase.from("tournament_payments").insert({
      tournament_id: tournament.id,
      registration_id: primaryRegistrationId,
      registration_group_id: group.id,
      provider: "ASAAS",
      external_reference: `tournament-family:${group.id}`,
      billing_type: billingType,
      status: "CREATED",
      amount,
    }).select("*").single();
    if (insert.error?.code === "23505") {
      const retry = await supabase.from("tournament_payments")
        .select("*")
        .eq("registration_group_id", group.id)
        .single();
      if (retry.error) throw retry.error;
      localPayment = retry.data as JsonRecord;
    } else if (insert.error) throw insert.error;
    else {
      localPayment = insert.data as JsonRecord;
      ownsPaymentCreation = true;
    }
  }
  if (!localPayment) throw new Error("Não foi possível preparar a cobrança familiar.");

  if (localPayment.provider_payment_id) {
    try {
      localPayment = await repairExistingPixPayment(supabase, localPayment);
    } catch (error) {
      console.warn("tournament-register family PIX repair deferred", {
        payment_id: localPayment.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    return json(request, responseBody(localPayment));
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

  const claimedPayment = localPayment;
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
    const failed = await supabase.from("tournament_payments").update({
      status: "FAILED",
      raw_response: { ...providerError, stage: "asaas_family_payment" },
      updated_at: new Date().toISOString(),
    }).eq("id", claimedPayment.id).select("*").single();
    if (failed.error) throw failed.error;
    return json(request, responseBody(failed.data as JsonRecord, {
      retryable: true,
      warning: "As inscrições foram reservadas, mas a cobrança não ficou pronta. Tente gerar o pagamento novamente.",
    }), 202);
  }
  return json(request, responseBody(localPayment), 201);
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
    const captchaToken = text(payload.captcha_token, 2048);
    const termsAccepted = payload.terms_accepted === true;
    const athleteInputs = Array.isArray(payload.athletes) ? payload.athletes.map(record) : [];

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(requestToken)) {
      return json(request, { error: "Torneio ou solicitação inválidos." }, 400);
    }
    if (payerName.length < 2) return json(request, { error: "Informe o nome completo do responsável." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(payerEmail)) return json(request, { error: "Informe o e-mail do responsável." }, 400);
    if (payerPhone.length < 10 || payerPhone.length > 13) {
      return json(request, { error: "Informe um telefone válido do responsável." }, 400);
    }
    if (!isValidCpf(payerCpf)) return json(request, { error: "Informe um CPF válido do responsável." }, 400);
    if (athleteInputs.length < 1 || athleteInputs.length > 6) {
      return json(request, { error: "Adicione de um a seis atletas à inscrição." }, 400);
    }
    if (!allowedBillingTypes.has(billingType)) return json(request, { error: "Forma de pagamento inválida." }, 400);
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
      if (!allowedParticipantTypes.has(participantType) || participantType === "COURTESY") {
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
    const now = Date.now();
    const opensAt = tournament.registration_opens_at ? Date.parse(String(tournament.registration_opens_at)) : null;
    const closesAt = tournament.registration_closes_at ? Date.parse(String(tournament.registration_closes_at)) : null;
    if (tournament.status !== "REGISTRATION_OPEN" || tournament.registration_open !== true ||
      (opensAt && now < opensAt) || (closesAt && now > closesAt)) {
      return json(request, { error: "As inscrições deste torneio estão fechadas." }, 409);
    }
    const allowedMethods = Array.isArray(tournament.allowed_payment_methods)
      ? tournament.allowed_payment_methods.map((method) => String(method).toUpperCase())
      : ["PIX", "BOLETO", "CREDIT_CARD"];
    if (billingType === "UNDEFINED") {
      const canChoose = allowedMethods.includes("UNDEFINED") ||
        ["PIX", "BOLETO", "CREDIT_CARD"].filter((method) => allowedMethods.includes(method)).length > 1;
      if (!canChoose) return json(request, { error: "Escolha uma forma de pagamento disponível." }, 400);
    }
    if (!allowedMethods.includes(billingType)) {
      return json(request, { error: "Esta forma de pagamento não está disponível no torneio." }, 400);
    }

    const existingGroupResult = await supabase.from("tournament_registration_groups")
      .select("*")
      .eq("request_token", requestToken)
      .maybeSingle();
    if (existingGroupResult.error) throw existingGroupResult.error;
    if (existingGroupResult.data) {
      const existingGroup = existingGroupResult.data as JsonRecord;
      if (String(existingGroup.tournament_id) !== String(tournament.id) || digits(existingGroup.payer_cpf) !== payerCpf) {
        return json(request, { error: "Esta tentativa de inscrição não corresponde ao responsável informado." }, 403);
      }
      const existingRegistrations = await supabase.from("tournament_registrations")
        .select("*")
        .eq("registration_group_id", existingGroup.id)
        .order("created_at");
      if (existingRegistrations.error) throw existingRegistrations.error;
      return await finishFamilyCheckout(
        request,
        supabase,
        existingGroup,
        (existingRegistrations.data || []) as JsonRecord[],
        tournament,
        billingType,
      );
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
      const primaryAmount = Number(registrationPricing[athleteInput.participantType]);
      if (!Number.isFinite(primaryAmount) || primaryAmount < 0) {
        return json(request, { error: `O valor da inscrição de ${athleteInput.fullName} ainda não foi configurado.` }, 409);
      }

      const sourceKey = await familyAthleteSourceKey(
        payerEmail,
        payerPhone,
        athleteInput.fullName,
        athleteInput.birthDate,
        athleteInput.cpf,
      );
      let athleteResult = await supabase.from("tournament_athletes").select("*").eq("source_key", sourceKey).maybeSingle();
      if (athleteResult.error) throw athleteResult.error;
      let athlete = athleteResult.data as JsonRecord | null;
      if (athleteInput.cpf) {
        const cpfResult = await supabase.from("tournament_athletes").select("*").eq("cpf", athleteInput.cpf).maybeSingle();
        if (cpfResult.error) throw cpfResult.error;
        if (cpfResult.data && athlete && String(cpfResult.data.id) !== String(athlete.id)) {
          return json(request, { error: `Os dados de ${athleteInput.fullName} já estão vinculados a outro cadastro.` }, 409);
        }
        athlete = (cpfResult.data || athlete) as JsonRecord | null;
      }
      if (athlete) {
        const currentTournamentRegistration = await supabase.from("tournament_registrations")
          .select("id")
          .eq("tournament_id", tournament.id)
          .eq("athlete_id", athlete.id)
          .limit(1)
          .maybeSingle();
        if (currentTournamentRegistration.error) throw currentTournamentRegistration.error;
        if (currentTournamentRegistration.data) {
          return json(request, {
            error: `${athleteInput.fullName} já possui inscrição neste torneio. Fale com a organização para alterar ou complementar a inscrição.`,
          }, 409);
        }
        const previousRegistration = await supabase.from("tournament_registrations")
          .select("id")
          .eq("athlete_id", athlete.id)
          .limit(1)
          .maybeSingle();
        if (previousRegistration.error) throw previousRegistration.error;
        const storedCpf = digits(athlete.cpf);
        const submittedCpfMatches = isValidCpf(athleteInput.cpf) && storedCpf === athleteInput.cpf;
        const minorGuardianMatches = athleteInput.isMinor && !athleteInput.cpf &&
          String(athlete.source_key || "") === sourceKey &&
          text(athlete.email, 180).toLowerCase() === payerEmail &&
          digits(athlete.guardian_phone) === payerPhone &&
          text(athlete.birth_date, 10) === athleteInput.birthDate;
        if (previousRegistration.data && !submittedCpfMatches && !minorGuardianMatches) {
          return json(request, {
            error: `Os dados de ${athleteInput.fullName} já existem. Confirme os dados do responsável, o CPF ou fale com a organização.`,
          }, 409);
        }
      }
      const athleteValues = {
        full_name: athleteInput.fullName,
        source_key: sourceKey,
        email: athleteInput.isMinor ? payerEmail : (athleteInput.isPayer ? payerEmail : null),
        phone: athleteInput.phone || null,
        cpf: athleteInput.cpf || null,
        birth_date: athleteInput.birthDate || null,
        gender: athleteInput.gender,
        city: athleteInput.city,
        is_minor: athleteInput.isMinor,
        guardian_name: athleteInput.isMinor ? payerName : null,
        guardian_phone: athleteInput.isMinor ? payerPhone : null,
        active: true,
        status: "ACTIVE",
        updated_at: new Date().toISOString(),
      };
      if (athlete) {
        athleteResult = await supabase.from("tournament_athletes").update(athleteValues)
          .eq("id", athlete.id).select("*").single();
      } else {
        athleteResult = await supabase.from("tournament_athletes").insert(athleteValues).select("*").single();
      }
      if (athleteResult.error?.code === "23505") {
        return json(request, { error: `Já existe um cadastro de ${athleteInput.fullName}. Confira os dados ou fale com a organização.` }, 409);
      }
      if (athleteResult.error) throw athleteResult.error;
      athlete = athleteResult.data as JsonRecord;
      rpcEntries.push({
        athlete_id: athlete.id,
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
    const claimResult = await supabase.rpc("claim_public_tournament_family_bundle", {
      p_tournament_id: tournament.id,
      p_request_token: requestToken,
      p_payer_name: payerName,
      p_payer_email: payerEmail,
      p_payer_phone: payerPhone,
      p_payer_cpf: payerCpf,
      p_entries: rpcEntries,
    });
    if (claimResult.error?.code === "P0001") {
      return json(request, { error: claimResult.error.message }, 409);
    }
    if (claimResult.error) throw claimResult.error;
    const claimed = record(claimResult.data);
    const claimedGroupSummary = record(claimed.registration_group);
    const groupLookup = await supabase.from("tournament_registration_groups")
      .select("*")
      .eq("id", claimedGroupSummary.id)
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
      billingType,
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? text((error as JsonRecord).code, 40)
      : "internal_error";
    console.error("tournament-register family failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível concluir a inscrição familiar.", code: failureStage }, 500);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const securityConfig = publicRegistrationSecurityConfig();
  if (request.method === "GET") {
    if (!securityConfig) {
      return json(request, { error: "As inscrições estão temporariamente indisponíveis." }, 503);
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
    const courtesyToken = text(payload.courtesy_token, 100);
    const gender = text(payload.gender, 20).toUpperCase();
    const availabilityDays = Array.isArray(payload.availability_days)
      ? payload.availability_days.map((day) => text(day, 20).toUpperCase()).filter(Boolean)
      : [];
    const city = nullableText(payload.city, 100);
    const partnerName = nullableText(payload.partner_name, 120);
    const notes = nullableText(payload.notes, 500);
    const billingType = normalizeBillingType(payload.payment_method);
    const trackingToken = text(payload.tracking_token, 80);
    const captchaToken = text(payload.captcha_token, 2048);
    const termsAccepted = payload.terms_accepted === true;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(categoryId)) {
      return json(request, { error: "Torneio ou categoria inválidos." }, 400);
    }
    if (fullName.length < 2) return json(request, { error: "Informe seu nome completo." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
    if (phone.length < 10 || phone.length > 13) return json(request, { error: "Informe um telefone válido com DDD." }, 400);
    if (submittedCpf && !isValidCpf(submittedCpf)) return json(request, { error: "Informe um CPF válido." }, 400);
    if (!allowedParticipantTypes.has(participantType)) return json(request, { error: "Escolha um tipo de inscrição válido." }, 400);
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
      .select("id,name,slug,status,registration_open,registration_opens_at,registration_closes_at,default_fee,allowed_payment_methods,is_published,courtesy_registration_token,settings")
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
    if (participantType === "COURTESY" && (!courtesyToken || courtesyToken !== String(tournament.courtesy_registration_token || ""))) {
      return json(request, { error: "Este link de inscrição isenta é inválido ou expirou." }, 403);
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

    failureStage = "athlete_upsert";
    const sourceKey = await publicAthleteSourceKey(email, phone);
    let { data: athlete, error: athleteError } = await supabase.from("tournament_athletes")
      .select("*")
      .eq("source_key", sourceKey)
      .maybeSingle();
    if (athleteError) throw athleteError;
    let registration: JsonRecord | null = null;
    let additionalRegistration: JsonRecord | null = null;
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
      if (registration && (!trackingToken || trackingToken !== String(registration.public_token))) {
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
      if (registration && (!trackingToken || trackingToken !== String(registration.public_token))) {
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
      const result = await supabase.rpc("claim_public_tournament_registration_bundle", {
        p_tournament_id: tournament.id,
        p_primary_category_id: category.id,
        p_additional_category_id: additionalCategory?.id || null,
        p_athlete_id: athlete.id,
        p_public_name: fullName,
        p_public_city: city,
        p_public_club: null,
        p_partner_name: partnerName,
        p_shirt_size: null,
        p_primary_amount: baseAmount,
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
    const paymentResult = await supabase.from("tournament_payments").select("*").eq("registration_id", registration.id).maybeSingle();
    if (paymentResult.error) throw paymentResult.error;
    let localPayment = paymentResult.data as JsonRecord | null;
    let ownsPaymentCreation = false;
    if (!localPayment) {
      const insert = await supabase.from("tournament_payments").insert({
        tournament_id: tournament.id,
        registration_id: registration.id,
        provider: "ASAAS",
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

    if (localPayment.provider_payment_id) {
      try {
        localPayment = await repairExistingPixPayment(supabase, localPayment);
      } catch (error) {
        console.warn("tournament-register PIX repair deferred", {
          payment_id: localPayment.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
      });
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
    const claimedPayment: JsonRecord = localPayment;
    failureStage = "asaas_payment";
    try {
      localPayment = await createOrRecoverPayment(supabase, claimedPayment, athlete, tournament, category, additionalCategory);
    } catch (error) {
      const providerError = providerErrorSnapshot(error);
      console.error("tournament-register provider failure", { stage: failureStage, ...providerError });
      const failedPayment = await supabase.from("tournament_payments").update({
        status: "FAILED",
        raw_response: { ...providerError, stage: failureStage },
        updated_at: new Date().toISOString(),
      }).eq("id", claimedPayment.id).select("*").single();
      if (failedPayment.error) throw failedPayment.error;
      return json(request, {
        registration: safeRegistration(registration),
        additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
        payment: safePayment(failedPayment.data as JsonRecord),
        tracking_token: registration.public_token,
        retryable: true,
        warning: "Sua inscrição foi salva, mas a cobrança não ficou pronta. Tente gerar o pagamento novamente.",
      }, 202);
    }

    return json(request, {
      registration: safeRegistration(registration),
      additional_registration: additionalRegistration ? safeRegistration(additionalRegistration) : null,
      payment: safePayment(localPayment),
      tracking_token: registration.public_token,
    }, 201);
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
