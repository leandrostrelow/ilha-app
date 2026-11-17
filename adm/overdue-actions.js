(function (root) {
  'use strict';
  async function suspend(ctx, invoice, selection) {
    let prepared;
    try { prepared = await ctx.prepare(selection); } catch (error) { error.beforeMutation = true; throw error; }
    if (prepared && prepared.state === 'COMPLETED') return prepared;
    if (ctx.managed(invoice)) await ctx.cancel(invoice, selection.p_reason);
    const result = await ctx.finish(selection);
    if (!result || result.state !== 'COMPLETED') throw new Error('A suspensão não foi concluída. Confira e tente novamente.');
    return result;
  }
  async function open(ctx, invoice) {
    const preview = await ctx.preview(invoice.id);
    const dialog = document.createElement('dialog');
    dialog.className = 'overdue-action-dialog';
    dialog.setAttribute('aria-labelledby', 'overdueSuspendTitle');
    const e = ctx.escape;
    dialog.innerHTML = '<form><h2 id="overdueSuspendTitle">Suspender inscrição</h2><p>' + e(ctx.summary(invoice)) + '</p>' +
      '<p>A fatura inteira será cancelada, inclusive os valores de familiares que continuarem nas aulas. Outras faturas já emitidas serão preservadas.</p>' +
      '<fieldset><legend>Quem vai parar de fazer aulas?</legend><label><input type="checkbox" name="payer"> ' + e(preview.payerName) + ' (responsável)</label>' +
      preview.members.map(member => '<label><input type="checkbox" name="member" value="' + e(member.id) + '"> ' + e(member.name) + '</label>').join('') + '</fieldset>' +
      (preview.members.length ? '<p>Dependentes podem ser selecionados individualmente. Para suspender o responsável pagador, selecione toda a família.</p>' : '') +
      '<p>Os selecionados sairão dos alunos ativos e das aulas. A cobrança futura será desativada para o responsável ou pausada para os dependentes selecionados. O cadastro e o histórico serão preservados.</p>' +
      '<label>Motivo da suspensão<textarea name="reason" required minlength="10" maxlength="400"></textarea></label>' +
      '<label><input type="checkbox" name="consent" required> Confirmo o cancelamento desta fatura e a suspensão dos selecionados.</label>' +
      '<p role="alert" class="overdue-action-error" hidden></p><button type="button" class="ghost-btn" data-review hidden>Revisar dados atuais</button><div class="overdue-action-buttons"><button type="button" data-close class="ghost-btn">Voltar</button><button type="submit" class="primary-btn">Cancelar fatura e suspender</button></div></form>';
    document.body.append(dialog);
    let busy = false;
    const form = dialog.querySelector('form'), error = dialog.querySelector('[role="alert"]');
    const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-review]').addEventListener('click', () => { if (!busy) { close(); open(ctx, invoice).catch(error => ctx.notify(error.message)); } });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      const selection = { p_invoice_id: invoice.id, p_payer: form.elements.payer.checked,
        p_member_ids: Array.from(form.querySelectorAll('[name="member"]:checked')).map(input => input.value),
        p_reason: form.elements.reason.value.trim(), p_version: preview.version };
      if ((!selection.p_payer && !selection.p_member_ids.length) || (selection.p_payer && selection.p_member_ids.length !== preview.members.length)) {
        error.hidden = false; error.textContent = 'Selecione quem vai parar. Para suspender o responsável, selecione também todos os dependentes.'; return;
      }
      busy = true; error.hidden = true;
      let editable = false;
      form.querySelectorAll('input,textarea,button').forEach(input => { input.disabled = true; });
      try {
        await suspend(ctx, invoice, selection);
        await ctx.changed(); busy = false; close(); ctx.notify('Fatura cancelada e inscrições selecionadas suspensas. Histórico preservado.');
      } catch (failure) {
        editable = failure.beforeMutation === true;
        dialog.querySelector('[data-review]').hidden = false;
        error.hidden = false;
        error.textContent = (failure && failure.message || 'Falha ao concluir.') + ' A operação pode ter concluído o cancelamento antes desta falha. Confira a ficha; repetir esta mesma operação não cria outra cobrança.';
      } finally {
        busy = false;
        form.querySelectorAll('button').forEach(button => { button.disabled = false; });
        // Keep the reviewed selection and reason stable on a retry.
        if (editable) form.querySelectorAll('input,textarea').forEach(input => { input.disabled = false; });
      }
    });
    dialog.showModal();
  }
  root.IlhaOverdueActions = { open, suspend };
})(typeof window === 'undefined' ? globalThis : window);
