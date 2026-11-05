(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const monthName = value => new Date(value+'T12:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
  let state = null;
  async function mount(host, config) {
    if (state && state.host === host && state.config.clientId === config.clientId && (state.busy || state.selected.size)) { state.config=config; return; }
    const current=state={host,config,rows:[],selected:new Set(),busy:false,request:null};
    host.innerHTML='<p role="status">Consultando mensalidades por mês…</p>';
    try {
      const rows=await config.read();
      if(state!==current)return;
      current.rows=rows; render(current);
    } catch(error) {
      if(state!==current)return;
      host.innerHTML='<p role="alert">Não foi possível consultar os meses. '+esc(error.message)+'</p><button type="button" class="ghost-btn" data-mr-reload>Tentar novamente</button>';
      host.querySelector('[data-mr-reload]').onclick=()=>{state=null;mount(host,config);};
    }
  }
  function render(s) {
    const {host,config,rows}=s;
    host.innerHTML='<div class="mr-heading"><div><h3>Mensalidades por mês</h3><p>Selecione os meses que já foram pagos. O plano e as próximas cobranças continuam iguais.</p></div></div>'+ 
      '<div class="mr-months">'+rows.map(row=>'<label class="mr-month '+(row.state==='PAID'?'is-paid':'')+'">'+
        '<input type="checkbox" data-mr-month="'+esc(row.invoice_month)+'"'+(row.state!=='AVAILABLE'||!config.canWrite?' disabled':'')+'>'+
        '<span><strong>'+esc(monthName(row.invoice_month))+'</strong><b>'+money(row.amount)+'</b><small>'+
        (row.state==='PAID'?'Pago':row.state==='AVAILABLE'?(row.invoice_id?'Fatura em aberto':'Ainda não emitida'):'Revisar cadastro / cobrança')+'</small></span></label>').join('')+'</div>'+
      (config.canWrite?'<div class="mr-receipt" hidden><div class="mr-fields"><label>Forma de recebimento<select data-mr-method><option value="CASH">Dinheiro em mãos</option><option value="CLUB_PIX">Pix direto do clube</option></select></label>'+
        '<label>Recebido em<input data-mr-date type="date" value="'+esc(config.today)+'" max="'+esc(config.today)+'" min="2000-01-01" required></label>'+
        '<label class="mr-notes">Observação<input data-mr-notes maxlength="500" placeholder="Ex.: pagamento antecipado de 3 meses"></label></div>'+
        '<p class="mr-total" aria-live="polite"></p><label class="mr-confirm"><input type="checkbox" data-mr-confirm> Confirmo que o clube já recebeu o total dos meses selecionados.</label>'+
        '<p class="mr-result" role="status"></p><button class="primary-btn" type="button" data-mr-save>Confirmar recebimento</button></div>':'');
    host.querySelectorAll('[data-mr-month]').forEach(input=>input.addEventListener('change',()=>{
      if(input.checked)s.selected.add(input.dataset.mrMonth);else s.selected.delete(input.dataset.mrMonth);
      s.request=null; update(s);
    }));
    host.querySelector('[data-mr-save]')?.addEventListener('click',()=>save(s));
    host.querySelectorAll('[data-mr-method],[data-mr-date],[data-mr-notes]').forEach(input=>input.addEventListener('change',()=>{s.request=null;}));
  }
  function update(s) {
    const box=s.host.querySelector('.mr-receipt');if(!box)return;
    box.hidden=!s.selected.size;
    s.host.querySelector('.mr-total').textContent=s.selected.size+' mês(es) · Total recebido: '+money(s.rows.filter(r=>s.selected.has(r.invoice_month)).reduce((sum,r)=>sum+Number(r.amount),0));
    s.host.querySelector('[data-mr-confirm]').checked=false;
  }
  async function save(s) {
    if(s.busy||!s.selected.size)return;
    const host=s.host, message=host.querySelector('.mr-result');
    const date=host.querySelector('[data-mr-date]');
    if(!date.reportValidity())return;
    if(!host.querySelector('[data-mr-confirm]').checked){message.textContent='Confirme que o valor já foi recebido antes de dar baixa.';return;}
    const payload={action:'record_months',clientId:s.config.clientId,
      months:s.rows.filter(r=>s.selected.has(r.invoice_month)).map(r=>({month:r.invoice_month,expectedAmount:Number(r.amount)})),
      method:host.querySelector('[data-mr-method]').value,receivedOn:date.value,notes:host.querySelector('[data-mr-notes]').value.trim()};
    s.request ||= {...payload,requestId:crypto.randomUUID()};
    s.busy=true; host.querySelectorAll('button,input,select').forEach(input=>input.disabled=true);
    message.textContent='Confirmando os meses. Não feche esta janela…';
    try {
      const data=await s.config.send(s.request);
      if(data.state==='COMPLETED'){
        message.textContent='Recebimento confirmado em todos os meses selecionados.';
        await s.config.changed();
        if(state!==s)return;
        const rows=await s.config.read();s.rows=rows;s.selected.clear();s.request=null;render(s);
        const notice=document.createElement('p');notice.className='mr-success';notice.setAttribute('role','status');notice.textContent='Meses marcados como pagos. Eles não serão cobrados novamente.';host.prepend(notice);
      }else{
        message.textContent=(data.results||[]).map(row=>monthName(row.month)+': '+(row.state==='COMPLETED'?'pago':row.error||'aguardando confirmação')).join(' · ')+'. Toque novamente para concluir os pendentes; os meses pagos não serão duplicados.';
      }
    }catch(error){message.textContent=(error.message||'Resposta não confirmada.')+' Tente novamente com os mesmos dados para conferir a baixa, sem duplicar o recebimento.';}
    finally{
      s.busy=false;
      if(state===s){host.querySelectorAll('button,input,select').forEach(input=>input.disabled=false);
        host.querySelectorAll('[data-mr-month]').forEach(input=>input.disabled=s.rows.find(row=>row.invoice_month===input.dataset.mrMonth)?.state!=='AVAILABLE');}
    }
  }
  window.IlhaMonthlyReceipts={mount,reset(){state=null;}};
})();
