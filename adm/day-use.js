/* Beach Tennis access ledger. No automatic collection or customer messages. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const shift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const date=v=>String(v||'').slice(0,10).split('-').reverse().join('/');
  const label=k=>k==='MENSAL'?'Mensal':'Diário';
  const method=k=>({PIX:'Pix recebido',DINHEIRO:'Dinheiro',CARTAO_CREDITO:'Cartão de crédito',CARTAO_DEBITO:'Cartão de débito'}[k]||k);
  const phoneLabel=v=>String(v||'').replace(/^55(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3');
  let ctx,key='',rows=[],plans=[],customers=[],proofs=[],loading=false,loaded=false,last=0,error='',busy=false,request=null,focusBefore=null;
  let latestMonthly=new Map();
  let tab='monthly',invite=null;
  let query='',kind='TODOS',status='ATUAIS',period='HOJE',receivedOnly=false,reportMonth=today().slice(0,7),refreshAgain=false;
  const modal=()=>document.getElementById('dayUseDialog');
  const person=r=>r.bar_day_use_customers||{};
  const sorted=()=>rows.slice().sort((a,b)=>(b.paid_on+' '+b.created_at+' '+b.id).localeCompare(a.paid_on+' '+a.created_at+' '+a.id));
  function state(row){
    if(person(row).deleted_at)return 'EXCLUIDO';
    if(row.cancelled_at)return 'CANCELADO';
    if(row.kind==='MENSAL'&&latestMonthly.get(row.customer_id)!==row.id)return 'RENOVADO';
    return today()>=row.expires_on?'VENCIDO':'ATIVO';
  }
  function periodBounds(mode, day, month=day.slice(0,7)){
    if(mode==='TODOS')return {from:'0000-01-01',to:'9999-12-31'};
    if(mode==='SEMANA')return {from:shift(day,-6),to:day};
    if(mode==='MES'){const first=month+'-01';const d=new Date(first+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return {from:first,to:d.toISOString().slice(0,10)};}
    return {from:day,to:day};
  }
  const reportBounds=()=>periodBounds(period,ctx?.commandSnapshot?.().day||today(),reportMonth);
  const inRange=(day,bounds)=>Boolean(day)&&day>=bounds.from&&day<=bounds.to;
  const periodText=()=>period==='HOJE'?'Hoje':period==='SEMANA'?'Últimos 7 dias':period==='MES'?reportMonth.split('-').reverse().join('/'):'Todos os períodos';
  function commandReport(snapshot, planRows, options={}){
    if(!snapshot)return [];
    const orders=new Map(snapshot.orders.map(o=>[o.id,o]));
    const allItems=new Map(snapshot.items.map(i=>[i.id,i]));
    const kinds=new Map(planRows.map(p=>[p.product_id||p.bar_products?.id,p.kind]).filter(([id])=>id));
    const groups=new Map(),seen=new Set();
    for(const item of snapshot.items){
      if(seen.has(item.id))continue;seen.add(item.id);
      const order=orders.get(item.orderId);
      if(!order||order.status==='CANCELADA'||item.status==='CANCELADO')continue;
      const itemKind=kinds.get(item.productId);
      if(!itemKind)continue;
      const source=allItems.get(item.splitSourceItemId)||item;
      const sourceOrder=orders.get(source.orderId)||order;
      const when=sourceOrder.source==='BALCAO'?(sourceOrder.closedAt||sourceOrder.openedAt||source.created):source.created;
      const saleDay=snapshot.dateKey(when);
      const id=item.splitSourceItemId||item.id;
      let group=groups.get(id);
      if(!group){group={id,saleDay,kind:itemKind,quantity:Number(source.quantity||0),amount:0,orders:new Map(),names:new Set()};groups.set(id,group);}
      group.amount+=Number(item.quantity||0)*Number(item.unitPrice||0);
      group.orders.set(order.id,order);
      group.names.add(item.customerName||order.customerName||'Cliente não informado');
    }
    return Array.from(groups.values()).map(g=>{
      const linked=Array.from(g.orders.values());
      const paid=linked.every(o=>o.paymentStatus==='PAGO');
      const partial=!paid&&linked.some(o=>o.paymentStatus==='PAGO'||o.paymentStatus==='PARCIAL'||snapshot.finance.some(f=>f.orderId===o.id&&f.type==='RECEITA'&&['PAGO','RECEBIDO'].includes(f.status)&&Number(f.amount)>0));
      const paidDays=linked.map(o=>{
        const receipts=snapshot.finance.filter(f=>f.orderId===o.id&&f.type==='RECEITA'&&['PAGO','RECEBIDO'].includes(f.status)&&Number(f.amount)>0);
        return receipts.map(f=>f.paidAt||f.created||f.dueDate).filter(Boolean).map(v=>snapshot.dateKey(v)).filter(Boolean).sort().at(-1)||(o.closedAt?snapshot.dateKey(o.closedAt):'');
      });
      const paidDay=paid&&paidDays.every(Boolean)?paidDays.sort().at(-1):'';
      return {...g,paidDay,paid,names:Array.from(g.names).join(' / '),orders:linked,payment:paid?'Comanda paga':partial?'Pagamento parcial':'Em aberto'};
    }).filter(g=>{
      const bounds=options.bounds||{from:snapshot.day,to:snapshot.day};
      return options.receivedOnly?g.paid&&inRange(g.paidDay,bounds):inRange(g.saleDay,bounds);
    });
  }
  const commands=(filtered=false)=>commandReport(ctx?.commandSnapshot?.(),plans,filtered?{bounds:reportBounds(),receivedOnly}:{});
  function metrics(){return {
    active:rows.filter(r=>r.kind==='MENSAL'&&state(r)==='ATIVO').length,
    expired:rows.filter(r=>r.kind==='MENSAL'&&state(r)==='VENCIDO').length,
    daily:rows.filter(r=>r.kind==='DIARIO'&&!r.cancelled_at&&r.paid_on===today()).length+commands().filter(r=>r.kind==='DIARIO').reduce((sum,r)=>sum+r.quantity,0),
    total:rows.filter(r=>!r.cancelled_at&&r.paid_on===today()).reduce((s,r)=>s+Number(r.amount),0)
  };}
  function card(){
    const m=metrics();
    return '<article class="bar-command-unified-card bar-counter-command-card bar-day-use-card has-money-value"><button class="bar-command-unified-main" type="button" data-day-use-open><span class="bar-command-unified-icon" aria-hidden="true"><svg><use href="#admin-icon-calendar"></use></svg></span><span class="bar-command-unified-copy"><span class="bar-command-unified-heading"><strong>Day Use · Beach Tennis</strong></span><small>'+esc(!loaded?(error?'Não foi possível carregar · tente novamente':'Controle diário e mensal'):m.daily+' diários hoje · '+m.active+' mensais ativos · '+m.expired+' vencidos')+'</small></span></button><div class="bar-command-unified-footer"><div class="bar-counter-command-actions"><button class="bar-counter-command-action" type="button" data-day-use-open="new">+ Registrar pagamento</button><button class="bar-counter-command-action is-history" type="button" data-day-use-open>Gerenciar</button></div><div class="bar-command-unified-side"><b class="bar-command-unified-value">'+money(m.total)+'</b><small>recebidos diretamente hoje</small></div></div></article>';
  }
  function ensure(context){
    if(key!==context.sessionKey)reset();
    ctx=context;key=context.sessionKey;
    if(ctx.canRead()&&!loading&&Date.now()-last>30000)refresh();
  }
  function reset(){if(proofObjectUrl){URL.revokeObjectURL(proofObjectUrl);proofObjectUrl='';}key='';ctx=null;rows=[];plans=[];customers=[];proofs=[];tab='monthly';invite=null;latestMonthly=new Map();loaded=false;error='';last=0;request=null;busy=false;loading=false;query='';kind='TODOS';status='ATUAIS';period='HOJE';receivedOnly=false;reportMonth=today().slice(0,7);refreshAgain=false;modal()?.remove();}
  async function refresh(force=false){
    if(!ctx?.canRead())return;
    if(loading){if(force)refreshAgain=true;return;}
    if(!force&&Date.now()-last<30000)return;
    loading=true;last=Date.now();const epoch=key;
    try{
      if(modal()?.open&&ctx.refreshCommands)await ctx.refreshCommands(true);
      const data=ctx.demo()?ctx.demoData():await Promise.all([
        ctx.read('bar_day_use_passes?select=*,bar_day_use_customers(full_name,phone,deleted_at,delete_reason)&order=paid_on.desc,created_at.desc,id.desc'),
        ctx.read('bar_day_use_plans?select=*,bar_products(id,name,sale_price,active)&order=kind.asc'),
        ctx.read('bar_day_use_customers?select=id,full_name,phone,created_at,deleted_at&order=created_at.desc'),
        ctx.read('bar_day_use_proofs?select=id,customer_id,object_path,uploaded_at&uploaded_at=not.is.null&order=uploaded_at.desc')
      ]);
      if(epoch!==key)return;
      [rows,plans]=data;proofs=data[3]||[];customers=data[2]||Array.from(new Map(rows.map(r=>[r.customer_id,{id:r.customer_id,...person(r)}])).values());loaded=true;error='';
      latestMonthly=new Map();for(const row of sorted())if(row.kind==='MENSAL'&&!row.cancelled_at&&!latestMonthly.has(row.customer_id))latestMonthly.set(row.customer_id,row.id);
    }catch(e){if(epoch===key)error=e.message||'Falha ao atualizar Day Use.';}
    finally{if(epoch===key){loading=false;paintCard();renderList();if(refreshAgain){refreshAgain=false;refresh(true);}}}
  }
  function paintCard(){const old=document.querySelector('.bar-day-use-card');if(old)old.outerHTML=card();}
  function skeleton(){
    if(modal())return;
    const el=document.createElement('dialog');el.id='dayUseDialog';el.className='day-use-dialog';
    el.innerHTML=`<header class="du-heading"><div><span class="du-eyebrow">ILHA BAR / BEACH TENNIS</span><h2>Day Use</h2></div><button class="ghost-btn" type="button" data-du-close aria-label="Fechar Day Use">Fechar ×</button></header>
      <div class="du-notice" id="duNotice" role="status"></div><button type="button" class="du-new-registrations" id="duNewRegistrations" data-du-pending hidden></button><div class="du-metrics" id="duMetrics"></div>
      <div class="du-tabs" role="tablist" aria-label="Gerenciar Day Use">${[['monthly','Mensalistas'],['daily','Diárias'],['receipts','Recebimentos']].map(([id,name])=>`<button type="button" role="tab" id="duTab-${id}" aria-controls="duPanel" data-du-tab="${id}">${name}</button>`).join('')}</div>
      <section id="duPanel" role="tabpanel" tabindex="0"><div class="du-section-heading"><div><h3 id="duSectionTitle"></h3></div><div class="du-top-actions"><button class="ghost-btn" type="button" data-du-refresh>Atualizar</button><button class="primary-btn" type="button" data-du-new>+ Registrar pagamento</button></div></div>
      <div id="duInvite" class="du-invite" hidden><div><strong>Novo mensalista</strong></div><button class="ghost-btn" type="button" data-du-invite>Gerar link de cadastro</button><div id="duInviteResult" hidden></div></div>
      <div class="du-period-toolbar"><label>Período<select id="duPeriod"><option value="HOJE">Hoje</option><option value="SEMANA">Últimos 7 dias</option><option value="MES">Mensal</option><option value="TODOS">Todos os períodos</option></select></label><label id="duMonthLabel" hidden>Mês<input type="month" id="duMonth" value="${reportMonth}"></label><label>Pagamentos<select id="duReceipt"><option value="TODOS">Todos os lançamentos</option><option value="RECEBIDOS">Somente recebidos / quitados</option></select></label></div>
      <button type="button" class="ghost-btn" id="duProofs" data-du-proofs hidden>Comprovantes recebidos</button><div class="du-toolbar"><label>Buscar pessoa<input id="duSearch" type="search" placeholder="Nome ou telefone"></label><label id="duKindLabel">Tipo<select id="duKind"><option value="TODOS">Diário e mensal</option><option value="DIARIO">Day Use diário</option><option value="MENSAL">Day Use mensal</option></select></label><label>Situação<select id="duStatus"></select></label></div>
      <div id="duEditor" hidden></div><div class="du-list-meta" id="duListMeta" role="status"></div><div class="du-list" id="duList"></div><section class="du-command-report" id="duCommandReport"></section></section>
      `;
    document.body.append(el);
    configureTab();
    el.querySelector('.du-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...el.querySelectorAll('[data-du-tab]')],index=tabs.indexOf(e.target);const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});
    el.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    el.addEventListener('close',()=>{if(!busy&&document.getElementById('duEditor')){document.getElementById('duEditor').hidden=true;focusBefore?.focus?.();}});
    el.addEventListener('input',e=>{if(e.target.id==='duSearch'){query=e.target.value;renderList();}if(['duPaidOn','duPlan'].includes(e.target.id))preview();});
    el.addEventListener('change',async e=>{if(['duPeriod','duReceipt','duMonth'].includes(e.target.id)){period=document.getElementById('duPeriod').value;receivedOnly=document.getElementById('duReceipt').value==='RECEBIDOS';reportMonth=document.getElementById('duMonth').value||today().slice(0,7);document.getElementById('duMonthLabel').hidden=period!=='MES';notice('Atualizando período…');await refresh(true);if(!error)notice('');return;}if(e.target.id==='duKind'){kind=e.target.value;renderList();}if(e.target.id==='duStatus'){status=e.target.value;renderList();}if(e.target.id==='duPlan')preview();});
    el.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b||busy)return;
      if(b.hasAttribute('data-du-close'))el.close();
      if(b.hasAttribute('data-du-refresh'))await refresh(true);
      if(b.hasAttribute('data-du-new'))editor();
      if(b.hasAttribute('data-du-proofs')){tab='monthly';status='COMPROVANTES';configureTab();renderList();}
      if(b.dataset.duProof)await viewProof(b.dataset.duProof);
      if(b.hasAttribute('data-du-pending')){tab='monthly';status='SEM_PAGAMENTO';configureTab();renderList();document.getElementById('duList').scrollIntoView({block:'nearest',behavior:'smooth'});}
      if(b.dataset.duTab){tab=b.dataset.duTab;status=tab==='monthly'?'ATUAIS':tab==='customers'?'CADASTRADOS':'TODOS';document.getElementById('duEditor').hidden=true;configureTab();renderList();}
      if(b.hasAttribute('data-du-invite'))await createInvite(b);
      if(b.hasAttribute('data-du-copy')){try{await navigator.clipboard.writeText(invite.url);notice('Link fixo copiado.');}catch{document.getElementById('duInviteUrl').select();notice('Copie o link abaixo.');}}
      if(b.closest('.du-more'))b.closest('.du-more').open=false;
      if(b.dataset.duCommand){el.close();ctx.openCommand?.(b.dataset.duCommand);}
      if(b.dataset.duRenew)editor(findRow(b.dataset.duRenew));
      if(b.dataset.duEdit)editor(findRow(b.dataset.duEdit),'edit');
      if(b.dataset.duCancel)editor(findRow(b.dataset.duCancel),'cancel');
      if(b.dataset.duDelete)editor(findRow(b.dataset.duDelete),'delete');
      if(b.hasAttribute('data-du-dismiss'))document.getElementById('duEditor').hidden=true;
    });
    el.addEventListener('submit',save);
  }
  function configureTab(){
    const titles={monthly:['Mensalistas','Veja todos os mensais atuais e quem precisa renovar, independente da data em que pagou.'],daily:['Diárias','Acessos registrados e Day Use lançados nas comandas no período escolhido.'],receipts:['Recebimentos','Consulte pagamentos diretos e comandas, com filtros por período e tipo.'],customers:['Cadastros','Pessoas cadastradas, inclusive as que ainda não têm um pagamento registrado.']};
    document.getElementById('duPanel').setAttribute('aria-labelledby','duTab-'+tab);
    modal().querySelectorAll('[data-du-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.duTab===tab));b.tabIndex=b.dataset.duTab===tab?0:-1;});
    document.getElementById('duSectionTitle').textContent=titles[tab][0];
    modal().querySelector('.du-period-toolbar').hidden=!['daily','receipts'].includes(tab);
    document.getElementById('duKindLabel').hidden=tab!=='receipts';
    document.getElementById('duInvite').hidden=!ctx.canWrite()||tab!=='monthly';
    const options=tab==='monthly'?[['ATUAIS','Todos os mensalistas'],['SEM_PAGAMENTO','Aguardando pagamento'],['COMPROVANTES','Comprovantes recebidos'],['ATIVO','Ativos'],['PROXIMOS','Vencem em até 7 dias'],['VENCIDO','Vencidos']]:tab==='customers'?[['CADASTRADOS','Cadastros atuais'],['SEM_PAGAMENTO','Sem pagamento registrado'],['EXCLUIDO','Excluídos']]:[['TODOS','Todo o histórico'],['ATIVO','Ativos'],['VENCIDO','Vencidos'],['CANCELADO','Cancelados'],['EXCLUIDO','Excluídos']];
    document.getElementById('duStatus').innerHTML=options.map(([value,name])=>'<option value="'+value+'"'+(value===status?' selected':'')+'>'+name+'</option>').join('');
  }
  // Monthly membership follows the latest pass, not the receipt date filter.
  function filterPasses(data,options,getState){
    const {tab,kind,status,query,bounds,receivedOnly,day}=options,q=query.toLocaleLowerCase('pt-BR').trim(),digits=q.replace(/\D/g,'');
    return data.filter(r=>{
      const p=person(r),s=getState(r);
      if(q&&!String(p.full_name||'').toLocaleLowerCase('pt-BR').includes(q)&&!(digits&&String(p.phone||'').includes(digits)))return false;
      if(tab==='monthly')return r.kind==='MENSAL'&&['ATIVO','VENCIDO'].includes(s)&&(status==='ATUAIS'||s===status||(status==='PROXIMOS'&&s==='ATIVO'&&r.expires_on<=shift(day,7)));
      if(!inRange(r.paid_on,bounds)||(receivedOnly&&r.cancelled_at))return false;
      if(tab==='daily'?r.kind!=='DIARIO':kind!=='TODOS'&&r.kind!==kind)return false;
      return status==='TODOS'||s===status;
    });
  }
  function findRow(id){return rows.find(r=>r.id===id)||customers.filter(c=>'customer-'+c.id===id).map(c=>({id,customer_id:c.id,kind:'MENSAL',bar_day_use_customers:c}))[0];}
  function renderCustomers(){
    const q=query.toLocaleLowerCase('pt-BR').trim(),digits=q.replace(/\D/g,'');
    const paid=new Set(rows.filter(r=>!r.cancelled_at).map(r=>r.customer_id));
    const matches=customers.filter(c=>(status==='EXCLUIDO'?c.deleted_at:!c.deleted_at)&&(status!=='SEM_PAGAMENTO'||!paid.has(c.id))&&(!q||c.full_name.toLocaleLowerCase('pt-BR').includes(q)||(digits&&c.phone.includes(digits))));
    document.getElementById('duListMeta').textContent=loaded?matches.length+' cadastro(s)':'Carregando cadastros…';
    document.getElementById('duList').innerHTML=matches.map(c=>{const id='customer-'+c.id,editable=ctx.canWrite()&&!c.deleted_at;return '<article class="du-person"><div class="du-person-main"><strong>'+esc(c.full_name)+'</strong><a href="https://wa.me/'+esc(c.phone)+'" target="_blank" rel="noopener noreferrer">'+esc(phoneLabel(c.phone))+'</a></div><div class="du-dates"><span class="du-badge">'+(c.deleted_at?'Excluído':paid.has(c.id)?'Possui pagamentos':'Sem pagamento registrado')+'</span></div><div class="du-actions">'+(editable?'<button class="small-btn du-renew" type="button" data-du-renew="'+id+'">Registrar pagamento</button><details class="du-more"><summary>Mais opções ⌄</summary><div class="du-more-panel"><button type="button" class="small-btn" data-du-edit="'+id+'">Editar cadastro</button><button type="button" class="small-btn du-danger" data-du-delete="'+id+'">Excluir cadastro</button></div></details>':'')+'</div></article>';}).join('')||'<div class="lesson-empty-state">Nenhum cadastro neste filtro. Use o link acima para convidar uma pessoa.</div>';
  }
  function renderProofs(){
    const q=query.trim().toLocaleLowerCase('pt-BR');
    const matches=proofs.filter(r=>{const c=customers.find(c=>c.id===r.customer_id);return c&&(!q||c.full_name.toLocaleLowerCase('pt-BR').includes(q)||c.phone.includes(q.replace(/\D/g,''))&&/\d/.test(q));});
    document.getElementById('duListMeta').textContent=matches.length+' comprovante(s) · confira antes de registrar o pagamento';
    document.getElementById('duList').innerHTML=matches.map(r=>{const c=customers.find(c=>c.id===r.customer_id);return '<article class="du-person"><div class="du-person-main"><strong>'+esc(c.full_name)+'</strong><small>'+esc(phoneLabel(c.phone))+'</small></div><div class="du-dates"><span>Enviado em '+date(r.uploaded_at)+'</span><span class="du-badge">Comprovante enviado</span></div><div class="du-actions"><button class="small-btn" type="button" data-du-proof="'+esc(r.id)+'">Ver comprovante</button>'+(ctx.canWrite()&&!c.deleted_at?'<button class="small-btn du-renew" type="button" data-du-renew="customer-'+esc(c.id)+'">Registrar pagamento</button>':'')+'</div></article>';}).join('')||'<div class="lesson-empty-state">Nenhum comprovante neste filtro.</div>';
  }
  let proofObjectUrl='';
  async function viewProof(id){
    const proof=proofs.find(r=>r.id===id),epoch=key;if(!proof||!ctx.loadProof)return;
    try{
      notice('Abrindo comprovante…');const blob=await ctx.loadProof(proof.object_path);if(epoch!==key)return;
      if(proofObjectUrl)URL.revokeObjectURL(proofObjectUrl);proofObjectUrl=URL.createObjectURL(blob);
      const box=document.getElementById('duEditor');box.hidden=false;box.innerHTML='<div class="du-editor-title"><h3>Comprovante de pagamento</h3><button type="button" class="ghost-btn" data-du-dismiss>Fechar</button></div><img class="du-proof-image" alt="Comprovante enviado pelo cliente" src="'+esc(proofObjectUrl)+'">';box.scrollIntoView({block:'nearest',behavior:'smooth'});notice('');
    }catch(e){notice(e.message||'Não foi possível abrir o comprovante.',true);}
  }
  async function createInvite(button){
    if(!ctx.canWrite())return;
    if(ctx.demo()){notice('O link de cadastro fica disponível no painel conectado. A demonstração não cria convites reais.');return;}
    const epoch=key,operationCtx=ctx;busy=true;button.disabled=true;
    try{
      if(!ctx.canPersist())throw Error('Atualize a conexão antes de criar o link.');
      const response=await operationCtx.write('bar_enable_day_use_public_registration',{}),result=Array.isArray(response)?response[0]:response;
      if(epoch!==key)return;
      if(result?.enabled!==true)throw Error('Não foi possível criar o link. Tente novamente.');
      invite={url:location.origin+'/day-use',expires:result.expires_at};
      const output=document.getElementById('duInviteResult');output.hidden=false;
      output.innerHTML='<label>Link fixo para cadastro e QR Code<input id="duInviteUrl" readonly value="'+esc(invite.url)+'"></label><div class="du-invite-actions"><button type="button" class="small-btn" data-du-copy>Copiar link</button><a class="small-btn du-whatsapp" href="https://wa.me/?text='+encodeURIComponent('Olá! Preencha seu cadastro do Beach Tennis do Ilha por este link: '+invite.url)+'" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a></div>';
      notice('Link pronto para enviar. A pessoa aparecerá em Mensalistas, aguardando pagamento.');
    }catch(e){if(epoch===key)notice(e.message||'Não foi possível criar o link.',true);}
    finally{busy=false;button.disabled=false;}
  }
  async function open(mode){
    if(!ctx?.canRead())return;
    focusBefore=document.activeElement;skeleton();if(!modal().open)modal().showModal();
    renderList();await refresh(true);if(mode==='new'&&loaded)editor();
  }
  function notice(message,bad=false){const n=document.getElementById('duNotice');if(n){n.textContent=message;n.classList.toggle('is-error',bad);}}
  function renderList(){
    if(!modal()?.open)return;
    const proofButton=document.getElementById('duProofs');proofButton.hidden=tab!=='monthly'||!proofs.length;proofButton.textContent='Comprovantes recebidos · '+proofs.length;
    const paidCustomers=new Set(rows.filter(r=>!r.cancelled_at).map(r=>r.customer_id));
    const pendingCount=customers.filter(c=>!c.deleted_at&&!paidCustomers.has(c.id)).length;
    const pendingButton=document.getElementById('duNewRegistrations');pendingButton.hidden=!pendingCount;pendingButton.textContent='Novos cadastros · '+pendingCount+' aguardando pagamento →';
    const m=metrics(),bounds=reportBounds();
    const metricKind=tab==='daily'?'DIARIO':tab==='receipts'?kind:'TODOS';
    const periodRows=rows.filter(r=>!r.cancelled_at&&inRange(r.paid_on,bounds)&&(metricKind==='TODOS'||r.kind===metricKind));
    const periodCommands=commands(true).filter(r=>metricKind==='TODOS'||r.kind===metricKind);
    const dailyCount=periodRows.filter(r=>r.kind==='DIARIO').length+periodCommands.filter(r=>r.kind==='DIARIO').reduce((sum,r)=>sum+r.quantity,0);
    const monthBounds=periodBounds('MES',today());
    const monthDirect=rows.filter(r=>!r.cancelled_at&&inRange(r.paid_on,monthBounds)).reduce((sum,r)=>sum+Number(r.amount),0);
    const monthCommands=commandReport(ctx?.commandSnapshot?.(),plans,{bounds:monthBounds,receivedOnly:true}).reduce((sum,r)=>sum+r.amount,0);
    document.getElementById('duMetrics').innerHTML=[['Mensais ativos',m.active],['Mensais vencidos',m.expired],['Diários · '+(['daily','receipts'].includes(tab)?periodText():'Hoje'),['daily','receipts'].includes(tab)?dailyCount:m.daily],['Recebido no mês · '+today().slice(0,7).split('-').reverse().join('/'),loading?'Carregando…':error?'Indisponível':money(monthDirect+monthCommands)]].map(([t,v])=>'<article><span>'+t+'</span><strong>'+v+'</strong></article>').join('');

    if(error)notice(error,true);
    document.querySelector('[data-du-new]').disabled=!loaded||!ctx.canWrite();
    document.getElementById('duCommandReport').hidden=!['daily','receipts'].includes(tab);
    if(['daily','receipts'].includes(tab))renderCommands();
    const matches=filterPasses(sorted(),{tab,kind,status,query,bounds,receivedOnly,day:today()},state);
    if(tab==='monthly'&&status==='COMPROVANTES'){renderProofs();return;}
    if(tab==='monthly'&&status==='SEM_PAGAMENTO'){renderCustomers();return;}
    document.getElementById('duListMeta').textContent=loaded?matches.length+' registro(s) neste filtro':'Carregando Day Use…';
    document.getElementById('duList').innerHTML=matches.map(r=>{
      const p=person(r),s=state(r),editable=ctx.canWrite()&&!p.deleted_at;
      return '<article class="du-person"><div class="du-person-main"><strong>'+esc(p.full_name)+'</strong><a href="https://wa.me/'+esc(p.phone)+'" target="_blank" rel="noopener">'+esc(phoneLabel(p.phone))+'</a><small>'+esc(label(r.kind))+' · '+money(r.amount)+' · '+esc(method(r.payment_method))+'</small></div><div class="du-dates"><span>Pago em <b>'+date(r.paid_on)+'</b></span><span>'+(r.kind==='MENSAL'?'Vence em <b>'+date(r.expires_on):'Válido em <b>'+date(r.paid_on))+'</b></span><span class="du-badge du-'+s.toLowerCase()+'">'+({ATIVO:'Ativo',VENCIDO:'Vencido',CANCELADO:'Cancelado',RENOVADO:'Renovado',EXCLUIDO:'Excluído'}[s])+'</span></div><div class="du-actions"><div class="du-primary-actions">'+(editable?'<button type="button" class="small-btn du-renew" data-du-renew="'+r.id+'">'+(r.kind==='MENSAL'?'Renovar':'Novo diário')+'</button>':'')+(!p.deleted_at&&!r.cancelled_at&&s!=='RENOVADO'?'<a class="small-btn du-whatsapp" href="'+esc(whatsappUrl(r))+'" target="_blank" rel="noopener noreferrer" aria-label="Preparar cobrança de '+esc(p.full_name)+' no WhatsApp">Enviar cobrança</a>':'')+'</div>'+(editable?'<details class="du-more"><summary>Mais opções <span aria-hidden="true">⌄</span></summary><div class="du-more-panel"><button type="button" class="small-btn" data-du-edit="'+r.id+'">Editar cadastro</button>'+(!r.cancelled_at?'<button type="button" class="small-btn du-danger" data-du-cancel="'+r.id+'">Cancelar pagamento</button>':'')+'<button type="button" class="small-btn du-danger" data-du-delete="'+r.id+'">Excluir cadastro</button></div></details>':'')+'</div>'+(r.cancelled_at?'<p class="du-cancel-reason">'+esc(r.cancel_reason)+'</p>':'')+'</article>';
    }).join('')||'<div class="lesson-empty-state">'+(loaded?'Nenhum Day Use neste filtro.':'Aguarde o carregamento.')+'</div>';
  }
  function renderCommands(){
    const output=document.getElementById('duCommandReport');if(!output)return;
    const data=commands(true).filter(r=>(tab==='daily'?r.kind==='DIARIO':kind==='TODOS'||r.kind===kind)&&(!query.trim()||r.names.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))));
    const qty=data.reduce((n,r)=>n+r.quantity,0),amount=data.reduce((n,r)=>n+r.amount,0);
    output.innerHTML='<header><div><h3>Day Use nas comandas</h3><p>'+esc(periodText())+' · '+(receivedOnly?'data da quitação':'data do lançamento')+' · fechamento às 6h</p></div><strong>'+qty+' Day Use(s) · '+money(amount)+'</strong></header><p class="du-command-note">Valor dos itens, não das parcelas recebidas. No filtro de recebidos, entram apenas comandas totalmente quitadas no período. Pagamentos parciais não são atribuídos a produtos.</p><div class="du-command-list">'+data.map(r=>'<article><div><strong>'+esc(r.names)+'</strong><small>'+esc(label(r.kind))+' · '+r.quantity+' × Day Use · '+money(r.amount)+'</small></div><span class="du-badge '+(r.payment==='Comanda paga'?'du-ativo':'du-vencido')+'">'+r.payment+'</span><div class="du-command-links">'+r.orders.map(o=>'<button type="button" class="small-btn" data-du-command="'+esc(o.id)+'">'+(o.source==='BALCAO'?'Balcão':'Comanda')+' '+esc(o.commandNumber||'Ver')+'</button>').join('')+'</div></article>').join('')+'</div>'+(!data.length?'<p>Nenhum Day Use lançado nas comandas neste período e filtro.</p>':'');
  }
  function whatsappUrl(row){
    const p=person(row),plan=plans.find(plan=>plan.kind===row.kind);
    const price=money(plan?.bar_products?.sale_price??row.amount);
    const expiry=date(row.expires_on),expired=today()>=row.expires_on;
    const message=row.kind==='MENSAL'
      ? 'Olá, '+p.full_name+'! Aqui é do Ilha Bar / Beach Tennis. Seu Day Use mensal '+(expired?'venceu':'vence')+' em '+expiry+'. A renovação por mais 30 dias é '+price+'. Fale com a gente para combinar o pagamento. Se já pagou, por favor nos avise para conferirmos. Obrigado!'
      : 'Olá, '+p.full_name+'! Aqui é do Ilha Bar / Beach Tennis. O Day Use diário é '+price+'. Fale com a gente para combinar o pagamento do seu próximo dia. Obrigado!';
    const phone=String(p.phone||'').replace(/\D/g,'');
    return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
  }
  function editor(row,mode='pay'){
    if(!ctx.canWrite())return;
    const p=row?person(row):{},box=document.getElementById('duEditor');request={id:crypto.randomUUID(),payload:null};
    box.hidden=false;
    const contact='<label>Nome completo<input name="full_name" required minlength="5" maxlength="120" value="'+esc(p.full_name)+'" autocomplete="off"'+(row&&mode==='pay'?' readonly':'')+'></label><label>Telefone com DDD<input name="phone" required inputmode="tel" minlength="10" maxlength="20" value="'+esc(p.phone)+'"'+(row&&mode==='pay'?' readonly':'')+'></label>';
    box.innerHTML='<form id="duForm" data-mode="'+mode+'" data-row="'+esc(row?.id)+'"><div class="du-editor-title"><h3>'+({pay:row?'Registrar novo pagamento':'Registrar pagamento recebido',edit:'Editar cadastro',cancel:'Cancelar pagamento',delete:'Excluir cadastro'}[mode])+'</h3><button class="ghost-btn" type="button" data-du-dismiss>Fechar</button></div>'+(mode==='delete'?'<p>Excluir <strong>'+esc(p.full_name)+'</strong> da lista? Todos os pagamentos deste cadastro serão cancelados no financeiro: <strong>'+money(rows.filter(r=>r.customer_id===row.customer_id&&!r.cancelled_at).reduce((sum,r)=>sum+Number(r.amount),0))+'</strong>. Use esta opção para testes ou cadastros incorretos. O histórico fica preservado em Excluídos; não há devolução automática de dinheiro.</p><label>Motivo<textarea name="reason" required minlength="5" maxlength="500" placeholder="Ex.: cadastro de teste"></textarea></label><label class="du-confirm"><input type="checkbox" required> Confirmo a exclusão do cadastro e o cancelamento dos pagamentos vinculados.</label>':mode==='cancel'?'<p>Cancelar '+esc(p.full_name)+' · '+money(row.amount)+' de '+date(row.paid_on)+'. O recebimento sairá dos totais do financeiro, sem apagar o histórico. Devoluções por Pix ou cartão devem ser feitas no banco ou na maquininha.</p><label>Motivo<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>':'<div class="du-form-grid">'+contact+(mode==='pay'?'<label>Tipo de Day Use<select name="kind" id="duPlan">'+plans.map(plan=>'<option value="'+plan.kind+'"'+((row?.kind||(tab==='daily'?'DIARIO':'MENSAL'))===plan.kind?' selected':'')+'>'+label(plan.kind)+' · '+money(plan.bar_products.sale_price)+'</option>').join('')+'</select></label><label>Data em que recebeu<input name="paid_on" id="duPaidOn" type="date" required min="2020-01-01" max="'+today()+'" value="'+today()+'"></label><label>Como recebeu?<select name="payment_method" required><option value="">Selecione</option>'+['PIX','DINHEIRO','CARTAO_DEBITO','CARTAO_CREDITO'].map(m=>'<option value="'+m+'">'+method(m)+'</option>').join('')+'</select></label><div class="du-preview" id="duPreview"></div>':'')+'</div>')+'<p class="du-error" id="duFormError" role="alert"></p><button class="primary-btn" type="submit">'+({pay:'Confirmar pagamento recebido',edit:'Salvar cadastro',cancel:'Confirmar cancelamento',delete:'Excluir cadastro e cancelar pagamentos'}[mode])+'</button></form>';
    if(mode==='pay')preview();box.scrollIntoView({block:'nearest',behavior:'smooth'});box.querySelector('input:not([readonly]),textarea,select')?.focus();
  }
  function preview(){
    const output=document.getElementById('duPreview'),day=document.getElementById('duPaidOn')?.value,plan=plans.find(p=>p.kind===document.getElementById('duPlan')?.value);
    if(!output||!day||!plan)return;
    output.innerHTML='<strong>'+money(plan.bar_products.sale_price)+'</strong><span>'+(plan.kind==='MENSAL'?'Vence em '+date(shift(day,30))+' · 30 dias':'Válido em '+date(day))+'</span><small>Um recebimento no financeiro do bar. A validade começa na data paga, inclusive nas renovações.</small>';
  }
  async function save(e){
    if(e.target.id!=='duForm')return;e.preventDefault();if(busy)return;
    const f=e.target,mode=f.dataset.mode,values=Object.fromEntries(new FormData(f)),row=findRow(f.dataset.row),epoch=key,operationCtx=ctx;
    const failure=document.getElementById('duFormError');failure.textContent='';
    try{
      if(!ctx.canWrite())throw Error('Sem permissão para registrar Day Use.');
      if(!ctx.demo()&&!ctx.canPersist())throw Error('A conexão com o bar não está pronta. Atualize antes de salvar.');
      const payload=mode==='pay'?{p_name:values.full_name,p_phone:values.phone,p_kind:values.kind,p_paid_on:values.paid_on,p_payment_method:values.payment_method,p_customer_id:row?.customer_id||null}:mode==='edit'?{p_id:row.customer_id,p_name:values.full_name,p_phone:values.phone}:{p_id:mode==='delete'?row.customer_id:row.id,p_reason:values.reason};
      const fingerprint=JSON.stringify(payload);
      if(request.payload&&request.payload!==fingerprint)throw Error('Confira se a tentativa anterior foi registrada. Para mudar os dados, feche e reabra o formulário.');
      request.payload=fingerprint;if(mode==='pay')payload.p_request_id=request.id;
      busy=true;f.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
      const rpc={pay:'bar_record_day_use',edit:'bar_edit_day_use_customer',cancel:'bar_cancel_day_use',delete:'bar_delete_day_use_customer'}[mode];
      const response=await operationCtx.write(rpc,payload),saved=Array.isArray(response)?response[0]:response;
      if(epoch!==key)return;
      if(!saved?.id)throw Error('O servidor não confirmou a operação. Atualize a lista antes de tentar novamente.');
      document.getElementById('duEditor').hidden=true;request=null;
      try{
        await refresh(true);await operationCtx.changed();
        notice(error?'Operação registrada. Não foi possível recarregar a lista; toque em Atualizar.':mode==='delete'?'Cadastro excluído e pagamentos cancelados. Histórico preservado.':mode==='cancel'?'Pagamento cancelado e financeiro atualizado.':mode==='edit'?'Cadastro atualizado.':'Pagamento registrado no financeiro do bar.',Boolean(error));
      }catch{notice('Operação registrada. Atualize o painel para conferir o financeiro.',true);}
    }catch(err){failure.textContent=err.message||'Não foi possível salvar. Tente novamente.';}
    finally{busy=false;f.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);}
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-day-use-open]');if(b)open(b.dataset.dayUseOpen);});
  setInterval(()=>{if(ctx&&!document.hidden&&document.body.classList.contains('club-bar')){refresh();paintCard();if(modal()?.open)renderList();}},30000);
  window.IlhaDayUse={filterPasses,ensure,card,refresh,open,state,metrics,reset,commandReport,periodBounds};
})();
