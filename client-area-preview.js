// The preview uses index.html's actual renderers, never a second customer UI.
// Only an already-authorized ADM window reads data; no login token is transferred.
(function () {
  const mode = new URLSearchParams(location.search).get('clientPreview') === '1';
  let snapshot = null;
  let pending = null;
  let refreshTimer = 0;
  if (mode) {
    try {
      const value = JSON.parse(window.name || '{}');
      if (value.kind === 'ilha-client-readonly-preview-v2' && value.expiresAt > Date.now() && value.data && value.data.client && value.data.client.id) snapshot = value;
    } catch (_) {}
    window.name = '';
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, options) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const method = String(options && options.method || input && input.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method) || url.hostname.endsWith('.supabase.co')) return Promise.reject(new Error('Visualização do ADM: alterações e chamadas autenticadas estão bloqueadas.'));
      return originalFetch(input, options);
    };
    document.addEventListener('submit', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast('Somente consulta. Faça alterações pelo ADM.');
    }, true);
    document.addEventListener('click', function (event) {
      const action = event.target.closest('button, a, input[type="file"]');
      if (!action) return;
      const allowed = '[data-view], [data-back-home], [data-open-pix], [data-close-pix], [data-copy-modal-pix], [data-refresh-invoice], [data-refresh-invoices], [data-refresh-plan], [data-clear-invoice-filter], [data-plan-tab], [data-close-court-booking], [data-close-court-rules], [data-family-confirm-toggle], #paymentClearFilter, #clientPreviewRefresh, #clientPreviewClose, #clientCourtRulesBtn';
      if (action.matches(allowed)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      toast('Visualização somente leitura: essa ação não será realizada na conta do cliente.');
    }, true);
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin || event.source !== window.opener || !pending || !snapshot || !event.data || event.data.kind !== 'ilha-preview-result' || event.data.channel !== snapshot.channel) return;
      const operation = pending; pending = null; clearTimeout(refreshTimer);
      if (event.data.error) { operation.reject(new Error(event.data.error)); return; }
      const next = event.data.snapshot;
      if (!next || !next.data || !next.data.client || next.data.client.id !== snapshot.data.client.id || next.expiresAt <= Date.now()) { operation.reject(new Error('Visualização inválida. Reabra pelo ADM.')); return; }
      snapshot = next; apply(); renderAll(); operation.resolve();
    });
  }

  function apply() {
    const data = snapshot.data;
    session = { preview: true, user: { id: data.client.id, email: data.client.email } };
    demoMode = false;
    client = Object.assign({}, data.client);
    appPlans = (data.plans || []).map(mapPlanRow);
    syncLinkedClientPlan();
    planRequests = (data.planRequests || []).map(mapPlanRequestRow);
    storeRequests = (data.storeRequests || []).map(mapStoreRequestRow);
    storeProducts = (data.products || []).map(mapStoreProductRow).filter(storeProductAvailable);
    paymentInvoices = (data.invoices || []).map(mapPaymentInvoiceRow);
    monthlyPaymentOptions = data.monthlyPaymentOptions || [];
    monthlyPaymentOptionsError = false;
    familyInvoiceItems = data.items || [];
    familySummary = data.family || null;
    myLessons = data.lessons || [];
    myCourtBookings = data.bookings || [];
    courtScheduleDays = data.schedule || [];
    courtAvailability = data.availability || [];
    courtOpponents = data.opponents || [];
    courtChallenges = data.challenges || [];
    announcements = (data.announcements || []).map(mapAnnouncementRow).concat((data.notifications || []).filter(function (item) { return !['NOVO_ALUNO','TORNEIO_INSCRICAO','COMUNICADO'].includes(item.event_type); }).map(mapClientNotificationRow));
    dismissedNotificationKeys = new Set((data.dismissals || []).map(function (item) { return item.source_type + ':' + item.source_id; }));
    familyLoadError = null; paymentInvoicesLoadError = null; clientDataLoadError = null;
    const label = document.getElementById('clientPreviewLabel');
    if (label) label.textContent = 'Consulta: ' + (client.full_name || 'Cliente') + ' · ' + new Date(snapshot.capturedAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const warning = document.getElementById('clientPreviewWarning');
    if (warning) {
      warning.hidden = !(data.warnings && data.warnings.length);
      warning.textContent = 'Algumas informações adicionais não puderam ser consultadas. As faturas foram carregadas diretamente do cadastro.';
    }
  }

  function activate() {
    if (!snapshot) { lock('Esta visualização expirou. Abra novamente pelo ADM.'); return; }
    document.body.classList.add('client-readonly-preview');
    const style = document.createElement('style');
    style.textContent = 'body.client-readonly-preview{padding-top:48px}#clientPreviewBar{position:fixed;top:0;left:0;right:0;z-index:99999;min-height:44px;padding:7px 10px;display:flex;gap:8px;align-items:center;justify-content:center;background:#172740;color:white;font:600 12px system-ui}#clientPreviewBar button{padding:6px 9px;border:1px solid #869ba2;border-radius:6px;background:#fff;color:#12363f;font:inherit}#clientPreviewWarning{padding:10px;background:#fff2cf;color:#5f4600;font:12px system-ui}body.client-readonly-preview .client-push-card{display:none!important}';
    document.head.appendChild(style);
    const bar = document.createElement('div'); bar.id = 'clientPreviewBar';
    bar.innerHTML = '<span id="clientPreviewLabel"></span><span>Somente leitura</span><button type="button" id="clientPreviewRefresh">Atualizar</button><button type="button" id="clientPreviewClose">Fechar</button>';
    document.body.prepend(bar);
    const warning = document.createElement('div'); warning.id = 'clientPreviewWarning'; warning.hidden = true; bar.after(warning);
    document.getElementById('clientPreviewRefresh').onclick = function () { refresh().catch(function (error) { toast(error.message); }); };
    document.getElementById('clientPreviewClose').onclick = function () { window.close(); };
    apply();
    if (needsRegistration(client)) openRegistrationCompletion();
    else if (String(client.status).toUpperCase() === 'ATIVO') unlock();
    else unlockPendingAccess();
  }

  function refresh() {
    if (pending) return pending.promise;
    if (!snapshot || snapshot.expiresAt <= Date.now() || !window.opener || window.opener.closed) return Promise.reject(new Error('Reabra a visualização pelo ADM para atualizar.'));
    let resolve, reject;
    const promise = new Promise(function (yes, no) { resolve = yes; reject = no; });
    pending = { promise: promise, resolve: resolve, reject: reject };
    refreshTimer = setTimeout(function () { if (pending) { pending.reject(new Error('O ADM não respondeu. Reabra a visualização.')); pending = null; } }, 45000);
    window.opener.postMessage({ kind:'ilha-preview-refresh', channel:snapshot.channel }, location.origin);
    return promise;
  }
  window.IlhaClientPreview = { mode: mode, activate: activate, refresh: refresh, apply: apply };
})();
