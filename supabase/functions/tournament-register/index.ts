import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

const allowedBillingTypes = new Set(["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"]);
const retryablePaymentStatuses = new Set(["CREATED", "FAILED"]);

type JsonRecord = Record<string, unknown>;

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://app.ilhatenis.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
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

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const checksum = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(value[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return checksum(9) === Number(value[9]) && checksum(10) === Number(value[10]);
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    date >= new Date("1900-01-01T00:00:00Z") && date < new Date();
}

function normalizeBillingType(value: unknown) {
  const normalized = text(value || "PIX", 30).toUpperCase().replace(/[- ]/g, "_");
  if (normalized === "CARTAO" || normalized === "CARTAO_CREDITO" || normalized === "CARD") return "CREDIT_CARD";
  if (normalized === "ESCOLHER" || normalized === "ALL") return "UNDEFINED";
  return normalized;
}

function saoPauloDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  };
}

function asaasConfig() {
  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const configuredUrl = (Deno.env.get("ASAAS_BASE_URL") || "").replace(/\/+$/, "");
  const allowedUrls = new Set(["https://api-sandbox.asaas.com/v3", "https://api.asaas.com/v3"]);
  if (!apiKey || !allowedUrls.has(configuredUrl)) throw new Error("Configuração de pagamento indisponível.");
  return { apiKey, baseUrl: configuredUrl };
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
      const message = errors.map((item: JsonRecord) => text(item.description, 180)).filter(Boolean).join(" ") ||
        `Asaas respondeu com status ${response.status}.`;
      throw new Error(message);
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

async function ensureAsaasCustomer(supabase: ReturnType<typeof createClient>, athlete: JsonRecord) {
  if (athlete.asaas_customer_id) return String(athlete.asaas_customer_id);
  const cpf = String(athlete.cpf || "");
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
  supabase: ReturnType<typeof createClient>,
  localPayment: JsonRecord,
  providerPayment: JsonRecord,
) {
  const providerPaymentId = text(providerPayment.id, 100);
  if (!providerPaymentId) throw new Error("Cobrança sem identificador no Asaas.");
  let pix: JsonRecord = {};
  if (String(localPayment.billing_type) === "PIX") {
    pix = await asaasRequest(`/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`);
  }
  const update = {
    provider_payment_id: providerPaymentId,
    provider_customer_id: nullableText(providerPayment.customer, 100),
    status: mapAsaasPaymentStatus(providerPayment.status),
    invoice_url: nullableText(providerPayment.invoiceUrl || providerPayment.bankSlipUrl, 1000),
    pix_payload: nullableText(pix.payload, 4000),
    pix_encoded_image: nullableText(pix.encodedImage, 500000),
    pix_expires_at: nullableText(pix.expirationDate, 80),
    raw_response: { payment: providerPayment, pix },
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

async function createOrRecoverPayment(
  supabase: ReturnType<typeof createClient>,
  localPayment: JsonRecord,
  athlete: JsonRecord,
  tournament: JsonRecord,
  category: JsonRecord,
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
      description: `Inscrição ${tournament.name} · ${category.name}`.slice(0, 500),
      externalReference,
    }),
  });
  return await saveProviderPayment(supabase, { ...localPayment, provider_customer_id: customerId }, providerPayment);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 25000) return json(request, { error: "Dados da inscrição muito grandes." }, 413);

  let failureStage = "payload";
  try {
    const payload = await request.json().catch(() => null) as JsonRecord | null;
    if (!payload) return json(request, { error: "Dados da inscrição inválidos." }, 400);

    const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
    const categoryId = text(payload.category_id, 80);
    const fullName = text(payload.full_name, 120);
    const cpf = digits(payload.cpf);
    const birthDate = text(payload.birth_date, 10);
    const email = text(payload.email, 180).toLowerCase();
    const phone = digits(payload.phone);
    const city = nullableText(payload.city, 100);
    const club = nullableText(payload.club, 120);
    const shirtSize = nullableText(payload.shirt_size, 20);
    const partnerName = nullableText(payload.partner_name, 120);
    const notes = nullableText(payload.notes, 500);
    const billingType = normalizeBillingType(payload.payment_method);
    const trackingToken = text(payload.tracking_token, 80);
    const termsAccepted = payload.terms_accepted === true;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug) || !isUuid(categoryId)) {
      return json(request, { error: "Torneio ou categoria inválidos." }, 400);
    }
    if (fullName.length < 2) return json(request, { error: "Informe seu nome completo." }, 400);
    if (!validCpf(cpf)) return json(request, { error: "Informe um CPF válido." }, 400);
    if (!validBirthDate(birthDate)) return json(request, { error: "Informe uma data de nascimento válida." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(request, { error: "Informe um e-mail válido." }, 400);
    if (phone.length < 10 || phone.length > 13) return json(request, { error: "Informe um telefone válido com DDD." }, 400);
    if (!termsAccepted) return json(request, { error: "Confirme os dados e a autorização para realizar a inscrição." }, 400);
    if (!allowedBillingTypes.has(billingType)) return json(request, { error: "Forma de pagamento inválida." }, 400);

    failureStage = "database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("Configuração do Supabase ausente.");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "tournament_lookup";
    const { data: tournament, error: tournamentError } = await supabase.from("tournaments")
      .select("id,name,slug,status,registration_open,registration_opens_at,registration_closes_at,default_fee,allowed_payment_methods,is_published")
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
      .select("id,tournament_id,name,event_type,registration_fee,registration_open,max_entries,active")
      .eq("id", categoryId)
      .eq("tournament_id", tournament.id)
      .maybeSingle();
    if (categoryError) throw categoryError;
    if (!category || !category.active || !category.registration_open) {
      return json(request, { error: "Esta categoria não está recebendo inscrições." }, 409);
    }
    if (category.event_type === "DOUBLES" && !partnerName) {
      return json(request, { error: "Informe o nome da dupla para esta categoria." }, 400);
    }
    const allowedMethods = Array.isArray(tournament.allowed_payment_methods)
      ? tournament.allowed_payment_methods.map((item: unknown) => String(item).toUpperCase())
      : ["PIX", "BOLETO", "CREDIT_CARD"];
    if (billingType === "UNDEFINED") {
      const canChoose = allowedMethods.includes("UNDEFINED") ||
        ["PIX", "BOLETO", "CREDIT_CARD"].filter((method) => allowedMethods.includes(method)).length > 1;
      if (!canChoose) return json(request, { error: "Escolha uma forma de pagamento disponível." }, 400);
    }
    if (!allowedMethods.includes(billingType)) {
      return json(request, { error: "Esta forma de pagamento não está disponível no torneio." }, 400);
    }
    const amount = Math.max(0, Number(category.registration_fee ?? tournament.default_fee ?? 0));

    failureStage = "athlete_upsert";
    let { data: athlete, error: athleteError } = await supabase.from("tournament_athletes")
      .select("*")
      .eq("cpf", cpf)
      .maybeSingle();
    if (athleteError) throw athleteError;
    const athleteValues = {
      full_name: fullName,
      email,
      phone,
      cpf,
      birth_date: birthDate,
      city,
      club_name: club,
      active: true,
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
    };
    if (athlete) {
      if (String(athlete.birth_date || "") !== birthDate) {
        return json(request, { error: "Os dados informados não conferem com o cadastro deste CPF." }, 409);
      }
    } else {
      const result = await supabase.from("tournament_athletes").insert(athleteValues).select("*").single();
      if (result.error?.code === "23505") {
        const retry = await supabase.from("tournament_athletes").select("*").eq("cpf", cpf).single();
        if (retry.error) throw retry.error;
        if (String(retry.data.birth_date || "") !== birthDate) {
          return json(request, { error: "Os dados informados não conferem com o cadastro deste CPF." }, 409);
        }
        athlete = retry.data;
      } else if (result.error) throw result.error;
      else athlete = result.data;
    }

    failureStage = "registration_lookup";
    let registrationResult = await supabase.from("tournament_registrations")
      .select("*")
      .eq("tournament_id", tournament.id)
      .eq("category_id", category.id)
      .eq("athlete_id", athlete.id)
      .maybeSingle();
    if (registrationResult.error) throw registrationResult.error;
    let registration = registrationResult.data as JsonRecord | null;
    if (registration && (!trackingToken || trackingToken !== String(registration.public_token))) {
      return json(request, { error: "Já existe uma inscrição deste CPF nesta categoria. Use o acompanhamento enviado na primeira inscrição." }, 409);
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
          payment: safePayment(existingPayment.data as JsonRecord | null),
          tracking_token: registration.public_token,
        });
      }
    } else {
      failureStage = "registration_capacity";
      const result = await supabase.rpc("tournament_claim_public_registration", {
        p_tournament_id: tournament.id,
        p_category_id: category.id,
        p_athlete_id: athlete.id,
        p_public_name: fullName,
        p_public_city: city,
        p_public_club: club,
        p_partner_name: partnerName,
        p_shirt_size: shirtSize,
        p_total_amount: amount,
        p_notes: notes,
      });
      if (result.error?.code === "23505") {
        return json(request, { error: "Esta inscrição já está sendo processada. Aguarde alguns segundos e use o acompanhamento da primeira solicitação." }, 409);
      }
      if (result.error) throw result.error;
      registration = (Array.isArray(result.data) ? result.data[0] : result.data) as JsonRecord | null;
    }
    if (!registration) throw new Error("Não foi possível preparar a inscrição.");
    const registrationStatus = String(registration.status);

    if (registrationStatus === "WAITLIST" || amount === 0) {
      return json(request, {
        registration: safeRegistration(registration),
        payment: null,
        tracking_token: registration.public_token,
      }, 201);
    }

    failureStage = "payment_claim";
    const externalReference = `tournament-registration:${registration.id}`;
    let paymentResult = await supabase.from("tournament_payments").select("*").eq("registration_id", registration.id).maybeSingle();
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

    if (localPayment.provider_payment_id || !retryablePaymentStatuses.has(String(localPayment.status))) {
      return json(request, {
        registration: safeRegistration(registration),
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
        payment: safePayment(localPayment),
        tracking_token: registration.public_token,
      }, 409);
    }

    failureStage = "asaas_payment";
    try {
      localPayment = await createOrRecoverPayment(supabase, localPayment, athlete, tournament, category);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao criar cobrança.";
      const failedPayment = await supabase.from("tournament_payments").update({
        status: "FAILED",
        raw_response: { error: message.slice(0, 500), stage: failureStage },
        updated_at: new Date().toISOString(),
      }).eq("id", localPayment.id).select("*").single();
      if (failedPayment.error) throw failedPayment.error;
      return json(request, {
        registration: safeRegistration(registration),
        payment: safePayment(failedPayment.data as JsonRecord),
        tracking_token: registration.public_token,
        retryable: true,
        warning: "Sua inscrição foi salva, mas a cobrança não ficou pronta. Tente gerar o pagamento novamente.",
      }, 202);
    }

    return json(request, {
      registration: safeRegistration(registration),
      payment: safePayment(localPayment),
      tracking_token: registration.public_token,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("tournament-register failure", { stage: failureStage, message });
    const publicMessage = failureStage === "asaas_payment"
      ? "A inscrição foi salva, mas não foi possível gerar a cobrança agora. Tente novamente."
      : "Não foi possível concluir a inscrição.";
    return json(request, { error: publicMessage, code: failureStage }, 500);
  }
});
