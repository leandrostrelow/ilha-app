import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const migration = await readFile(
  path.join(
    projectRoot,
    'supabase',
    'migrations',
    '20260902174420_harden_announcement_audiences_and_notify_tournament_admins.sql'
  ),
  'utf8'
);
const broadcast = await readFile(
  path.join(projectRoot, 'supabase', 'functions', 'client-broadcast-push', 'index.ts'),
  'utf8'
);
const dispatcher = await readFile(
  path.join(projectRoot, 'supabase', 'functions', 'client-notification-dispatch', 'index.ts'),
  'utf8'
);
const client = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
const admin = await readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `função ${name} não encontrada`);
  const nextFunction = source.indexOf('\n    function ', start + 1);
  return source.slice(start, nextFunction < 0 ? source.length : nextFunction);
}

test('comunicado em massa exige público explícito e nunca assume todos', () => {
  assert.match(broadcast, /const targetType = String\(input\.target_type \|\| ""\)/);
  assert.doesNotMatch(broadcast, /input\.target_type \|\| "todos"/);
  assert.match(broadcast, /if \(!userId && !targetType\)/);
  assert.match(migration, /alter column target_type drop default/i);
  assert.match(migration, /normalized_target_type not in \('todos', 'plano', 'aluno', 'mensalista', 'avulso'\)/i);
  assert.match(migration, /app_announcements_target_plan_required_check[\s\S]*target_type <> 'plano'[\s\S]*target_plan_code/i);
  assert.match(migration, /app_announcements_target_type_check[\s\S]*\('todos', 'aluno', 'mensalista', 'avulso', 'plano'\)/i);
  assert.doesNotMatch(migration, /target_type = 'outro'/i);
});

test('leitura do comunicado é protegida no banco pela mesma audiência da fila', () => {
  assert.match(migration, /create policy "announcements read own audience or permitted staff"/i);
  assert.match(migration, /client\.id = \(select auth\.uid\(\)\)/i);
  for (const target of ['todos', 'plano', 'aluno', 'mensalista', 'avulso']) {
    assert.match(migration, new RegExp(`target_type = '${target}'|normalized_target_type = '${target}'`, 'i'));
  }
  assert.match(migration, /target_type = 'plano'[\s\S]*nullif\(btrim\(coalesce\(target_plan_code, ''\)\), ''\) is not null/i);
  assert.match(migration, /security definer[\s\S]*auth\.jwt\(\) ->> 'role'[\s\S]*service_role/i);
  assert.match(migration, /revoke all on function public\.enqueue_app_client_broadcast[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.enqueue_app_client_broadcast[\s\S]*to service_role/i);
});

test('nova inscrição cria um único aviso mínimo para o ADM e não copia PII', () => {
  const triggerFunction = migration.match(
    /create or replace function public\.notify_club_admins_about_tournament_registration\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i
  );
  assert.ok(triggerFunction, 'trigger de inscrição não encontrado');
  assert.match(triggerFunction[1], /new\.parent_registration_id is not null/);
  assert.match(triggerFunction[1], /coalesce\(new\.registration_group_id::text, new\.id::text\)/);
  assert.match(triggerFunction[1], /'TORNEIO_INSCRICAO'/);
  assert.match(triggerFunction[1], /on conflict \(dedupe_key\).*do nothing/is);
  assert.match(triggerFunction[1], /protected_access_accounts/);
  assert.match(triggerFunction[1], /\? 'tournaments'/);
  assert.doesNotMatch(triggerFunction[1], /new\.(?:public_name|email|phone|cpf)|tournament_athletes/i);
  assert.match(migration, /after insert on public\.tournament_registrations/i);
});

test('evento de inscrição usa somente subscriptions do ADM e Ilha Play o ignora', () => {
  assert.match(dispatcher, /adminOnlyEvents = new Set\(\["NOVO_ALUNO", "TORNEIO_INSCRICAO"\]\)/);
  assert.match(dispatcher, /notificationSurface\(dispatch\.event_type\)/);
  assert.match(dispatcher, /subscriptionSurface === "ADM" \? "ilha-adm" : "ilha-play"/);
  assert.match(client, /\['NOVO_ALUNO', 'TORNEIO_INSCRICAO', 'COMUNICADO'\]/);
  assert.match(client, /\['COMUNICADO', 'NOVO_ALUNO', 'TORNEIO_INSCRICAO'\]/);
});

test('publicação no app não dispara Push automaticamente', () => {
  assert.match(admin, /id="announcementSendPush"/);
  const createAnnouncement = functionBody(admin, 'createAnnouncementAction');
  assert.match(createAnnouncement, /sendPushNow/);
  assert.match(createAnnouncement, /if \(!editingItem && sendPushNow && payload\.body\)/);
  assert.doesNotMatch(createAnnouncement, /if \(!editingItem && payload\.body\)/);
});
