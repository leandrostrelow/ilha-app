(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canAdjustAmount = invoice => !invoice.supersededAt && !invoice.paidAt && Number(invoice.amount) > 0 &&
    ['ABERTA','AGUARDANDO','VENCIDA'].includes(invoice.status) && ['PENDING','OVERDUE'].includes(invoice.providerStatus);
  function payload(values, config) {
    if (!config.canWrite) throw new Error('Seu acesso não permite conciliar recebimentos.');
    if (!values.confirmed) throw new Error('Confirme a conferência dos registros antes de continuar.');
    const reason = String(values.reason || '').trim();
    if (reason.length < 10 || reason.length > 400) throw new Error('Informe um motivo entre 10 e 400 caracteres.');
    if (values.action === 'adjust_amount') {
      const invoice = config.invoices.find(row => row.id === values.invoiceId && canAdjustAmount(row));
      const newAmount = Number(values.newAmount);
      if (!invoice) throw new Error('Selecione uma fatura Asaas em aberto, sem pagamento ou substituição.');
      if (!Number.isFinite(newAmount) || newAmount <= 0 || newAmount === Number(invoice.amount) ||
        Math.abs(newAmount*100-Math.round(newAmount*100)) > 0.00001) throw new Error('Informe um novo valor positivo, com até duas casas decimais.');
      return {action:values.action, invoiceId:invoice.id, expectedAmount:Number(invoice.amount), newAmount,
        invoiceMonth:invoice.invoiceMonth, oldDueDate:invoice.dueDate, reason};
    }
    if (values.action === 'audited_reissue' || values.action === 'reschedule_failed') {
      const invoice = config.invoices.find(row => row.id === values.invoiceId && !row.supersededAt &&
        ((values.action === 'reschedule_failed' && row.status === 'ABERTA' && row.providerStatus === 'FAILED') || (values.action === 'audited_reissue' && ((row.status === 'CANCELADA' && row.providerStatus === 'CANCELLED') || (row.status === 'AGUARDANDO' && row.providerStatus === 'REVIEW_REQUIRED')))));
      if (!invoice || !/^\d{4}-\d{2}-\d{2}$/.test(values.newDueDate || '')) throw new Error('Selecione a cobrança cancelada/em revisão e o vencimento correto.');
      return {action:values.action, invoiceId:invoice.id, expectedAmount:Number(invoice.amount), invoiceMonth:invoice.invoiceMonth,
        oldDueDate:invoice.dueDate, newDueDate:values.newDueDate, reason};
    }
    if (values.action === 'review_reversal') {
      const invoice = config.invoices.find(row => row.id === values.invoiceId && row.status === 'PAGA' && row.providerStatus === 'RECEIVED' && !row.supersededAt);
      if (!invoice) throw new Error('Selecione uma fatura paga pelo provedor para conferir a reversão.');
      return {action:values.action, invoiceId:invoice.id, expectedAmount:Number(invoice.amount), invoiceMonth:invoice.invoiceMonth, dueDate:invoice.dueDate, reason};
    }
    if (values.action !== 'historical_receipt') throw new Error('Operação inválida.');
    const month = String(values.month || '');
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
    if (!/^\d{4}-\d{2}$/.test(month) || !validDate(month+'-01') || month >= config.today.slice(0,7) ||
      !validDate(values.dueDate) || values.dueDate.slice(0,7) !== month || !validDate(values.receivedOn) || values.receivedOn < month+'-01' || values.receivedOn > config.today) {
      throw new Error('Confira a competência passada, o vencimento e a data real do recebimento.');
    }
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount*100-Math.round(amount*100)) > 0.00001) throw new Error('Informe o valor real recebido, com até duas casas decimais.');
    return {action:values.action, clientId:config.clientId, invoiceMonth:month+'-01', amount, dueDate:values.dueDate, receivedOn:values.receivedOn, reason};
  }
  function mount(host, config) {
    host.hidden = !config.canWrite;
    if (!config.canWrite) { host.innerHTML=''; return; }
    const invoices = config.invoices.filter(row => !row.supersededAt && ['RECEIVED','CANCELLED','REVIEW_REQUIRED','FAILED'].includes(row.providerStatus));
    host.innerHTML='<details><summary>Conciliação administrativa</summary><p>Confira também o Asaas antes de registrar uma correção. O histórico será preservado.</p>'+
      '<label>Operação<select data-mc-action><option value="historical_receipt">Registrar Pix histórico recebido pelo clube</option><option value="review_reversal">Conferir baixa desfeita no Asaas</option><option value="audited_reissue">Reemitir cobrança com vencimento corrigido</option><option value="reschedule_failed">Reagendar substituta recusada pelo Asaas</option><option value="adjust_amount">Corrigir valor de fatura em aberto</option></select></label>'+
      '<div data-mc-history><p>Use somente quando não existir fatura nem lançamento da competência. Não gera cobrança no Asaas.</p><div class="mr-fields">'+
      '<label>Competência<input type="month" data-mc-month></label><label>Valor recebido (R$)<input type="number" min="0.01" step="0.01" data-mc-amount></label>'+
      '<label>Vencimento original<input type="date" data-mc-due></label><label>Data real do Pix<input type="date" data-mc-received max="'+esc(config.today)+'"></label></div></div>'+
      '<div data-mc-reversal hidden><p data-mc-description>A conferência da baixa mantém a fatura em revisão. A reemissão confirma o cancelamento no Asaas e cria uma substituta única, sem registrar pagamento.</p><label>Fatura<select data-mc-invoice><option value="">Selecione</option>'+
      invoices.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.invoiceMonth)+' · R$ '+Number(i.amount).toFixed(2)+' · vence '+esc(i.dueDate)+'</option>').join('')+'</select></label><label data-mc-new-due-wrap hidden>Novo vencimento<input type="date" data-mc-new-due></label><label data-mc-new-amount-wrap hidden>Novo valor total (R$)<input type="number" min="0.01" step="0.01" data-mc-new-amount></label></div>'+
      '<label>Motivo da correção<textarea data-mc-reason minlength="10" maxlength="400"></textarea></label><label><input type="checkbox" data-mc-confirm> Conferi competência, valor, vencimento e recebimento no Ilha e no Asaas.</label>'+
      '<p role="status" data-mc-status></p><button type="button" class="primary-btn" data-mc-save>Executar conciliação</button></details>';
    const field = name => host.querySelector('[data-mc-'+name+']');
    const originalDescription=field('description').textContent;
    field('action').onchange=()=>{
      const action=field('action').value, adjusting=action==='adjust_amount';
      field('history').hidden=action!=='historical_receipt';field('reversal').hidden=!field('history').hidden;
      field('new-due-wrap').hidden=!['audited_reissue','reschedule_failed'].includes(action);field('new-amount-wrap').hidden=!adjusting;
      field('description').textContent=adjusting?'Corrige somente o valor desta fatura no Ilha e no Asaas, conforme a composição atual do cadastro. Mantém vencimento e cobrança, sem registrar pagamento.':originalDescription;
      field('invoice').innerHTML='<option value="">Selecione</option>'+(adjusting?config.invoices.filter(canAdjustAmount):invoices).map(i=>'<option value="'+esc(i.id)+'">'+esc(i.invoiceMonth)+' · R$ '+Number(i.amount).toFixed(2)+' · vence '+esc(i.dueDate)+'</option>').join('');
      field('new-amount').value='';field('confirm').checked=false;field('status').textContent='';
    };
    host.querySelectorAll('input:not([type=checkbox]),select,textarea').forEach(el=>el.addEventListener('input',()=>{field('confirm').checked=false;}));
    let busy=false;
    field('save').onclick=async()=>{
      if(busy)return;
      try {
        const body=payload({action:field('action').value, invoiceId:field('invoice').value, month:field('month').value, amount:field('amount').value,
          newDueDate:field('new-due').value, newAmount:field('new-amount').value, dueDate:field('due').value, receivedOn:field('received').value, reason:field('reason').value, confirmed:field('confirm').checked},config);
        busy=true;host.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
        field('status').textContent='Conferindo e registrando a conciliação…';
        const result=await config.send(body);
        if(result.state!==(['audited_reissue','reschedule_failed'].includes(body.action)?'REISSUED':body.action==='review_reversal'?'REVIEW_REQUIRED':'COMPLETED')) throw new Error('Resultado não confirmado. Atualize os registros antes de continuar.');
        field('status').textContent=body.action==='adjust_amount'?'Valor corrigido no Ilha e no Asaas. Vencimento e histórico preservados, sem registrar pagamento.':['audited_reissue','reschedule_failed'].includes(body.action)?'Substituta emitida com o vencimento conferido. Cobrança anterior preservada no histórico.':body.action==='review_reversal'?'Baixa desfeita registrada. Fatura e financeiro estão em revisão, sem pagamento.':'Pix histórico registrado com a data e o valor informados.';
        await config.changed();
      } catch(error) { field('status').textContent=error.message || 'Conciliação não concluída.'; }
      finally {busy=false;host.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);field('confirm').checked=false;}
    };
  }
  window.IlhaMonthlyReconciliation={mount,payload};
})();
