import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const adminPage = await readFile(path.join(projectRoot, 'adm/index.html'), 'utf8');

test('topo do torneio mostra um único título com o nome atual', () => {
  assert.match(adminPage, /<h1 id="tournamentTitle">Gestão Ilha Open 2026<\/h1>/);
  assert.match(adminPage, /\$\('tournamentTitle'\)\.textContent = 'Gestão ' \+ \(data\.torneio\.nome \|\| 'do torneio'\)/);
  assert.doesNotMatch(adminPage, /id="tournamentSubtitle"|Gestão do Torneio Ilha/);
});

test('configurações do torneio ficam organizadas em blocos recolhíveis', () => {
  const groups = adminPage.match(/<details class="card span-12 tournament-settings-group"/g) || [];
  assert.equal(groups.length, 6);
  assert.match(adminPage, /<strong>Dados do torneio<\/strong>/);
  assert.match(adminPage, /<strong>Imagens e abertura<\/strong>/);
  assert.match(adminPage, /<strong>Valores da inscrição<\/strong>/);
  assert.match(adminPage, /<strong>Classes<\/strong>/);
  assert.match(adminPage, /<strong>Página pública<\/strong>/);
  assert.match(adminPage, /<strong>Notificações<\/strong>/);
  assert.match(adminPage, /\.tournament-settings-group\[open\] > summary::after/);
});

test('textos repetitivos e o cartão antigo de publicação foram removidos', () => {
  [
    'Edite jogadores, placares e horarios diretamente nos jogos.',
    'Acompanhe para quem cada convite foi criado e se ele já foi utilizado.',
    'Acesse e copie todos os endereços do torneio em um só lugar.',
    'Clique no jogo para editar. Arraste ⋮⋮ para ordenar; dia, horário e quadra salvam automaticamente.',
    'Fluxo sugerido: jogadores, inscrições, chave, agenda e placar.',
    'Na aba Chaves, use "Imagem Instagram" para baixar a arte da categoria atual em alta qualidade.',
  ].forEach((copy) => assert.doesNotMatch(adminPage, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
});
