import {QUICK_CHARACTERS,QUICK_ATTRIBUTES,QUICK_VENUES,quickConfig,quickCharacter,quickPlayer} from './quick-play.js';
import {characterPortrait,heroesReady} from './characters.js';

export function createQuickPlayUI({host,showSection,onStart,onBack,onRanked,getProfile=()=>null}){
 let config=quickConfig(),role='player',paint=0;
 function button(text,action,className=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=className;b.addEventListener('click',action);return b;}
 function portrait(person,w=72,h=88){const c=document.createElement('canvas');c.width=w;c.height=h;c.setAttribute('aria-hidden','true');characterPortrait(c,person);return c;}
 function render(){
  const scroll=host.querySelector('.quick-cast')?.scrollTop||0,focusIndex=[...host.querySelectorAll('button,select')].indexOf(document.activeElement);
  host.replaceChildren();
  const head=document.createElement('header');head.className='quick-heading';
  const heading=document.createElement('div');heading.innerHTML='<p class="eyebrow">JOGO RÁPIDO</p><h2>Monte sua partida.</h2>';
  head.append(heading,button('Voltar',onBack,'quick-back'));host.append(head);
  const modes=document.createElement('div');modes.className='quick-modes';modes.setAttribute('aria-label','Escolha o esporte');
  for(const [sport,name] of [['tennis','Tênis'],['pickleball','Pickleball']]){const b=button(name,()=>{config=quickConfig({...config,sport});render();});b.setAttribute('aria-pressed',String(config.sport===sport));modes.append(b);}
  const venueLabel=document.createElement('label');venueLabel.className='quick-venue';venueLabel.textContent='Onde vamos jogar?';
  const select=document.createElement('select');select.id='quickVenue';
  for(const venue of QUICK_VENUES.filter(v=>v.sport===config.sport)){const o=document.createElement('option');o.value=venue.id;o.textContent=venue.name;select.append(o);}
  select.value=config.venue;select.addEventListener('change',()=>{config=quickConfig({...config,venue:select.value});render();});venueLabel.append(select);host.append(modes,venueLabel);
  const versus=document.createElement('div');versus.className='quick-versus';
  for(const [side,label] of [['player','Você joga'],['opponent','Computador']]){
   const person=side==='player'?quickPlayer(config[side],getProfile()):quickCharacter(config[side]),card=button('',()=>{role=side;render();},'quick-fighter');card.setAttribute('aria-label',`${label}: ${person.name}. Trocar personagem`);card.setAttribute('aria-pressed',String(role===side));
   const tag=document.createElement('small');tag.textContent=label;
   const identity=document.createElement('div');identity.className='quick-identity';const name=document.createElement('strong');name.textContent=person.name;identity.append(portrait(person),name);
   const stats=document.createElement('div');stats.className='quick-stats';
   QUICK_ATTRIBUTES.forEach((name,i)=>{const row=document.createElement('div'),title=document.createElement('span'),bar=document.createElement('meter'),value=document.createElement('b');title.textContent=name;bar.min=0;bar.max=5;bar.value=person.stats[i];bar.setAttribute('aria-label',`${name}: ${person.stats[i]} de 5`);value.textContent=person.stats[i]+'/5';row.append(title,bar,value);stats.append(row);});
   card.append(tag,identity,stats);versus.append(card);
  }host.append(versus);
  const pickerTitle=document.createElement('h3');pickerTitle.id='quickPickerTitle';pickerTitle.textContent=role==='player'?'Quem você vai controlar?':'Quem joga contra você?';host.append(pickerTitle);
  const rosterHint=document.createElement('p');rosterHint.className='quick-roster-hint';rosterHint.textContent=`${QUICK_CHARACTERS.length} personagens · deslize a lista para ver todos`;host.append(rosterHint);
  const grid=document.createElement('div');grid.className='quick-cast';grid.setAttribute('role','group');grid.setAttribute('aria-labelledby',pickerTitle.id);
  for(const entry of QUICK_CHARACTERS){const person=role==='player'?quickPlayer(entry.id,getProfile()):entry,label=entry.id==='player-f'&&person.name!==entry.name?`${person.name} · roxo`:person.name;const b=button('',()=>{config={...config,[role]:person.id};render();},'quick-person');b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(config[role]===person.id));b.style.setProperty('--shirt',person.color||'#d2e893');const name=document.createElement('span');name.textContent=label;b.append(portrait(person,64,80),name);grid.append(b);}
  host.append(grid);
  const foot=document.createElement('footer');foot.className='quick-footer';
  const note=document.createElement('p'),venue=QUICK_VENUES.find(v=>v.id===config.venue);note.textContent=`${venue.hint} · ${config.sport==='tennis'?'Tie-break de 7':'Primeiro a 5'}`;
  const start=button('Jogar agora ▶',()=>onStart({...config}),'primary');start.id='quickStart';foot.append(note,start);host.append(foot);
  if(onRanked){const ranked=button('Ranking clássico · 90 segundos',onRanked,'quick-ranked');host.append(ranked);}
  grid.scrollTop=scroll;
  if(focusIndex>=0)host.querySelectorAll('button,select')[focusIndex]?.focus({preventScroll:true});
 }
 return {async open(defaults={}){
  config=quickConfig(defaults);role='player';const request=++paint;showSection('quickPlayArea');host.replaceChildren();
  const loading=document.createElement('p');loading.textContent='Preparando a turma…';loading.setAttribute('role','status');host.append(loading,button('Voltar',onBack,'quick-back'));
  try{await heroesReady;}catch{if(request===paint&&!host.hidden)loading.textContent='As imagens não carregaram. Confira a conexão e recarregue o jogo para tentar novamente.';return;}
  if(request!==paint||host.hidden)return;render();host.querySelector('.quick-back').focus({preventScroll:true});
 }};
}
