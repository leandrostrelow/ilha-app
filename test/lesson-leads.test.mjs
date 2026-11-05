import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateLead, validateLeadUpdate, phoneDigits, sheetPayload } from '../supabase/functions/_shared/lesson-leads.js';
const sample = () => ({nome:'Aluno de teste',telefone:'(27) 99999-0000',idade:'25',publico:'Adulto',genero:'',responsavel:'',dias_disponiveis:['Segunda','Quinta'],periodo:'Noite',ja_fez_aula:'Não',nivel:'Avançado',frequencia:'1x: R$250',objetivo:'Aprender do zero',como_conheceu:'Instagram',observacoes:'',consent:true});
test('lead intake normalizes contact and clears irrelevant skill level',()=>{
  const lead=validateLead(sample());assert.equal(lead.telefone,'5527999990000');assert.equal(lead.nivel,'');assert.equal(lead.idade,25);
  assert.equal(phoneDigits('+55 27 99999-0000'),'5527999990000');assert.equal(phoneDigits('123'),'');
});
test('lead intake validates required consent, days, ranges, and text limits',()=>{
  for(const patch of [{consent:false},{telefone:'123'},{idade:'-2'},{idade:2.5},{dias_disponiveis:['Domingo']},{dias_disponiveis:'Segunda'},{nome:'A'},{observacoes:'x'.repeat(1501)},{frequencia:'3x'},{periodo:'Madrugada'},{genero:{}},{como_conheceu:'TikTok'},{utm:{utm_source:'x'.repeat(101)}}])assert.throws(()=>validateLead({...sample(),...patch}));
  assert.deepEqual(validateLead({...sample(),dias_disponiveis:['Segunda','Segunda']}).dias_disponiveis,['Segunda']);
});
test('minor leads require responsible adult regardless of selected audience',()=>{
  assert.throws(()=>validateLead({...sample(),idade:12}));
  assert.throws(()=>validateLead({...sample(),publico:'Criança',idade:''}));
  assert.equal(validateLead({...sample(),idade:12,responsavel:'Responsável teste'}).responsavel,'Responsável teste');
});
test('admin updates restrict workflow and validate professor and dates',()=>{
  assert.throws(()=>validateLeadUpdate({status:'admin'}));assert.throws(()=>validateLeadUpdate({status:'encaminhado'}));
  assert.throws(()=>validateLeadUpdate({status:'novo',proximo_contato:'2026-02-30'}));
  assert.throws(()=>validateLeadUpdate({status:'novo',professor_telefone:'123'}));
  const v=validateLeadUpdate({status:'encaminhado',professor_nome:'Renato',professor_telefone:'27992963984',confirm_forward:true});
  assert.equal(v.confirm_forward,true);assert.equal(v.professor_telefone,'5527992963984');
});
test('spreadsheet payload preserves legacy fields, days, guardian and prevents formulas',()=>{
  const payload=sheetPayload({...validateLead(sample()),nome:'=IMPORTXML("bad")',responsavel:'Maria',observacoes:'Olá'});
  assert.equal(payload.action,'submit');assert.ok(payload.nome.startsWith("'="));assert.deepEqual(payload.dias_disponiveis,['Segunda','Quinta']);assert.equal(payload.observacoes,'Responsável: Maria · Como conheceu: Instagram · Olá');
  assert.equal(payload.genero,'Não informado');assert.equal(payload.como_conheceu,'Instagram');assert.match(payload.observacoes,/Como conheceu: Instagram/);
});
const [api,sql,teacherGrant,leadNotifications,dispatcher,admin,ui,form,js,build]=await Promise.all(['supabase/functions/lesson-leads-api/index.ts','supabase/migrations/20260930132818_lesson_lead_intake.sql','supabase/migrations/20260930145232_restore_lesson_lead_teacher_read.sql','supabase/migrations/20260930150615_lesson_lead_admin_notifications.sql','supabase/functions/client-notification-dispatch/index.ts','adm/index.html','adm/leads.js','aulas.html','aulas.js','scripts/build.mjs'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
test('lead management is private and anonymous submit has no list privileges',()=>{
  assert.match(api,/auth\.getUser\(token\)/);assert.match(api,/rpc\("has_club_permission", \{ p_permission: "classes" \}\)/);
  assert.ok(api.indexOf('auth.getUser(token)')<api.indexOf('body.action === "list"'));
  assert.match(sql,/revoke all on public\.lesson_leads, public\.lesson_lead_events from anon, authenticated/);
  assert.match(sql,/enable row level security/g);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/revoke all on function public\.lesson_lead_submit.*from public, anon, authenticated/);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/request_id uuid unique/);
});
test('sheet retries are manually confirmed and never auto-replay ambiguous writes',()=>{
  assert.match(api,/confirm_checked !== true/);assert.match(api,/retry \? \["pending", "failed", "uncertain"\] : \["pending"\]/);
  assert.match(api,/sheet_sync: "sending"/);assert.match(api,/let status = "uncertain"/);
  assert.match(ui,/Abrir o WhatsApp não confirma o envio/);assert.match(ui,/Já encaminhado conforme anotação/);
  assert.match(sql,/where id = p_id and revision = p_revision/);
});
test('lead page and admin integrate in navigation with no public PII cache',()=>{
  assert.match(admin,/data-admin-nav="club-leads"/);assert.match(admin,/'club-leads': 'classes'/);
  assert.equal((admin.match(/'club-leads': openLeadsModule/g)||[]).length,2);
  assert.match(admin,/IlhaLeadsAdmin\.clear\(\)/);
  assert.match(form,/id="responsavel"/);assert.match(form,/id="consent"/);
  assert.match(js,/crypto\.randomUUID/);assert.doesNotMatch(js,/localStorage/);
  assert.match(build,/'adm\/leads\.js','adm\/leads\.css'/);
});
test('lead list survives an auxiliary teacher lookup failure and service role can read teachers',()=>{
  assert.match(api,/if \(leads\.error\) throw leads\.error/);
  assert.match(api,/teachers\.error \? \[\] : \(teachers\.data \|\| \[\]\)/);
  assert.match(api,/lesson_leads_teachers_load_failed/);
  assert.match(teacherGrant,/grant select on table public\.teachers to service_role/);
});
test('lead detail supports fixed WhatsApp forwarding, confirmation, editing and guarded deletion',()=>{
  assert.match(ui,/Emerson.*557391837772/);assert.match(ui,/Gabriel.*5527997148039/);assert.match(ui,/Renato.*5527992963984/);
  assert.match(admin,/id="leadForwardTeacher"/);assert.match(admin,/id="leadStudentWhatsApp"[^>]*>Enviar confirmação pelo WhatsApp/);
  assert.match(admin,/id="leadDelete"[^>]*>Excluir lead/);assert.match(admin,/id="leadSave"[^>]*>Salvar alterações/);
  assert.match(ui,/action:'delete',id:lead\.id,revision:lead\.revision/);assert.match(ui,/a linha da planilha não será removida automaticamente/);
  assert.match(api,/body\.action === "delete"/);assert.match(api,/\.eq\("revision", body\.revision\)/);assert.match(api,/lesson_lead_deleted/);
});
test('new lesson leads show a navigation badge and notify authorized ADM devices',()=>{
  assert.match(admin,/data-lead-nav-badge/);assert.match(ui,/action:'count'/);assert.match(api,/body\.action === "count"/);
  assert.match(leadNotifications,/after insert on public\.lesson_leads/);assert.match(leadNotifications,/NOVO_INTERESSADO_AULA/);
  assert.match(leadNotifications,/protected_access_accounts/);assert.match(leadNotifications,/\? 'classes'/);
  assert.match(dispatcher,/adminOnlyEvents[\s\S]*NOVO_INTERESSADO_AULA/);
  assert.match(admin,/NOVO_INTERESSADO_AULA[\s\S]*Ver interessados/);assert.match(admin,/refreshBadge\(leadAdminContext\(\)\)/);
});
test('lead form opens directly without the promotional intro block',()=>{
  assert.doesNotMatch(form,/aulas-intro|court-art|Tem uma turma esperando/);
  assert.match(form,/<main class="aulas-layout">\s*<section class="aulas-card">/);
  assert.match(form,/value="1x: R\$250"[\s\S]*?>R\$ 250,00<\/strong>/);
  assert.match(form,/label:has\(input:checked\).*border-color:#8fbe00.*background:#f3fbdc/);
  assert.match(form,/accent-color:#8fbe00/);
  assert.match(form,/name="como_conheceu" value="Instagram" required/);
  assert.match(form,/value="Google"/);assert.match(form,/value="Indicação"/);
  assert.doesNotMatch(form,/Os dados ficam no cadastro interno/);
  assert.match(form,/Preencher não faz matrícula nem reserva horário/);
  assert.match(form,/Como a procura pelas aulas está alta e as vagas são limitadas/);
  assert.match(form,/entraremos em contato pelo WhatsApp assim que encontrarmos a melhor solução/);
});
