import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";
import { derivePredictionAccessCode, sendPredictionAccessEmail } from "../_shared/prediction-access-email.ts";

type Row = Record<string, any>;
type DbClient = SupabaseClient<any, "public", "public", any>;

class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number | null;

  constructor(message: string, status = 400, code = "invalid_request", retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const defaultAllowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "https://ilha-app-staging.vercel.app",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);
const syntheticStagingRef = "ohndgphxtwhokekjyobu";
const cloudflareTestSiteKey = "1x00000000000000000000AA";
const cloudflareTestSecretKey = "1x0000000000000000000000000000000AA";
const accessCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function configuredOrigins() {
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

const allowedOrigins = configuredOrigins();

function corsHeaders(request: Request) {
  return appCorsHeaders(request, "GET, POST, OPTIONS");
}

function json(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function uuid(value: unknown) {
  const candidate = text(value, 40).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)
    ? candidate
    : "";
}

function serviceRoleKey() {
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys);
      if (parsed.default) return String(parsed.default);
    } catch (_error) {
      if (currentKeys.startsWith("sb_secret_")) return currentKeys;
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

type SecurityConfig = {
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  turnstileAllowedHostnames: Set<string>;
  rateLimitSalt: string;
};

function securityConfig(): SecurityConfig | null {
  const turnstileSiteKey = (Deno.env.get("TURNSTILE_SITE_KEY") || "").trim();
  const turnstileSecretKey = (Deno.env.get("TURNSTILE_SECRET_KEY") || "").trim();
  const rateLimitSalt = Deno.env.get("PUBLIC_REGISTRATION_RATE_LIMIT_SALT") || "";
  const turnstileAllowedHostnames = new Set(
    (Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES") || "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter((hostname) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)),
  );
  if (!allowedOrigins || !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSiteKey) ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(turnstileSecretKey) || rateLimitSalt.length < 32 ||
    turnstileAllowedHostnames.size === 0) return null;
  return { turnstileSiteKey, turnstileSecretKey, turnstileAllowedHostnames, rateLimitSalt };
}

function isSyntheticStagingProject() {
  try {
    return new URL(Deno.env.get("SUPABASE_URL") || "").hostname === `${syntheticStagingRef}.supabase.co`;
  } catch (_error) {
    return false;
  }
}

function trustedClientIp(request: Request) {
  const candidate = text(request.headers.get("cf-connecting-ip"), 64).toLowerCase();
  if (!candidate || (!candidate.includes(".") && !candidate.includes(":"))) return "unknown";
  return /^[0-9a-f:.]+$/i.test(candidate) ? candidate : "unknown";
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

async function verifyTurnstile(request: Request, token: string, config: SecurityConfig) {
  const form = new FormData();
  form.set("secret", config.turnstileSecretKey);
  form.set("response", token);
  const ip = trustedClientIp(request);
  if (ip !== "unknown") form.set("remoteip", ip);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError("A proteção anti-robô está indisponível. Tente novamente.", 503, "captcha_unavailable");
    const outcome = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const testKeys = isSyntheticStagingProject() && config.turnstileSiteKey === cloudflareTestSiteKey &&
      config.turnstileSecretKey === cloudflareTestSecretKey;
    if (testKeys) return outcome.success === true;
    return outcome.success === true && outcome.action === "palpite_ilha" &&
      config.turnstileAllowedHostnames.has(String(outcome.hostname || "").toLowerCase());
  } finally {
    clearTimeout(timeout);
  }
}

function assertAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins?.has(origin)) {
    throw new ApiError("Origem não autorizada.", 403, "origin_denied");
  }
}

async function consumeRateLimit(
  client: DbClient,
  request: Request,
  config: SecurityConfig,
  scope: "snapshot" | "register" | "resume" | "state" | "predict",
  identity = "",
) {
  const limits = {
    snapshot: [180, 60],
    register: [12, 600],
    resume: [20, 600],
    state: [120, 60],
    predict: [90, 60],
  } as const;
  const [limit, windowSeconds] = limits[scope];
  const keyHash = await hmacSha256(config.rateLimitSalt, `${scope}:${trustedClientIp(request)}:${identity}`);
  const result = await client.rpc("consume_tournament_prediction_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.allowed) {
    const reportedRetryAfter = Number(row?.retry_after_seconds);
    const retryAfterSeconds = Number.isFinite(reportedRetryAfter)
      ? Math.max(1, Math.min(windowSeconds, Math.ceil(reportedRetryAfter)))
      : windowSeconds;
    throw new ApiError(
      `Muitas tentativas. Tente novamente em ${retryAfterSeconds} segundo${retryAfterSeconds === 1 ? "" : "s"}.`,
      429,
      "rate_limited",
      retryAfterSeconds,
    );
  }
}

function normalizeEmail(value: unknown) {
  const email = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ApiError("Informe um e-mail válido.", 400, "invalid_email");
  }
  return email;
}

function normalizePhone(value: unknown) {
  const phone = digits(value);
  if (phone.length < 10 || phone.length > 13) {
    throw new ApiError("Informe um telefone válido com DDD.", 400, "invalid_phone");
  }
  return phone;
}

function normalizeName(value: unknown) {
  const name = text(value, 120);
  if (name.length < 3 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) {
    throw new ApiError("Informe seu nome.", 400, "invalid_name");
  }
  return name;
}

function publicName(fullName: string) {
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1).toUpperCase()}.`;
}

function normalizeAccessCode(value: unknown) {
  const code = text(value, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 10 || [...code].some((character) => !accessCodeAlphabet.includes(character))) {
    throw new ApiError("Código de acesso inválido.", 401, "invalid_access");
  }
  return code;
}

function accessCodeHash(config: SecurityConfig, code: string) {
  return hmacSha256(config.rateLimitSalt, `palpite-access:${code}`);
}

function asIsoFromMatch(match: Row, tournament: Row) {
  if (match.scheduled_at) return String(match.scheduled_at);
  if (!match.match_date || !match.match_time) return "";
  const timezone = String(tournament.timezone || "America/Sao_Paulo");
  const offset = timezone === "America/Sao_Paulo" ? "-03:00" : "";
  return `${match.match_date}T${String(match.match_time).slice(0, 8)}${offset}`;
}

function predictionWindow(match: Row, tournament: Row) {
  const timezone = String(tournament.timezone || "America/Sao_Paulo");
  const offset = timezone === "America/Sao_Paulo" ? "-03:00" : "";
  const scheduledAt = asIsoFromMatch(match, tournament);
  const reference = scheduledAt || (match.match_date ? `${match.match_date}T00:00:00${offset}` : "");
  const referenceMs = reference ? new Date(reference).getTime() : Number.NaN;
  return {
    scheduledAt,
    opensAt: Number.isFinite(referenceMs) ? new Date(referenceMs - 24 * 60 * 60 * 1000).toISOString() : "",
  };
}

function isMatchLocked(match: Row, tournament: Row) {
  const status = String(match.status || "").toUpperCase();
  if (!["PENDING", "SCHEDULED"].includes(status) || match.started_at || match.finished_at || match.winner_athlete_id) return true;
  const window = predictionWindow(match, tournament);
  if (!window.opensAt || Date.now() < new Date(window.opensAt).getTime()) return true;
  return window.scheduledAt ? new Date(window.scheduledAt).getTime() <= Date.now() : false;
}

function matchLockReason(match: Row, tournament: Row) {
  const window = predictionWindow(match, tournament);
  if (window.opensAt && Date.now() < new Date(window.opensAt).getTime()) return "UPCOMING";
  return isMatchLocked(match, tournament) ? "CLOSED" : null;
}

function campaignAcceptsPredictions(campaign: Row) {
  const now = Date.now();
  const opensAt = campaign.opens_at ? new Date(campaign.opens_at).getTime() : null;
  const closesAt = campaign.closes_at ? new Date(campaign.closes_at).getTime() : null;
  return campaign.status === "OPEN" && campaign.published === true &&
    (opensAt === null || Number.isNaN(opensAt) || now >= opensAt) &&
    (closesAt === null || Number.isNaN(closesAt) || now < closesAt);
}

function pointsForMatch(match: Row, campaign: Row) {
  const phase = String(match.round_code || match.phase || "").toUpperCase();
  if (phase === "FINAL" || phase === "F") return Number(campaign.final_points || 3);
  if (["SF", "SEMIFINAL", "SEMI_FINAL"].includes(phase)) return Number(campaign.semifinal_points || 2);
  return Number(campaign.initial_round_points || 1);
}

function isSettledMatch(match: Row | undefined): match is Row {
  const status = String(match?.status || "").toUpperCase();
  return Boolean(match?.winner_athlete_id) && ["FINISHED", "WALKOVER"].includes(status);
}

function assertNoError(error: Row | null) {
  if (error) throw error;
}

async function selectCampaign(client: DbClient, tournamentSlug: string) {
  let tournament: Row | null = null;
  if (tournamentSlug) {
    const tournamentResult = await client.from("tournaments").select("id,name,slug,logo_url,cover_url,status,is_published,starts_on,ends_on,timezone")
      .eq("slug", tournamentSlug).eq("is_published", true).neq("status", "ARCHIVED").maybeSingle();
    assertNoError(tournamentResult.error);
    tournament = tournamentResult.data as Row | null;
    if (!tournament) return { campaign: null, tournament: null };
  }

  let campaignQuery = client.from("tournament_prediction_campaigns").select("*")
    .eq("published", true)
    .in("status", ["OPEN", "LOCKED", "FINISHED"]);
  if (tournament) campaignQuery = campaignQuery.eq("tournament_id", tournament.id);
  const campaignResult = await campaignQuery.order("created_at", { ascending: false }).limit(20);
  assertNoError(campaignResult.error);
  const rows = (campaignResult.data || []) as Row[];
  const orderedCampaigns = [
    ...rows.filter((row) => row.status === "OPEN"),
    ...rows.filter((row) => row.status === "LOCKED"),
    ...rows.filter((row) => !["OPEN", "LOCKED"].includes(String(row.status))),
  ];
  if (!orderedCampaigns.length) return { campaign: null, tournament: null };

  if (tournament) return { campaign: orderedCampaigns[0], tournament };

  const tournamentIds = [...new Set(orderedCampaigns.map((row) => row.tournament_id).filter(Boolean))];
  if (tournamentIds.length) {
    const tournamentResult = await client.from("tournaments").select("id,name,slug,logo_url,cover_url,status,is_published,starts_on,ends_on,timezone")
      .in("id", tournamentIds).eq("is_published", true).neq("status", "ARCHIVED");
    assertNoError(tournamentResult.error);
    const tournaments = new Map(((tournamentResult.data || []) as Row[]).map((row) => [String(row.id), row]));
    const campaign = orderedCampaigns.find((row) => tournaments.has(String(row.tournament_id))) || null;
    if (campaign) tournament = tournaments.get(String(campaign.tournament_id)) || null;
    if (campaign && tournament) return { campaign, tournament };
  }
  return { campaign: null, tournament: null };
}

function calculateRanking(entries: Row[], predictions: Row[], matchMap: Map<string, Row>, campaign: Row) {
  return entries.filter((entry) => entry.status === "ACTIVE").map((entry) => {
    const entryPredictions = predictions.filter((prediction) => prediction.entry_id === entry.id);
    let score = 0;
    let correct = 0;
    let settled = 0;
    for (const prediction of entryPredictions) {
      const match = matchMap.get(String(prediction.match_id));
      if (!isSettledMatch(match) || ![match?.side1_athlete_id, match?.side2_athlete_id].includes(prediction.predicted_winner_athlete_id)) continue;
      settled += 1;
      if (prediction.predicted_winner_athlete_id === match.winner_athlete_id) {
        correct += 1;
        score += pointsForMatch(match, campaign);
      }
    }
    return {
      entry_id: entry.id,
      name: entry.public_name,
      score,
      correct,
      settled,
      predictions: entryPredictions.length,
      joined_at: entry.created_at,
    };
  }).sort((left, right) => right.score - left.score || right.settled - left.settled ||
    String(left.joined_at).localeCompare(String(right.joined_at)) || String(left.entry_id).localeCompare(String(right.entry_id)))
    .map((row, index) => ({ ...row, position: index + 1 }));
}

async function authenticatedEntry(client: DbClient, config: SecurityConfig, campaignId: string, entryIdValue: unknown, accessCodeValue: unknown) {
  const entryId = uuid(entryIdValue);
  const code = normalizeAccessCode(accessCodeValue);
  if (!entryId) throw new ApiError("Acesso não encontrado neste aparelho.", 401, "invalid_access");
  const hash = await accessCodeHash(config, code);
  const result = await client.from("tournament_prediction_entries").select("*")
    .eq("id", entryId).eq("campaign_id", campaignId).eq("access_code_hash", hash).maybeSingle();
  assertNoError(result.error);
  if (!result.data) throw new ApiError("Código ou cadastro não encontrado.", 401, "invalid_access");
  if (result.data.status !== "ACTIVE") throw new ApiError("Este cadastro está bloqueado. Fale com a organização.", 403, "entry_blocked");
  return { entry: result.data as Row, hash, code };
}

async function loadSnapshot(client: DbClient, tournamentSlug: string, participant?: { entry: Row }) {
  const selected = await selectCampaign(client, tournamentSlug);
  if (!selected.campaign || !selected.tournament) return { available: false };
  const { campaign, tournament } = selected;
  const [categoryResult, matchResult, entryResult, predictionResult] = await Promise.all([
    client.from("tournament_categories").select("id,name,sort_order").eq("tournament_id", tournament.id)
      .eq("active", true).eq("is_published", true).order("sort_order").order("name"),
    client.from("tournament_matches").select("id,category_id,round_no,round_code,phase,match_no,side1_athlete_id,side2_athlete_id,winner_athlete_id,score,court_name,match_date,match_time,scheduled_at,started_at,finished_at,status,sort_order,published")
      .eq("tournament_id", tournament.id).eq("published", true).order("sort_order").order("round_no").order("match_no"),
    client.from("tournament_prediction_entries").select("id,public_name,status,created_at").eq("campaign_id", campaign.id),
    client.from("tournament_predictions").select("id,entry_id,match_id,predicted_winner_athlete_id,created_at,updated_at").eq("campaign_id", campaign.id),
  ]);
  [categoryResult.error, matchResult.error, entryResult.error, predictionResult.error].forEach(assertNoError);
  const matches = ((matchResult.data || []) as Row[]).filter((match) => match.side1_athlete_id && match.side2_athlete_id);
  const athleteIds = [...new Set(matches.flatMap((match) => [match.side1_athlete_id, match.side2_athlete_id, match.winner_athlete_id]).filter(Boolean))];
  const athleteResult = athleteIds.length
    ? await client.from("tournament_athletes").select("id,full_name,nickname").in("id", athleteIds)
    : { data: [], error: null };
  assertNoError(athleteResult.error as Row | null);
  const athleteMap = new Map(((athleteResult.data || []) as Row[]).map((athlete) => [String(athlete.id), athlete]));
  const matchMap = new Map(matches.map((match) => [String(match.id), match]));
  const entries = (entryResult.data || []) as Row[];
  const activeEntryIds = new Set(entries.filter((entry) => entry.status === "ACTIVE").map((entry) => String(entry.id)));
  const predictions = ((predictionResult.data || []) as Row[])
    .filter((prediction) => activeEntryIds.has(String(prediction.entry_id)));
  const totals = new Map<string, { total: number; side1: number; side2: number }>();
  for (const prediction of predictions) {
    const match = matchMap.get(String(prediction.match_id));
    if (!match) continue;
    const total = totals.get(match.id) || { total: 0, side1: 0, side2: 0 };
    total.total += 1;
    if (prediction.predicted_winner_athlete_id === match.side1_athlete_id) total.side1 += 1;
    if (prediction.predicted_winner_athlete_id === match.side2_athlete_id) total.side2 += 1;
    totals.set(match.id, total);
  }
  const ranking = calculateRanking(entries, predictions, matchMap, campaign);
  const ownPredictions = participant
    ? predictions.filter((prediction) => prediction.entry_id === participant.entry.id)
      .map((prediction) => ({ match_id: prediction.match_id, winner_athlete_id: prediction.predicted_winner_athlete_id, updated_at: prediction.updated_at }))
    : [];
  const acceptingPredictions = campaignAcceptsPredictions(campaign);
  return {
    available: true,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      logo_url: tournament.logo_url,
      cover_url: tournament.cover_url,
      starts_on: tournament.starts_on,
      ends_on: tournament.ends_on,
    },
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      opens_at: campaign.opens_at,
      closes_at: campaign.closes_at,
      rules_version: campaign.rules_version,
      rules_text: campaign.rules_text,
      initial_round_points: campaign.initial_round_points,
      semifinal_points: campaign.semifinal_points,
      final_points: campaign.final_points,
      prize: campaign.prize_enabled ? campaign.prize_description : null,
      finalized: campaign.status === "FINISHED",
      accepting_predictions: acceptingPredictions,
    },
    categories: categoryResult.data || [],
    matches: matches.map((match) => {
      const side1 = athleteMap.get(String(match.side1_athlete_id));
      const side2 = athleteMap.get(String(match.side2_athlete_id));
      const total = totals.get(match.id) || { total: 0, side1: 0, side2: 0 };
      const window = predictionWindow(match, tournament);
      return {
        id: match.id,
        category_id: match.category_id,
        round_no: match.round_no,
        phase: match.round_code || match.phase,
        match_no: match.match_no,
        side1: { id: match.side1_athlete_id, name: side1?.nickname || side1?.full_name || "Atleta 1", picks: total.side1 },
        side2: { id: match.side2_athlete_id, name: side2?.nickname || side2?.full_name || "Atleta 2", picks: total.side2 },
        total_picks: total.total,
        winner_athlete_id: match.winner_athlete_id,
        score: match.score,
        court_name: match.court_name,
        match_date: match.match_date,
        match_time: match.match_time ? String(match.match_time).slice(0, 5) : null,
        scheduled_at: asIsoFromMatch(match, tournament) || null,
        prediction_opens_at: window.opensAt || null,
        status: match.status,
        locked: !acceptingPredictions || isMatchLocked(match, tournament),
        lock_reason: acceptingPredictions ? matchLockReason(match, tournament) : "CLOSED",
        points: pointsForMatch(match, campaign),
      };
    }),
    ranking: ranking.map(({ entry_id: _entryId, joined_at: _joinedAt, ...row }) => row),
    participant: participant ? {
      id: participant.entry.id,
      name: participant.entry.full_name,
      public_name: participant.entry.public_name,
      status: participant.entry.status,
      predictions: ownPredictions,
      ranking: ranking.find((row) => row.entry_id === participant.entry.id) || null,
    } : null,
  };
}

function databaseMessage(error: unknown) {
  return String((error as Row)?.message || "");
}

function mapDatabaseError(error: unknown): never {
  const message = databaseMessage(error);
  if (message.includes("campaign_closed")) throw new ApiError("Os palpites estão fechados para este torneio.", 409, "campaign_closed");
  if (message.includes("campaign_not_found")) throw new ApiError("Palpite Ilha não encontrado.", 404, "campaign_not_found");
  if (message.includes("invalid_access")) throw new ApiError("Código ou cadastro não encontrado.", 401, "invalid_access");
  if (message.includes("entry_blocked")) throw new ApiError("Este cadastro está bloqueado. Fale com a organização.", 403, "entry_blocked");
  if (message.includes("match_unavailable")) throw new ApiError("Este jogo ainda não está disponível para palpite.", 409, "match_unavailable");
  if (message.includes("prediction_locked")) throw new ApiError("O jogo já começou ou o horário do palpite encerrou.", 409, "prediction_locked");
  if (message.includes("prediction_not_open")) throw new ApiError("Este jogo abre para palpites 24 horas antes do horário marcado.", 409, "prediction_not_open");
  if (message.includes("request_conflict")) {
    throw new ApiError("Esta tentativa já foi usada com dados diferentes. Revise os dados e tente novamente.", 409, "request_conflict");
  }
  if (message.includes("registration_conflict")) {
    throw new ApiError("Este cadastro pendente foi alterado. Confira os dados e envie novamente.", 409, "request_conflict");
  }
  if (String((error as Row)?.code || "") === "23505") {
    throw new ApiError("Não foi possível criar outro cadastro com estes dados. Use “Já tenho código” ou fale com a organização.", 409, "identity_exists");
  }
  throw error;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  let stage = "bootstrap";
  try {
    assertAllowedOrigin(request);
    const config = securityConfig();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = serviceRoleKey();
    if (!config || !supabaseUrl || !serviceKey) {
      throw new ApiError("O Palpite Ilha está temporariamente indisponível.", 503, "not_configured");
    }
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.searchParams.get("config") === "1") {
        return json(request, { ok: true, captcha: { provider: "turnstile", site_key: config.turnstileSiteKey, action: "palpite_ilha" } });
      }
      const tournamentSlug = text(url.searchParams.get("torneio") || url.searchParams.get("slug"), 100).toLowerCase();
      stage = "snapshot";
      await consumeRateLimit(client, request, config, "snapshot", tournamentSlug);
      return json(request, { ok: true, data: await loadSnapshot(client, tournamentSlug) });
    }

    if (request.method !== "POST") throw new ApiError("Método não permitido.", 405, "method_not_allowed");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 24_000) throw new ApiError("Dados muito grandes.", 413, "payload_too_large");
    let payload: Row;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      payload = parsed;
    } catch (_error) {
      throw new ApiError("Dados inválidos.", 400, "invalid_json");
    }
    const action = text(payload.action, 20).toLowerCase();
    const tournamentSlug = text(payload.tournament_slug || payload.torneio || payload.slug, 100).toLowerCase();
    const selected = await selectCampaign(client, tournamentSlug);
    if (!selected.campaign) throw new ApiError("O Palpite Ilha ainda não está disponível.", 404, "campaign_not_found");
    const campaign = selected.campaign;

    if (action === "register") {
      stage = "register";
      const fullName = normalizeName(payload.full_name || payload.name);
      const email = normalizeEmail(payload.email);
      const phone = normalizePhone(payload.phone);
      const requestId = uuid(payload.request_id);
      if (!requestId || payload.consent !== true) throw new ApiError("Confirme as regras e o uso dos dados para participar.", 400, "consent_required");
      await consumeRateLimit(client, request, config, "register", await hmacSha256(config.rateLimitSalt, `${email}:${phone}`));
      if (!await verifyTurnstile(request, text(payload.captcha_token, 2048), config)) {
        throw new ApiError("Confirme a proteção anti-robô e tente novamente.", 400, "captcha_failed");
      }
      const accessCode = await derivePredictionAccessCode(config.rateLimitSalt, requestId);
      const accessHash = await accessCodeHash(config, accessCode);
      let result;
      try {
        result = await client.rpc("register_tournament_prediction_entry", {
          p_campaign_id: campaign.id,
          p_request_id: requestId,
          p_full_name: fullName,
          p_public_name: publicName(fullName),
          p_email: email,
          p_phone: phone,
          p_access_code_hash: accessHash,
        });
        if (result.error) mapDatabaseError(result.error);
      } catch (error) {
        mapDatabaseError(error);
      }
      const entry = (Array.isArray(result!.data) ? result!.data[0] : result!.data) as Row;
      if (!entry?.id) throw new ApiError("Não foi possível concluir o cadastro.", 500, "registration_failed");
      const participant = { entry };
      let emailDelivery: Row = { status: "NOT_CONFIGURED" };
      try {
        emailDelivery = await sendPredictionAccessEmail(client, entry, campaign, selected.tournament || {}, accessCode);
      } catch (emailError) {
        console.error("bet-public-api access email failure", {
          stage: "access_email",
          code: text((emailError as Row)?.code || "email_delivery_failed", 80),
        });
        emailDelivery = { status: "FAILED" };
      }
      return json(request, {
        ok: true,
        access: { entry_id: entry.id, access_code: accessCode },
        email_delivery: emailDelivery,
        data: await loadSnapshot(client, tournamentSlug, participant),
      }, 201);
    }

    if (action === "resume") {
      stage = "resume";
      const email = normalizeEmail(payload.email);
      const code = normalizeAccessCode(payload.access_code);
      await consumeRateLimit(client, request, config, "resume", await hmacSha256(config.rateLimitSalt, email));
      if (!await verifyTurnstile(request, text(payload.captcha_token, 2048), config)) {
        throw new ApiError("Confirme a proteção anti-robô e tente novamente.", 400, "captcha_failed");
      }
      const hash = await accessCodeHash(config, code);
      const result = await client.from("tournament_prediction_entries").select("*")
        .eq("campaign_id", campaign.id).eq("email", email).eq("access_code_hash", hash).maybeSingle();
      assertNoError(result.error);
      if (!result.data) throw new ApiError("E-mail ou código não encontrado.", 401, "invalid_access");
      if (result.data.status !== "ACTIVE") throw new ApiError("Este cadastro está bloqueado. Fale com a organização.", 403, "entry_blocked");
      await client.from("tournament_prediction_entries").update({ last_seen_at: new Date().toISOString() }).eq("id", result.data.id);
      return json(request, {
        ok: true,
        access: { entry_id: result.data.id, access_code: code },
        data: await loadSnapshot(client, tournamentSlug, { entry: result.data as Row }),
      });
    }

    if (action === "state" || action === "predict") {
      stage = action;
      const authenticated = await authenticatedEntry(client, config, campaign.id, payload.entry_id, payload.access_code);
      await consumeRateLimit(client, request, config, action, authenticated.entry.id);
      if (action === "predict") {
        const matchId = uuid(payload.match_id);
        const winnerId = uuid(payload.winner_athlete_id);
        const requestId = uuid(payload.request_id);
        if (!matchId || !winnerId || !requestId) throw new ApiError("Palpite inválido.", 400, "invalid_prediction");
        const result = await client.rpc("save_tournament_prediction", {
          p_campaign_id: campaign.id,
          p_entry_id: authenticated.entry.id,
          p_access_code_hash: authenticated.hash,
          p_match_id: matchId,
          p_predicted_winner_athlete_id: winnerId,
          p_request_id: requestId,
        });
        if (result.error) mapDatabaseError(result.error);
      }
      return json(request, { ok: true, data: await loadSnapshot(client, tournamentSlug, authenticated) });
    }

    throw new ApiError("Ação inválida.", 400, "invalid_action");
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError("Não foi possível concluir agora.", 500, "internal_error");
    console.error("bet-public-api failure", { stage, code: apiError.code });
    const retryAfterSeconds = apiError.status === 429 ? apiError.retryAfterSeconds : null;
    return json(
      request,
      {
        ok: false,
        error: apiError.message,
        code: apiError.code,
        ...(retryAfterSeconds ? { retry_after_seconds: retryAfterSeconds } : {}),
      },
      apiError.status,
      retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds), "Access-Control-Expose-Headers": "Retry-After" }
        : {},
    );
  }
});
