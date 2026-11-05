import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";
import { CHARACTERS, VERSION, replayGame } from "../_shared/ilha-tennis-engine.js";
import { VERSION as LEGACY_VERSION, replayGame as replayLegacyGame } from "../_shared/ilha-tennis-engine-v1.js";

const supportedVersions = new Set([VERSION, LEGACY_VERSION]);
const telemetryEvents = new Set(["game_opened", "campaign_started", "match_started", "match_finished", "campaign_completed"]);

class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("");
}
function serviceKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { return JSON.parse(keys).default || ""; } catch { /* legacy fallback */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
Deno.serve(async (request: Request) => {
  const headers = { ...appCorsHeaders(request, "POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.headers.get("origin") && headers["Access-Control-Allow-Origin"] === "null") return reply({ error: "Origem não autorizada." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Método não permitido." }, 405);
  try {
    // Bound the streamed body before allocating a replay from untrusted input.
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError("Informe a partida.");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 42000) { await reader.cancel(); throw new RequestError("Partida inválida.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RequestError("Pedido inválido."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Pedido inválido.");
    const secret = serviceKey();
    if (!secret) throw new RequestError("Ranking temporariamente indisponível.", 503);
    const client = createClient(Deno.env.get("SUPABASE_URL") || "", secret, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "leaderboard") {
      // Unversioned requests came from the original published client.
      const rankingVersion = body.version || LEGACY_VERSION;
      if (!supportedVersions.has(rankingVersion)) throw new RequestError("Versão do ranking inválida.");
      const { data, error } = await client.from("arcade_scores")
        .select("nickname,character,score,points_won,returns,achieved_at").eq("game", rankingVersion)
        .order("score", { ascending: false }).order("points_won", { ascending: false })
        .order("returns", { ascending: false }).order("achieved_at", { ascending: true }).limit(10);
      if (error) throw error;
      return reply({ scores: data });
    }
    if (!supportedVersions.has(body.version)) throw new RequestError("Atualize a página para jogar a versão mais recente.", 409);
    if (typeof body.identity !== "string" || !/^[a-f0-9]{64}$/.test(body.identity)) throw new RequestError("Reabra o jogo para iniciar seu jogador.", 401);
    const playerHash = await sha256(`arcade-player:${body.identity}`);
    if (body.action === "telemetry") {
      if (typeof body.event_id !== "string" || !/^[a-f0-9-]{36}$/.test(body.event_id)) throw new RequestError("Evento inválido.");
      if (typeof body.event !== "string" || !telemetryEvents.has(body.event)) throw new RequestError("Evento inválido.");
      const rawProperties = body.properties && typeof body.properties === "object" && !Array.isArray(body.properties) ? body.properties : {};
      const entries = Object.entries(rawProperties);
      if (entries.length > 2 || entries.some(([key, value]) => !/^[a-z][a-z0-9_]{0,31}$/.test(key) ||
        !["string", "number", "boolean"].includes(typeof value) || (typeof value === "string" && value.length > 80))) {
        throw new RequestError("Detalhes do evento inválidos.");
      }
      const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
      const ipHash = await sha256(`${secret}:arcade-telemetry-ip:${ip.trim().slice(0, 64)}`);
      const since = new Date(Date.now() - 3600000).toISOString();
      const { count, error: rateError } = await client.from("arcade_telemetry_events").select("event_id", { count: "exact", head: true })
        .gte("occurred_at", since).or(`player_hash.eq.${playerHash},ip_hash.eq.${ipHash}`);
      if (rateError) throw rateError;
      if ((count || 0) >= 240) throw new RequestError("Muitos eventos enviados. Tente novamente mais tarde.", 429);
      const { error } = await client.from("arcade_telemetry_events").upsert({
        event_id: body.event_id, event_name: body.event, player_hash: playerHash, ip_hash: ipHash,
        game_version: body.version, properties: Object.fromEntries(entries),
      }, { onConflict: "event_id", ignoreDuplicates: true });
      if (error) throw error;
      return reply({ saved: true });
    }
    if (body.action === "start") {
      const nickname = typeof body.nickname === "string" ? body.nickname.normalize("NFC").trim().replace(/\s+/g, " ") : "";
      if (!/^[\p{L}\p{N} ._'-]{2,18}$/u.test(nickname)) throw new RequestError("Use um apelido de 2 a 18 letras ou números.");
      if (!CHARACTERS.some(c => c.id === body.character)) throw new RequestError("Escolha um jogador.");
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const ipHash = await sha256(`${secret}:arcade-ip:${ip.slice(0, 64)}`);
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const { data, error } = await client.rpc("arcade_start_run", { p_player_hash: playerHash, p_ip_hash: ipHash, p_nickname: nickname, p_character: body.character, p_seed: seed, p_game: body.version });
      if (error?.message.includes("ARCADE_RATE_LIMIT")) throw new RequestError("Muitas partidas iniciadas. Faça um treino e tente o ranking mais tarde.", 429);
      if (error) throw error;
      return reply(data);
    }
    if (body.action === "finish") {
      if (typeof body.run_id !== "string" || !/^[a-f0-9-]{36}$/.test(body.run_id)) throw new RequestError("Partida inválida.");
      const { data: run, error } = await client.from("arcade_runs").select("id,seed,character,game,started_at,finished_at,score")
        .eq("id", body.run_id).eq("player_hash", playerHash).maybeSingle();
      if (error) throw error;
      if (!run) throw new RequestError("Partida não encontrada para este jogador.", 404);
      if (run.finished_at) return reply({ saved: true, score: run.score });
      if (!supportedVersions.has(run.game) || body.version !== run.game) throw new RequestError("A versão informada não corresponde à partida.", 409);
      const elapsed = Date.now() - Date.parse(run.started_at);
      if (elapsed < 88000) throw new RequestError("A partida ainda não terminou. Aguarde e tente novamente.", 409);
      if (elapsed > 86400000) throw new RequestError("Esta partida venceu. Jogue novamente para entrar no ranking.", 410);
      let result;
      try {
        const verify = run.game === LEGACY_VERSION ? replayLegacyGame : replayGame;
        result = verify(Number(run.seed), run.character, body.inputs);
      } catch { throw new RequestError("Não foi possível validar esta partida."); }
      const { data, error: finishError } = await client.rpc("arcade_finish_run", {
        p_run_id: run.id, p_player_hash: playerHash, p_score: result.score,
        p_points_won: result.playerPoints, p_points_lost: result.cpuPoints, p_returns: result.returns,
      });
      if (finishError) throw finishError;
      return reply(data);
    }
    throw new RequestError("Ação inválida.");
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    console.error("arcade-api", error instanceof Error ? error.message : "database request failed");
    return reply({ error: "Não foi possível salvar agora. Tente novamente em instantes." }, 500);
  }
});
