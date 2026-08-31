import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const migrationSource = await readFile(
  path.join(
    projectRoot,
    'supabase',
    'migrations',
    '20260825191004_open_court_notification_delivery_hardening.sql'
  ),
  'utf8'
);
const clientSource = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
const dispatcherSource = await readFile(
  path.join(projectRoot, 'supabase', 'functions', 'client-notification-dispatch', 'index.ts'),
  'utf8'
);

test('desafios abertos criam notificacoes deduplicadas apenas para clientes aptos', () => {
  assert.match(migrationSource, /create or replace function public\.notify_clients_about_open_court_challenge\(\)/i);
  assert.match(migrationSource, /'CONVITE_QUADRA_ABERTO'/);
  assert.match(
    migrationSource,
    /'court-challenge-open:'\s*\|\|\s*new\.id::text\s*\|\|\s*':'\s*\|\|\s*new\.challenge_invite_version::text\s*\|\|\s*':'\s*\|\|\s*candidate\.id::text/i
  );
  assert.match(migrationSource, /upper\(coalesce\(candidate\.status, ''\)\) = 'ATIVO'/i);
  assert.match(migrationSource, /candidate\.registration_completed_at is not null/i);
  assert.match(migrationSource, /candidate\.id <> new\.client_id/i);
  assert.match(migrationSource, /on conflict \(dedupe_key\) where dedupe_key is not null do nothing/i);
  assert.match(migrationSource, /after insert or update of status, challenge_kind, challenge_invite_version/i);
});

test('fanout apenas enfileira e deixa o cron disparar um unico worker', () => {
  const queueFunction = migrationSource.match(
    /create or replace function public\.queue_app_client_notification_push\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$/i
  );
  assert.ok(queueFunction, 'funcao de fila nao encontrada');
  assert.match(queueFunction[1], /insert into public\.app_client_notification_dispatches/i);
  assert.doesNotMatch(queueFunction[1], /invoke_app_client_notification_dispatch/i);
});

test('RPC autenticada transfere a subscription para a conta ativa e confirma o dono', () => {
  assert.match(migrationSource, /create or replace function public\.upsert_current_app_push_subscription\(/i);
  assert.match(migrationSource, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migrationSource, /on conflict \(endpoint\) do update/i);
  assert.match(migrationSource, /set user_id = excluded\.user_id/i);
  assert.match(
    migrationSource,
    /grant execute on function public\.upsert_current_app_push_subscription\(text, text, text, text\)\s+to authenticated/i
  );
  assert.match(clientSource, /rest\('rpc\/upsert_current_app_push_subscription'/);
  assert.match(clientSource, /String\(saved\.owner_user_id \|\| ''\) !== userId/);
  assert.match(clientSource, /clientPushSubscriptionOwnerUserId === userId/);
  assert.doesNotMatch(
    clientSource,
    /rest\('app_push_subscriptions\?on_conflict=endpoint'/
  );
});

test('dispatcher isola falhas por aparelho e persiste estados honestos', () => {
  assert.match(dispatcherSource, /Promise\.allSettled/);
  assert.match(dispatcherSource, /status = "PARCIAL"/);
  assert.match(dispatcherSource, /status = "SEM_ASSINATURA"/);
  assert.match(dispatcherSource, /status = reachedAttemptLimit \? "FALHOU" : "PENDENTE"/);
  assert.match(dispatcherSource, /notificationTtlSeconds\(dispatch\.event_type\)/);
  assert.match(dispatcherSource, /normalized === "LEMBRETE_QUADRA"/);
  assert.match(dispatcherSource, /normalized === "CONVITE_QUADRA_ABERTO"/);
  assert.match(dispatcherSource, /if \(\(subscriptions \|\| \[\]\)\.length\) await ensurePushConfiguration\(\)/);
  assert.ok(
    dispatcherSource.indexOf('if ((subscriptions || []).length) await ensurePushConfiguration()') >
      dispatcherSource.indexOf('if (subscriptionsError) throw subscriptionsError'),
    'VAPID deve ser carregado somente depois de confirmar que há assinatura Push'
  );
  assert.match(migrationSource, /notification\.event_type/);
  assert.match(migrationSource, /auth\.jwt\(\) ->> 'role'/);
  assert.doesNotMatch(migrationSource, /request\.jwt\.claim\.role/);
  assert.match(migrationSource, /'PARCIAL'/);
  assert.match(migrationSource, /'SEM_ASSINATURA'/);
});
