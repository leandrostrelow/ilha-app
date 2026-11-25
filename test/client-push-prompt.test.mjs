import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = name => {
  const match = source.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'));
  assert.ok(match, `Função não encontrada: ${name}`);
  return match[0];
};

function fixture(options = {}) {
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const classes = new Set(['client-unlocked']);
  const ids = ['clientPushPromptModal', 'clientPushPromptTitle', 'clientPushPromptDescription',
    'clientPushPromptEnableBtn', 'clientPushPromptLaterBtn', 'clientPushConsent',
    'clientEnableNotificationsBtn', 'clientPushTitle', 'clientPushDescription',
    'clientPushProfileControl', 'clientDisableNotificationsBtn', 'welcomeUpdateModal'];
  const elements = Object.fromEntries(ids.map(id => [id, {
    id, hidden: true, disabled: false, dataset: {}, textContent: '', isConnected: true,
    classList: { remove() {} }, focus() { calls.push(['focus', id]); }
  }]));
  let subscription = options.subscribed ? { endpoint: 'https://push.invalid/synthetic',
    toJSON: () => ({ endpoint: 'https://push.invalid/synthetic', keys: { p256dh: 'fake-key', auth: 'fake-auth' } }) } : null;
  const registration = { pushManager: {
    getSubscription: async () => subscription,
    subscribe: async () => { calls.push('subscribe'); subscription = { endpoint: 'https://push.invalid/synthetic', toJSON: () => ({ endpoint: 'https://push.invalid/synthetic', keys: { p256dh: 'fake-key', auth: 'fake-auth' } }) }; return subscription; }
  } };
  const notification = { permission: options.permission || 'default', requestPermission: async () => {
    calls.push('permission'); notification.permission = options.answer || 'granted'; return notification.permission;
  } };
  const window = { Notification: notification, PushManager: {},
    clearTimeout: id => timers.delete(id), setTimeout: callback => { timers.set(++timerId, callback); return timerId; } };
  if (options.unsupported) delete window.PushManager;
  const context = vm.createContext({ window, Notification: notification, navigator: { serviceWorker: {}, userAgent: 'Synthetic test' },
    document: { hidden: false, activeElement: null, body: { classList: { contains: value => classes.has(value) } } },
    session: { user: { id: 'synthetic-client' } }, clientPreviewMode: false, clientSessionEpoch: 1,
    clientPushPromptShown: false, clientPushPromptTimer: 0, clientPushAppBackgrounded: false,
    clientPushActivationInProgress: false, clientPushActivationVersion: 0, clientPushSubscriptionPromise: null, clientPushPromptReturnFocus: null,
    clientPushSubscriptionOwnerUserId: options.ownerConfirmed ? 'synthetic-client' : '',
    CLIENT_PUSH_PREFERENCE_KEY: 'test-preference', CLIENT_PUSH_VAPID_KEY: 'synthetic-vapid',
    $: id => elements[id], currentUser: () => context.session?.user || {},
    clientUsesIos: () => Boolean(options.ios), clientAppIsInstalled: () => Boolean(options.installed),
    ensureClientServiceWorker: async () => { calls.push('service-worker'); return registration; },
    clientUrlBase64ToBytes: value => value, storageKey: value => value,
    readStored: () => options.optOut ? false : null, writeStored: () => {},
    rest: async () => { calls.push('save'); if (options.saveFailure) throw Error('Offline'); return { owner_user_id: 'synthetic-client', enabled: true }; },
    toast: message => calls.push(['toast', message]), enableClientNotificationSound: () => {},
    disableClientPushSubscription: async () => {}, installClientApp: async () => calls.push('install')
  });
  for (const name of ['saveClientPushSubscription', 'clientPushSupportState', 'ensureClientPushSubscription',
    'closeClientPushPrompt', 'openClientPushPrompt', 'clientPushPromptCanOpen', 'maybeShowClientPushPrompt',
    'handleClientPushAppVisibility', 'renderClientPushState', 'toggleClientPush']) {
    vm.runInContext(functionSource(name), context);
  }
  async function runTimers() {
    const pending = Array.from(timers.values()); timers.clear();
    for (const callback of pending) await callback();
  }
  async function reopen() {
    context.document.hidden = true; context.handleClientPushAppVisibility();
    context.document.hidden = false; context.handleClientPushAppVisibility();
    await new Promise(resolve => setImmediate(resolve)); await runTimers();
  }
  return { context, calls, elements, classes, notification, options, timers, runTimers, reopen };
}

test('lembra uma vez na abertura e novamente ao retornar ao app, sem pedir permissão automaticamente', async () => {
  const f = fixture();
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, false);
  assert.match(f.elements.clientPushPromptDescription.textContent, /mensalidades/);
  f.context.closeClientPushPrompt();
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  await f.reopen();
  assert.equal(f.elements.clientPushPromptModal.hidden, false);
  assert.equal(f.calls.includes('permission'), false);
});

test('assinatura ativa confirmada não recebe convite na abertura nem no retorno', async () => {
  const f = fixture({ permission: 'granted', subscribed: true });
  assert.equal(await f.context.renderClientPushState({ prompt: true }), 'active');
  await f.runTimers(); await f.reopen();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  assert.equal(f.elements.clientPushConsent.hidden, true);
  assert.equal(f.elements.clientPushProfileControl.hidden, false);
  assert.equal(f.calls.filter(call => call === 'save').length, 1);
  assert.equal(f.calls.includes('permission'), false);
});

test('estado é relido antes de abrir; permissão ativada e logout invalidam convite pendente', async () => {
  const f = fixture({ subscribed: true, ownerConfirmed: true });
  await f.context.renderClientPushState({ prompt: true });
  f.notification.permission = 'granted'; await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  const other = fixture();
  await other.context.renderClientPushState({ prompt: true });
  other.context.clientSessionEpoch++; other.context.session = null; await other.runTimers();
  assert.equal(other.elements.clientPushPromptModal.hidden, true);
});

test('permissão nativa só vem do clique e antes de esperar o service worker', async () => {
  const f = fixture();
  await f.context.ensureClientPushSubscription(false);
  assert.deepEqual(f.calls, []);
  await f.context.toggleClientPush(f.elements.clientPushPromptEnableBtn);
  assert.equal(f.calls[0], 'permission');
  assert.equal(f.calls.filter(call => call === 'permission').length, 1);
  assert.equal(f.context.clientPushActivationInProgress, false);
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  assert.equal(f.context.clientPushSubscriptionOwnerUserId, 'synthetic-client');
});

test('bloqueio oferece orientação e nunca repete a solicitação nativa', async () => {
  const f = fixture({ permission: 'denied' });
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptEnableBtn.dataset.pushState, 'blocked');
  assert.match(f.elements.clientPushPromptDescription.textContent, /configurações/);
  await f.context.toggleClientPush(f.elements.clientPushPromptEnableBtn);
  await f.context.ensureClientPushSubscription(true);
  assert.equal(f.calls.includes('permission'), false);
  f.context.closeClientPushPrompt(); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
});

test('recusar a permissão atualiza orientação e mantém saída disponível', async () => {
  const f = fixture({ answer: 'denied' });
  await assert.rejects(f.context.toggleClientPush(f.elements.clientPushPromptEnableBtn), /ainda não foram ativadas/);
  assert.equal(f.elements.clientPushPromptEnableBtn.disabled, false);
  assert.equal(f.elements.clientPushPromptEnableBtn.dataset.pushState, 'blocked');
  f.context.closeClientPushPrompt();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  assert.equal(f.calls.filter(call => call === 'permission').length, 1);
});

test('troca de visibilidade da janela de permissão não abre outro convite', async () => {
  const f = fixture(); f.context.clientPushPromptShown = true;
  f.context.clientPushActivationInProgress = true;
  await f.reopen();
  assert.equal(f.context.clientPushPromptShown, true);
  assert.equal(f.context.clientPushAppBackgrounded, false);
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
});

test('iPhone fora da tela inicial orienta instalação; navegador incompatível informa a limitação', async () => {
  const ios = fixture({ ios: true });
  await ios.context.renderClientPushState({ prompt: true }); await ios.runTimers();
  assert.equal(ios.elements.clientPushPromptEnableBtn.dataset.pushState, 'install');
  assert.match(ios.elements.clientPushPromptDescription.textContent, /tela inicial/);
  await ios.context.toggleClientPush(ios.elements.clientPushPromptEnableBtn);
  assert.equal(ios.calls.includes('install'), true);
  assert.equal(ios.calls.includes('permission'), false);
  const unsupported = fixture({ unsupported: true });
  await unsupported.context.renderClientPushState({ prompt: true }); await unsupported.runTimers();
  assert.equal(unsupported.elements.clientPushPromptTitle.textContent, 'Notificações indisponíveis');
  await unsupported.context.toggleClientPush(unsupported.elements.clientPushPromptEnableBtn);
  assert.equal(unsupported.elements.clientPushPromptModal.hidden, true);
  await unsupported.context.toggleClientPush(unsupported.elements.clientEnableNotificationsBtn);
  assert.equal(unsupported.elements.clientPushPromptModal.hidden, false);
  assert.equal(unsupported.calls.includes('permission'), false);
});

test('não sobrepõe abertura, boas-vindas ou tela oculta e não solicita em demo/preview', async () => {
  const f = fixture(); f.classes.add('client-intro-open');
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  f.classes.delete('client-intro-open'); f.elements.welcomeUpdateModal.hidden = false;
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  f.elements.welcomeUpdateModal.hidden = true; f.context.document.hidden = true;
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
  f.context.document.hidden = false; f.context.session.demo = true;
  assert.equal(await f.context.renderClientPushState({ prompt: true }), 'hidden');
  f.context.session.demo = false; f.context.clientPreviewMode = true;
  await f.context.renderClientPushState({ prompt: true }); await f.runTimers();
  assert.equal(f.elements.clientPushPromptModal.hidden, true);
});


test('clique durante sincronização aguarda a mesma assinatura sem falso erro', async () => {
  const f = fixture({ permission: 'granted' });
  let release;
  const realEnsure = f.context.ensureClientServiceWorker;
  f.context.ensureClientServiceWorker = async () => {
    await new Promise(resolve => { release = resolve; });
    return realEnsure();
  };
  const background = f.context.ensureClientPushSubscription(false);
  const clicked = f.context.ensureClientPushSubscription(true);
  release();
  assert.deepEqual(await Promise.all([background, clicked]), [true, true]);
  assert.equal(f.calls.filter(call => call === 'subscribe').length, 1);
  assert.equal(f.calls.filter(call => call === 'save').length, 1);
  assert.equal(f.calls.includes('permission'), false);
});

test('logout durante preparação aborta gravação e inscrição para outra conta', async () => {
  const f = fixture({ permission: 'granted' });
  let release;
  const realEnsure = f.context.ensureClientServiceWorker;
  f.context.ensureClientServiceWorker = async () => {
    await new Promise(resolve => { release = resolve; });
    return realEnsure();
  };
  const pending = f.context.ensureClientPushSubscription(false);
  f.context.clientSessionEpoch++; f.context.session = null;
  release();
  assert.equal(await pending, false);
  assert.equal(f.calls.includes('subscribe'), false);
  assert.equal(f.calls.includes('save'), false);
});

test('assinatura liberada antes do login é vinculada depois sem nova permissão', async () => {
  const f = fixture(); f.context.session = null;
  assert.equal(await f.context.ensureClientPushSubscription(true), true);
  assert.equal(f.calls.filter(call => call === 'save').length, 0);
  f.context.session = { user: { id: 'synthetic-client' } };
  assert.equal(await f.context.ensureClientPushSubscription(false), true);
  assert.equal(f.calls.filter(call => call === 'permission').length, 1);
  assert.equal(f.calls.filter(call => call === 'subscribe').length, 1);
  assert.equal(f.calls.filter(call => call === 'save').length, 1);
});


test('clique enquanto o convite confere a assinatura invalida a abertura atrasada', async () => {
  for (const stillInProgress of [true, false]) {
    const f = fixture(); let release;
    f.context.renderClientPushState = async () => {
      await new Promise(resolve => { release = resolve; }); return 'inactive';
    };
    f.context.maybeShowClientPushPrompt('inactive');
    const waiting = f.runTimers();
    f.context.clientPushActivationInProgress = stillInProgress;
    f.context.clientPushActivationVersion++;
    release(); await waiting;
    assert.equal(f.elements.clientPushPromptModal.hidden, true);
    assert.equal(f.context.clientPushPromptShown, false);
  }
});
