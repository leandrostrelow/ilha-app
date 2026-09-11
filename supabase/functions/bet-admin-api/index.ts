import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";

type Row = Record<string, any>;
type DbClient = SupabaseClient<any, "public", "public", any>;

class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const permissions = new Set(["tournaments", "tournaments.read", "tournaments.write"]);
const writePermissions = new Set(["tournaments", "tournaments.write"]);

function corsHeaders(request: Request) {
  return appCorsHeaders(request, "GET, POST, OPTIONS");
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function nullableText(value: unknown, max = 500) {
  return text(value, max) || null;
}

function uuid(value: unknown) {
  const candidate = text(value, 40).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)
    ? candidate
    : "";
}

function boolean(value: unknown, fallback = false) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function boundedInteger(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new ApiError("A pontuação de cada fase deve ficar entre 1 e 20.", 400, "invalid_points");
  }
  return parsed;
}

function serviceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const current = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  try {
    const parsed = JSON.parse(current);
    return String(parsed.default || "");
  } catch (_error) {
    return current.startsWith("sb_secret_") ? current : "";
  }
}

function publicApiKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const current = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  try {
    const parsed = JSON.parse(current);
    return String(parsed.default || "");
  } catch (_error) {
    return current.startsWith("sb_publishable_") ? current : "";
  }
}

function permissionList(profile: Row) {
  return Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
}

function can(profile: Row, accepted: Set<string>) {
  if (!profile || profile.active === false) return false;
  if (profile.role === "admin") return true;
  return permissionList(profile).some((permission) => accepted.has(permission));
}

function protectedCan(profile: Row, protectedAccount: Row, accepted: Set<string>) {
  if (!profile || profile.active === false || !protectedAccount || protectedAccount.active === false) return false;
  if (profile.role !== protectedAccount.role) return false;
  if (profile.role === "admin") return true;
  return permissionList(profile).some((permission) => accepted.has(permission)) &&
    permissionList(protectedAccount).some((permission) => accepted.has(permission));
}

function assertNoError(error: Row | null) {
  if (error) throw error;
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

function calculateRanking(entries: Row[], predictions: Row[], matchMap: Map<string, Row>, campaign: Row) {
  return entries.map((entry) => {
    const own = predictions.filter((prediction) => prediction.entry_id === entry.id);
    let score = 0;
    let correct = 0;
    let settled = 0;
    for (const prediction of own) {
      const match = matchMap.get(String(prediction.match_id));
      if (!isSettledMatch(match) || ![match?.side1_athlete_id, match?.side2_athlete_id].includes(prediction.predicted_winner_athlete_id)) continue;
      settled += 1;
      if (prediction.predicted_winner_athlete_id === match.winner_athlete_id) {
        correct += 1;
        score += pointsForMatch(match, campaign);
      }
    }
    return {
      id: entry.id,
      full_name: entry.full_name,
      public_name: entry.public_name,
      email: entry.email,
      phone: entry.phone,
      status: entry.status,
      score,
      correct,
      settled,
      predictions: own.length,
      joined_at: entry.created_at,
      last_seen_at: entry.last_seen_at,
    };
  }).sort((left, right) => {
    if (left.status !== right.status) return left.status === "ACTIVE" ? -1 : 1;
    return right.score - left.score || right.settled - left.settled ||
      String(left.joined_at).localeCompare(String(right.joined_at)) || String(left.id).localeCompare(String(right.id));
  }).map((entry, index) => ({ ...entry, position: entry.status === "ACTIVE" ? index + 1 : null }));
}

function rpcRow(data: unknown) {
  return (Array.isArray(data) ? data[0] : data) as Row | null;
}

function mapRpcError(error: unknown): never {
  const message = String((error as Row)?.message || "");
  if (message.includes("tournament_not_found")) throw new ApiError("Torneio não encontrado.", 404, "tournament_not_found");
  if (message.includes("campaign_not_found")) throw new ApiError("Desafio não encontrado.", 404, "campaign_not_found");
  if (message.includes("entry_not_found")) throw new ApiError("Participante não encontrado.", 404, "entry_not_found");
  if (message.includes("campaign_finished")) throw new ApiError("Reabra o desafio antes de alterar participantes.", 409, "campaign_finished");
  if (message.includes("campaign_must_be_locked")) throw new ApiError("Salve o status “Palpites encerrados” antes de finalizar.", 409, "campaign_must_be_locked");
  if (message.includes("tournament_not_finished")) throw new ApiError("Finalize o torneio na aba Torneio antes de confirmar o campeão do desafio.", 409, "tournament_not_finished");
  if (message.includes("tournament_results_incomplete")) throw new ApiError("Ainda existem jogos publicados sem resultado confirmado.", 409, "results_incomplete");
  if (message.includes("no_winner")) throw new ApiError("Ainda não há palpites apurados para confirmar um campeão.", 409, "no_winner");
  if (message.includes("campaign_not_finished")) throw new ApiError("Este desafio ainda não foi finalizado.", 409, "campaign_not_finished");
  if (message.includes("prize_review_required")) throw new ApiError("Para divulgar prêmio, informe a descrição e a referência da revisão/autorização.", 409, "prize_review_required");
  if (message.includes("invalid_campaign")) throw new ApiError("Revise o título, as regras, o status e a pontuação.", 400, "invalid_campaign");
  if (message.includes("As regras e a pontuação")) throw new ApiError("Regras e pontuação não podem mudar depois do primeiro cadastro.", 409, "rules_frozen");
  throw error;
}

async function loadSnapshot(client: DbClient, requestedTournamentId = "") {
  const tournamentResult = await client.from("tournaments")
    .select("id,name,slug,status,is_published,starts_on,ends_on,logo_url")
    .neq("status", "ARCHIVED").order("created_at", { ascending: false });
  assertNoError(tournamentResult.error);
  const tournaments = (tournamentResult.data || []) as Row[];
  let tournament = requestedTournamentId ? tournaments.find((row) => row.id === requestedTournamentId) : null;
  if (!tournament) {
    const activeCampaignResult = await client.from("tournament_prediction_campaigns").select("tournament_id")
      .in("status", ["OPEN", "LOCKED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    assertNoError(activeCampaignResult.error);
    tournament = tournaments.find((row) => row.id === activeCampaignResult.data?.tournament_id) ||
      tournaments.find((row) => row.status === "IN_PROGRESS") || tournaments[0] || null;
  }
  if (!tournament) return { tournaments, tournament: null, campaign: null, participants: [], summary: {} };

  const campaignResult = await client.from("tournament_prediction_campaigns").select("*")
    .eq("tournament_id", tournament.id).maybeSingle();
  assertNoError(campaignResult.error);
  const campaign = campaignResult.data as Row | null;
  if (!campaign) {
    return {
      tournaments,
      tournament,
      campaign: null,
      participants: [],
      summary: { participants: 0, predictions: 0, settled_matches: 0, available_matches: 0 },
      public_url: `https://app.ilhatenis.com/bet?torneio=${encodeURIComponent(tournament.slug)}`,
    };
  }

  const [entryResult, predictionResult, matchResult] = await Promise.all([
    client.from("tournament_prediction_entries").select("*").eq("campaign_id", campaign.id),
    client.from("tournament_predictions").select("id,entry_id,match_id,predicted_winner_athlete_id,created_at,updated_at").eq("campaign_id", campaign.id),
    client.from("tournament_matches").select("id,side1_athlete_id,side2_athlete_id,winner_athlete_id,round_code,phase,status,published")
      .eq("tournament_id", tournament.id).eq("published", true),
  ]);
  [entryResult.error, predictionResult.error, matchResult.error].forEach(assertNoError);
  const entries = (entryResult.data || []) as Row[];
  const predictions = (predictionResult.data || []) as Row[];
  const matches = (matchResult.data || []) as Row[];
  const matchMap = new Map(matches.map((match) => [String(match.id), match]));
  const participants = calculateRanking(entries, predictions, matchMap, campaign);
  const availableMatches = matches.filter((match) =>
    match.side1_athlete_id && match.side2_athlete_id && String(match.status || "").toUpperCase() !== "CANCELLED"
  ).length;
  const settledMatches = matches.filter(isSettledMatch).length;
  return {
    tournaments,
    tournament,
    campaign,
    participants,
    summary: {
      participants: entries.length,
      active_participants: entries.filter((entry) => entry.status === "ACTIVE").length,
      predictions: predictions.length,
      settled_matches: settledMatches,
      available_matches: availableMatches,
    },
    winner: campaign.winner_entry_id ? participants.find((entry) => entry.id === campaign.winner_entry_id) || null : null,
    public_url: `https://app.ilhatenis.com/bet?torneio=${encodeURIComponent(tournament.slug)}`,
  };
}

async function selectedTournament(client: DbClient, tournamentIdValue: unknown) {
  const tournamentId = uuid(tournamentIdValue);
  if (!tournamentId) throw new ApiError("Selecione um torneio.", 400, "tournament_required");
  const result = await client.from("tournaments").select("*").eq("id", tournamentId).neq("status", "ARCHIVED").maybeSingle();
  assertNoError(result.error);
  if (!result.data) throw new ApiError("Torneio não encontrado.", 404, "tournament_not_found");
  return result.data as Row;
}

async function saveCampaign(client: DbClient, actorId: string, payload: Row) {
  const tournament = await selectedTournament(client, payload.tournament_id);
  const currentResult = await client.from("tournament_prediction_campaigns").select("*")
    .eq("tournament_id", tournament.id).maybeSingle();
  assertNoError(currentResult.error);
  const current = (currentResult.data || {}) as Row;
  const title = text(payload.title || current.title || `Palpite Ilha · ${tournament.name}`, 120);
  const status = text(payload.status || current.status || "DRAFT", 20).toUpperCase();
  if (title.length < 3 || !["DRAFT", "OPEN", "LOCKED", "ARCHIVED"].includes(status)) {
    throw new ApiError("Revise o título e o status.", 400, "invalid_campaign");
  }
  const rulesText = text(payload.rules_text || current.rules_text ||
    "Cada palpite correto vale pontos. Fases iniciais valem 1 ponto, semifinais valem 2 e finais valem 3. Em caso de empate, vence quem tiver mais partidas apuradas e, depois, quem entrou primeiro.", 4000);
  if (rulesText.length < 20) throw new ApiError("Explique as regras do desafio.", 400, "invalid_rules");
  const prizeEnabled = boolean(payload.prize_enabled, Boolean(current.prize_enabled));
  const prizeDescription = nullableText(payload.prize_description ?? current.prize_description, 240);
  const authorizationReference = nullableText(payload.authorization_reference ?? current.authorization_reference, 160);
  if (prizeEnabled && (!prizeDescription || !authorizationReference)) {
    throw new ApiError("Para divulgar prêmio, informe a descrição e a referência da revisão/autorização.", 409, "prize_review_required");
  }
  const result = await client.rpc("admin_save_tournament_prediction_campaign", {
    p_tournament_id: tournament.id,
    p_actor_id: actorId,
    p_title: title,
    p_status: status,
    p_published: status === "ARCHIVED" || status === "DRAFT" ? false : boolean(payload.published, Boolean(current.published)),
    p_opens_at: nullableText(payload.opens_at ?? current.opens_at, 40),
    p_closes_at: nullableText(payload.closes_at ?? current.closes_at, 40),
    p_rules_text: rulesText,
    p_initial_round_points: boundedInteger(payload.initial_round_points, Number(current.initial_round_points || 1)),
    p_semifinal_points: boundedInteger(payload.semifinal_points, Number(current.semifinal_points || 2)),
    p_final_points: boundedInteger(payload.final_points, Number(current.final_points || 3)),
    p_prize_enabled: prizeEnabled,
    p_prize_description: prizeDescription,
    p_authorization_reference: authorizationReference,
  });
  if (result.error) mapRpcError(result.error);
  return rpcRow(result.data);
}

async function setEntryStatus(client: DbClient, actorId: string, payload: Row) {
  const entryId = uuid(payload.entry_id);
  const status = text(payload.status, 20).toUpperCase();
  if (!entryId || !["ACTIVE", "BLOCKED"].includes(status)) throw new ApiError("Participante ou status inválido.");
  const result = await client.rpc("admin_set_tournament_prediction_entry_status", {
    p_entry_id: entryId,
    p_status: status,
    p_actor_id: actorId,
  });
  if (result.error) mapRpcError(result.error);
  return rpcRow(result.data);
}

async function deleteEntry(client: DbClient, actorId: string, payload: Row) {
  const entryId = uuid(payload.entry_id);
  if (!entryId) throw new ApiError("Participante inválido.");
  const result = await client.rpc("admin_delete_tournament_prediction_entry", {
    p_entry_id: entryId,
    p_actor_id: actorId,
  });
  if (result.error) mapRpcError(result.error);
  return { id: entryId, deleted: true };
}

async function finalizeCampaign(client: DbClient, actorId: string, payload: Row) {
  const tournament = await selectedTournament(client, payload.tournament_id);
  const result = await client.rpc("admin_finalize_tournament_prediction_campaign", {
    p_tournament_id: tournament.id,
    p_actor_id: actorId,
  });
  if (result.error) mapRpcError(result.error);
  return rpcRow(result.data);
}

async function reopenCampaign(client: DbClient, actorId: string, payload: Row) {
  const tournament = await selectedTournament(client, payload.tournament_id);
  const result = await client.rpc("admin_reopen_tournament_prediction_campaign", {
    p_tournament_id: tournament.id,
    p_actor_id: actorId,
  });
  if (result.error) mapRpcError(result.error);
  return rpcRow(result.data);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  let stage = "bootstrap";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    const serviceKey = serviceRoleKey();
    if (!supabaseUrl || !anonKey || !serviceKey) throw new ApiError("Configuração indisponível.", 503, "not_configured");
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) throw new ApiError("Sessão inválida.", 401, "invalid_session");
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const userResult = await userClient.auth.getUser(token);
    if (userResult.error || !userResult.data.user) throw new ApiError("Sessão inválida.", 401, "invalid_session");
    const profileResult = await client.from("profiles").select("id,role,active,permissions").eq("id", userResult.data.user.id).maybeSingle();
    assertNoError(profileResult.error);
    const profile = (profileResult.data || {}) as Row;
    const protectedResult = await client.from("protected_access_accounts").select("role,active,permissions")
      .eq("email", text(userResult.data.user.email, 320).toLowerCase()).eq("role", profile.role || "").eq("active", true).maybeSingle();
    assertNoError(protectedResult.error);
    const protectedAccount = (protectedResult.data || {}) as Row;
    if (!can(profile, permissions) || !protectedCan(profile, protectedAccount, permissions)) {
      throw new ApiError("Você não tem permissão para acessar o Palpite Ilha.", 403, "permission_denied");
    }
    const canWrite = can(profile, writePermissions) && protectedCan(profile, protectedAccount, writePermissions);

    if (request.method === "GET") {
      stage = "snapshot";
      const tournamentId = uuid(new URL(request.url).searchParams.get("tournament_id"));
      return json(request, { ok: true, data: await loadSnapshot(client, tournamentId) });
    }
    if (request.method !== "POST") throw new ApiError("Método não permitido.", 405, "method_not_allowed");
    if (!canWrite) throw new ApiError("Seu acesso permite somente consultar.", 403, "write_denied");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 32_000) throw new ApiError("Dados muito grandes.", 413, "payload_too_large");
    let payload: Row;
    try {
      payload = JSON.parse(rawBody);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid");
    } catch (_error) {
      throw new ApiError("Dados inválidos.", 400, "invalid_json");
    }
    const action = text(payload.action, 40);
    stage = action;
    let result: unknown;
    if (action === "saveCampaign") result = await saveCampaign(client, profile.id, payload);
    else if (action === "setEntryStatus") result = await setEntryStatus(client, profile.id, payload);
    else if (action === "deleteEntry") result = await deleteEntry(client, profile.id, payload);
    else if (action === "finalizeCampaign") result = await finalizeCampaign(client, profile.id, payload);
    else if (action === "reopenCampaign") result = await reopenCampaign(client, profile.id, payload);
    else throw new ApiError("Ação inválida.", 400, "invalid_action");
    return json(request, { ok: true, result, data: await loadSnapshot(client, uuid(payload.tournament_id)) });
  } catch (error) {
    const code = String((error as Row)?.code || "");
    let apiError = error instanceof ApiError ? error : new ApiError("Não foi possível concluir a alteração.", 500, "internal_error");
    if (!(error instanceof ApiError) && code === "23505") apiError = new ApiError("Já existe um cadastro com esses dados.", 409, "duplicate");
    if (!(error instanceof ApiError) && ["23503", "23514"].includes(code)) apiError = new ApiError(text((error as Row)?.message, 300) || "A alteração conflita com dados vinculados.", 409, "conflict");
    console.error("bet-admin-api failure", { stage, code: apiError.code });
    return json(request, { ok: false, error: apiError.message, code: apiError.code }, apiError.status);
  }
});
