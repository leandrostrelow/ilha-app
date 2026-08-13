import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type Row = Record<string, any>;
type DbClient = ReturnType<typeof createClient>;

const allowedOrigins = new Set([
  "https://app.ilhatenis.com",
  "http://localhost:8769",
  "http://127.0.0.1:8769",
]);

const readPermissions = new Set(["tournaments", "tournaments.read", "tournaments.write"]);
const writePermissions = new Set(["tournaments", "tournaments.write"]);
const writeActions = new Set([
  "saveTournament",
  "createTournament",
  "saveCategory",
  "deleteCategory",
  "savePlayer",
  "saveRegistration",
  "deleteRegistration",
  "generateBracket",
  "saveMatch",
  "saveMatches",
  "scheduleMatch",
  "updateScore",
  "saveAgendaEvent",
  "deleteAgendaEvent",
  "setLiveState",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://app.ilhatenis.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function publicApiKey() {
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) return legacyKey;
  const currentKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!currentKeys) return "";
  try {
    const parsed = JSON.parse(currentKeys);
    return parsed.default || "";
  } catch (_error) {
    return currentKeys.startsWith("sb_publishable_") ? currentKeys : "";
  }
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function nullableText(value: unknown, max = 500) {
  return text(value, max) || null;
}

function numberValue(value: unknown, fallback = 0) {
  const raw = typeof value === "string" ? value.trim() : value;
  const normalized = typeof raw === "string" && raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerValue(value: unknown, fallback = 0) {
  return Math.trunc(numberValue(value, fallback));
}

function booleanValue(value: unknown, fallback = false) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function uuid(value: unknown) {
  const candidate = text(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : "";
}

function slugify(value: unknown) {
  return text(value, 140)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || `torneio-${Date.now()}`;
}

function codeFromName(value: unknown) {
  return text(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || `CLASSE-${Date.now().toString().slice(-5)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Erro desconhecido.");
}

function assertNoError(error: any) {
  if (error) throw error;
}

function firstObject(...values: unknown[]): Row {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  }
  return {};
}

function ownField(input: Row, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return { present: true, value: input[key] };
  }
  return { present: false, value: undefined };
}

function uuidField(input: Row, keys: string[], current: unknown) {
  const field = ownField(input, ...keys);
  return field.present ? (uuid(field.value) || null) : (uuid(current) || null);
}

function permissionsOf(profile: Row) {
  return Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
}

function can(profile: Row, permissions: Set<string>) {
  if (!profile || profile.active === false) return false;
  if (profile.role === "admin") return true;
  return permissionsOf(profile).some((permission) => permissions.has(permission));
}

function legacyTournamentStatus(value: unknown) {
  const status = text(value, 40).toUpperCase();
  if (status === "FINISHED") return "FINALIZADO";
  if (status === "ARCHIVED") return "ARQUIVADO";
  return status === "DRAFT" ? "RASCUNHO" : "ATIVO";
}

function databaseTournamentStatus(value: unknown, current = "", registrationOpen = false) {
  const status = text(value, 40).toUpperCase();
  if (["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "FINISHED", "ARCHIVED"].includes(status)) return status;
  if (status === "FINALIZADO") return "FINISHED";
  if (status === "ARQUIVADO") return "ARCHIVED";
  if (status === "RASCUNHO") return "DRAFT";
  if (status === "ATIVO") {
    if (registrationOpen) return "REGISTRATION_OPEN";
    return current === "IN_PROGRESS" ? "IN_PROGRESS" : "REGISTRATION_CLOSED";
  }
  return current || "DRAFT";
}

function legacyGender(value: unknown) {
  const gender = text(value, 20).toUpperCase();
  if (gender === "MALE") return "MASC";
  if (gender === "FEMALE") return "FEM";
  return gender || "MASC";
}

function databaseGender(value: unknown) {
  const gender = text(value, 20).toUpperCase();
  if (["MASC", "MASCULINO", "MALE", "M"].includes(gender)) return "MALE";
  if (["FEM", "FEMININO", "FEMALE", "F"].includes(gender)) return "FEMALE";
  if (gender === "OTHER") return "OTHER";
  return "NOT_INFORMED";
}

function legacyAthleteStatus(row: Row) {
  return row.active === false || row.status === "INACTIVE" ? "INATIVO" : "ATIVO";
}

function databaseAthleteStatus(value: unknown) {
  const status = text(value, 30).toUpperCase();
  if (["INATIVO", "INACTIVE"].includes(status)) return "INACTIVE";
  if (["SUSPENSO", "SUSPENDED"].includes(status)) return "SUSPENDED";
  return "ACTIVE";
}

function legacyPaymentStatus(value: unknown) {
  const status = text(value, 30).toUpperCase();
  if (status === "PAID") return "PAGO";
  if (status === "NOT_REQUIRED") return "ISENTO";
  if (status === "CANCELLED") return "CANCELADO";
  if (status === "OVERDUE") return "VENCIDO";
  if (status === "REFUNDED") return "ESTORNADO";
  return "PENDENTE";
}

function databasePaymentStatus(value: unknown) {
  const status = text(value, 30).toUpperCase();
  if (["PAGO", "PAID", "CONFIRMADO", "CONFIRMED"].includes(status)) return "PAID";
  if (["ISENTO", "NOT_REQUIRED"].includes(status)) return "NOT_REQUIRED";
  if (["CANCELADO", "CANCELLED"].includes(status)) return "CANCELLED";
  if (["VENCIDO", "OVERDUE"].includes(status)) return "OVERDUE";
  if (["ESTORNADO", "REFUNDED"].includes(status)) return "REFUNDED";
  return "PENDING";
}

function databaseRegistrationStatus(
  value: unknown,
  current: unknown,
  paymentStatus: string,
  confirmed: boolean | null,
) {
  const status = text(value, 30).toUpperCase();
  const mapped: Record<string, string> = {
    PENDING: "PENDING",
    PENDENTE: "PENDING",
    CONFIRMED: "CONFIRMED",
    CONFIRMADO: "CONFIRMED",
    WAITLIST: "WAITLIST",
    LISTA_ESPERA: "WAITLIST",
    "LISTA DE ESPERA": "WAITLIST",
    CANCELLED: "CANCELLED",
    CANCELADO: "CANCELLED",
    REFUNDED: "REFUNDED",
    ESTORNADO: "REFUNDED",
  };
  if (paymentStatus === "CANCELLED") return "CANCELLED";
  if (paymentStatus === "REFUNDED") return "REFUNDED";
  if (mapped[status]) return mapped[status];
  if (confirmed === true || paymentStatus === "PAID" || paymentStatus === "NOT_REQUIRED") return "CONFIRMED";
  if (confirmed === false) return "PENDING";
  const previous = text(current, 30).toUpperCase();
  return ["PENDING", "CONFIRMED", "WAITLIST", "CANCELLED", "REFUNDED"].includes(previous) ? previous : "PENDING";
}

function legacyMatchStatus(value: unknown) {
  const status = text(value, 30).toUpperCase();
  if (["FINISHED", "WALKOVER"].includes(status)) return "FINALIZADO";
  if (status === "CANCELLED") return "CANCELADO";
  if (status === "IN_PROGRESS") return "EM_ANDAMENTO";
  return "PENDENTE";
}

function databaseMatchStatus(value: unknown, hasWinner = false) {
  const status = text(value, 30).toUpperCase();
  if (hasWinner || ["FINALIZADO", "FINISHED"].includes(status)) return "FINISHED";
  if (["CANCELADO", "CANCELLED"].includes(status)) return "CANCELLED";
  if (["EM_ANDAMENTO", "AO_VIVO", "IN_PROGRESS"].includes(status)) return "IN_PROGRESS";
  if (["AGENDADO", "SCHEDULED"].includes(status)) return "SCHEDULED";
  return "PENDING";
}

function validDate(value: unknown) {
  const candidate = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function validTime(value: unknown) {
  const candidate = text(value, 20);
  const match = candidate.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

const weekDayIndexes: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const weekDayLabels = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

function normalizeKey(value: unknown) {
  return text(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function resolveLegacyDate(value: unknown, tournament: Row) {
  const raw = text(value, 20);
  if (!raw) throw new Error("Informe a data.");
  const direct = validDate(value);
  if (direct) return direct;
  const desired = weekDayIndexes[normalizeKey(value)];
  if (desired === undefined) throw new Error("Data inválida.");
  const baseText = validDate(tournament.starts_on) || new Date().toISOString().slice(0, 10);
  const base = new Date(`${baseText}T12:00:00Z`);
  const distance = (desired - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + distance);
  return base.toISOString().slice(0, 10);
}

function legacyDay(value: unknown, metadata: Row = {}) {
  if (metadata.legacy_date) return text(metadata.legacy_date, 20);
  const date = validDate(value);
  if (!date) return "";
  return weekDayLabels[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function phaseForSize(playersInRound: number) {
  if (playersInRound <= 2) return "FINAL";
  if (playersInRound === 4) return "SF";
  if (playersInRound === 8) return "QF";
  if (playersInRound === 16) return "R16";
  if (playersInRound === 32) return "R32";
  if (playersInRound === 64) return "R64";
  return `R${playersInRound}`;
}

function nextPowerOfTwo(value: number) {
  let size = 2;
  while (size < value && size < 128) size *= 2;
  return size;
}

function seedOrder(size: number): number[] {
  if (size <= 2) return [1, 2];
  const previous = seedOrder(size / 2);
  const result: number[] = [];
  previous.forEach((seed) => {
    result.push(seed, size + 1 - seed);
  });
  return result;
}

function mapTournament(row: Row) {
  const publicUrl = row.slug ? `https://app.ilhatenis.com/torneios/${encodeURIComponent(row.slug)}` : "";
  return {
    torneio_id: row.id,
    id: row.id,
    nome: row.name || "",
    name: row.name || "",
    slug: row.slug || "",
    public_slug: row.slug || "",
    public_url: publicUrl,
    ano: row.year || "",
    year: row.year || null,
    cidade: row.city || "",
    city: row.city || "",
    clube: row.club_name || "",
    club_name: row.club_name || "",
    data_inicio: row.starts_on || "",
    starts_on: row.starts_on || null,
    data_fim: row.ends_on || "",
    ends_on: row.ends_on || null,
    status: legacyTournamentStatus(row.status),
    database_status: row.status,
    instagram: row.instagram || "",
    whatsapp: row.whatsapp || "",
    observacoes: row.notes || "",
    notes: row.notes || "",
    inscricoes_abertas: row.registration_open === true,
    registration_open: row.registration_open === true,
    publicado: row.is_published === true,
    is_published: row.is_published === true,
    settings: row.settings || {},
  };
}

function mapCategory(row: Row) {
  return {
    categoria_id: row.id,
    id: row.id,
    torneio_id: row.tournament_id,
    tournament_id: row.tournament_id,
    codigo: row.code || "",
    code: row.code || "",
    nome: row.name || "",
    name: row.name || "",
    descricao: row.description || "",
    event_type: row.event_type || "SINGLES",
    gender: row.gender || "OPEN",
    classe: row.class_level || "",
    formato: row.draw_format || "SINGLE_ELIMINATION",
    tamanho_chave: row.draw_size || "",
    valor: Number(row.registration_fee || 0),
    inscricoes_abertas: row.registration_open !== false,
    max_inscritos: row.max_entries || "",
    status: row.active === false ? "INATIVA" : "ATIVA",
    ordem: row.sort_order || 0,
  };
}

function mapAthlete(row: Row) {
  return {
    jogador_id: row.id,
    id: row.id,
    nome: row.full_name || "",
    full_name: row.full_name || "",
    apelido: row.nickname || "",
    email: row.email || "",
    whatsapp: row.phone || "",
    phone: row.phone || "",
    cidade: row.city || "",
    clube: row.club_name || "",
    genero: legacyGender(row.gender),
    ranking: row.ranking || "",
    seed: row.seed || "",
    status: legacyAthleteStatus(row),
    observacoes: row.notes || "",
  };
}

function mapRegistration(row: Row) {
  return {
    inscricao_id: row.id,
    id: row.id,
    torneio_id: row.tournament_id,
    categoria_id: row.category_id,
    jogador_id: row.athlete_id,
    nome_publico: row.public_name || "",
    parceiro: row.partner_name || "",
    status_pagamento: legacyPaymentStatus(row.payment_status),
    status: row.status || "PENDING",
    valor: Number(row.total_amount || 0),
    data_inscricao: row.created_at ? String(row.created_at).slice(0, 10) : "",
    confirmado: row.status === "CONFIRMED",
    observacoes: row.notes || "",
    public_token: row.public_token,
  };
}

function mapMatch(row: Row, athletes: Map<string, Row>) {
  const metadata = firstObject(row.metadata);
  return {
    jogo_id: row.id,
    id: row.id,
    torneio_id: row.tournament_id,
    categoria_id: row.category_id,
    rodada: row.round_no || 1,
    fase: row.phase || row.round_code || "",
    posicao_chave: row.match_no || 1,
    jogador1_id: row.side1_athlete_id || "",
    jogador1_nome: athletes.get(String(row.side1_athlete_id || ""))?.full_name || "",
    jogador2_id: row.side2_athlete_id || "",
    jogador2_nome: athletes.get(String(row.side2_athlete_id || ""))?.full_name || "",
    vencedor_id: row.winner_athlete_id || "",
    vencedor_nome: athletes.get(String(row.winner_athlete_id || ""))?.full_name || "",
    origem1_jogo_id: row.source1_match_id || "",
    origem2_jogo_id: row.source2_match_id || "",
    placar: row.score || "",
    quadra: row.court_name || "",
    data: legacyDay(row.match_date, metadata),
    data_iso: row.match_date || "",
    hora: row.match_time ? String(row.match_time).slice(0, 5) : "",
    status: legacyMatchStatus(row.status),
    ordem: row.sort_order || 0,
    observacoes: row.public_notes || metadata.observacoes || "",
    resultado_em: row.finished_at || "",
  };
}

function mapCourt(row: Row) {
  return {
    quadra_id: row.id,
    id: row.id,
    torneio_id: row.tournament_id,
    nome: row.name,
    superficie: row.surface || "",
    ordem: row.sort_order || 0,
    ativa: row.active !== false,
  };
}

function mapEvent(row: Row) {
  return {
    agenda_id: row.id,
    id: row.id,
    torneio_id: row.tournament_id,
    tipo: "EVENTO",
    titulo: row.title || "",
    descricao: row.description || "",
    data: legacyDay(row.event_date),
    data_iso: row.event_date || "",
    hora: row.event_time ? String(row.event_time).slice(0, 5) : "",
    quadra: row.court_name || "Sem quadra",
    status: row.status || "SCHEDULED",
    publicar: row.published !== false,
    ordem: row.sort_order || 0,
  };
}

async function selectTournament(client: DbClient, id: string, slug: string) {
  let query = client.from("tournaments").select("*");
  if (id) query = query.eq("id", id);
  else if (slug) query = query.eq("slug", slug);
  else query = query.neq("status", "ARCHIVED").order("updated_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  assertNoError(error);
  return data as Row | null;
}

async function loadSnapshot(client: DbClient, tournamentId = "", slug = "") {
  const { data: tournamentRows, error: tournamentListError } = await client
    .from("tournaments")
    .select("*")
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  assertNoError(tournamentListError);
  const tournaments = (tournamentRows || []) as Row[];
  let tournament: Row | null = null;
  if (tournamentId) tournament = tournaments.find((row) => row.id === tournamentId) || null;
  else if (slug) tournament = tournaments.find((row) => row.slug === slug) || null;
  else tournament = tournaments.find((row) => row.status !== "ARCHIVED") || tournaments[0] || null;

  const empty = {
    torneio: {}, categorias: [], jogadores: [], inscricoes: [], jogos: [], quadras: [], agenda: [],
    config: [], live: {}, torneios: tournaments.map(mapTournament),
  };
  if (!tournament) return empty;

  const id = tournament.id;
  const [categoriesResult, athletesResult, registrationsResult, matchesResult, courtsResult, eventsResult, liveResult] = await Promise.all([
    client.from("tournament_categories").select("*").eq("tournament_id", id).order("sort_order").order("name"),
    client.from("tournament_athletes").select("*").order("full_name"),
    client.from("tournament_registrations").select("*").eq("tournament_id", id).order("created_at"),
    client.from("tournament_matches").select("*").eq("tournament_id", id).order("category_id").order("round_no").order("match_no"),
    client.from("tournament_courts").select("*").eq("tournament_id", id).order("sort_order").order("name"),
    client.from("tournament_schedule_events").select("*").eq("tournament_id", id).order("event_date").order("event_time"),
    client.from("tournament_live_state").select("*").eq("tournament_id", id).maybeSingle(),
  ]);
  [categoriesResult, athletesResult, registrationsResult, matchesResult, courtsResult, eventsResult, liveResult].forEach((result) => assertNoError(result.error));

  const categories = ((categoriesResult.data || []) as Row[]).filter((row) => row.active !== false);
  const visibleCategoryIds = new Set(categories.map((row) => String(row.id)));
  const registrations = ((registrationsResult.data || []) as Row[]).filter((row) => visibleCategoryIds.has(String(row.category_id)));
  const matches = ((matchesResult.data || []) as Row[]).filter((row) => visibleCategoryIds.has(String(row.category_id)));
  // Atletas são um cadastro global e precisam continuar disponíveis para novas inscrições.
  // Esta rota é autenticada e protegida pela permissão administrativa de torneios/RLS.
  const athletes = (athletesResult.data || []) as Row[];
  const athleteMap = new Map(athletes.map((row) => [String(row.id), row]));
  const liveRow = (liveResult.data || {}) as Row;
  const livePayload = Object.assign({}, firstObject(liveRow.payload), {
    status: liveRow.status || firstObject(liveRow.payload).status || "IDLE",
    match_id: liveRow.match_id || firstObject(liveRow.payload).match_id || "",
    game1: liveRow.game1 || "",
    game2: liveRow.game2 || "",
    tie1: liveRow.tie1 || "",
    tie2: liveRow.tie2 || "",
  });

  return {
    torneio: mapTournament(tournament),
    categorias: categories.map(mapCategory),
    jogadores: athletes.map(mapAthlete),
    inscricoes: registrations.map(mapRegistration),
    jogos: matches.map((row) => mapMatch(row, athleteMap)),
    quadras: ((courtsResult.data || []) as Row[]).map(mapCourt),
    agenda: ((eventsResult.data || []) as Row[]).map(mapEvent),
    config: [{ chave: "LIVE_STATE", valor: JSON.stringify(livePayload) }],
    live: livePayload,
    torneios: tournaments.map(mapTournament),
  };
}

async function currentTournament(client: DbClient, payload: Row, nested: Row = {}) {
  const id = uuid(payload.tournament_id || payload.torneio_id || nested.tournament_id || nested.torneio_id);
  const slug = text(payload.slug || nested.slug, 100);
  const tournament = await selectTournament(client, id, slug);
  if (!tournament) throw new Error("Torneio não encontrado.");
  return tournament;
}

async function audit(client: DbClient, actorId: string, tournamentId: string, entityType: string, entityId: string, action: string, oldData: unknown, newData: unknown) {
  const { error } = await client.from("tournament_audit_log").insert({
    tournament_id: tournamentId || null,
    actor_id: actorId || null,
    entity_type: entityType,
    entity_id: uuid(entityId) || null,
    action,
    old_data: oldData || null,
    new_data: newData || null,
  });
  if (error) console.error("tournament audit failure", { action, message: error.message });
}

async function uniqueSlug(client: DbClient, desired: string, ignoredId = "") {
  const base = slugify(desired);
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let query = client.from("tournaments").select("id").eq("slug", candidate);
    if (ignoredId) query = query.neq("id", ignoredId);
    const { data, error } = await query.limit(1);
    assertNoError(error);
    if (!data?.length) return candidate;
    candidate = `${base}-${attempt + 2}`.slice(0, 100);
  }
  return `${base}-${Date.now().toString().slice(-6)}`.slice(0, 100);
}

function tournamentPayload(input: Row, current: Row = {}) {
  const name = text(input.nome || input.name || current.name, 140);
  if (name.length < 3) throw new Error("Informe o nome do torneio.");
  const rawStatus = input.status || current.status || "DRAFT";
  const registrationOpen = booleanValue(input.inscricoes_abertas ?? input.registration_open, current.registration_open === true);
  return {
    name,
    year: integerValue(input.ano ?? input.year, current.year || new Date().getFullYear()),
    city: nullableText(input.cidade ?? input.city ?? current.city, 100),
    club_name: nullableText(input.clube ?? input.club_name ?? current.club_name, 120),
    starts_on: validDate(input.data_inicio ?? input.starts_on) || current.starts_on || null,
    ends_on: validDate(input.data_fim ?? input.ends_on) || current.ends_on || null,
    status: databaseTournamentStatus(rawStatus, current.status || "", registrationOpen),
    registration_open: registrationOpen,
    is_published: booleanValue(input.publicado ?? input.is_published, current.is_published === true),
    instagram: nullableText(input.instagram ?? current.instagram, 120),
    whatsapp: nullableText(input.whatsapp ?? current.whatsapp, 30),
    notes: nullableText(input.observacoes ?? input.notes ?? current.notes, 4000),
    settings: firstObject(input.settings, current.settings),
    updated_at: new Date().toISOString(),
  };
}

async function saveTournament(client: DbClient, actorId: string, payload: Row, create: boolean) {
  const input = firstObject(payload.torneio, payload.tournament, payload);
  const requestedId = uuid(input.torneio_id || input.id || payload.tournament_id);
  let current: Row = {};
  if (requestedId) {
    const result = await client.from("tournaments").select("*").eq("id", requestedId).maybeSingle();
    assertNoError(result.error);
    current = result.data || {};
  }
  if (!create && !current.id) throw new Error("Torneio não encontrado.");
  const data = tournamentPayload(input, current);
  const desiredSlug = text(input.slug, 100) || current.slug || data.name;
  const slug = await uniqueSlug(client, desiredSlug, current.id || "");
  let saved: Row;
  if (current.id) {
    const result = await client.from("tournaments").update({ ...data, slug, updated_by: actorId }).eq("id", current.id).select().single();
    assertNoError(result.error);
    saved = result.data;
  } else {
    const result = await client.from("tournaments").insert({ ...data, slug, created_by: actorId, updated_by: actorId }).select().single();
    assertNoError(result.error);
    saved = result.data;
  }
  await audit(client, actorId, saved.id, "tournament", saved.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, saved);
  return saved;
}

async function saveCategory(client: DbClient, actorId: string, payload: Row) {
  const input = firstObject(payload.categoria, payload.category, payload);
  const tournament = await currentTournament(client, payload, input);
  const categoryId = uuid(input.categoria_id || input.id);
  let current: Row = {};
  if (categoryId) {
    const result = await client.from("tournament_categories").select("*").eq("id", categoryId).eq("tournament_id", tournament.id).maybeSingle();
    assertNoError(result.error);
    current = result.data || {};
  }
  const name = text(input.nome || input.name || current.name, 100);
  if (name.length < 2) throw new Error("Informe o nome da classe.");
  const data = {
    tournament_id: tournament.id,
    code: text(input.codigo || input.code || current.code, 30) || codeFromName(name),
    name,
    description: nullableText(input.descricao ?? input.description ?? current.description, 800),
    event_type: ["SINGLES", "DOUBLES"].includes(text(input.event_type || current.event_type, 20).toUpperCase()) ? text(input.event_type || current.event_type, 20).toUpperCase() : "SINGLES",
    gender: ["MALE", "FEMALE", "MIXED", "OPEN"].includes(text(input.gender || current.gender, 20).toUpperCase()) ? text(input.gender || current.gender, 20).toUpperCase() : "OPEN",
    class_level: nullableText(input.classe ?? input.class_level ?? current.class_level, 40),
    draw_format: text(input.formato || input.draw_format || current.draw_format || "SINGLE_ELIMINATION", 40),
    draw_size: integerValue(input.tamanho_chave ?? input.draw_size, current.draw_size || 0) || null,
    registration_fee: Math.max(0, numberValue(input.valor ?? input.registration_fee, current.registration_fee || 0)),
    registration_open: booleanValue(input.inscricoes_abertas ?? input.registration_open, current.registration_open !== false),
    max_entries: integerValue(input.max_inscritos ?? input.max_entries, current.max_entries || 0) || null,
    active: text(input.status, 20).toUpperCase() !== "INATIVA" && input.active !== false,
    is_published: input.is_published !== false,
    sort_order: integerValue(input.ordem ?? input.sort_order, current.sort_order || 0),
    updated_at: new Date().toISOString(),
  };
  const result = current.id
    ? await client.from("tournament_categories").update(data).eq("id", current.id).select().single()
    : await client.from("tournament_categories").insert(data).select().single();
  assertNoError(result.error);
  await audit(client, actorId, tournament.id, "category", result.data.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, result.data);
  return result.data as Row;
}

async function deleteCategory(client: DbClient, actorId: string, payload: Row) {
  const categoryId = uuid(payload.categoria_id || payload.category_id || payload.id);
  if (!categoryId) throw new Error("Classe inválida.");
  const lookup = await client.from("tournament_categories").select("*").eq("id", categoryId).maybeSingle();
  assertNoError(lookup.error);
  if (!lookup.data) throw new Error("Classe não encontrada.");
  const counts = await Promise.all([
    client.from("tournament_registrations").select("id", { count: "exact", head: true }).eq("category_id", categoryId),
    client.from("tournament_matches").select("id", { count: "exact", head: true }).eq("category_id", categoryId),
  ]);
  counts.forEach((result) => assertNoError(result.error));
  if ((counts[0].count || 0) + (counts[1].count || 0) > 0) {
    throw new Error("Esta classe possui inscrições ou jogos. Desative-a em vez de excluir.");
  }
  const result = await client.from("tournament_categories").delete().eq("id", categoryId);
  assertNoError(result.error);
  await audit(client, actorId, lookup.data.tournament_id, "category", categoryId, "DELETE", lookup.data, null);
  return { categoria_id: categoryId, deleted: true };
}

async function savePlayer(client: DbClient, actorId: string, payload: Row) {
  const input = firstObject(payload.jogador, payload.player, payload);
  const athleteId = uuid(input.jogador_id || input.id);
  let current: Row = {};
  if (athleteId) {
    const lookup = await client.from("tournament_athletes").select("*").eq("id", athleteId).maybeSingle();
    assertNoError(lookup.error);
    current = lookup.data || {};
  }
  const fullName = text(input.nome || input.full_name || current.full_name, 120);
  if (fullName.length < 2) throw new Error("Informe o nome do atleta.");
  const status = databaseAthleteStatus(input.status || current.status);
  const data = {
    full_name: fullName,
    nickname: nullableText(input.apelido ?? input.nickname ?? current.nickname, 80),
    email: nullableText(input.email ?? current.email, 180)?.toLowerCase() || null,
    phone: nullableText(input.whatsapp ?? input.phone ?? current.phone, 30),
    cpf: nullableText(input.cpf ?? current.cpf, 20),
    birth_date: validDate(input.data_nascimento ?? input.birth_date) || current.birth_date || null,
    gender: databaseGender(input.genero || input.gender || current.gender),
    city: nullableText(input.cidade ?? input.city ?? current.city, 100),
    club_name: nullableText(input.clube ?? input.club_name ?? current.club_name, 120),
    ranking: integerValue(input.ranking, current.ranking || 0) || null,
    seed: integerValue(input.seed, current.seed || 0) || null,
    status,
    active: status === "ACTIVE",
    notes: nullableText(input.observacoes ?? input.notes ?? current.notes, 2000),
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };
  const result = current.id
    ? await client.from("tournament_athletes").update(data).eq("id", current.id).select().single()
    : await client.from("tournament_athletes").insert({ ...data, created_by: actorId }).select().single();
  assertNoError(result.error);
  const tournament = await currentTournament(client, payload).catch(() => null);
  await audit(client, actorId, tournament?.id || "", "athlete", result.data.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, result.data);
  return mapAthlete(result.data as Row);
}

async function saveRegistration(client: DbClient, actorId: string, payload: Row) {
  const input = firstObject(payload.inscricao, payload.registration, payload);
  const tournament = await currentTournament(client, payload, input);
  const registrationId = uuid(input.inscricao_id || input.id);
  const categoryId = uuid(input.categoria_id || input.category_id);
  const athleteId = uuid(input.jogador_id || input.athlete_id);
  if (!categoryId || !athleteId) throw new Error("Escolha atleta e classe.");
  const [categoryResult, athleteResult] = await Promise.all([
    client.from("tournament_categories").select("*").eq("id", categoryId).eq("tournament_id", tournament.id).maybeSingle(),
    client.from("tournament_athletes").select("*").eq("id", athleteId).maybeSingle(),
  ]);
  assertNoError(categoryResult.error);
  assertNoError(athleteResult.error);
  if (!categoryResult.data || !athleteResult.data) throw new Error("Atleta ou classe não encontrado.");
  let current: Row = {};
  let lookup = client.from("tournament_registrations").select("*");
  if (registrationId) lookup = lookup.eq("id", registrationId);
  else lookup = lookup.eq("tournament_id", tournament.id).eq("category_id", categoryId).eq("athlete_id", athleteId);
  const existing = await lookup.maybeSingle();
  assertNoError(existing.error);
  current = existing.data || {};
  const paymentStatus = databasePaymentStatus(input.status_pagamento || input.payment_status || current.payment_status);
  const confirmedField = ownField(input, "confirmado", "confirmed");
  const requestedConfirmed = confirmedField.present ? booleanValue(confirmedField.value, false) : null;
  const registrationStatus = databaseRegistrationStatus(input.status, current.status, paymentStatus, requestedConfirmed);
  const totalAmount = Math.max(0, numberValue(input.valor ?? input.total_amount, current.total_amount ?? categoryResult.data.registration_fee ?? 0));
  const data = {
    tournament_id: tournament.id,
    category_id: categoryId,
    athlete_id: athleteId,
    public_name: text(input.nome_publico || input.public_name || athleteResult.data.full_name, 120),
    public_city: nullableText(input.cidade ?? input.public_city ?? athleteResult.data.city, 100),
    public_club: nullableText(input.clube ?? input.public_club ?? athleteResult.data.club_name, 120),
    partner_name: nullableText(input.parceiro ?? input.partner_name ?? current.partner_name, 120),
    seed_number: integerValue(input.seed_number ?? athleteResult.data.seed, current.seed_number || 0) || null,
    status: registrationStatus,
    payment_status: paymentStatus,
    total_amount: totalAmount,
    paid_amount: paymentStatus === "PAID" ? totalAmount : 0,
    source: ["PUBLIC", "ADMIN", "IMPORT", "DEMO"].includes(text(input.source || current.source, 20).toUpperCase()) ? text(input.source || current.source, 20).toUpperCase() : "ADMIN",
    published: input.published !== false,
    notes: nullableText(input.observacoes ?? input.notes ?? current.notes, 2000),
    confirmed_at: registrationStatus === "CONFIRMED" ? (current.confirmed_at || new Date().toISOString()) : null,
    cancelled_at: registrationStatus === "CANCELLED" ? (current.cancelled_at || new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  };
  const result = current.id
    ? await client.from("tournament_registrations").update(data).eq("id", current.id).select().single()
    : await client.from("tournament_registrations").insert(data).select().single();
  assertNoError(result.error);
  await audit(client, actorId, tournament.id, "registration", result.data.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, result.data);
  return result.data as Row;
}

async function deleteRegistration(client: DbClient, actorId: string, payload: Row) {
  const id = uuid(payload.inscricao_id || payload.registration_id || payload.id);
  if (!id) throw new Error("Inscrição inválida.");
  const lookup = await client.from("tournament_registrations").select("*").eq("id", id).maybeSingle();
  assertNoError(lookup.error);
  if (!lookup.data) throw new Error("Inscrição não encontrada.");
  const result = await client.from("tournament_registrations").delete().eq("id", id);
  assertNoError(result.error);
  await audit(client, actorId, lookup.data.tournament_id, "registration", id, "DELETE", lookup.data, null);
  return { inscricao_id: id, deleted: true };
}

function matchPayload(input: Row, tournament: Row, current: Row = {}) {
  const metadata = Object.assign({}, firstObject(current.metadata), firstObject(input.metadata));
  const dateField = ownField(input, "data", "match_date");
  let date = current.match_date || null;
  if (dateField.present) {
    const rawDate = text(dateField.value, 20);
    if (!rawDate) {
      date = null;
      delete metadata.legacy_date;
    } else {
      date = resolveLegacyDate(rawDate, tournament);
      if (validDate(rawDate)) delete metadata.legacy_date;
      else metadata.legacy_date = rawDate;
    }
  }
  const timeField = ownField(input, "hora", "match_time");
  let time = current.match_time || null;
  if (timeField.present) {
    const rawTime = text(timeField.value, 20);
    if (!rawTime) time = null;
    else {
      time = validTime(rawTime);
      if (!time) throw new Error("Horário inválido.");
    }
  }
  const winnerField = ownField(input, "vencedor_id", "winner_athlete_id");
  const winner = uuidField(input, ["vencedor_id", "winner_athlete_id"], current.winner_athlete_id);
  const courtField = ownField(input, "quadra", "court_name");
  const courtName = courtField.present ? nullableText(courtField.value, 100) : (current.court_name || null);
  const statusField = ownField(input, "status");
  let requestedStatus = statusField.present
    ? statusField.value
    : (winnerField.present && !winner ? "PENDING" : current.status);
  if (winnerField.present && !winner && ["FINISHED", "FINALIZADO", "WALKOVER"].includes(text(requestedStatus, 30).toUpperCase())) {
    requestedStatus = "PENDING";
  }
  const scheduleWasEdited = dateField.present || timeField.present || courtField.present;
  const normalizedRequestedStatus = text(requestedStatus, 30).toUpperCase();
  if (scheduleWasEdited && !date && !time && !courtName && !winner &&
      ["", "PENDING", "PENDENTE", "SCHEDULED", "AGENDADO"].includes(normalizedRequestedStatus)) {
    requestedStatus = "PENDING";
  }
  const status = databaseMatchStatus(requestedStatus, Boolean(winner));
  return {
    tournament_id: tournament.id,
    category_id: uuidField(input, ["categoria_id", "category_id"], current.category_id),
    round_no: Math.max(1, integerValue(input.rodada ?? input.round_no, current.round_no || 1)),
    round_code: nullableText(input.fase ?? input.round_code ?? current.round_code, 20),
    phase: nullableText(input.fase ?? input.phase ?? current.phase, 20),
    match_no: Math.max(1, integerValue(input.posicao_chave ?? input.match_no, current.match_no || 1)),
    side1_athlete_id: uuidField(input, ["jogador1_id", "side1_athlete_id"], current.side1_athlete_id),
    side2_athlete_id: uuidField(input, ["jogador2_id", "side2_athlete_id"], current.side2_athlete_id),
    winner_athlete_id: winner || null,
    source1_match_id: uuidField(input, ["origem1_jogo_id", "source1_match_id"], current.source1_match_id),
    source2_match_id: uuidField(input, ["origem2_jogo_id", "source2_match_id"], current.source2_match_id),
    score: nullableText(input.placar ?? input.score ?? current.score, 100),
    court_name: courtName,
    match_date: date,
    match_time: time,
    status,
    sort_order: integerValue(input.ordem ?? input.sort_order, current.sort_order || 0),
    published: booleanValue(input.published, current.published !== false),
    public_notes: nullableText(input.observacoes ?? input.public_notes ?? current.public_notes, 1000),
    finished_at: status === "FINISHED" ? (current.finished_at || new Date().toISOString()) : null,
    metadata,
    updated_at: new Date().toISOString(),
  };
}

async function syncWinnerPropagation(client: DbClient, match: Row, previousWinnerId = "", visited = new Set<string>()) {
  if (!match?.id || !match.tournament_id || !match.category_id || visited.has(match.id)) return;
  visited.add(match.id);
  const nextResult = await client
    .from("tournament_matches")
    .select("*")
    .eq("tournament_id", match.tournament_id)
    .eq("category_id", match.category_id)
    .or(`source1_match_id.eq.${match.id},source2_match_id.eq.${match.id}`)
    .limit(2);
  assertNoError(nextResult.error);
  const nextMatches = (nextResult.data || []) as Row[];
  if (nextMatches.length > 1) throw new Error("A chave possui mais de um destino para o mesmo jogo.");
  const next = nextMatches[0] || null;
  if (!next) return;
  const sideKey = next.source1_match_id === match.id ? "side1_athlete_id" : "side2_athlete_id";
  const incomingWinner = uuid(match.winner_athlete_id) || null;
  const participantChanged = (uuid(next[sideKey]) || null) !== incomingWinner;
  const patch: Row = {
    [sideKey]: incomingWinner,
    updated_at: new Date().toISOString(),
  };
  const projectedSide1 = sideKey === "side1_athlete_id" ? patch[sideKey] : next.side1_athlete_id;
  const projectedSide2 = sideKey === "side2_athlete_id" ? patch[sideKey] : next.side2_athlete_id;
  const nextWinner = uuid(next.winner_athlete_id);
  const winnerStillValid = nextWinner && [projectedSide1, projectedSide2].includes(nextWinner);
  if (nextWinner && (participantChanged || !winnerStillValid)) {
    patch.winner_athlete_id = null;
    patch.score = null;
    patch.status = "PENDING";
    patch.finished_at = null;
  }
  const updated = await client.from("tournament_matches").update(patch).eq("id", next.id).select().single();
  assertNoError(updated.error);
  if (nextWinner && (participantChanged || !winnerStillValid)) {
    await syncWinnerPropagation(client, updated.data as Row, nextWinner || previousWinnerId, visited);
  }
}

async function saveOneMatch(client: DbClient, actorId: string, payload: Row, input: Row) {
  const matchId = uuid(input.jogo_id || input.id);
  let current: Row = {};
  if (matchId) {
    const lookup = await client.from("tournament_matches").select("*").eq("id", matchId).maybeSingle();
    assertNoError(lookup.error);
    current = lookup.data || {};
  }
  const tournament = await currentTournament(client, payload, Object.assign({}, current, input));
  const data = matchPayload(input, tournament, current);
  if (!data.category_id) throw new Error("A classe do jogo é obrigatória.");
  if (data.winner_athlete_id && ![data.side1_athlete_id, data.side2_athlete_id].includes(data.winner_athlete_id)) {
    throw new Error("O vencedor precisa ser um dos atletas deste jogo.");
  }
  const result = current.id
    ? await client.from("tournament_matches").update(data).eq("id", current.id).select().single()
    : await client.from("tournament_matches").insert(data).select().single();
  assertNoError(result.error);
  await syncWinnerPropagation(client, result.data as Row, uuid(current.winner_athlete_id));
  await audit(client, actorId, tournament.id, "match", result.data.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, result.data);
  return result.data as Row;
}

async function saveMatches(client: DbClient, actorId: string, payload: Row) {
  const matches = Array.isArray(payload.jogos) ? payload.jogos : Array.isArray(payload.matches) ? payload.matches : [];
  if (!matches.length) throw new Error("Nenhum jogo informado.");
  const saved: Row[] = [];
  for (const match of matches) saved.push(await saveOneMatch(client, actorId, payload, firstObject(match)));
  return saved;
}

async function updateMatchFields(client: DbClient, actorId: string, payload: Row, mode: "schedule" | "score") {
  const matchId = uuid(payload.jogo_id || payload.match_id || firstObject(payload.jogo).jogo_id);
  if (!matchId) throw new Error("Jogo inválido.");
  const lookup = await client.from("tournament_matches").select("*").eq("id", matchId).maybeSingle();
  assertNoError(lookup.error);
  if (!lookup.data) throw new Error("Jogo não encontrado.");
  const tournament = await currentTournament(client, payload, lookup.data);
  const input = firstObject(payload.jogo, payload);
  let update: Row;
  if (mode === "schedule") {
    const metadata = Object.assign({}, firstObject(lookup.data.metadata));
    const dateField = ownField(input, "data", "match_date");
    const timeField = ownField(input, "hora", "match_time");
    const courtField = ownField(input, "quadra", "court_name");
    let matchDate = lookup.data.match_date || null;
    if (dateField.present) {
      const rawDate = text(dateField.value, 20);
      if (!rawDate) {
        matchDate = null;
        delete metadata.legacy_date;
      } else {
        matchDate = resolveLegacyDate(rawDate, tournament);
        if (validDate(rawDate)) delete metadata.legacy_date;
        else metadata.legacy_date = rawDate;
      }
    }
    let matchTime = lookup.data.match_time || null;
    if (timeField.present) {
      const rawTime = text(timeField.value, 20);
      if (!rawTime) matchTime = null;
      else {
        matchTime = validTime(rawTime);
        if (!matchTime) throw new Error("Horário inválido.");
      }
    }
    const courtName = courtField.present ? nullableText(courtField.value, 100) : (lookup.data.court_name || null);
    const hasSchedule = Boolean(matchDate || matchTime || courtName);
    const normalizedRequestedStatus = text(input.status, 30).toUpperCase();
    const requestedStatus = !hasSchedule && !lookup.data.winner_athlete_id &&
        ["", "PENDING", "PENDENTE", "SCHEDULED", "AGENDADO"].includes(normalizedRequestedStatus)
      ? "PENDING"
      : (input.status || (hasSchedule ? "SCHEDULED" : "PENDING"));
    update = {
      match_date: matchDate,
      match_time: matchTime,
      court_name: courtName,
      status: databaseMatchStatus(requestedStatus, Boolean(lookup.data.winner_athlete_id)),
      metadata,
      updated_at: new Date().toISOString(),
    };
  } else {
    const winnerField = ownField(input, "vencedor_id", "winner_athlete_id");
    const winner = winnerField.present ? uuid(winnerField.value) : uuid(lookup.data.winner_athlete_id);
    if (winner && ![lookup.data.side1_athlete_id, lookup.data.side2_athlete_id].includes(winner)) {
      throw new Error("O vencedor precisa ser um dos atletas deste jogo.");
    }
    let requestedStatus = input.status || (winner ? "FINISHED" : "PENDING");
    if (winnerField.present && !winner && ["FINISHED", "FINALIZADO", "WALKOVER"].includes(text(requestedStatus, 30).toUpperCase())) {
      requestedStatus = "PENDING";
    }
    update = {
      score: ownField(input, "placar", "score").present
        ? nullableText(ownField(input, "placar", "score").value, 100)
        : (lookup.data.score || null),
      winner_athlete_id: winner || null,
      status: databaseMatchStatus(requestedStatus, Boolean(winner)),
      finished_at: winner ? (lookup.data.finished_at || new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
  }
  const result = await client.from("tournament_matches").update(update).eq("id", matchId).select().single();
  assertNoError(result.error);
  await syncWinnerPropagation(client, result.data as Row, uuid(lookup.data.winner_athlete_id));
  await audit(client, actorId, tournament.id, "match", matchId, mode === "schedule" ? "SCHEDULE" : "SCORE", lookup.data, result.data);
  return result.data as Row;
}

async function saveAgendaEvent(client: DbClient, actorId: string, payload: Row) {
  const input = firstObject(payload.evento, payload.event, payload);
  const tournament = await currentTournament(client, payload, input);
  const eventId = uuid(input.agenda_id || input.id);
  let current: Row = {};
  if (eventId) {
    const lookup = await client.from("tournament_schedule_events").select("*").eq("id", eventId).eq("tournament_id", tournament.id).maybeSingle();
    assertNoError(lookup.error);
    current = lookup.data || {};
  }
  const title = text(input.titulo || input.title || current.title, 160);
  if (title.length < 2) throw new Error("Informe o nome do evento.");
  const statusValue = text(input.status || current.status || "SCHEDULED", 30).toUpperCase();
  const allowedStatuses = ["SCHEDULED", "CONFIRMED", "FINISHED", "CANCELLED"];
  const data = {
    tournament_id: tournament.id,
    title,
    description: nullableText(input.descricao ?? input.description ?? current.description, 1000),
    event_date: resolveLegacyDate(input.data ?? input.event_date ?? current.event_date, tournament),
    event_time: validTime(input.hora ?? input.event_time ?? current.event_time) || null,
    court_name: nullableText(input.quadra ?? input.court_name ?? current.court_name, 100),
    status: allowedStatuses.includes(statusValue) ? statusValue : "SCHEDULED",
    published: booleanValue(input.publicar ?? input.published, current.published !== false),
    sort_order: integerValue(input.ordem ?? input.sort_order, current.sort_order || 0),
    updated_at: new Date().toISOString(),
  };
  const result = current.id
    ? await client.from("tournament_schedule_events").update(data).eq("id", current.id).select().single()
    : await client.from("tournament_schedule_events").insert(data).select().single();
  assertNoError(result.error);
  await audit(client, actorId, tournament.id, "schedule_event", result.data.id, current.id ? "UPDATE" : "CREATE", current.id ? current : null, result.data);
  return result.data as Row;
}

async function deleteAgendaEvent(client: DbClient, actorId: string, payload: Row) {
  const id = uuid(payload.agenda_id || payload.event_id || payload.id);
  if (!id) throw new Error("Evento inválido.");
  const lookup = await client.from("tournament_schedule_events").select("*").eq("id", id).maybeSingle();
  assertNoError(lookup.error);
  if (!lookup.data) throw new Error("Evento não encontrado.");
  const result = await client.from("tournament_schedule_events").delete().eq("id", id);
  assertNoError(result.error);
  await audit(client, actorId, lookup.data.tournament_id, "schedule_event", id, "DELETE", lookup.data, null);
  return { agenda_id: id, deleted: true };
}

async function setLiveState(client: DbClient, actorId: string, payload: Row) {
  const input = firstObject(payload.live, payload);
  const tournament = await currentTournament(client, payload, input);
  const matchId = uuid(input.match_id);
  const data = {
    tournament_id: tournament.id,
    status: text(input.status || "IDLE", 30).toUpperCase(),
    match_id: matchId || null,
    game1: nullableText(input.game1 ?? input.set1p1, 12),
    game2: nullableText(input.game2 ?? input.set1p2, 12),
    tie1: nullableText(input.tie1 ?? input.st1, 12),
    tie2: nullableText(input.tie2 ?? input.st2, 12),
    side1_athlete_id: uuid(input.jogador1_id || input.side1_athlete_id) || null,
    side2_athlete_id: uuid(input.jogador2_id || input.side2_athlete_id) || null,
    winner_athlete_id: uuid(input.vencedor_id || input.winner_athlete_id) || null,
    category_id: uuid(input.categoria_id || input.category_id) || null,
    phase: nullableText(input.fase ?? input.phase, 20),
    ad_url: nullableText(input.ad_url, 1000),
    ad_title: nullableText(input.ad_title, 160),
    ad_source: nullableText(input.ad_source, 40),
    ad_id: nullableText(input.ad_id, 120),
    payload: input,
    updated_at: new Date().toISOString(),
  };
  const previous = await client.from("tournament_live_state").select("*").eq("tournament_id", tournament.id).maybeSingle();
  assertNoError(previous.error);
  const result = await client.from("tournament_live_state").upsert(data, { onConflict: "tournament_id" }).select().single();
  assertNoError(result.error);
  await audit(client, actorId, tournament.id, "live_state", tournament.id, "UPDATE", previous.data, result.data);
  return result.data as Row;
}

async function generateBracket(client: DbClient, actorId: string, payload: Row) {
  const categoryId = uuid(payload.categoria_id || payload.category_id);
  if (!categoryId) throw new Error("Escolha uma classe.");
  const categoryResult = await client.from("tournament_categories").select("*").eq("id", categoryId).maybeSingle();
  assertNoError(categoryResult.error);
  const category = categoryResult.data as Row | null;
  if (!category) throw new Error("Classe não encontrada.");
  const tournament = await selectTournament(client, category.tournament_id, "");
  if (!tournament) throw new Error("Torneio não encontrado.");
  const registrationsResult = await client
    .from("tournament_registrations")
    .select("*, tournament_athletes(ranking, seed)")
    .eq("category_id", categoryId)
    .eq("status", "CONFIRMED");
  assertNoError(registrationsResult.error);
  const registrations = ((registrationsResult.data || []) as Row[]).sort((a, b) => {
    const aSeed = integerValue(a.seed_number ?? a.tournament_athletes?.seed, 99999);
    const bSeed = integerValue(b.seed_number ?? b.tournament_athletes?.seed, 99999);
    if (aSeed !== bSeed) return aSeed - bSeed;
    const aRank = integerValue(a.tournament_athletes?.ranking, 99999);
    const bRank = integerValue(b.tournament_athletes?.ranking, 99999);
    return aRank - bRank;
  });
  if (registrations.length < 2) throw new Error("São necessárias pelo menos duas inscrições confirmadas para gerar a chave.");
  const automaticSize = nextPowerOfTwo(registrations.length);
  const requestedSize = integerValue(payload.tamanho_chave || payload.draw_size, 0);
  const size = requestedSize && [2, 4, 8, 16, 32, 64, 128].includes(requestedSize)
    ? Math.max(requestedSize, automaticSize)
    : Math.max(integerValue(category.draw_size, 0), automaticSize);
  if (size > 128) throw new Error("A chave permite no máximo 128 participantes.");
  if (registrations.length > size) throw new Error("A quantidade de inscritos é maior que o tamanho da chave.");

  const order = seedOrder(size);
  const slots = order.map((seed) => registrations[seed - 1] || null);
  const rounds = Math.log2(size);
  const rows: Row[] = [];
  const rowsByRound: Row[][] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const playersInRound = size / Math.pow(2, round - 1);
    const matchCount = playersInRound / 2;
    const phase = phaseForSize(playersInRound);
    const roundRows: Row[] = [];
    for (let position = 0; position < matchCount; position += 1) {
      const row: Row = {
        id: crypto.randomUUID(),
        legacy_key: `draw:${categoryId}:${Date.now()}:${round}:${position + 1}`,
        tournament_id: tournament.id,
        category_id: categoryId,
        round_no: round,
        round_code: phase,
        phase,
        match_no: position + 1,
        side1_athlete_id: null,
        side2_athlete_id: null,
        winner_athlete_id: null,
        source1_match_id: null,
        source2_match_id: null,
        score: null,
        status: "PENDING",
        sort_order: (round * 1000) + ((position + 1) * 10),
        published: true,
        metadata: { generated: true },
      };
      if (round === 1) {
        const side1 = slots[position * 2];
        const side2 = slots[(position * 2) + 1];
        row.side1_athlete_id = side1?.athlete_id || null;
        row.side2_athlete_id = side2?.athlete_id || null;
        if ((row.side1_athlete_id && !row.side2_athlete_id) || (!row.side1_athlete_id && row.side2_athlete_id)) {
          row.winner_athlete_id = row.side1_athlete_id || row.side2_athlete_id;
          row.status = "FINISHED";
          row.metadata = { generated: true, bye: true };
        }
      } else {
        const previous = rowsByRound[round - 2];
        row.source1_match_id = previous[position * 2]?.id || null;
        row.source2_match_id = previous[(position * 2) + 1]?.id || null;
        const source1 = previous[position * 2];
        const source2 = previous[(position * 2) + 1];
        if (source1?.winner_athlete_id) row.side1_athlete_id = source1.winner_athlete_id;
        if (source2?.winner_athlete_id) row.side2_athlete_id = source2.winner_athlete_id;
      }
      roundRows.push(row);
      rows.push(row);
    }
    rowsByRound.push(roundRows);
  }
  if (rows.length !== size - 1 || rows.some((row) => !row.id || !row.category_id || !row.tournament_id)) {
    throw new Error("A chave gerada não passou na validação interna.");
  }

  const replacement = await client.rpc("tournament_replace_bracket_atomic", {
    p_tournament_id: tournament.id,
    p_category_id: categoryId,
    p_draw_size: size,
    p_matches: rows,
    p_overwrite: payload.overwrite === true,
  });
  assertNoError(replacement.error);
  const result = (replacement.data || {}) as Row;
  const previousMatches = Array.isArray(result.previous_matches) ? result.previous_matches : [];
  const insertedMatches = Array.isArray(result.matches) ? result.matches : [];
  if (insertedMatches.length !== rows.length) throw new Error("A chave não foi gravada por completo.");
  await audit(
    client,
    actorId,
    tournament.id,
    "bracket",
    categoryId,
    previousMatches.length ? "REGENERATE" : "GENERATE",
    previousMatches,
    insertedMatches,
  );
  return { categoria_id: categoryId, tamanho_chave: size, jogos: insertedMatches };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (!["GET", "POST"].includes(request.method)) return json(request, { ok: false, error: "Método inválido." }, 405);

  let failureStage = "setup";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = publicApiKey();
    if (!supabaseUrl || !anonKey) throw new Error("Configuração do Supabase ausente.");
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(request, { ok: false, error: "Sessão inválida." }, 401);
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    failureStage = "session";
    const userResult = await client.auth.getUser(token);
    if (userResult.error || !userResult.data.user) return json(request, { ok: false, error: "Sessão inválida." }, 401);
    failureStage = "profile";
    const profileResult = await client.from("profiles").select("id, role, active, permissions").eq("id", userResult.data.user.id).maybeSingle();
    assertNoError(profileResult.error);
    const profile = (profileResult.data || {}) as Row;
    if (!can(profile, readPermissions)) return json(request, { ok: false, error: "Você não tem permissão para acessar torneios." }, 403);

    if (request.method === "GET") {
      failureStage = "snapshot";
      const url = new URL(request.url);
      const tournamentId = uuid(url.searchParams.get("tournament_id"));
      const slug = text(url.searchParams.get("slug"), 100);
      const data = await loadSnapshot(client, tournamentId, slug);
      return json(request, { ok: true, data });
    }

    failureStage = "payload";
    const payload = await request.json().catch(() => ({})) as Row;
    const action = text(payload.action, 50);
    if (!writeActions.has(action)) return json(request, { ok: false, error: "Ação inválida." }, 400);
    if (!can(profile, writePermissions)) return json(request, { ok: false, error: "Você não tem permissão para alterar torneios." }, 403);

    failureStage = action;
    let result: unknown;
    let responseTournamentId = uuid(payload.tournament_id || payload.torneio_id);
    if (action === "createTournament") {
      result = await saveTournament(client, profile.id, payload, true);
      responseTournamentId = (result as Row).id;
    } else if (action === "saveTournament") {
      result = await saveTournament(client, profile.id, payload, false);
      responseTournamentId = (result as Row).id;
    } else if (action === "saveCategory") {
      result = await saveCategory(client, profile.id, payload);
      responseTournamentId = (result as Row).tournament_id;
    } else if (action === "deleteCategory") result = await deleteCategory(client, profile.id, payload);
    else if (action === "savePlayer") result = await savePlayer(client, profile.id, payload);
    else if (action === "saveRegistration") {
      result = await saveRegistration(client, profile.id, payload);
      responseTournamentId = (result as Row).tournament_id;
    } else if (action === "deleteRegistration") result = await deleteRegistration(client, profile.id, payload);
    else if (action === "generateBracket") result = await generateBracket(client, profile.id, payload);
    else if (action === "saveMatch") result = await saveOneMatch(client, profile.id, payload, firstObject(payload.jogo, payload.match, payload));
    else if (action === "saveMatches") result = await saveMatches(client, profile.id, payload);
    else if (action === "scheduleMatch") result = await updateMatchFields(client, profile.id, payload, "schedule");
    else if (action === "updateScore") result = await updateMatchFields(client, profile.id, payload, "score");
    else if (action === "saveAgendaEvent") result = await saveAgendaEvent(client, profile.id, payload);
    else if (action === "deleteAgendaEvent") result = await deleteAgendaEvent(client, profile.id, payload);
    else result = await setLiveState(client, profile.id, payload);

    const response: Row = { ok: true, result };
    if (payload.returnData === true) {
      if (!responseTournamentId) {
        const tournament = await currentTournament(client, payload).catch(() => null);
        responseTournamentId = tournament?.id || "";
      }
      response.data = await loadSnapshot(client, responseTournamentId, "");
    }
    return json(request, response);
  } catch (error) {
    const message = errorMessage(error);
    console.error("tournament-admin-api failure", { stage: failureStage, message });
    const normalized = message.toLowerCase();
    const status = normalized.includes("não encontr") ? 404 : normalized.includes("já possui") || normalized.includes("obrigat") || normalized.includes("informe") || normalized.includes("escolha") || normalized.includes("necessária") ? 400 : 500;
    return json(request, { ok: false, error: message, code: failureStage }, status);
  }
});
