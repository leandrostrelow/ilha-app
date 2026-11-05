const API = 'https://lkqtgptebkgfwguykxhv.supabase.co';
const KEY = 'sb_publishable_zcX8te5g99p0bA12xy_E-A_MTyNpJNx';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const slug = new URLSearchParams(location.search).get('torneio') || 'ilha-pickleball-open-2026';
const storageKey = 'pickleball-checkout:' + slug;
let categories = [], nextKey = 1, captcha = '', widget = null, busy = false, tracking = '', timer;
let requestToken, lastPayment = null, startsOn='2026-09-22', birthSignature='';
const birthDates={}, packagePrices=[0,50,80,90,100];
try { requestToken = sessionStorage.getItem(storageKey) || crypto.randomUUID(); sessionStorage.setItem(storageKey, requestToken); tracking=sessionStorage.getItem(storageKey+':tracking')||''; } catch { requestToken=crypto.randomUUID(); }
async function request(path, body) {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers:{apikey:KEY,'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}) });
  const data = await r.json();
  if (!r.ok) { const error = new Error(data.error || data.message || 'Não foi possível concluir. Tente novamente.'); error.expired=data.expired; throw error; }
  return data;
}
function showError(message) { $('error').textContent=message; $('error').hidden=!message; if(message) $('error').scrollIntoView({behavior:'smooth',block:'center'}); }
function nameKey(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase(); }
function entryRows() {
  return Array.from(document.querySelectorAll('[data-category]:checked')).flatMap((checkbox)=>{
    const category=categories.find((r)=>r.id===checkbox.value);
    return Array.from(checkbox.closest('.pb-category').querySelectorAll('[data-entry]')).map((row)=>({
      category, names:Array.from(row.querySelectorAll('[data-member-name]')).map((i)=>i.value.trim())
    }));
  });
}
function buildSignup(rows, births={}) {
  const athletes=[], entries=[], byName=new Map();
  for(const row of rows) {
    const members=row.names.map((full_name,i)=>{
      const normalized=nameKey(full_name);
      if(!normalized)return '';
      const gender=row.category.gender==='MIXED'?(i===0?'MALE':'FEMALE'):['MALE','FEMALE'].includes(row.category.gender)?row.category.gender:'NOT_INFORMED';
      let person=byName.get(normalized);
      if(!person){person={key:'p'+(athletes.length+1),full_name,gender,birth_date:births[normalized]||null};byName.set(normalized,person);athletes.push(person);}
      else if(gender!=='NOT_INFORMED'){
        if(person.gender!=='NOT_INFORMED'&&person.gender!==gender)throw new Error(full_name+': confira os nomes nas classes masculina, feminina e mista.');
        person.gender=gender;
      }
      return person.key;
    });
    entries.push({category_id:row.category.id,members});
  }
  return {athletes,entries};
}
function collectBirths() {
  document.querySelectorAll('[data-birth-name]').forEach((el)=>birthDates[el.dataset.birthName]=el.value);
  return birthDates;
}
function signup() { return buildSignup(entryRows(),collectBirths()); }
function addEntry(category, container) {
  const row=document.createElement('div');row.className='pb-entry';row.dataset.entry=String(nextKey++);
  const labels=category.gender==='MIXED'?['Nome do jogador','Nome da jogadora']:category.event_type==='DOUBLES'?['Nome do 1º integrante','Nome do 2º integrante']:['Nome de quem vai jogar'];
  row.innerHTML='<div class="pb-grid">'+labels.map((label)=>'<label>'+label+'<input data-member-name required maxlength="120" autocomplete="off" list="participantNames" placeholder="Nome completo"></label>').join('')+'</div><button class="pb-remove" type="button" aria-label="Remover esta inscrição">Remover</button>';
  row.querySelector('button').onclick=()=>{
    if(container.children.length===1){const card=container.closest('.pb-category');card.querySelector('[data-category]').checked=false;card.querySelector('.pb-members').hidden=true;}
    row.remove();updateSummary();
  };
  container.append(row);
}
function renderCategories() {
  $('categories').innerHTML=['DOUBLES','SINGLES'].map((type)=>'<h3 class="pb-category-group">'+(type==='DOUBLES'?'Duplas':'Simples')+'</h3>'+categories.filter((c)=>c.event_type===type).map((c)=>'<div class="pb-category"><label class="pb-check"><input type="checkbox" data-category value="'+esc(c.id)+'" '+(!c.registration_open||c.is_full?'disabled':'')+'><span>'+esc(c.name)+(c.is_full?' · Lotada':!c.registration_open?' · Encerrada':'')+'</span></label><div class="pb-members" hidden><div data-entries></div><button type="button" class="pb-secondary pb-add-entry">'+(type==='DOUBLES'?'+ Outra dupla nesta classe':'+ Outra pessoa nesta classe')+'</button></div></div>').join('')).join('');
  $('categories').addEventListener('change',(event)=>{
    if(event.target.matches('[data-category]')){
      const checkbox=event.target,card=checkbox.closest('.pb-category'),members=card.querySelector('.pb-members'),container=card.querySelector('[data-entries]');
      members.hidden=!checkbox.checked;
      if(checkbox.checked&&!container.children.length)addEntry(categories.find((c)=>c.id===checkbox.value),container);
      members.querySelectorAll('input').forEach((input)=>input.disabled=!checkbox.checked);
    }
    updateSummary();
  });
  $('categories').addEventListener('input',updateSummary);
  document.querySelectorAll('.pb-add-entry').forEach((button)=>button.onclick=()=>{
    if(document.querySelectorAll('[data-entry]').length>=36){showError('Para mais de 36 inscrições, fale com a organização.');return;}
    const card=button.closest('.pb-category');
    addEntry(categories.find((c)=>c.id===card.querySelector('[data-category]').value),card.querySelector('[data-entries]'));
    updateSummary();card.querySelector('[data-entry]:last-child input').focus();
  });
}
function updateSummary() {
  collectBirths();
  const rows=entryRows(), names=[...new Map(rows.flatMap((row)=>row.names).filter(Boolean).map((name)=>[nameKey(name),name])).values()];
  $('participantNames').innerHTML=names.map((name)=>'<option value="'+esc(name)+'"></option>').join('');
  const ageNames=[...new Map(rows.filter((row)=>row.category.settings?.age_max!==undefined||row.category.settings?.age_min!==undefined).flatMap((row)=>row.names).filter(Boolean).map((name)=>[nameKey(name),name])).entries()];
  const signature=JSON.stringify(ageNames);
  if(signature!==birthSignature){
    birthSignature=signature;$('ageSection').hidden=!ageNames.length;
    $('ageFields').innerHTML=ageNames.map(([key,name])=>'<label>'+esc(name)+'<input type="date" data-birth-name="'+esc(key)+'" value="'+esc(birthDates[key]||'')+'" min="1900-01-01" max="'+esc(startsOn)+'" required></label>').join('');
  }
  try{
    const {athletes,entries}=signup();let total=0;
    const html=athletes.map((person)=>{
      const selected=entries.filter((e)=>e.members.includes(person.key)),count=selected.length,amount=packagePrices[count];
      if(amount!==undefined)total+=amount;
      return '<div class="pb-summary-row"><span>'+esc(person.full_name)+'<small>'+selected.map((e)=>esc(categories.find((c)=>c.id===e.category_id).name)).join(' · ')+'</small></span><b>'+(amount===undefined?'Máximo: 4':money(amount))+'</b></div>';
    }).join('');
    $('summary').innerHTML=(html||'<p>Marque uma classe e preencha os nomes.</p>')+'<div class="pb-total"><strong>Total previsto</strong><strong>'+money(total)+'</strong></div>';
    $('selectionError').textContent='';$('selectionError').hidden=true;
  }catch(error){$('selectionError').textContent=error.message;$('selectionError').hidden=false;$('summary').innerHTML='<p>Confira os nomes para calcular o total.</p>';}
}
function validateSelection(athletes,entries) {
  if(!entries.length) throw new Error('Escolha pelo menos uma classe.');
  if(athletes.length>18||entries.length>36)throw new Error('Para grupos maiores, fale com a organização.');
  for(const athlete of athletes){
    const selected=entries.filter((e)=>e.members.includes(athlete.key));
    if(athlete.full_name.trim().length<2)throw new Error('Preencha o nome completo de cada participante.');
    if(!selected.length||selected.length>4)throw new Error(athlete.full_name+': escolha de 1 a 4 classes.');
    if(new Set(selected.map((e)=>e.category_id)).size!==selected.length)throw new Error(athlete.full_name+' foi incluído mais de uma vez na mesma classe.');
  }
  for(const entry of entries){
    const c=categories.find((r)=>r.id===entry.category_id);
    if(!c||entry.members.some((key)=>!key)||new Set(entry.members).size!==entry.members.length||entry.members.length!==(c.event_type==='DOUBLES'?2:1))throw new Error('Preencha os nomes de cada classe. Nas duplas são duas pessoas diferentes.');
    const members=entry.members.map((key)=>athletes.find((p)=>p.key===key));
    if(c.gender==='MIXED'&&new Set(members.map((p)=>p.gender)).size!==2)throw new Error('A dupla mista precisa de um homem e uma mulher.');
    for(const p of members){
      const cfg=c.settings||{},needsBirth=cfg.age_min!==undefined||cfg.age_max!==undefined;
      if(needsBirth&&!/^\d{4}-\d{2}-\d{2}$/.test(p.birth_date||''))throw new Error('Informe o nascimento de '+p.full_name+'.');
      const age=p.birth_date?Number(startsOn.slice(0,4))-Number(p.birth_date.slice(0,4))-(startsOn.slice(5)<p.birth_date.slice(5)?1:0):null;
      if((c.gender==='MALE'||c.gender==='FEMALE')&&c.gender!==p.gender)throw new Error(p.full_name+': confira os nomes de '+c.name+'.');
      if(needsBirth&&(age<0||(cfg.age_min!==undefined&&age<cfg.age_min)||(cfg.age_max!==undefined&&age>cfg.age_max)))throw new Error(p.full_name+': idade fora do limite de '+c.name+'.');
    }
  }
}
async function initCaptcha() {
  const config=await request('/functions/v1/tournament-register');
  if(!window.turnstile) await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=resolve;script.onerror=reject;document.head.append(script);});
  widget=window.turnstile.render('#captcha',{sitekey:config.captcha_site_key,action:'tournament_registration',callback:(token)=>{captcha=token;$('submit').disabled=busy;$('captchaStatus').textContent='Validação concluída.';},'expired-callback':()=>{captcha='';$('submit').disabled=true;},'error-callback':()=>{captcha='';$('submit').disabled=true;$('captchaStatus').textContent='Recarregue para tentar a validação novamente.';}});
}
function resetCaptcha() {captcha='';$('submit').disabled=true;if(widget!==null)window.turnstile.reset(widget);}
function safeUrl(url){try{const u=new URL(url);return u.protocol==='https:'?u.href:'';}catch{return '';}}
function mergePackagePayment(previous, update) {
  const before=previous||{}, merged={...before,...update};
  // Preserve display names in memory; polling intentionally contains no personal data.
  // Instructions come exclusively from the latest server response (never stale Pix).
  if(Array.isArray(update.registrations)) merged.registrations=update.registrations.map((row,i)=>({...((before.registrations||[])[i]||{}),...row}));
  return merged;
}
function renderPayment(data) {
  data=mergePackagePayment(lastPayment,data);lastPayment=data;
  clearTimeout(timer);if(data.tracking_token){tracking=data.tracking_token;try{sessionStorage.setItem(storageKey+':tracking',tracking);}catch{ /* session only */ }}
  const p=data.payment||{}, rows=data.registrations||[], status=String(p.status||'CREATED');
  const confirmed=data.confirmed===true||(rows.length>0&&rows.every((r)=>r.status==='CONFIRMED'&&r.payment_status==='PAID'));
  const terminal=confirmed||data.terminal===true||data.reservation_expired===true||['REVIEW_REQUIRED','PARTIALLY_REFUNDED','CANCELLED','REFUNDED','CHARGEBACK','OVERDUE'].includes(status);
  const title=confirmed?'Inscrições confirmadas!':data.reservation_expired?'Reserva vencida':terminal?'Confira sua inscrição':status==='PENDING'?'Seu Pix está pronto':status==='FAILED'?'Não foi possível gerar o Pix':'Conferindo a cobrança';
  const payable=!terminal&&status==='PENDING'&&Date.parse(p.expires_at)>Date.now();
  $('packageForm').hidden=true;$('loading').hidden=true;$('payment').hidden=false;
  const invoice=safeUrl(p.invoice_url);
  $('payment').innerHTML=`<p class="pb-kicker">PAGAMENTO ÚNICO</p><h2>${title}</h2><p>${esc(data.warning||(confirmed?'Seu pagamento foi confirmado. Acompanhe os jogos na página do torneio.':data.reservation_expired?'O prazo desta reserva terminou. Fale com a organização antes de refazer a inscrição.':'As vagas só são confirmadas após o pagamento. Acompanhe o status nesta tela.'))}</p><div class="pb-total"><span>Total</span><strong>${money(p.amount??data.registration_group?.total_amount??0)}</strong></div><ul>${rows.map((r)=>`<li>${r.public_name?esc(r.public_name)+' · ':''}${esc(categories.find((c)=>c.id===r.category_id)?.name||'Classe')}</li>`).join('')}</ul>
    ${payable&&p.pix_encoded_image?`<img alt="QR Code Pix" src="data:image/png;base64,${esc(p.pix_encoded_image)}">`:''}
    ${payable&&p.pix_payload?`<label>Pix copia e cola<textarea readonly id="pixText">${esc(p.pix_payload)}</textarea></label><button type="button" class="pb-primary" id="copyPix">Copiar Pix</button>`:''}
    ${payable&&invoice?`<a href="${esc(invoice)}" target="_blank" rel="noopener">Abrir cobrança Asaas</a>`:''}
    ${p.expires_at&&!terminal?`<p>Pague até ${new Date(p.expires_at).toLocaleString('pt-BR')}. Não gere outra inscrição enquanto esta cobrança estiver em conferência.</p>`:''}
    <p id="paymentFeedback" role="status">Status: ${esc(({PENDING:'Aguardando pagamento',CREATED:'Preparando',RECONCILING:'Em conferência',FAILED:'Falha na geração',PAID:'Pago',OVERDUE:'Vencido'})[status]||status)}</p>
    ${!terminal?'<button type="button" class="pb-secondary" id="checkPayment">Atualizar pagamento</button>':''}
    ${!terminal&&status==='FAILED'?'<button type="button" class="pb-primary" id="retryPayment">Tentar novamente com a mesma inscrição</button>':''}
    <a href="/torneios/${encodeURIComponent(slug)}">Ver página do torneio</a>`;
  if($('copyPix'))$('copyPix').onclick=async()=>{try{await navigator.clipboard.writeText(p.pix_payload);$('copyPix').textContent='Pix copiado';}catch{$('pixText').select();}};
  if($('checkPayment'))$('checkPayment').onclick=()=>refreshPayment();
  if($('retryPayment'))$('retryPayment').onclick=()=>{$('payment').hidden=true;$('packageForm').hidden=false;resetCaptcha();$('packageForm').scrollIntoView({behavior:'smooth'});};
  if(!terminal&&tracking)timer=setTimeout(refreshPayment,15000);
  if(confirmed){try{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(storageKey+':tracking');}catch{/* optional */}}
}
async function refreshPayment(){clearTimeout(timer);try{const data=await request('/functions/v1/tournament-register',{action:'package_payment_status',tournament_slug:slug,tracking_token:tracking});renderPayment(data);}catch(error){if($('paymentFeedback')){$('paymentFeedback').textContent=error.message;timer=setTimeout(refreshPayment,30000);}else throw error;}}
$('packageForm').addEventListener('submit',async(event)=>{
  event.preventDefault();if(busy||!captcha)return;showError('');
  try{const {athletes,entries}=signup();validateSelection(athletes,entries);const form=new FormData(event.currentTarget);const payer=Object.fromEntries(['full_name','cpf','phone','email'].map((key)=>[key,form.get(key)]));busy=true;$('submit').disabled=true;$('submit').textContent='Preparando inscrição…';
    const data=await request('/functions/v1/tournament-register',{action:'package_checkout',tournament_slug:slug,request_token:requestToken,payer,athletes,entries,terms_accepted:$('terms').checked,captcha_token:captcha});renderPayment(data);$('payment').focus();
  }catch(error){showError(error.message);if(error.expired){requestToken=crypto.randomUUID();try{sessionStorage.setItem(storageKey,requestToken);}catch{/* optional */}}resetCaptcha();}
  finally{busy=false;$('submit').textContent='Gerar Pix das inscrições';$('submit').disabled=!captcha;}
});
$('ageFields').addEventListener('input',collectBirths);
async function init(){
  try{const snapshot=await request('/rest/v1/rpc/tournament_public_snapshot',{p_slug:slug});const t=snapshot.tournament;
    if(!t||t.settings?.registration_mode!=='ATHLETE_PACKAGES')throw new Error('Torneio não encontrado.');
    categories=snapshot.categories||[];$('back').href='/torneios/'+encodeURIComponent(slug);startsOn=t.starts_on||startsOn;renderCategories();updateSummary();
    if(tracking){await refreshPayment();if(!$('payment').hidden)return;}
    if(!t.registration_open||t.status!=='REGISTRATION_OPEN')throw new Error('As inscrições estão encerradas.');
    $('packageForm').hidden=false;$('loading').hidden=true;await initCaptcha();
  }catch(error){$('loading').hidden=true;showError(error.message||'Não foi possível carregar a inscrição.');}
}
init();
