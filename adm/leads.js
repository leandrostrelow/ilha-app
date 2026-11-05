(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stages = { novo: 'Novo', contato: 'Em contato', encaminhado: 'Encaminhado', agendado: 'Aula agendada', matriculado: 'Matriculado', arquivado: 'Arquivado' };
  const sheetLabels = { imported:'Histórico da planilha',synced:'Na planilha',pending:'Planilha pendente',sending:'Confirmando planilha',failed:'Falha na planilha',uncertain:'Conferir planilha' };
  const forwardTeachers = [{name:'Emerson',phone:'557391837772'},{name:'Gabriel',phone:'5527997148039'},{name:'Renato',phone:'5527992963984'}];
  const state = { context: null, leads: [], teachers: [], total: 0, selected: null, initialized: false, busy: false, loading: false, generation: 0 };
  const digits = v => { let p = String(v || '').replace(/\D/g,''); if (p.length === 10 || p.length === 11) p = '55' + p; return /^55\d{10,11}$/.test(p) ? p : ''; };
  const date = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';
  const datetime = v => v ? new Date(v).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : '—';
  const today = () => new Date().toLocaleDateString('en-CA', {timeZone:'America/Sao_Paulo'});
  const localDateTime = v => v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  function status(message, error = false) { $('leadsStatus').textContent = message; $('leadsStatus').classList.toggle('is-error', error); }
  function updateNavBadge(count) {
    document.querySelectorAll('[data-lead-nav-badge]').forEach(badge => {
      const value = Math.max(0, Number(count || 0)); badge.textContent = value > 99 ? '99+' : String(value); badge.hidden = value === 0;
    });
  }
  async function api(body) {
    const token = state.context?.getSession()?.access_token;
    if (!token || token === 'demo') throw new Error('Entre com sua conta do ADM para ver os interessados.');
    let response;
    try { response = await fetch(state.context.supabaseUrl + '/functions/v1/lesson-leads-api', {
      method:'POST', headers: { 'Content-Type':'application/json', apikey:state.context.publishableKey, Authorization:'Bearer '+token },
      body:JSON.stringify(body), signal:AbortSignal.timeout(30000)
    }); } catch { throw new Error('Sem conexão com o cadastro. Seus dados não foram apagados; tente novamente.'); }
    let result; try { result = await response.json(); } catch { throw new Error('Resposta indisponível. Atualize e tente novamente.'); }
    if (!response.ok || !result.ok) throw new Error(result.error || 'Não foi possível concluir.');
    return result;
  }
  function filtered() {
    const query = $('leadSearch').value.trim().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
    return state.leads.filter(l => {
      const searchable = [l.nome,l.telefone,l.responsavel,l.professor_nome].join(' ').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
      return (!query || searchable.includes(query) || (query.replace(/\D/g,'').length >= 4 && l.telefone.includes(query.replace(/\D/g,'')))) &&
        (!$('leadStage').value || l.status === $('leadStage').value) &&
        (!$('leadTeacherFilter').value || l.teacher_id === $('leadTeacherFilter').value) &&
        (!$('leadPeriod').value || l.periodo === $('leadPeriod').value) &&
        (!$('leadDue').checked || (l.proximo_contato && l.proximo_contato <= today() && !['matriculado','arquivado'].includes(l.status)));
    });
  }
  function render() {
    const leads = filtered(); const phoneCounts = new Map();
    state.leads.forEach(l => phoneCounts.set(l.telefone,(phoneCounts.get(l.telefone)||0)+1));
    $('leadsMetrics').innerHTML = Object.entries(stages).filter(([key])=>key!=='arquivado').map(([key,label]) => '<button type="button" data-lead-filter="'+key+'" class="lead-metric '+($('leadStage').value===key?'selected':'')+'"><strong>'+state.leads.filter(l=>l.status===key).length+'</strong><span>'+label+'</span></button>').join('');
    $('leadsCount').textContent = `${leads.length} ${leads.length===1?'interessado':'interessados'} · ${state.leads.length} de ${state.total} carregados`;
    $('leadsMore').hidden = state.leads.length >= state.total;
    updateNavBadge(state.leads.filter(l => l.status === 'novo').length);
    $('leadsRows').innerHTML = leads.length ? leads.map(l => '<button type="button" class="lead-row" data-lead-id="'+esc(l.id)+'">'+
      '<span class="lead-person"><strong>'+esc(l.nome)+'</strong><small>'+esc(l.telefone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3'))+' · '+esc(l.publico)+(l.idade?' · '+l.idade+' anos':'')+'</small>'+(phoneCounts.get(l.telefone)>1?'<small class="lead-duplicate">Telefone em mais de um cadastro</small>':'')+'</span>'+
      '<span class="lead-availability"><strong>'+esc(l.periodo||'A combinar')+'</strong><small>'+esc((l.dias_disponiveis||[]).map(d=>d.slice(0,3)).join(' · ')||'Dias a combinar')+'</small><small>'+esc(l.frequencia)+'</small></span>'+
      '<span><span class="lead-badge '+esc(l.status)+'">'+stages[l.status]+'</span><small>'+esc(l.professor_nome||'Sem professor definido')+'</small></span>'+
      '<span class="lead-dates"><strong>'+date(l.created_at)+'</strong><small class="'+(l.proximo_contato&&l.proximo_contato<=today()?'lead-due':'')+'">'+(l.proximo_contato?'Retorno '+date(l.proximo_contato+'T12:00:00'):'Sem retorno marcado')+'</small><small>'+esc(sheetLabels[l.sheet_sync])+'</small></span><span class="lead-open" aria-hidden="true">↗</span></button>').join('') : '<div class="lead-empty"><strong>Nenhum interessado por aqui.</strong><p>Confira os filtros ou compartilhe o link /aulas.</p></div>';
  }
  async function refreshBadge(context) {
    if (context) state.context = context;
    const data = await api({ action:'count' }); updateNavBadge(data.new_count); return data.new_count;
  }
  async function load(append = false) {
    if (state.loading) return;
    state.loading = true; const generation = state.generation;
    $('leadsRefresh').disabled = true; $('leadsMore').disabled = true;
    status('Carregando interessados…');
    try {
      const data = await api({ action:'list',offset:append?state.leads.length:0 });
      if (generation !== state.generation) return;
      state.leads = append ? [...new Map([...state.leads,...data.leads].map(l=>[l.id,l])).values()] : data.leads;
      state.total = data.total; state.teachers = data.teachers;
      const selected = $('leadTeacherFilter').value;
      $('leadTeacherFilter').innerHTML = '<option value="">Todos os professores</option>'+state.teachers.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
      $('leadTeacherFilter').value = selected;
      render(); status('Atualizado agora. As etapas são gerenciadas no ADM; novos cadastros também vão para a planilha.');
    } catch(e) { status(e.message,true); }
    finally { state.loading = false; $('leadsRefresh').disabled = false; $('leadsMore').disabled = false; }
  }
  function detailItem(label,value) { return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value||'Não informado')+'</dd></div>'; }
  function draft() {
    const teacher = state.teachers.find(t=>t.id===$('leadTeacher').value);
    return {status:$('leadEditStage').value,teacher_id:teacher?.id||null,professor_nome:teacher?.name||$('leadTeacherName').value.trim(),
      professor_telefone:$('leadTeacherPhone').value.trim(),proximo_contato:$('leadFollowup').value||null,
      aula_em:$('leadTrial').value?new Date($('leadTrial').value).toISOString():null,anotacoes:$('leadNotes').value.trim()};
  }
  function summary() {
    const l = state.selected;
    return `*Interessado em aulas · Ilha Tênis*\n\n*Nome:* ${l.nome}\n*WhatsApp:* ${l.telefone}${l.responsavel?'\n*Responsável:* '+l.responsavel:''}\n*Idade:* ${l.idade||'Não informada'} · ${l.publico}\n*Dias:* ${(l.dias_disponiveis||[]).join(', ')||'A combinar'}\n*Período:* ${l.periodo}\n*Já fez aula:* ${l.ja_fez_aula}\n*Nível:* ${l.nivel||'A definir'}\n*Frequência:* ${l.frequencia}\n*Objetivo:* ${l.objetivo||'A combinar'}\n*Como conheceu:* ${l.como_conheceu||'Não informado'}\n*Observações:* ${l.observacoes||'—'}\n\n*Falar com aluno/responsável:*\nhttps://wa.me/${digits(l.telefone)}`;
  }
  function updatePreview() {
    const phone = digits($('leadTeacherPhone').value);
    $('leadSummary').value = summary();
    $('leadTeacherWhatsApp').href = phone ? 'https://wa.me/'+phone+'?text='+encodeURIComponent(summary()) : '#';
    $('leadTeacherWhatsApp').setAttribute('aria-disabled',phone?'false':'true');
  }
  function applyForwardTeacher() {
    const [name, phone] = $('leadForwardTeacher').value.split('|');
    if (!name || !phone) { updatePreview(); return; }
    const sameName = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase() === name.toLowerCase();
    const teacher = state.teachers.find(t => sameName(t.name));
    $('leadTeacher').value = teacher?.id || '';
    $('leadTeacherName').value = name;
    $('leadTeacherName').readOnly = Boolean(teacher);
    $('leadTeacherPhone').value = phone;
    updatePreview();
  }
  async function openDetail(id) {
    const generation = state.generation;
    try {
      status('Abrindo cadastro…'); const data = await api({action:'detail',id});
      if (generation !== state.generation) return;
      state.selected = data.lead; const l = state.selected;
      $('leadDetailTitle').textContent = l.nome;
      $('leadDetailDate').textContent = 'Recebido em '+datetime(l.created_at)+(l.source==='planilha'?' · importado da planilha':' · formulário /aulas');
      $('leadFacts').innerHTML = [detailItem('WhatsApp',l.telefone),detailItem('Aluno',[l.publico,l.idade?l.idade+' anos':'',l.genero].filter(Boolean).join(' · ')),detailItem('Responsável',l.responsavel),detailItem('Disponibilidade',(l.dias_disponiveis||[]).join(', ')+' · '+l.periodo),detailItem('Frequência',l.frequencia),detailItem('Experiência',l.ja_fez_aula==='Sim'?'Já fez aula · '+(l.nivel||'A definir'):'Primeiras aulas'),detailItem('Objetivo',l.objetivo),detailItem('Como conheceu o clube',l.como_conheceu),detailItem('Observações do aluno',l.observacoes)].join('');
      $('leadLegacyNote').hidden = !l.source_note;
      $('leadLegacyNote').textContent = l.source_note ? 'Anotação original: '+l.source_note+' (data do encaminhamento não informada na planilha).' : '';
      const recipient = l.responsavel || l.nome;
      $('leadStudentWhatsApp').href = 'https://wa.me/'+digits(l.telefone)+'?text='+encodeURIComponent('Olá, '+recipient+'! Tudo bem? Aqui é a equipe do Ilha Tênis. Recebemos as informações sobre o interesse nas aulas de '+l.nome+'. Nossa equipe vai analisar a disponibilidade e, em breve, entraremos em contato para buscar a melhor turma e horário. 🎾');
      $('leadEditStage').innerHTML = Object.entries(stages).map(([v,label])=>'<option value="'+v+'">'+label+'</option>').join('');
      $('leadEditStage').value = l.status;
      $('leadTeacher').innerHTML = '<option value="">Outro / a definir</option>'+state.teachers.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
      $('leadTeacher').value = l.teacher_id||'';
      $('leadTeacherName').value = l.professor_nome||'';
      $('leadTeacherName').readOnly = Boolean(l.teacher_id);
      $('leadTeacherPhone').value = l.professor_telefone||state.teachers.find(t=>t.id===l.teacher_id)?.phone||'';
      const forwarded = forwardTeachers.find(t => t.phone === digits($('leadTeacherPhone').value) || t.name.toLowerCase() === String(l.professor_nome||'').toLowerCase());
      $('leadForwardTeacher').value = forwarded ? forwarded.name+'|'+forwarded.phone : '';
      $('leadFollowup').value = l.proximo_contato||''; $('leadTrial').value = localDateTime(l.aula_em); $('leadNotes').value = l.anotacoes||'';
      $('leadForwardInfo').textContent = l.encaminhado_em ? 'Último envio confirmado em '+datetime(l.encaminhado_em) : l.status==='encaminhado'?'Já encaminhado conforme anotação da planilha.':'Abrir o WhatsApp não confirma o envio.';
      $('leadSheetInfo').textContent = sheetLabels[l.sheet_sync]+(l.sheet_error?' · '+l.sheet_error:'');
      const stale = l.sheet_sync==='sending' && Date.now()-Date.parse(l.sheet_attempt_at)>300000;
      $('leadSyncSheet').hidden = !['pending','failed','uncertain'].includes(l.sheet_sync) && !stale;
      $('leadEvents').innerHTML = data.events.length ? data.events.map(e=>'<li><time>'+datetime(e.created_at)+'</time><span>'+esc(e.detail)+'</span></li>').join('') : '<li>Sem alterações registradas.</li>';
      $('leadDetailError').textContent = ''; updatePreview();
      if (!$('leadDialog').open) $('leadDialog').showModal(); status('');
    } catch(e) { status(e.message,true); }
  }
  async function save(confirmForward = false) {
    if (state.busy || !state.selected) return;
    if (confirmForward && !confirm('Você já enviou o resumo ao professor? Confirme somente depois de enviar no WhatsApp.')) return;
    state.busy = true; $('leadSave').disabled = true; $('leadConfirmForward').disabled = true;
    try {
      const patch = draft(); if (confirmForward) patch.status = 'encaminhado';
      await api({action:'update',id:state.selected.id,revision:state.selected.revision,...patch,confirm_forward:confirmForward});
      await load(); await openDetail(state.selected.id);
      state.context.notify(confirmForward?'Encaminhamento registrado.':'Cadastro atualizado.');
    } catch(e) { $('leadDetailError').textContent = e.message; }
    finally { state.busy = false; $('leadSave').disabled = false; $('leadConfirmForward').disabled = false; }
  }
  async function removeSelected() {
    if (state.busy || !state.selected) return;
    const lead = state.selected;
    if (!confirm('Excluir permanentemente o lead de '+lead.nome+'?\n\nO cadastro e seu histórico serão apagados do ADM. Se ele já foi enviado para a planilha, a linha da planilha não será removida automaticamente.')) return;
    state.busy = true; $('leadDelete').disabled = true; $('leadSave').disabled = true;
    try {
      await api({action:'delete',id:lead.id,revision:lead.revision});
      $('leadDialog').close(); state.selected = null; await load();
      state.context.notify('Lead excluído do ADM.');
    } catch(e) { $('leadDetailError').textContent = e.message; }
    finally { state.busy = false; $('leadDelete').disabled = false; $('leadSave').disabled = false; }
  }
  async function copy(value) { try { await navigator.clipboard.writeText(value); state.context.notify('Copiado!'); } catch { state.context.notify('Não foi possível copiar. Selecione o texto e copie manualmente.'); } }
  function exportCsv() {
    const rows = [['Nome','WhatsApp','Responsável','Idade','Público','Dias','Período','Frequência','Nível','Objetivo','Como conheceu','Etapa','Professor','Próximo contato','Recebido em','Observações','Anotações','Histórico original'],...filtered().map(l=>[l.nome,l.telefone,l.responsavel,l.idade,l.publico,(l.dias_disponiveis||[]).join(', '),l.periodo,l.frequencia,l.nivel,l.objetivo,l.como_conheceu,stages[l.status],l.professor_nome,l.proximo_contato,l.created_at,l.observacoes,l.anotacoes,l.source_note])];
    const cell = v => { let s = String(v??''); if (/^[\s]*[=+@-]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
    const blob = new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download='interessados-aulas-'+today()+'.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function init() {
    if (state.initialized) return; state.initialized = true;
    $('leadStage').innerHTML = '<option value="">Todas as etapas</option>'+Object.entries(stages).map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('');
    ['leadSearch','leadStage','leadTeacherFilter','leadPeriod','leadDue'].forEach(id=>$(id).addEventListener(id==='leadSearch'?'input':'change',render));
    $('leadsRefresh').addEventListener('click',()=>load());
    $('leadsMore').addEventListener('click',()=>load(true));
    $('leadsCopyLink').addEventListener('click',()=>copy(location.origin+'/aulas'));
    $('leadsExport').addEventListener('click',exportCsv);
    $('leadsMetrics').addEventListener('click',e=>{const b=e.target.closest('[data-lead-filter]');if(b){$('leadStage').value=$('leadStage').value===b.dataset.leadFilter?'':b.dataset.leadFilter;render();}});
    $('leadsRows').addEventListener('click',e=>{const b=e.target.closest('[data-lead-id]');if(b)openDetail(b.dataset.leadId);});
    $('leadClose').addEventListener('click',()=>$('leadDialog').close());
    $('leadSave').addEventListener('click',()=>save());
    $('leadDelete').addEventListener('click',removeSelected);
    $('leadConfirmForward').addEventListener('click',()=>save(true));
    $('leadCopySummary').addEventListener('click',()=>copy(summary()));
    $('leadTeacher').addEventListener('change',()=>{const t=state.teachers.find(x=>x.id===$('leadTeacher').value);$('leadTeacherName').value=t?.name||'';$('leadTeacherName').readOnly=Boolean(t);$('leadTeacherPhone').value=t?.phone||'';updatePreview();});
    $('leadTeacherPhone').addEventListener('input',updatePreview);
    $('leadForwardTeacher').addEventListener('change',applyForwardTeacher);
    $('leadTeacherWhatsApp').addEventListener('click',e=>{if(!digits($('leadTeacherPhone').value)){e.preventDefault();$('leadDetailError').textContent='Informe o WhatsApp do professor ou copie o resumo.';$('leadTeacherPhone').focus();}});
    $('leadSyncSheet').addEventListener('click',async()=>{
      if (state.busy || !confirm('Confira a planilha antes. Este botão reenvia o cadastro e pode duplicar uma entrega sem confirmação. Confirmou que ele ainda não está lá?')) return;
      state.busy=true; $('leadSyncSheet').disabled=true;
      try { await api({action:'sync_sheet',id:state.selected.id,confirm_checked:true}); await openDetail(state.selected.id); await load(); }
      catch(e){$('leadDetailError').textContent=e.message;}
      finally{state.busy=false;$('leadSyncSheet').disabled=false;}
    });
  }
  function clear() {
    state.generation++; state.leads=[];state.teachers=[];state.selected=null;state.total=0;
    if ($('leadDialog').open) $('leadDialog').close();
    $('leadsRows').replaceChildren(); $('leadFacts').replaceChildren(); $('leadEvents').replaceChildren();
    $('leadSummary').value='';$('leadNotes').value='';$('leadDetailTitle').textContent='Interessado';
    $('leadsMetrics').replaceChildren(); $('leadsCount').textContent=''; status('');
    ['leadDetailDate','leadLegacyNote','leadForwardInfo','leadSheetInfo','leadDetailError'].forEach(id=>$(id).textContent='');
    ['leadTeacherName','leadTeacherPhone','leadFollowup','leadTrial','leadSearch'].forEach(id=>$(id).value='');
    ['leadStudentWhatsApp','leadTeacherWhatsApp'].forEach(id=>$(id).href='#');
  }
  window.IlhaLeadsAdmin = {open(context){state.context=context;init();load();},refreshBadge,clear};
})();
