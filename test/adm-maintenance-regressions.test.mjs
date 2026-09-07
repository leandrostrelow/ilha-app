import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const [adminSource, versionSource] = await Promise.all([
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'app-version.json'), 'utf8'),
]);

const adminCssMatch = adminSource.match(/<style>([\s\S]*?)<\/style>/i);
assert.ok(adminCssMatch, 'folha de estilos inline do ADM não encontrada');
const adminCss = adminCssMatch[1];

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `função ${name} não encontrada`);
  const nextFunction = source.indexOf('\n    function ', start + 1);
  return source.slice(start, nextFunction < 0 ? source.length : nextFunction);
}

function blockBody(source, openingBraceIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let inComment = false;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (current === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }

  assert.fail('bloco CSS sem fechamento');
}

function maxWidthMediaBodies(source, maximumWidth) {
  const bodies = [];
  const mediaPattern = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let match;
  while ((match = mediaPattern.exec(source))) {
    const width = Number(match[1]);
    if (width <= maximumWidth) {
      bodies.push(blockBody(source, match.index + match[0].lastIndexOf('{')));
    }
  }
  return bodies.join('\n');
}

function declarationsFor(source, selectorFragment) {
  const declarations = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(source))) {
    if (match[1].includes(selectorFragment)) declarations.push(match[2]);
  }
  return declarations.join('\n');
}

test('detalhes do cliente do Bar preservam a customerKey selecionada', () => {
  const detail = functionSource(adminSource, 'openBarCustomerDetail');
  assert.match(detail, /opsState\.selectedBarCustomerKey\s*=\s*customerKey\s*;/);
  assert.doesNotMatch(detail, /opsState\.selectedBarCustomerKey\s*=\s*phoneKey\s*;/);
});

test('checkout dividido do Bar volta a uma coluna no mobile', () => {
  const mobileCss = maxWidthMediaBodies(adminCss, 760);
  const splitGrid = declarationsFor(
    mobileCss,
    '.bar-command-modal .bar-checkout-grid:has(#barCheckoutSingleMethodField[hidden])',
  );
  assert.ok(splitGrid, 'override mobile específico do checkout dividido não encontrado');
  assert.match(splitGrid, /grid-template-columns\s*:\s*(?:minmax\(0\s*,\s*)?1fr\)?\s*(?:!important)?\s*;/);
});

test('ADM Bar mantém um botão Sair acessível no cabeçalho mobile', () => {
  const buttons = adminSource.match(/<button\b[^>]*id="barSurfaceLogoutBtn"[^>]*>[\s\S]*?<\/button>/g) || [];
  assert.equal(buttons.length, 1, 'o botão móvel Sair do ADM Bar deve existir uma única vez');
  assert.match(buttons[0], /data-bar-surface-only/);
  assert.match(buttons[0], />\s*Sair\s*</);
  assert.match(adminSource, /\$\('barSurfaceLogoutBtn'\)\.addEventListener\('click',\s*lockAdmin\)/);
});

test('gesto de puxar para atualizar fica restrito ao ADM Bar', () => {
  const initializer = functionSource(adminSource, 'initBarPullToRefresh');
  assert.match(initializer, /if\s*\(\s*!IS_BAR_ADMIN_SURFACE\s*\)\s*return\s*;/);
});

test('editor de Novo horário mantém conteúdo rolável e ações acessíveis', () => {
  const dialog = declarationsFor(adminCss, '#lessonSlotEditorModal .lesson-editor-dialog');
  const form = declarationsFor(adminCss, '#lessonSlotEditorForm');
  const body = declarationsFor(adminCss, '#lessonSlotEditorModal .admin-modal-body');
  const actions = declarationsFor(adminCss, '#lessonSlotEditorModal .lesson-editor-actions');

  assert.match(dialog, /display\s*:\s*flex\s*;/);
  assert.match(dialog, /max-height\s*:\s*calc\(100dvh\s*-\s*\d+px\)\s*;/);
  assert.match(dialog, /flex-direction\s*:\s*column\s*;/);
  assert.match(dialog, /overflow\s*:\s*hidden\s*;/);
  assert.match(form, /display\s*:\s*flex\s*;/);
  assert.match(form, /min-height\s*:\s*0\s*;/);
  assert.match(form, /flex\s*:\s*1\s+1\s+auto\s*;/);
  assert.match(form, /flex-direction\s*:\s*column\s*;/);
  assert.match(form, /overflow\s*:\s*hidden\s*;/);
  assert.match(body, /min-height\s*:\s*0\s*;/);
  assert.match(body, /flex\s*:\s*1\s+1\s+auto\s*;/);
  assert.match(body, /overflow-y\s*:\s*auto\s*;/);
  assert.match(actions, /flex\s*:\s*0\s+0\s+auto\s*;/);
});

test('modais operacionais preservam foco e respondem ao teclado', () => {
  const showModal = functionSource(adminSource, 'showClubAdminModal');
  const hideModal = functionSource(adminSource, 'hideClubAdminModal');
  const keyboard = functionSource(adminSource, 'handleClubAdminModalKeyboard');
  const focusTrap = functionSource(adminSource, 'trapClubAdminModalFocus');

  assert.match(showModal, /clubAdminModalOpeners\.set\(modal,\s*opener\)/);
  assert.match(showModal, /\(initialFocus\s*\|\|\s*dialog\s*\|\|\s*modal\)\.focus\(\)/);
  assert.match(hideModal, /opener\.isConnected[\s\S]*opener\.focus\(\)/);
  assert.match(keyboard, /event\.key\s*===\s*'Escape'/);
  assert.match(keyboard, /closeLessonSlotEditor\(\)/);
  assert.match(keyboard, /closeClientModal\(\)/);
  assert.match(focusTrap, /event\.key\s*!==\s*'Tab'/);
  assert.match(focusTrap, /event\.shiftKey/);
  assert.match(adminSource, /document\.addEventListener\('keydown',\s*handleClubAdminModalKeyboard\)/);
  for (const [modalId, focusId] of [
    ['clientModal', 'clientEditName'],
    ['courtSlotModal', 'courtSlotStatus'],
    ['lessonSlotEditorModal', 'lessonSlotEditorTime'],
    ['lessonStudentEditorModal', 'lessonStudentPickerSearch'],
  ]) {
    assert.match(adminSource, new RegExp(`showClubAdminModal\\('${modalId}',\\s*'${focusId}'\\)`));
  }
});

test('topo do torneio empilha ações e status em telas estreitas', () => {
  const narrowCss = maxWidthMediaBodies(adminCss, 520);
  const actions = declarationsFor(narrowCss, '.topbar .top-actions');
  const children = declarationsFor(narrowCss, '.topbar .top-actions > *');
  const status = declarationsFor(narrowCss, '.topbar .top-actions > .status');

  assert.match(actions, /display\s*:\s*grid\s*;/);
  assert.match(actions, /grid-template-columns\s*:\s*(?:minmax\(0\s*,\s*)?1fr\)?\s*;/);
  assert.match(children, /width\s*:\s*100%\s*;/);
  assert.match(children, /max-width\s*:\s*100%\s*;/);
  assert.match(status, /white-space\s*:\s*normal\s*;/);
});

test('versão publicada avança após a manutenção de setembro', () => {
  const version = JSON.parse(versionSource).version;
  assert.match(version, /^\d{4}-\d{2}-\d{2}\.\d{4}$/);
  assert.ok(version > '2026-09-02.1031', `versão ainda não foi avançada: ${version}`);
});
