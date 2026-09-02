import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type JsonRecord = Record<string, unknown>;

const syntheticStagingRef = "ohndgphxtwhokekjyobu";
const syntheticStagingOrigin = "https://ilha-app-staging.vercel.app";

function isSyntheticStaging() {
  try {
    return new URL(Deno.env.get("SUPABASE_URL") || "").hostname === `${syntheticStagingRef}.supabase.co`;
  } catch (_error) {
    return false;
  }
}

const defaultAllowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);
if (isSyntheticStaging()) defaultAllowedOrigins.add(syntheticStagingOrigin);

function allowedOrigins() {
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

const configuredOrigins = allowedOrigins();

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": configuredOrigins?.has(origin) ? origin : origin ? "null" : "https://app.ilhatenis.com",
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

function text(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

type SecurityConfig = {
  rateLimitSalt: string;
};

function securityConfig(): SecurityConfig | null {
  const explicitlyEnabled = (Deno.env.get("TOURNAMENT_INTERNAL_REGISTRATION_ENABLED") || "")
    .trim()
    .toLowerCase() === "true";
  if (!explicitlyEnabled) return null;

  // This retired flow must never derive a public rate-limit secret from the
  // service-role credential. Re-enabling it requires an explicit, independent
  // secret and an audited origin allow-list.
  const rateLimitSalt = Deno.env.get("PUBLIC_REGISTRATION_RATE_LIMIT_SALT") || "";
  if (!configuredOrigins || rateLimitSalt.length < 32) return null;
  return { rateLimitSalt };
}

function trustedClientIp(request: Request) {
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
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeDatabaseMessage(error: JsonRecord) {
  const message = text(error.message, 220);
  const allowed = [
    "Informe o nome completo do atleta.",
    "Informe um telefone válido com DDD.",
    "Informe o nome e o telefone do responsável.",
    "Confirme a autorização de cobrança na próxima mensalidade.",
    "As inscrições deste torneio estão fechadas.",
    "Escolha uma ou duas classes.",
    "Uma das classes escolhidas não está disponível.",
  ];
  if (allowed.includes(message) || /^A classe .+ atingiu o limite de vagas\.$/.test(message)) return message;
  return "Não foi possível concluir a inscrição.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const requestOrigin = request.headers.get("origin") || "";
  if (requestOrigin && !configuredOrigins?.has(requestOrigin)) {
    return json(request, { error: "Origem não autorizada." }, 403);
  }
  const config = securityConfig();
  if (request.method === "GET") {
    if (!config) return json(request, { error: "As inscrições estão temporariamente indisponíveis." }, 503);
    return json(request, { captcha_provider: "none" });
  }
  if (request.method !== "POST") return json(request, { error: "Método inválido." }, 405);
  if (!config) return json(request, { error: "As inscrições estão temporariamente indisponíveis." }, 503);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 25000) {
    return json(request, { error: "Dados da inscrição muito grandes." }, 413);
  }

  let failureStage = "payload";
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 25000) {
      return json(request, { error: "Dados da inscrição muito grandes." }, 413);
    }
    let payload: JsonRecord;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_payload");
      payload = parsed as JsonRecord;
    } catch (_error) {
      return json(request, { error: "Dados da inscrição inválidos." }, 400);
    }

    const tournamentSlug = text(payload.tournament_slug, 100).toLowerCase();
    const fullName = text(payload.full_name, 120);
    const phone = digits(payload.phone);
    const isMinor = payload.is_minor === true;
    const guardianName = text(payload.guardian_name, 120);
    const guardianPhone = digits(payload.guardian_phone);
    const gender = text(payload.gender, 20).toUpperCase();
    const honeypot = text(payload.website, 200);
    const termsAccepted = payload.terms_accepted === true;
    const categoryIds = Array.isArray(payload.category_ids)
      ? Array.from(new Set(payload.category_ids.map((value) => text(value, 80)).filter(isUuid))).slice(0, 3)
      : [];

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentSlug)) {
      return json(request, { error: "Torneio inválido." }, 400);
    }
    if (fullName.length < 2) return json(request, { error: "Informe o nome completo do atleta." }, 400);
    if (phone.length < 10 || phone.length > 13) return json(request, { error: "Informe um telefone válido com DDD." }, 400);
    if (!['MALE', 'FEMALE'].includes(gender)) return json(request, { error: "Escolha o sexo." }, 400);
    if (categoryIds.length < 1 || categoryIds.length > 2) return json(request, { error: "Escolha uma ou duas classes." }, 400);
    if (isMinor && (guardianName.length < 2 || guardianPhone.length < 10 || guardianPhone.length > 13)) {
      return json(request, { error: "Informe o nome e o telefone do responsável." }, 400);
    }
    if (!termsAccepted) {
      return json(request, { error: "Confirme a autorização de cobrança na próxima mensalidade." }, 400);
    }
    if (honeypot) return json(request, { error: "Não foi possível concluir a inscrição." }, 400);

    failureStage = "database_setup";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = serviceRoleKey();
    if (!supabaseUrl || !supabaseKey) throw new Error("missing_database_config");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    failureStage = "network_rate_limit";
    const clientIp = trustedClientIp(request);
    const ipHash = clientIp ? await hmacSha256(config.rateLimitSalt, `ip:${clientIp}`) : null;
    const networkLimit = await supabase.rpc("consume_tournament_registration_network_rate_limits", { p_ip_hash: ipHash });
    if (networkLimit.error) throw networkLimit.error;
    const network = (Array.isArray(networkLimit.data) ? networkLimit.data[0] : networkLimit.data) as
      | { allowed?: boolean; retry_after_seconds?: number }
      | null;
    if (!network?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(network?.retry_after_seconds || 60)));
      return json(request, { error: "Muitas tentativas de inscrição. Aguarde um pouco e tente novamente." }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    failureStage = "category_gender_validation";
    const tournamentResult = await supabase.from("tournaments").select("id").eq("slug", tournamentSlug).maybeSingle();
    if (tournamentResult.error) throw tournamentResult.error;
    if (!tournamentResult.data?.id) return json(request, { error: "Torneio inválido." }, 400);
    const categoryResult = await supabase.from("tournament_categories").select("id,gender")
      .eq("tournament_id", tournamentResult.data.id).in("id", categoryIds);
    if (categoryResult.error) throw categoryResult.error;
    const allowedGenders = new Set([gender, "OPEN", "MIXED"]);
    if ((categoryResult.data || []).length !== categoryIds.length ||
      (categoryResult.data || []).some((category) => !allowedGenders.has(text(category.gender, 20).toUpperCase()))) {
      return json(request, { error: "Uma das classes escolhidas não está disponível para o sexo informado." }, 400);
    }

    failureStage = "identity_rate_limit";
    const identityHash = await hmacSha256(config.rateLimitSalt, `internal:${tournamentSlug}|${fullName.toLowerCase()}|${phone}`);
    const identityLimit = await supabase.rpc("consume_tournament_registration_identity_rate_limit", {
      p_identity_hash: identityHash,
    });
    if (identityLimit.error) throw identityLimit.error;
    const identity = (Array.isArray(identityLimit.data) ? identityLimit.data[0] : identityLimit.data) as
      | { allowed?: boolean; retry_after_seconds?: number }
      | null;
    if (!identity?.allowed) {
      const retryAfter = Math.max(1, Math.min(1800, Number(identity?.retry_after_seconds || 60)));
      return json(request, { error: "Muitas tentativas para estes dados. Aguarde um pouco e tente novamente." }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    failureStage = "registration";
    const result = await supabase.rpc("create_internal_tournament_registration", {
      p_tournament_slug: tournamentSlug,
      p_category_ids: categoryIds,
      p_full_name: fullName,
      p_phone: phone,
      p_is_minor: isMinor,
      p_guardian_name: isMinor ? guardianName : null,
      p_guardian_phone: isMinor ? guardianPhone : null,
      p_terms_accepted: true,
    });
    if (result.error) {
      const error = result.error as unknown as JsonRecord;
      const status = text(error.code, 20) === "23514" ? 409 : 500;
      return json(request, { error: safeDatabaseMessage(error), code: failureStage }, status);
    }
    const orderId = text(result.data?.order?.id, 80);
    if (!isUuid(orderId)) throw new Error("missing_registration_order");
    const orderResult = await supabase.from("tournament_registration_orders").select("athlete_id")
      .eq("id", orderId).maybeSingle();
    if (orderResult.error) throw orderResult.error;
    const athleteId = text(orderResult.data?.athlete_id, 80);
    if (!isUuid(athleteId)) throw new Error("missing_registration_athlete");
    const athleteUpdate = await supabase.from("tournament_athletes").update({ gender }).eq("id", athleteId);
    if (athleteUpdate.error) throw athleteUpdate.error;
    return json(request, result.data, result.data?.duplicate === true ? 200 : 201);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? text((error as JsonRecord).code, 40) : "internal_error";
    console.error("tournament-internal-register failure", { stage: failureStage, code });
    return json(request, { error: "Não foi possível concluir a inscrição.", code: failureStage }, 500);
  }
});
