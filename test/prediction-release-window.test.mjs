import test from 'node:test';
import assert from 'node:assert/strict';
import { releasedPredictionWindow } from '../supabase/functions/_shared/prediction-release-window.ts';

const day = '2026-09-19';
const match = { prediction_opened_at: '2026-09-19T16:00:00Z', prediction_opened_on: day };

test('final nova das 15h abre depois do corte da manhã e fecha às 15h locais', () => {
  const window = releasedPredictionWindow(match, day, '2026-09-19T15:00:00-03:00', 'America/Sao_Paulo');
  assert.equal(window.opensAt, match.prediction_opened_at);
  assert.equal(window.closesAt, '2026-09-19T18:00:00.000Z');
});

test('Após usa o fim do dia local como limite máximo, sem herdar horário da manhã', () => {
  const window = releasedPredictionWindow(match, day, '', 'America/Sao_Paulo');
  assert.equal(window.closesAt, '2026-09-20T03:00:00.000Z');
});

test('remarcar o dia não carrega liberação antiga', () => {
  assert.equal(releasedPredictionWindow(match, '2026-09-20', '', 'America/Sao_Paulo'), null);
  assert.equal(releasedPredictionWindow({}, day, '', 'America/Sao_Paulo'), null);
});

test('fuso diferente e horário após meia-noite continuam limitados ao dia da agenda', () => {
  const window = releasedPredictionWindow(match, day, '2026-09-21T12:00:00Z', 'Europe/Lisbon');
  assert.equal(window.closesAt, '2026-09-19T23:00:00.000Z');
});
