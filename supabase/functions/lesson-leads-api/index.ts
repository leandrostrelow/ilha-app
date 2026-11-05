import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";
import { validateLead, validateLeadUpdate, sheetPayload } from "../_shared/lesson-leads.js";

const SHEET_URL = "https://script.google.com/macros/s/AKfycbwVXDL_cZFDf6EV-Lr6358qMeazixeLm0Jf2z1Lv5hRCi0UHkRrlgE-GnaLkJiFm2F5/exec";
const leadColumns = "id,created_at,updated_at,revision,nome,telefone,idade,publico,genero,responsavel,dias_disponiveis,periodo,ja_fez_aula,nivel,frequencia,objetivo,como_conheceu,observacoes,status,teacher_id,professor_nome,professor_telefone,encaminhado_em,proximo_contato,aula_em,anotacoes,source,source_note,sheet_sync,sheet_attempt_at,sheet_synced_at,sheet_error";
class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
function envKey(legacy: string, current: string) {
  const raw = Deno.env.get(current);
  if (raw) { try { return JSON.parse(raw).default || ""; } catch { /* legacy fallback */ } }
  return Deno.env.get(legacy) || "";
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Dados não informados.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 20000) { await reader.cancel(); throw new RequestError("Dados muito grandes.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const b = JSON.parse(new TextDecoder().decode(bytes)); if (b && typeof b === "object" && !Array.isArray(b)) return b; } catch { /* invalid JSON */ }
  throw new RequestError("Dados inválidos.");
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
type Client = SupabaseClient<any, "public", "public", any>;
async function syncSheet(client: Client, id: string, retry = false) {
  // A compare-and-set claim prevents concurrent sends. Ambiguous delivery NEVER auto-retries.
  const { data: lead, error } = await client.from("lesson_leads").update({ sheet_sync: "sending", sheet_attempt_at: new Date().toISOString(), sheet_error: null })
    .eq("id", id).in("sheet_sync", retry ? ["pending", "failed", "uncertain"] : ["pending"]).select("*").maybeSingle();
  if (error) throw error;
  if (!lead) return;
  let status = "uncertain"; let message = "Sem confirmação da planilha. Confira antes de reenviar.";
  try {
    const response = await fetch(SHEET_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(sheetPayload(lead)), signal: AbortSignal.timeout(12000) });
    const result = await response.json();
    if (response.ok && result.success === true) { status = "synced"; message = ""; }
    else if (result.success === false) { status = "failed"; message = "A planilha recusou o envio. O cadastro está salvo no ADM."; }
  } catch { /* Persist ambiguity: the legacy endpoint does not support idempotency keys. */ }
  const { error: updateError } = await client.from("lesson_leads").update({ sheet_sync: status, sheet_error: message || null,
    ...(status === "synced" ? { sheet_synced_at: new Date().toISOString() } : {}) }).eq("id", id).eq("sheet_sync", "sending");
  if (updateError) throw updateError;
}

Deno.serve(async (request: Request) => {
  const headers = { ...appCorsHeaders(request, "POST, OPTIONS"), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.headers.get("origin") && headers["Access-Control-Allow-Origin"] === "null") return reply({ error: "Origem não autorizada." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Método inválido." }, 405);
  try {
    const body = await readBody(request);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const secret = envKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
    const publicKey = envKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
    if (!url || !secret || !publicKey) throw new RequestError("Serviço indisponível. Tente novamente.", 503);
    const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "submit") {
      if (body.website) return reply({ ok: true }); // honeypot: never persists or forwards spam
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.request_id || "")) throw new RequestError("Atualize a página e tente novamente.");
      let data;
      try { data = validateLead(body); } catch (e) { throw new RequestError((e as Error).message); }
      const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
      const ipHash = await hash(secret + ":lesson-lead:" + ip.trim().slice(0, 80));
      const { data: id, error } = await client.rpc("lesson_lead_submit", { p_request: body.request_id, p_ip_hash: ipHash, p_data: data });
      if (error?.message.includes("LEAD_RATE_LIMIT")) throw new RequestError("Muitos cadastros em pouco tempo. Tente novamente mais tarde.", 429);
      if (error) throw error;
      // Durable primary write already succeeded; sheet outages must not turn a saved lead into a failed form.
      try { await syncSheet(client, id); } catch { console.error("lesson_leads_sheet_state_failed"); }
      return reply({ ok: true });
    }
    // Administrative actions: verify JWT with Auth AND current protected-account permissions.
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new RequestError("Entre no ADM para continuar.", 401);
    const userClient = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + token } } });
    const { data: auth, error: authError } = await userClient.auth.getUser(token);
    if (authError || !auth.user) throw new RequestError("Sua sessão expirou. Entre novamente.", 401);
    const { data: allowed, error: permissionError } = await userClient.rpc("has_club_permission", { p_permission: "classes" });
    if (permissionError || allowed !== true) throw new RequestError("Seu acesso não permite gerenciar interessados em aulas.", 403);

    if (body.action === "count") {
      const { count, error } = await client.from("lesson_leads").select("id", { count: "exact", head: true }).eq("status", "novo");
      if (error) throw error;
      return reply({ ok: true, new_count: count || 0 });
    }
    if (body.action === "list") {
      const offset = Number(body.offset || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new RequestError("Página inválida.");
      const [leads, teachers] = await Promise.all([
        client.from("lesson_leads").select(leadColumns, { count: "exact" }).order("created_at", { ascending: false }).order("id").range(offset, offset + 199),
        client.from("teachers").select("id,name,phone").eq("active", true).neq("name", "Sem Professor").order("name"),
      ]);
      if (leads.error) throw leads.error;
      // Teacher assignment is auxiliary: a permission or availability problem there must
      // never hide leads that were safely stored in the primary table.
      if (teachers.error) console.error("lesson_leads_teachers_load_failed", teachers.error.code || "internal");
      const availableTeachers = teachers.error ? [] : (teachers.data || []);
      return reply({ ok: true, leads: leads.data, total: leads.count, teachers: availableTeachers.map(t => ({ ...t, phone: t.phone || (t.name.toLowerCase() === "renato" ? "5527992963984" : "") })) });
    }
    if (!/^[a-f0-9-]{36}$/i.test(body.id || "")) throw new RequestError("Cadastro inválido.");
    if (body.action === "delete") {
      if (!Number.isInteger(body.revision) || body.revision < 1) throw new RequestError("Reabra o cadastro antes de excluir.");
      const { data: deleted, error } = await client.from("lesson_leads").delete().eq("id", body.id).eq("revision", body.revision).select("id").maybeSingle();
      if (error) throw error;
      if (!deleted) throw new RequestError("Este cadastro foi atualizado por outra pessoa. Reabra e confira antes de excluir.", 409);
      console.info("lesson_lead_deleted", { id: body.id, actor: auth.user.id });
      return reply({ ok: true });
    }
    if (body.action === "detail") {
      const [lead, events] = await Promise.all([
        client.from("lesson_leads").select(leadColumns).eq("id", body.id).maybeSingle(),
        client.from("lesson_lead_events").select("id,created_at,kind,detail").eq("lead_id", body.id).order("created_at", { ascending: false }).limit(100),
      ]);
      if (lead.error || events.error) throw lead.error || events.error;
      if (!lead.data) throw new RequestError("Cadastro não encontrado.", 404);
      return reply({ ok: true, lead: lead.data, events: events.data });
    }
    if (body.action === "update") {
      if (!Number.isInteger(body.revision) || body.revision < 1) throw new RequestError("Reabra o cadastro.");
      let patch;
      try { patch = validateLeadUpdate(body); } catch (e) { throw new RequestError((e as Error).message); }
      if (patch.teacher_id) {
        const { data: teacher, error } = await client.from("teachers").select("name").eq("id", patch.teacher_id).eq("active", true).maybeSingle();
        if (error) throw error;
        if (!teacher) throw new RequestError("Professor não encontrado.");
        patch.professor_nome = teacher.name;
      }
      const detail = (patch.confirm_forward ? "Encaminhamento confirmado" : "Cadastro atualizado") + ": " + patch.status + (patch.professor_nome ? " · " + patch.professor_nome : "") + (patch.proximo_contato ? " · retorno " + patch.proximo_contato : "") + (patch.anotacoes ? " · " + patch.anotacoes.slice(0, 1500) : "");
      const { error } = await client.rpc("lesson_lead_update", { p_id: body.id, p_revision: body.revision, p_patch: patch, p_actor: auth.user.id, p_detail: detail });
      if (error?.message.includes("LEAD_CONFLICT")) throw new RequestError("Outra pessoa atualizou este cadastro. Feche e reabra para conferir antes de salvar.", 409);
      if (error) throw error;
      return reply({ ok: true });
    }
    if (body.action === "sync_sheet") {
      if (body.confirm_checked !== true) throw new RequestError("Confira primeiro se o contato já está na planilha.");
      // Recover abandoned claims only after a generous grace period, with explicit manual confirmation.
      await client.from("lesson_leads").update({ sheet_sync: "uncertain" }).eq("id", body.id).eq("sheet_sync", "sending").lt("sheet_attempt_at", new Date(Date.now() - 300000).toISOString());
      await syncSheet(client, body.id, true);
      return reply({ ok: true });
    }
    throw new RequestError("Ação inválida.");
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    console.error("lesson_leads_request_failed", (error as { code?: string })?.code || "internal");
    return reply({ error: "Não foi possível concluir agora. Tente novamente." }, 500);
  }
});
