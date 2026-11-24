(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_REASON = 'Configurar WhatsApp cinco dias antes e no vencimento, conforme política do clube.';
  const instances = new Map();
  const labels = { READY: 'Pronta para configurar', APPLIED: 'Configurada', BLOCKED: 'Revisar cadastro', WAITING_CUSTOMER: 'Sem cadastro no Asaas', FAILED: 'Falha na conferência' };
  const reasons = {
    CUSTOMER_NOT_CREATED: 'Aguardando o cadastro do pagador no Asaas.', CLIENT_NOT_FOUND: 'Cadastro não encontrado.',
    CLIENT_NOT_ACTIVE: 'Cadastro inativo.', FAMILY_DEPENDENT: 'Dependente: os avisos devem ir ao responsável.',
    AMBIGUOUS_FAMILY_PAYER: 'Confira quem é o responsável financeiro da família.', INVALID_PAYER_CPF: 'Confira o CPF do pagador.',
    INVALID_BIRTH_DATE: 'Confira a data de nascimento.', GUARDIAN_CONTACT_REQUIRED: 'Informe o nome e o celular do responsável pelo menor.',
    MOBILE_PHONE_REQUIRED: 'Informe um celular válido.', INVALID_RECIPIENT_PHONE: 'Confira o celular de quem recebe os avisos.',
    FAMILY_CONTACT_MISMATCH: 'Os contatos do responsável na família estão diferentes.',
    CUSTOMER_MAPPING_NOT_ACTIVE: 'Confira o vínculo do pagador com o Asaas.', AMBIGUOUS_PROVIDER_CUSTOMER: 'O cadastro do Asaas está vinculado a mais de uma pessoa.',
    INVOICE_CUSTOMER_MISMATCH: 'A cobrança está vinculada a outro cadastro no Asaas.', SHARED_OR_DIVERGENT_CUSTOMER: 'O cadastro no Asaas não corresponde a este pagador.',
    AMBIGUOUS_DUE_DATE_RULES: 'Confira as regras de vencimento no Asaas.', INCOMPLETE_NOTIFICATION_RULES: 'Não foi possível conferir todos os avisos do Asaas.',
    INVALID_NOTIFICATION_RULES: 'As regras de aviso precisam de conferência no Asaas.', UNKNOWN_NOTIFICATION_CHANNEL: 'Há um canal de aviso não reconhecido no Asaas.',
    INVALID_NOTIFICATION_CHANNEL: 'Não foi possível conferir os canais de aviso.', UNKNOWN_NOTIFICATION_STATE: 'O Asaas não confirmou a situação dos avisos.',
    TARGET_CHANGED: 'O cadastro mudou durante a operação. Consulte novamente.', NOTIFICATION_READBACK_MISMATCH: 'O Asaas não confirmou as regras gravadas.',
    CUSTOMER_READBACK_MISMATCH: 'O Asaas não confirmou o contato gravado.', AUDIT_REJECTED: 'Não foi possível registrar a conferência. Requer revisão.', AUDIT_FAILED: 'Não foi possível registrar a conferência. Requer revisão.',
    GLOBAL_DISABLE_UNCONFIRMED: 'O Asaas não confirmou a pausa dos avisos. Requer revisão.', GLOBAL_DISABLE_NOT_CONFIRMED: 'O Asaas não confirmou a pausa dos avisos. Requer revisão.',
    PROVIDER_POLICY_FAILED: 'Falha na comunicação com o Asaas. Consulte novamente.', POLICY_STATE_UNAVAILABLE: 'Não foi possível conferir a política de avisos.',
    POLICY_DEADLINE_EXCEEDED: 'A conferência atingiu o limite de tempo. Consulte a situação novamente.',
    CUSTOMER_SCOPE_BLOCKED: 'O cadastro compartilhado no Asaas precisa de revisão.', CUSTOMER_SCOPE_UNVERIFIED: 'Não foi possível confirmar o uso deste cadastro no Asaas.',
    REMOTE_PAYMENT_SCOPE_INCOMPLETE: 'Não foi possível conferir todas as cobranças deste cadastro no Asaas.', REMOTE_PAYMENT_SCOPE_UNVERIFIED: 'As cobranças deste cadastro no Asaas precisam de revisão.',
    OTHER_ACTIVE_CUSTOMER_PAYMENT: 'Há outra cobrança ativa neste cadastro do Asaas.', CUSTOMER_SCOPE_CHANGED: 'O uso deste cadastro mudou durante a conferência. Consulte novamente.',
    POLICY_DISABLED: 'A política de avisos foi desativada. Consulte novamente.'
  };
  function reasonLabel(reason) { return reasons[reason] || 'Não foi possível confirmar esta conta. Requer revisão.'; }
  const diagnosticFields = {
    emailEnabledForProvider: 'E-mail da conta Asaas', smsEnabledForProvider: 'SMS da conta Asaas',
    emailEnabledForCustomer: 'E-mail do pagador', smsEnabledForCustomer: 'SMS do pagador',
    phoneCallEnabledForCustomer: 'Ligação para o pagador', whatsappEnabledForCustomer: 'WhatsApp do pagador',
    UNKNOWN_CHANNEL: 'Canal não reconhecido'
  };
  const diagnosticTypes = { MISSING: 'ausente', NULL: 'nulo', BOOLEAN: 'sim/não', STRING: 'texto', NUMBER: 'número', ARRAY: 'lista', OBJECT: 'objeto', OTHER: 'outro tipo' };
  const diagnosticEvents = {
    PAYMENT_CREATED: 'Cobrança criada', PAYMENT_UPDATED: 'Cobrança atualizada', PAYMENT_RECEIVED: 'Pagamento recebido',
    PAYMENT_OVERDUE: 'Cobrança vencida', PAYMENT_DUEDATE_WARNING: 'Aviso de vencimento', SEND_LINHA_DIGITAVEL: 'Linha digitável', UNKNOWN_EVENT: 'Evento não reconhecido'
  };
  function diagnosticLines(diagnostics) {
    // Render only known labels and value kinds, never provider/customer values.
    if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return [];
    const lines = [], identity = diagnostics.identity;
    const ownLabel = (map, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
    if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
      if (typeof identity.idMatches === 'boolean') lines.push('Cadastro no Asaas: ' + (identity.idMatches ? 'confere' : 'divergente'));
      if (typeof identity.documentMatches === 'boolean') lines.push('Documento do pagador: ' + (identity.documentMatches ? 'confere' : 'divergente'));
      const reference = ownLabel({ OWNED: 'do Ilha', EMPTY: 'sem referência', FOREIGN: 'outra referência' }, identity.referenceKind);
      if (reference) lines.push('Vínculo da conta: ' + reference);
      if (typeof identity.deleted === 'boolean' || identity.deleted === null) lines.push('Cadastro excluído no Asaas: ' + (identity.deleted === null ? 'não informado' : identity.deleted ? 'sim' : 'não'));
    }
    [['notificationChannels', ''], ['verificationChannels', 'Após salvar: ']].forEach(([key, prefix]) => {
      if (!Array.isArray(diagnostics[key])) return;
      diagnostics[key].slice(0, 64).forEach(channel => {
        if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return;
        const field = ownLabel(diagnosticFields, channel.field), type = ownLabel(diagnosticTypes, channel.type), event = ownLabel(diagnosticEvents, channel.event);
        if (field && type && event) lines.push(prefix + field + ' · ' + event + ': ' + type);
      });
    });
    return Array.from(new Set(lines));
  }
  function diagnosticMarkup(item) {
    if (!['BLOCKED', 'FAILED'].includes(item.state)) return '';
    const lines = diagnosticLines(item.diagnostics);
    return lines.length ? '<details class="monthly-notification-diagnostics"><summary>Detalhes da conferência</summary>' + lines.map(line => '<p>' + esc(line) + '</p>').join('') + '</details>' : '';
  }
  function summarize(items) {
    const count = { total: items.length, configured: 0, ready: 0, blocked: 0, waiting: 0, failed: 0 };
    items.forEach(item => {
      if (item.state === 'APPLIED' || item.state === 'READY' && item.configured === true) count.configured++;
      else if (item.state === 'READY') count.ready++;
      else if (item.state === 'BLOCKED') count.blocked++;
      else if (item.state === 'WAITING_CUSTOMER') count.waiting++;
      else count.failed++;
    });
    return count;
  }
  function createController(config) {
    const state = { busy: false, operation: '', items: [], policy: null, previewComplete: false, stopped: false, message: '', error: false };
    let generation = 0;
    function assertAccess() {
      if (!config.isCurrent() || !config.canWrite()) throw new Error('Sessão ou permissão alterada. Abra novamente o financeiro.');
    }
    function changed() { if (config.isCurrent()) config.changed(state); }
    function validatePage(page, action) {
      if (!page || !page.policy || typeof page.policy.enabled !== 'boolean' || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean' ||
          page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor)) throw new Error('Resposta incompleta. Consulte a situação antes de continuar.');
      const allowed = action === 'notify_apply' ? ['APPLIED', 'BLOCKED', 'WAITING_CUSTOMER', 'FAILED'] : ['READY', 'BLOCKED', 'WAITING_CUSTOMER', 'FAILED'];
      if (page.items.some(item => !item || !item.clientId || !allowed.includes(item.state))) throw new Error('Resultado não confirmado. Consulte a situação antes de continuar.');
    }
    async function run(action, reason) {
      if (state.busy) return;
      assertAccess();
      if (action === 'notify_apply') {
        if (!state.previewComplete) throw new Error('Consulte todas as contas antes de aplicar.');
        reason = String(reason || '').trim();
        if (reason.length < 10 || reason.length > 400) throw new Error('Informe um motivo entre 10 e 400 caracteres.');
      }
      const runGeneration = ++generation;
      state.busy = true; state.operation = action; state.stopped = false; state.previewComplete = false;
      state.items = []; state.message = action === 'notify_apply' ? 'Aplicando em lotes…' : 'Consultando contas no Asaas…'; state.error = false;
      changed();
      let cursor;
      const cursors = new Set(), ids = new Set();
      try {
        do {
          assertAccess();
          const body = { action, limit: 5 };
          if (cursor) body.cursor = cursor;
          if (action === 'notify_apply') { body.enabled = true; body.reason = reason; }
          const page = await config.send(body);
          if (runGeneration !== generation) return;
          assertAccess(); validatePage(page, action);
          if (new Set(page.items.map(item => item.clientId)).size !== page.items.length || page.items.some(item => ids.has(item.clientId))) throw new Error('A lista mudou durante a conferência. Consulte novamente antes de continuar.');
          page.items.forEach(item => { ids.add(item.clientId); state.items.push(item); });
          state.policy = page.policy;
          state.message = state.items.length + ' conta(s) ' + (action === 'notify_apply' ? 'processada(s).' : 'conferida(s).');
          changed();
          if (!page.hasMore) {
            state.previewComplete = action === 'notify_preview';
            state.message = action === 'notify_apply' ? 'Processamento concluído. Confira os resultados e as exceções abaixo.' : 'Consulta concluída. Confira as contas antes de aplicar.';
            break;
          }
          if (state.stopped) { state.message = 'Interrompido após o lote atual. Consulte novamente antes de continuar.'; break; }
          if (cursors.has(page.nextCursor)) throw new Error('Paginação não confirmada. Consulte novamente antes de continuar.');
          cursors.add(page.nextCursor); cursor = page.nextCursor;
        } while (cursor);
      } catch (error) {
        if (runGeneration !== generation) return;
        state.error = true;
        state.message = (error.message || 'Não foi possível concluir.') + (action === 'notify_apply' ? ' A aplicação pode ter sido parcial. Consulte a situação antes de repetir.' : ' Nenhuma configuração foi alterada nesta consulta.');
      } finally {
        if (runGeneration === generation) { state.busy = false; changed(); }
      }
    }
    return {
      state, preview: () => run('notify_preview'), apply: reason => run('notify_apply', reason),
      stop: () => { if (state.busy) { state.stopped = true; state.message = 'Aguardando o lote atual para interromper…'; changed(); } },
      reset: () => { generation++; state.busy = false; state.previewComplete = false; state.items = []; state.policy = null; }
    };
  }
  function mount(host, config) {
    if (!host) return;
    const previous = instances.get(host);
    if (previous && previous.sessionKey === config.sessionKey) { previous.render(); return; }
    if (previous) previous.controller.reset();
    host.hidden = !config.canWrite();
    if (host.hidden) { host.innerHTML = ''; instances.delete(host); return; }
    host.innerHTML = '<details class="monthly-billing-options"><summary>Avisos por WhatsApp · Asaas</summary>' +
      '<div class="monthly-notification-head"><div><strong>5 dias antes e no vencimento</strong><p class="muted">Ao aplicar: somente o pagador; em famílias, apenas o responsável. Desativa e-mail, SMS e outros avisos do Asaas.</p></div><span class="ops-pill" data-mn-policy>Não consultado</span></div>' +
      '<p class="monthly-notification-warning">Cobranças já emitidas podem manter agendamentos anteriores no Asaas. Esta configuração não garante cancelar esses avisos.</p>' +
      '<div class="monthly-notification-actions"><button type="button" class="ghost-btn" data-mn-preview>Consultar situação</button><label class="field">Motivo<input type="text" maxlength="400" minlength="10" data-mn-reason value="' + esc(DEFAULT_REASON) + '"></label><button type="button" class="primary-btn" data-mn-apply disabled>Aplicar a todas as contas</button><button type="button" class="ghost-btn" data-mn-stop hidden>Parar após este lote</button></div>' +
      '<p data-mn-status role="status" aria-live="polite"></p><div class="monthly-notification-counts" data-mn-counts></div>' +
      '<details data-mn-results hidden><summary>Contas e exceções</summary><ul class="monthly-notification-results" data-mn-list></ul></details></details>';
    const field = name => host.querySelector('[data-mn-' + name + ']');
    const controller = createController({ ...config, changed: render });
    function render() {
      const state = controller.state, counts = summarize(state.items), allowed = config.canWrite() && config.isCurrent();
      host.hidden = !allowed;
      field('preview').disabled = state.busy || !allowed;
      field('apply').disabled = state.busy || !state.previewComplete || !allowed;
      field('reason').disabled = state.busy;
      field('stop').hidden = !state.busy;
      field('stop').disabled = state.stopped;
      field('policy').textContent = !state.policy ? 'Não consultado' : state.policy.enabled ? 'Política ativada' : 'Política não ativada';
      field('status').textContent = state.message;
      field('status').className = state.error ? 'monthly-notification-error' : 'muted';
      field('counts').innerHTML = counts.total ? [
        [counts.total, 'conferidas'], [counts.configured, 'configuradas'], [counts.ready, 'para configurar'],
        [counts.blocked, 'para revisar'], [counts.waiting, 'sem Asaas'], [counts.failed, 'falhas']
      ].map(([value, label]) => '<span><strong>' + value + '</strong> ' + label + '</span>').join('') : '';
      field('results').hidden = !counts.total;
      field('list').innerHTML = state.items.map(item => '<li><div><strong>' + esc(item.name || 'Conta sem nome') + '</strong>' +
        '<span>' + esc(item.maskedPhone || 'Telefone não disponível') + (item.recipientKind === 'GUARDIAN' ? ' · Responsável pelo menor' : item.isFamily ? ' · Responsável familiar' : '') + '</span></div><div><strong>' + esc(item.configured && item.state === 'READY' ? 'Configurada' : labels[item.state]) + '</strong>' +
        (item.reason ? '<span>' + esc(reasonLabel(item.reason)) + '</span>' : '') +
        (item.notificationDisabled === true ? '<span>Avisos pausados no Asaas</span>' : item.state === 'READY' && !item.configured && item.notificationDisabled === false ? '<span>Configuração diferente da política</span>' : '') + diagnosticMarkup(item) + '</div></li>').join('');
    }
    async function attempt(task) {
      try { await task(); } catch (error) { field('status').textContent = error.message || 'Não foi possível continuar.'; field('status').className = 'monthly-notification-error'; }
    }
    field('preview').onclick = () => attempt(() => controller.preview());
    field('apply').onclick = () => attempt(async () => {
      if (controller.state.busy || !controller.state.previewComplete) return;
      if (!field('reason').reportValidity()) return;
      const count = summarize(controller.state.items);
      if (!config.confirm('Aplicar WhatsApp 5 dias antes e no vencimento às ' + count.total + ' conta(s) conferida(s)? E-mail, SMS e outros avisos serão desativados. Contas bloqueadas serão sinalizadas. Agendamentos de cobranças antigas podem permanecer no Asaas.')) return;
      await controller.apply(field('reason').value);
    });
    field('stop').onclick = controller.stop;
    instances.set(host, { sessionKey: config.sessionKey, controller, render });
    render();
  }
  function reset() {
    instances.forEach((instance, host) => { instance.controller.reset(); host.innerHTML = ''; });
    instances.clear();
  }
  window.IlhaMonthlyNotifications = { createController, summarize, reasonLabel, diagnosticLines, mount, reset };
})();
