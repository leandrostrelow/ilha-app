(function (root) {
  'use strict';
  const upper = value => String(value || '').trim().toUpperCase();
  function classify(clients, invoices, dismissed, today) {
    const hidden = new Set(dismissed.map(row => String(row.invoice_id)));
    const unique = Array.from(new Map(invoices.map(row => [String(row.id), row])).values());
    const cancelled = row => Boolean(row.superseded_at) || ['CANCELADA', 'CANCELADO', 'ESTORNADA'].includes(upper(row.status)) || ['CANCELLED', 'CANCELED', 'DELETED', 'REFUNDED'].includes(upper(row.provider_status));
    const confirmed = row => !cancelled(row) && ['CONFIRMED', 'RECEIVED'].includes(upper(row.provider_status));
    const settled = row => Boolean(row.paid_at) || ['PAGA', 'PAGO'].includes(upper(row.status)) || ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(upper(row.provider_status));
    return {
      students: clients.filter(row => upper(row.status) === 'PENDENTE' && !row.registration_deleted_at).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
      payments: unique.filter(row => confirmed(row) && !hidden.has(String(row.id))).sort((a, b) => String(b.paid_at || b.updated_at || '').localeCompare(String(a.paid_at || a.updated_at || ''))),
      overdue: unique.filter(row => !cancelled(row) && !settled(row) && Number(row.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date || '') && row.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.id).localeCompare(String(b.id)))
    };
  }

  function create(ctx) {
    let clients = [], invoices = [], dismissed = [];
    let loadedClients = false, loadedFinance = false, clientError = '', financeError = '';
    let pending = null, queued = false, timer = null, generation = 0, lastUpdate = '';
    const dismissing = new Set();
    const el = id => document.getElementById(id);
    const empty = message => '<div class="home-work-empty">' + ctx.escape(message) + '</div>';
    const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10).split('-').reverse().join('/') : 'Não informado';
    const name = row => row.app_clients && row.app_clients.full_name || 'Aluno';
    function render() {
      if (!el('homeNewStudents')) return;
      const groups = classify(clients, invoices, dismissed, ctx.today());
      el('homeNewStudentsCount').textContent = groups.students.length;
      el('homeConfirmedCount').textContent = groups.payments.length;
      el('homeOverdueCount').textContent = groups.overdue.length;
      el('homeNewStudents').innerHTML = clientError ? empty(clientError) : !loadedClients ? empty('Carregando cadastros…') : groups.students.length ? groups.students.map(row =>
        '<article class="home-work-item"><div><strong>' + ctx.escape(row.full_name || 'Novo aluno') + '</strong><span>Cadastro recebido em ' + date(row.created_at) + '</span></div><button type="button" class="small-btn" data-dashboard-client="' + ctx.escape(row.id) + '">Abrir ficha</button></article>').join('') : empty('Nenhum cadastro aguardando ativação.');
      const invoiceCard = (row, paid) => '<article class="home-work-item"><div><strong>' + ctx.escape(name(row)) + '</strong><span>Mensalidade · ' + ctx.escape(String(row.invoice_month || '').slice(0, 7).split('-').reverse().join('/')) + '</span><span>' + (paid ? 'Confirmado pelo Asaas' : 'Venceu em ' + date(row.due_date)) + '</span></div><div class="home-work-item-actions"><strong class="home-work-amount">' + ctx.money(row.amount) + '</strong>' + (paid ? '<button type="button" class="small-btn" data-dashboard-dismiss="' + ctx.escape(row.id) + '"' + (dismissing.has(row.id) ? ' disabled' : '') + ' aria-label="Dispensar aviso de pagamento de ' + ctx.escape(name(row)) + '">' + (dismissing.has(row.id) ? 'Salvando…' : 'Dispensar aviso') + '</button>' : ctx.can('clients.read') ? '<button type="button" class="small-btn" data-dashboard-client="' + ctx.escape(row.client_id) + '" data-dashboard-finance="true">Ver ficha</button>' : '') + '</div></article>';
      el('homeConfirmedPayments').innerHTML = financeError ? empty(financeError) : !loadedFinance ? empty('Carregando pagamentos…') : groups.payments.length ? groups.payments.map(row => invoiceCard(row, true)).join('') : empty('Nenhum pagamento confirmado para conferir.');
      el('homeOverdueInvoices').innerHTML = financeError ? empty(financeError) : !loadedFinance ? empty('Carregando faturas…') : groups.overdue.length ? groups.overdue.map(row => invoiceCard(row, false)).join('') : empty('Nenhuma fatura vencida até ontem.');
      el('homeDashboardStatus').textContent = pending ? 'Atualizando…' : clientError || financeError ? 'Não foi possível atualizar todos os dados. Tente novamente.' : lastUpdate ? 'Atualizado às ' + lastUpdate + ' · atualização automática' : 'Acompanhamento do dia';
      el('homeDashboardRefresh').disabled = Boolean(pending);
    }
    async function refresh() {
      if (!ctx.userId() || !ctx.visible()) return;
      if (pending) { queued = true; return pending; }
      const version = generation, userId = ctx.userId(), epoch = ctx.epoch();
      const canClients = ctx.can('clients.read'), canFinance = ctx.can('finance.read');
      const task = (async () => {
        const results = await Promise.allSettled([
          canClients ? ctx.read('app_clients?select=id,full_name,status,created_at,registration_deleted_at&status=eq.PENDENTE&registration_deleted_at=is.null&order=created_at.desc,id.asc') : Promise.resolve([]),
          canFinance ? ctx.read('app_payment_invoices?select=id,client_id,invoice_month,amount,due_date,status,paid_at,provider_status,superseded_at,updated_at,app_clients(full_name)&superseded_at=is.null&or=(due_date.lt.' + ctx.today() + ',provider_status.in.(CONFIRMED,RECEIVED))&order=due_date.asc,id.asc') : Promise.resolve([]),
          canFinance ? ctx.read('admin_dashboard_payment_dismissals?select=invoice_id&user_id=eq.' + encodeURIComponent(userId) + '&order=invoice_id.asc') : Promise.resolve([])
        ]);
        if (version !== generation || userId !== ctx.userId() || epoch !== ctx.epoch()) return;
        clientError = results[0].status === 'rejected' ? 'Falha ao carregar novos alunos. Tente atualizar.' : '';
        financeError = results[1].status === 'rejected' || results[2].status === 'rejected' ? 'Falha ao carregar o financeiro. Tente atualizar.' : '';
        if (!clientError) { clients = results[0].value; loadedClients = true; }
        if (!financeError) { invoices = results[1].value; dismissed = results[2].value; loadedFinance = true; }
        lastUpdate = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      })();
      pending = task;
      render();
      try { await task; } finally {
        if (pending === task) { pending = null; render(); if (queued) { queued = false; refresh(); } }
      }
    }
    async function dismiss(id) {
      if (dismissing.has(id) || !ctx.can('finance.read')) return;
      const current = classify(clients, invoices, dismissed, ctx.today()).payments.find(row => row.id === id);
      if (!current) return;
      const version = generation, userId = ctx.userId();
      dismissing.add(id); render();
      try {
        await ctx.write('admin_dashboard_payment_dismissals?on_conflict=user_id,invoice_id', {
          method: 'POST', body: { user_id: userId, invoice_id: id }, prefer: 'resolution=ignore-duplicates,return=minimal'
        });
        if (version === generation && userId === ctx.userId()) {
          dismissed.push({ invoice_id: id });
          if (pending) queued = true;
        }
      } catch (error) { ctx.error(error); }
      finally { dismissing.delete(id); render(); }
    }
    function stop() { clearInterval(timer); timer = null; }
    function start() {
      stop(); refresh();
      timer = setInterval(() => { if (!document.hidden && ctx.visible()) refresh(); }, 20000);
    }
    function reset() {
      stop(); generation++; pending = null; queued = false;
      clients = []; invoices = []; dismissed = []; dismissing.clear();
      loadedClients = loadedFinance = false; clientError = financeError = lastUpdate = ''; render();
    }
    function bind() {
      el('homeDashboardRefresh').addEventListener('click', refresh);
      el('homeWorkDashboard').addEventListener('click', event => {
        const open = event.target.closest('[data-dashboard-client]');
        if (open) ctx.openClient(open.dataset.dashboardClient, open.dataset.dashboardFinance === 'true').catch(ctx.error);
        const clear = event.target.closest('[data-dashboard-dismiss]');
        if (clear) dismiss(clear.dataset.dashboardDismiss);
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx.visible()) refresh(); });
    }
    return { render, refresh, start, stop, reset, bind };
  }
  root.IlhaHomeDashboard = { classify, create };
})(typeof window === 'undefined' ? globalThis : window);
