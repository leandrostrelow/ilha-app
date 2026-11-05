import { CHARACTERS, createGame, stepGame, FPS, MAX_FRAMES, VERSION, INPUT, SHOTS, clamp } from './engine.js';
import { createRenderer, characterPortrait } from './render.js';
import { COURT_VIEW,viewToCourtX,keyboardTarget } from './court-view.js';
import { createClubWorld } from './world.js';
import {joystickVector} from './world-model.js';
import {paintScenePreviews} from './scenery-renderer.js';
import {ADVENTURE_KEY,NPCS,RIVALS,EXPLORE,readAdventure,advanceAdventure,objective,stageOf,canChallenge,duelRules,questItems,isRaining} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {BIOS,CHAT,BOSS_LINES} from './legado-story.js';
import {conversation,BOSS_WIN} from './campaign-story.js';
import {createCampaignEnding} from './campaign-ending.js';
import {createLegadoUI} from './legado-ui.js';
import {ETIQUETTE_LESSONS,createEtiquetteQuiz,answerEtiquetteQuiz,gradeEtiquetteQuiz} from './club-etiquette.js';
import {MEDALS,renderMedals,drawMedal} from './medals.js';
import {lessonTasks} from './lesson.js';
import {createRacketMatch,stepRacketMatch} from './racket-match.js';
import {createRacketLesson,stepRacketLesson,lessonAction,lessonAcceptsGesture} from './racket-lesson.js';
import {createLessonTutorial} from './lesson-tutorial.js';
import {createRacketRenderer} from './racket-renderer.js';
import {createMatchInput} from './match-input.js';
import {createAssistedInput} from './assisted-input.js';
import {createPickleballArcade} from './pickleball.js';
import {createGameAudio,musicForSection,musicForMatch} from './audio.js';
import {createGameFullscreen,observeGameView,isGameApp,gameDisplayHelp} from './game-display.js';
import {createGameInstall} from './game-install.js';
import {QUICK_VENUES,quickCharacter,quickConfig,quickMatchOptions,quickPlayer,trainingInvite} from './quick-play.js';
import {createQuickPlayUI} from './quick-play-ui.js';
import {createCampaignSaves} from './campaign-save.js';
import {createSaveUI} from './save-ui.js';
import {syncHalloween,isZombie} from './halloween-state.js';
import {CHALLENGES,createChallenge,stepChallenge,challengeStatus} from './halloween-challenges.js';
import {createHalloweenIntro} from './halloween-intro.js';
import {evidenceFor,finalRule,accusationFeedback} from './mystery.js';
import {paintNotebook} from './mystery-notebook.js';


const $ = (id) => document.getElementById(id);
const appMode=isGameApp(window);
const gameInstall=createGameInstall(window,renderInstallState);
let displayFullscreen=false;
const fullscreen=createGameFullscreen(document,({supported,fullscreen})=>{
 const button=$('fullscreenButton');
 button.setAttribute('aria-pressed',String(fullscreen||appMode));
 button.setAttribute('aria-label',appMode?'Sobre o modo app':fullscreen?'Sair da tela cheia':supported?'Entrar em tela cheia':'Como jogar sem as barras do navegador');
 button.querySelector('span').textContent=appMode?'Modo app':fullscreen?'Reduzir':'Tela cheia';
 button.title=button.getAttribute('aria-label');
 if(fullscreen&&!displayFullscreen)queueMicrotask(raiseGameDialog);
 displayFullscreen=fullscreen;
});
observeGameView($('matchStage'),$('matchStage').querySelector('.court-shell'),4/5);
const storage = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(`ilha-misterio:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`ilha-misterio:${key}`, JSON.stringify(value));return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(`ilha-misterio:${key}`); } catch { /* noop */ } },
};
let campaign=readAdventure(storage.get(ADVENTURE_KEY)),campaignSaved=true;
const saveWarning=document.createElement('p');saveWarning.id='campaignSaveWarning';saveWarning.hidden=true;saveWarning.setAttribute('role','status');$('gameDialog').append(saveWarning);
const campaignSaves=createCampaignSaves({onStatus:status=>{campaignSaved=status.saved;saveWarning.hidden=status.saved;saveWarning.textContent=status.conflict?'Outra aba salvou uma aventura mais nova. Baixe seu backup em Opções.':'Não foi possível salvar neste navegador. Abra Opções → Save e backup antes de sair.';}});
campaign=await campaignSaves.ready();syncHalloween(campaign);
let localMatch=null,lastLocalMatch=null,lesson=null,challenge=null,juiceGlowUntil=0,evandroGlowUntil=0;
let identity = storage.get('identity');
if (!/^[a-f0-9]{64}$/.test(identity || '')) {
  identity = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2,'0')).join('');
  storage.set('identity', identity);
}
let selected = CHARACTERS.some(c=>c.id===storage.get('character')) ? storage.get('character') : 'leandro';
const telemetry={track(){},trackOnce(){}}; // This independent prototype never submits to Legado's ranking.
telemetry.track('game_opened',{surface:appMode?'app':'web'});
let game = null, run = null, replay = [], paused = false, running = false, starting = false;
let target = 128, direction = 0, power = false, frameHandle = 0, lastTime = 0, accumulator = 0;
let sound = storage.get('sound', true), lastEvent = 0, pending = storage.get('pending');
const audio=createGameAudio({enabled:sound});
const pauseScore=document.createElement('p');pauseScore.className='pause-score';$('pauseOverlay').querySelector('h2').after(pauseScore);
$('pauseOverlay').querySelector('h2').textContent='Respira. Próximo ponto!';
const soundCheck=document.createElement('button');soundCheck.type='button';soundCheck.className='sound-check';soundCheck.textContent='Testar som ♪';soundCheck.addEventListener('click',()=>{if(!sound)toggleSound();initAudio();beep('menu-select');});$('resumeButton').after(soundCheck);
const pauseSound=document.createElement('button');pauseSound.type='button';pauseSound.className='text-button';pauseSound.textContent=sound?'Som: ligado':'Som: desligado';pauseSound.addEventListener('click',()=>{toggleSound();pauseSound.textContent=sound?'Som: ligado':'Som: desligado';});soundCheck.after(pauseSound);
const pauseFullscreen=document.createElement('button');pauseFullscreen.type='button';pauseFullscreen.className='text-button';pauseFullscreen.textContent='Tela cheia';pauseFullscreen.addEventListener('click',()=>$('fullscreenButton').click());pauseSound.after(pauseFullscreen);
const LEGACY_VERSION='tennis-8bit-v1';
if(pending&&!pending.version)pending={...pending,version:LEGACY_VERSION};
let shotInput=0,servePressed=false,rankingVersion=VERSION,rankingRequest=0;
let opponent = CHARACTERS.find(c=>c.id!==selected), selectionPurpose='explore';
let activeCourt=1,courtOverview=false;
const playerProfile=()=>({id:campaign.avatar,avatar:campaign.avatar,name:campaign.name,appearance:campaign.appearance,variant:campaign.variant,champion:campaign.champion,carryingFoice:campaign.foice&&campaign.wins.length===5,juiceGlow:performance.now()<juiceGlowUntil});
const matchPlayer=()=>localMatch?.kind==='quick'?quickPlayer(localMatch.config.player,campaign):playerProfile();
const canvas = $('gameCanvas'), rankedDraw = createRenderer(canvas,()=>opponent,()=>({court:activeCourt,overview:courtOverview}),()=>localMatch?playerProfile():null);
const manualDraw=createRacketRenderer(canvas,()=>({court:activeCourt,sport:game?.sport||'tennis'}),matchPlayer,()=>opponent);
const draw=s=>s.manual?manualDraw(s):rankedDraw(s);
draw.enterFrom=from=>{if(!game.manual)rankedDraw.enterFrom(from);};
draw.transitioning=()=>!game.manual&&rankedDraw.transitioning();
const matchButtons=[['topspinButton','normal'],['sliceButton','slice'],['dropButton','drop'],['serveButton','serve']].map(([id,value])=>[$(id),value]);
const assistInput=createAssistedInput(canvas,matchButtons,()=>game,()=>running&&!paused&&game?.assisted&&lessonAcceptsGesture(lesson));
const oldMatchInput=createMatchInput($('matchPad'),matchButtons,canvas,()=>running&&!paused&&game?.manual&&!game?.assisted);
const matchInput={reset(){assistInput.reset();oldMatchInput.reset();},read(){return game?.assisted?assistInput.read():oldMatchInput.read();}};
const lessonTutorial=createLessonTutorial($('lessonHud'),action=>{
 if(!running||paused)return;
 if(lessonAction(lesson,game,action)){matchInput.reset();initAudio();beep('menu-select');updateHud();if(lesson.phase==='practice')canvas.focus({preventScroll:true});}
});
let manualTarget=null;
function resizeMatchCanvas(){
 if(!game?.manual){canvas.width=480;canvas.height=600;return;}
 const r=$('matchStage').getBoundingClientRect();if(!r.width||!r.height)return;
 canvas.width=Math.round(Math.min(960,r.width));canvas.height=Math.round(canvas.width*r.height/r.width);
 if(running)draw(game);
}
const matchResize=new ResizeObserver(resizeMatchCanvas);matchResize.observe($('matchStage'));
const fmt = value => new Intl.NumberFormat('pt-BR').format(value);
const npc=id=>NPCS.find(n=>n.id===id)||AMBIENT_NPCS.find(n=>n.id===id);
const pickle=createPickleballArcade({canvas:$('pickleCanvas'),getCharacter:playerProfile,onFinish:finishPickleball,onSound:beep,onPause:value=>audio.setPaused(value),onTestSound:()=>{if(!sound)toggleSound();initAudio();beep('menu-select');}});
const ending=createCampaignEnding({getPlayer:playerProfile,getState:()=>campaign,onAward:()=>{progress({type:'crowned'});telemetry.trackOnce('campaign_completed');},onFinish:()=>progress({type:'credits-seen'}),onExit:enterClub,onSound:beep,onStart:()=>audio.setScene('ending',{restart:true}),onPause:value=>audio.setPaused(value)});
const world=createClubWorld({canvas:$('worldCanvas'),getCharacter:playerProfile,getCharacters:()=>CHARACTERS,
  getNpcs:()=>[...NPCS.map(n=>n.id==='evandro'?{...n,juiceGlow:performance.now()<evandroGlowUntil}:n),...AMBIENT_NPCS],getItems:()=>questItems(campaign),getObjective:()=>objective(campaign).target,getRain:()=>isRaining(campaign),
  onNearby:showNearby,onPlace:label=>{$('worldLocation').textContent=label;},
  onIntroEnd:()=>{$('worldIntro').hidden=true;$('worldArea').classList.remove('introducing');showWalkTutorial();updateMission();$('worldCanvas').focus({preventScroll:true});},
  onInteract:interactWith,onStep:()=>beep('step'),onAmbient:kind=>audio.effect(kind),
  onArrive:()=>updateMission('Você chegou. Use o botão Interagir para continuar a missão.'),
});
const halloweenIntro=createHalloweenIntro({getPlayer:()=>playerProfile(),onSound:beep,onStart:()=>audio.setScene('map',{restart:true}),onPause:value=>audio.setPaused(value),onDone:async()=>{await enterClub();world.skipIntro();talkToNpc(npc('leandro'));}});
const legacy=createLegadoUI({getState:()=>campaign,showSection,enterClub:()=>campaign.welcomed?enterClub():halloweenIntro.start(),
 saveProfile:(profile,fresh)=>{if(fresh){campaign=readAdventure(null);world.reset();telemetry.track('campaign_started',{avatar:profile.avatar});}progress({type:'profile',...profile});},
 goTo:async person=>{await enterClub();if(world.snapshot().introducing)world.skipIntro();goTo(person);},
 onSave:()=>savePanel.open(),onEnding:startParty,onMenu:stop,toggleSound,getSound:()=>sound,onMedals:async()=>{await enterClub();if(world.snapshot().introducing)world.skipIntro();openMedals();},
});

const savePanel=createSaveUI({saves:campaignSaves,getState:()=>campaign,onRestore:state=>{campaign=readAdventure(state);syncHalloween(campaign);world.reset();updateMission();},info:legacy.info,onBack:legacy.options});
let quickOrigin='menu',quickSelection=null;
const quickHost=document.createElement('section');quickHost.id='quickPlayArea';quickHost.className='quick-play';quickHost.hidden=true;quickHost.setAttribute('aria-label','Configurar jogo rápido');$('gameDialog').append(quickHost);
const quickPlay=createQuickPlayUI({host:quickHost,getProfile:()=>campaign,showSection,onStart:startQuickMatch,onBack:()=>quickOrigin==='menu'?legacy.menu():enterClub(),onRanked:()=>{activeCourt=1;opponent=npc('romulo');openSelection('match');}});
function openQuickPlay(defaults={},origin='club'){
 stop();quickOrigin=origin;
 quickSelection=quickConfig({player:campaign.avatar,...quickSelection,...defaults});
 return quickPlay.open(quickSelection);
}
function startQuickMatch(config){
 quickSelection=quickConfig(config);const venue=QUICK_VENUES.find(v=>v.id===quickSelection.venue);
 activeCourt=venue.court;opponent=quickCharacter(quickSelection.opponent);
 return start(true,{kind:'quick',id:opponent.id,config:{...quickSelection}});
}
function offerTraining(person){
 const preferred=trainingInvite(person),venues=[...QUICK_VENUES].sort((a,b)=>Number(b.id===preferred.venue)-Number(a.id===preferred.venue));
 story({title:`Uma partida com ${person.name}?`,character:person,eyebrow:'AMISTOSO · A ILHA CONTINUA',text:`“Bora jogar, ${campaign.name}! Você escolhe a quadra.”\n\nPartida livre: suas medalhas e missões ficam como estão.`,actions:[
  ...venues.map((venue,i)=>({label:venue.name,primary:i===0,run:()=>{quickOrigin='club';startQuickMatch({player:campaign.avatar,opponent:person.id,sport:venue.sport,venue:venue.id});}})),
  {label:'Escolher outros personagens',run:()=>openQuickPlay({...preferred,player:campaign.avatar})},{label:'Voltar à conversa',run:()=>person.ambient?talkToAmbient(person):talkToNpc(person)},
 ]});
}

function updateMission(extra=''){
 const task=objective(campaign);$('worldMission').querySelector('span').textContent=task.title;
 $('worldMission').querySelector('p').textContent=extra||task.text;
}
function progress(event){const rainy=isRaining(campaign);campaign=advanceAdventure(campaign,event);syncHalloween(campaign);campaignSaved=campaignSaves.save(campaign);updateMission();if(rainy&&!isRaining(campaign))beep('lesson-success');}
function goTo(target){closeWorldPanel();world.navigate(target);updateMission(`A caminho de ${target.name||target.label}. Toque no caminho para mudar o destino.`);}
function openMedals(){
 story({title:'Recuperações',eyebrow:'CADERNO DE TRATAMENTO',text:`${campaign.wins.length}/6 pacientes recuperados. Entregue o suco e cumpra o desafio de cada um. Depois, siga a missão dada pelo paciente curado. Treinos livres não avançam a história.`,actions:[{label:'Continuar a aventura',primary:true,run:closeWorldPanel}]});
 renderMedals($('storyExtras'),campaign);
}
function startEtiquette(){
 let page=0,quiz=null;
 const leave={label:'Continuar depois',run:closeWorldPanel};
 function teach(){
  const item=ETIQUETTE_LESSONS[page];
  story({title:item.title,character:npc('emerson'),eyebrow:`EMERSON · LIÇÃO ${page+1} DE ${ETIQUETTE_LESSONS.length}`,text:item.text,actions:[{label:page===ETIQUETTE_LESSONS.length-1?'Vamos à prova!':'Entendi! Próxima →',primary:true,run:()=>{beep('menu-select');if(++page<ETIQUETTE_LESSONS.length)teach();else{quiz=createEtiquetteQuiz();ask();}}},...(page?[{label:'Lição anterior',run:()=>{page--;teach();}}]:[]),leave]});
 }
 function ask(){
  const item=quiz.questions[quiz.answers.length];
  if(!item)return complete();
  story({title:item.question,character:npc('emerson'),eyebrow:`PROVA · PERGUNTA ${quiz.answers.length+1} DE 4`,text:'Escolha uma resposta. Três acertos são suficientes para passar!',actions:[leave]});
  const choices=document.createElement('div');choices.className='etiquette-choices';
  const feedback=document.createElement('p');feedback.className='etiquette-feedback';feedback.setAttribute('role','status');
  let answered=false;
  item.choices.forEach((label,index)=>{
   const button=document.createElement('button');button.type='button';button.textContent=label;
   button.addEventListener('click',()=>{
    if(answered)return;answered=true;quiz=answerEtiquetteQuiz(quiz,item.id,index);
    for(const [i,choice]of [...choices.children].entries()){choice.disabled=true;if(i===item.answer){choice.classList.add('correct');choice.textContent=`✓ ${item.choices[i]}`;}else if(i===index){choice.classList.add('incorrect');choice.textContent=`✕ ${item.choices[i]}`;}}
    feedback.textContent=`${index===item.answer?'Acertou!':'Vamos aprender juntos!'} ${item.explanation}`;
    initAudio();beep(index===item.answer?'lesson-success':'lesson-retry');
    const next=document.createElement('button');next.type='button';next.className='primary';next.textContent=quiz.answers.length===4?'Ver meu resultado':'Próxima pergunta →';next.addEventListener('click',ask);$('storyActions').prepend(next);next.focus({preventScroll:true});
   });choices.append(button);
  });
  $('storyExtras').append(choices,feedback);choices.firstElementChild.focus({preventScroll:true});
 }
 function complete(){
  const result=gradeEtiquetteQuiz(quiz.answers),wasPassed=campaign.extraTrained;
  if(result.passed)progress({type:'etiquette-passed',answers:quiz.answers});
  initAudio();beep(result.passed?'lesson-success':'lesson-retry');
  story({title:result.passed?'Craque dentro e fora da quadra!':'Vamos tentar mais uma vez?',character:npc('emerson'),eyebrow:`PROVA · ${result.score}/4 ACERTOS`,text:result.passed?`“Muito bem! Você sabe respeitar a turma e cuidar do nosso clube.”${!wasPassed?'\n\nVolte a Davi: seu desafio está liberado!':'\n\nRevisão concluída. Seu progresso está mantido.'}`:'“Você está aprendendo! Para passar, precisa de 3 acertos. Reveja as lições ou tente outra prova, sem pressa.”',actions:[...(result.passed?[{label:!wasPassed?'Voltar ao Davi':'Minha missão',primary:true,run:()=>!wasPassed?goTo(npc('davi')):openJournal()}]:[{label:'Tentar outra prova',primary:true,run:()=>{quiz=createEtiquetteQuiz();ask();}}]),{label:'Rever as lições',run:()=>{page=0;teach();}},{label:'Até mais!',run:closeWorldPanel}]});
 }
 teach();
}
function openJournal(){
 const task=objective(campaign),person=npc(task.target)||AMBIENT_NPCS.find(n=>n.id===task.target)||world.places.find(p=>p.id===task.target)||questItems(campaign).find(p=>p.id===task.target);
 story({title:task.title,eyebrow:'PRÓXIMO PASSO',text:task.text+(campaignSaved?'':'\nSeu navegador não está salvando o progresso.'),actions:[
  ...(person?[{label:`Ir até ${person.name||person.label}`,primary:true,run:()=>goTo(person)}]:[]),
  {label:'Caderno de pistas',run:openNotebook},{label:'Voltar',run:closeWorldPanel},
 ]});
}
function openNotebook(){
 const clues=evidenceFor(campaign);
 story({title:'Caderno dos detetives',eyebrow:`INVESTIGAÇÃO · ${clues.length}/6 LEMBRANÇAS`,text:campaign.champion?'Caso resolvido. Veja por que as pistas apontaram para a mesma pessoa.':'Quem levou o objeto E o recipiente vistos na mesa? Confirme os perfis conversando com a turma.',actions:[{label:stageOf(campaign)==='final-guide'?'Apresentar conclusão ao Leandro':'Conversar com Leandro',primary:true,run:()=>goTo(npc('leandro'))},{label:'Minha próxima missão',run:openJournal},{label:'Voltar',run:closeWorldPanel}]});
 paintNotebook($('storyExtras'),campaign,{onTalk:goTo,paintPortrait:characterPortrait});$('worldStory').scrollTop=0;$('storyTitle').tabIndex=-1;$('storyTitle').focus({preventScroll:true});
}
function talkToNpc(person){
 progress({type:'visit',id:person.id});
 const dialogue=conversation(campaign,person.id);
 let page=0;
 const present=()=>{
  const speaker=dialogue.speakers?.[page]==='player'?playerProfile():person;
  story({title:speaker.name,character:speaker,eyebrow:speaker===person?(campaign.wins.includes(person.id)?'RECUPERADO · PRONTO PARA AJUDAR':person.title):'VOCÊ · INVESTIGADOR DO ILHA',text:dialogue.pages[page],actions:[
  ...(campaign.champion?[{label:`Jogar com ${person.name} 🎾`,primary:true,run:()=>offerTraining(person)}]:[]),
  ...(page<dialogue.pages.length-1?[{label:'Continuar →',primary:!campaign.champion,run:()=>{page++;present();}}]:dialogue.actions.map(action=>({label:action.label,primary:!campaign.champion,run:()=>runStoryAction(action,person)}))),
  ...(page===dialogue.pages.length-1?[{label:'Sua história',run:()=>story({title:person.name,character:person,text:BIOS[person.id],actions:[{label:'Voltar',primary:true,run:present}]})}]:[]),
  ...(!isRaining(campaign)&&campaign.trained&&!campaign.champion?[{label:'Jogar um treino',run:()=>offerTraining(person)}]:[]),
  {label:'Até mais!',run:closeWorldPanel},
 ]});};
 present();
}
function talkToAmbient(person){
 // Former ambient characters now take part in the same mission/dialogue flow.
 return talkToNpc(person);
}
function runStoryAction(action,person){
 if(action.notebook)return openNotebook();
 if(action.accuse){
  if(stageOf(campaign)!=='final-guide')return openJournal();
  if(action.accuse!==campaign.caseId)return story({title:'Vamos comparar antes de concluir',character:npc('leandro'),text:accusationFeedback(campaign,action.accuse),actions:[{label:'Comparar as pistas',primary:true,run:openNotebook},{label:'Tentar outra conclusão',run:()=>talkToNpc(npc('leandro'))}]});
  progress({type:'accuse',id:action.accuse});return talkToNpc(npc('leandro'));
 }
 if(action.final&&stageOf(campaign)==='final-match'&&person.id===campaign.caseId){activeCourt=person.court;opponent=person;return start(true,{kind:'duel',id:person.id,final:true});}
 if(action.event){
  const firstBetoMedal=action.event.type==='beto-story-heard'&&!campaign.betoStory;
  progress(action.event);
  if(action.event.type==='drink-delivered'&&action.event.id==='evandro')evandroGlowUntil=performance.now()+16000;
  if(['bar-visited','juice-collected'].includes(action.event.type)){initAudio();beep('item-pickup');}
  if(action.event.type==='juice-given'){initAudio();beep('drink');}
  if(['witness-heard','clue-received','suspect-noted'].includes(action.event.type)){initAudio();beep('item-delivery');}
  if(['balls-delivered','drink-delivered'].includes(action.event.type)){initAudio();beep('item-delivery');}
  if(firstBetoMedal&&campaign.betoStory){
   audio.setScene('medal',{restart:true});
   return story({title:'Paciência Intergaláctica!',character:person,music:'medal',eyebrow:'MEDALHA CONQUISTADA',text:'“Você ouviu minha viagem até o fim! Essa medalha é sua. Agora vá encontrar André… e cuidado com a chuva!”',actions:[{label:'Próxima missão',primary:true,run:()=>goTo(npc('andre'))},{label:'Ver medalhas',run:openMedals}]});
  }
 }
 if(action.again)return talkToNpc(person);
 if(action.route){const target=npc(action.route)||AMBIENT_NPCS.find(n=>n.id===action.route)||world.places.find(p=>p.id===action.route)||questItems(campaign).find(p=>p.id===action.route);if(target)return goTo(target);}
 if(action.mission)return openJournal();
 if(action.theory)return startEtiquette();
 if(action.lesson){activeCourt=person.court;opponent=person;return start(true,{kind:'lesson',id:person.id,extra:person.id==='emerson'&&(campaign.requests.includes('davi')||campaign.champion)});}
 if(action.duel&&canChallenge(campaign,action.duel)){activeCourt=person.court;opponent=person;return start(true,{kind:'duel',id:person.id});}
 if(action.pickle)return startPickleball();
 if(action.party)return startParty();
 closeWorldPanel();
}
function startParty(){
 if(!['celebrate','champion'].includes(stageOf(campaign)))return;
 stop();showSection('endingArea');ending.start();
}
function offerPickleball(bioAction=null){story({title:'Gael · O guardião da azul',character:npc('gael'),eyebrow:'PICKLEBALL',text:`${CHAT.gael}\n\nO boneco corre sozinho. Arraste para a direita para sacar; para a esquerda, topspin; para cima ou para baixo, slice. Um toque faz a deixada. Incline para mirar e arraste mais para dar força.\n\nDeixe o saque e a primeira devolução quicarem. Sem voleio na cozinha. Primeiro a 5!`,actions:[{label:campaign.pickleball?'Pedir revanche':'Jogar pickleball',primary:true,run:startPickleball},...(bioAction?[bioAction]:[]),{label:'Até mais!',run:closeWorldPanel}]});}
function startPickleball(){if(!campaign.trained)return lessonRequired();stop();localMatch=null;showSection('pickleArea');pickle.start();telemetry.track('match_started',{mode:'campaign',sport:'pickleball'});}
async function finishPickleball(result){
 const won=result.playerPoints>result.cpuPoints,first=won&&!campaign.pickleball,forLourenco=campaign.requests.includes('lourenco')&&!campaign.wins.includes('lourenco');if(won)progress({type:'pickleball-won'});
 telemetry.track('match_finished',{mode:'campaign',result:won?'win':'loss'});
 await enterClub();if(first)audio.setScene('medal',{restart:true});
 story({title:first?'Medalha do Gael conquistada!':won?'Boa! Mais uma vitória na azul.':'Gael já marcou a revanche!',character:npc('gael'),music:first?'medal':'map',eyebrow:'PICKLEBALL · FIM DO JOGO',text:`Placar: ${result.playerPoints} × ${result.cpuPoints}.\n\n${won?`“Tá bom, você jogou bem! ${forLourenco?'Lourenço espera você para o primeiro desafio da Copa. ':''}Aqui eu quero revanche… mas só depois do meu lanche, é claro!”`:'“Foi boa! Mas aqui eu ainda mando!” Pode tentar de novo quando quiser.'}`,actions:[...(won?[{label:'Próxima missão',primary:true,run:openJournal}]:[]),{label:'Jogar de novo',primary:!won,run:startPickleball},...(won?[{label:'Ver medalhas',run:openMedals}]:[{label:'Continuar a história',run:openJournal}]),{label:'Voltar ao passeio',run:closeWorldPanel}]});
}

function showNearby(target){
  $('interactButton').disabled=!target;
  $('interactButton').hidden=!target;
  const action=target?.kind==='npc'?'Conversar':'Interagir';
  $('interactButton').textContent=action;
  $('interactButton').setAttribute('aria-label',target?`${action} com ${target.name||target.label}`:'Aproxime-se para interagir');
  $('nearbyHint').textContent=target?.name||target?.label||'';
}
function showWalkTutorial(){$('walkTutorial').hidden=Boolean(storage.get('walk-tutorial',false));}
$('worldCanvas').addEventListener('pointerdown',()=>{
 const state=world.snapshot();if(!state.active||state.blocked||state.introducing)return;
 $('walkTutorial').hidden=true;storage.set('walk-tutorial',true);
});
async function enterClub(){
  if(starting)return;stop();localMatch=null;lesson=null;showSection('worldArea');$('worldStory').hidden=true;$('worldMap').hidden=true;$('worldError').hidden=true;$('worldLoading').hidden=false;$('worldIntro').hidden=true;setWorldInert(true);updateMission();
  $('walkTutorial').hidden=true;
  $('worldCharacter').textContent=`${campaign.champion?'★ ':''}${campaign.name}`;
  if(!$('gameDialog').open)$('gameDialog').showModal();
  $('worldCanvas').focus({preventScroll:true});
  try{const entry=await world.enter();if(!entry)return;setWorldInert(false);$('worldLoading').hidden=true;$('worldIntro').hidden=!entry.intro;$('worldArea').classList.toggle('introducing',entry.intro);if(!entry.intro)showWalkTutorial();$('worldCanvas').focus({preventScroll:true});}
  catch{$('worldLoading').hidden=true;$('worldError').hidden=false;}
}
function closeWorldPanel(){
  $('worldStory').hidden=true;$('worldMap').hidden=true;world.block(false);setWorldInert(false);audio.setScene('map');$('worldCanvas').focus({preventScroll:true});
}
function setWorldInert(value){for(const id of ['worldCanvas','worldControls','miniMapButton','missionButton'])$(id).inert=value;$('worldArea').querySelector('.world-topbar').inert=value;}
function story({title,text,character=null,eyebrow='RESENHA NO ILHA',actions=[],music=character?.id==='beto'?'beto':'map'}){
  audio.setScene(music);
  $('worldMap').hidden=true;$('worldStory').hidden=false;world.block(true);setWorldInert(true);
  $('storyTitle').textContent=title;$('storyText').textContent=text;$('storyEyebrow').textContent=eyebrow;
  $('storyPortrait').hidden=!character;if(character)characterPortrait($('storyPortrait'),character);
  $('storyActions').replaceChildren();$('storyExtras').replaceChildren();
  actions.forEach(({label,run,primary=false})=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.className=primary?'primary':'story-secondary';button.addEventListener('click',run);$('storyActions').append(button);});
  $('worldStory').scrollTop=0;$('storyActions').firstElementChild?.focus({preventScroll:true});
}
function lessonRequired(){
 story({title:'Primeiro, a aula com Renato',character:npc('renato'),eyebrow:'QUADRA BLOQUEADA',text:'Converse com Renato. Você pode fazer a aula ou escolher “Já sei jogar — pular aula”. As duas opções liberam a investigação e os treinos.',actions:[{label:'Seguir a missão',primary:true,run:openJournal},{label:'Continuar explorando',run:closeWorldPanel}]});
}
function requestMatch(character=null){if(!campaign.trained)return lessonRequired();return openQuickPlay({sport:'tennis',venue:activeCourt===2?'court2':'court1',...(character?{opponent:character.id}:{})});}
function interactWith(target){
 if(target.kind==='item'&&questItems(campaign).some(item=>item.id===target.id)){
  const expected=target.id;
  story({title:target.name,eyebrow:'PISTA ENCONTRADA',text:target.description||'Uma pista para a investigação. Guarde no caderno e continue a missão.',actions:[
   {label:'Anotar e guardar a pista',primary:true,run:()=>{if(!questItems(campaign).some(c=>c.id===expected))return closeWorldPanel();progress({type:'clue-collected',id:expected});initAudio();beep('item-pickup');openJournal();}},
   {label:'Continuar procurando',run:closeWorldPanel},
  ]});return;
 }
 if(target.kind==='npc')return target.ambient?talkToAmbient(target):talkToNpc(target);
 if(target.kind==='bar'&&stageOf(campaign)==='celebrate')return story({title:'O último toque',eyebrow:'A TURMA ESTÁ ESPERANDO',text:'Felipe preparou o lote completo. Os seis pacientes recuperados vão ajudar a turma a tomar o suco e jogar tênis. Toque o sino para começar o mutirão.',actions:[{label:'Chamar o mutirão de cura',primary:true,run:startParty},{label:'Ainda não',run:closeWorldPanel}]});
 if(target.kind==='bar')return talkToNpc(npc('felipe'));
 if(['court','pickleball'].includes(target.kind)||target.id==='abandoned-court'){
  if(!campaign.champion)return story({title:'Primeiro, a investigação',eyebrow:'DESAFIO DE CHEFE',text:'Entregue o suco ao paciente e leia seu desafio. O botão de tratamento aparece na conversa. Treinos livres não curam pacientes nem avançam a história.',actions:[{label:'Seguir minha missão',primary:true,run:openJournal},{label:'Continuar andando',run:closeWorldPanel}]});
  return openQuickPlay(target.kind==='pickleball'?{sport:'pickleball',venue:'pickleball'}:{sport:'tennis',venue:target.id==='abandoned-court'?'old':target.id});
 }
 story({title:target.label,eyebrow:'MISTÉRIO NO ILHA',text:target.id==='wood-cabin'?'Daqui saiu a caixa de decoração da festa. Emerson guardou o rótulo do frasco. As pistas vêm dos depoimentos da turma: não precisa procurar objetos no chão.':target.id==='river'?'O rio reflete a lua. Um lugar tranquilo para revisar o caderno dos detetives antes de ouvir a próxima pessoa.':'A decoração ficou estranha demais. Encontre os personagens e siga a marca da missão.',actions:[{label:'Minha missão',primary:true,run:openJournal},{label:'Caderno de pistas',run:openNotebook},{label:'Continuar andando',run:closeWorldPanel}]});
}
function openWorldMap(){
  if($('worldArea').classList.contains('introducing'))return;
  $('worldMap').hidden=false;world.block(true);setWorldInert(true);$('mapDestinations').firstElementChild.focus({preventScroll:true});
}
for(const place of [npc('leandro'),...world.places,...NPCS.filter(n=>n.id!=='leandro'),...AMBIENT_NPCS]){const button=document.createElement('button');button.type='button';button.textContent=`${place.name||place.label} →`;button.addEventListener('click',()=>goTo(place));$('mapDestinations').append(button);}

async function api(){throw new Error('O Halloween não usa o ranking do Legado.');}

function soundLabel() { $('soundButton').textContent = sound?'Som on':'Som off';$('soundButton').setAttribute('aria-pressed',String(sound));$('soundButton').setAttribute('aria-label',sound?'Desativar músicas e efeitos':'Ativar músicas e efeitos'); }
function initAudio(){audio.setHidden(document.hidden);audio.unlock();audio.recover();}
function beep(kind){audio.effect(kind);}
function toggleSound(){sound=!sound;storage.set('sound',sound);audio.setEnabled(sound);soundLabel();if(sound){initAudio();beep('menu-select');}}

function renderCharacters() {
  const host=$('characters');host.replaceChildren();
  for(const c of CHARACTERS){
    const button=document.createElement('button');button.type='button';button.className='character';button.setAttribute('aria-pressed',String(selected===c.id));button.setAttribute('aria-label',`${c.name}, ${c.title}. Velocidade ${c.stats[0]}, força ${c.stats[1]}, alcance ${c.stats[2]}, de 5.`);
    const portrait=document.createElement('canvas');portrait.width=120;portrait.height=150;portrait.setAttribute('aria-hidden','true');characterPortrait(portrait,c);
    const name=document.createElement('strong');name.textContent=c.name;
    const title=document.createElement('small');title.textContent=c.title;
    const stat=document.createElement('span');stat.className='stat';stat.setAttribute('aria-hidden','true');
    ['VEL','FOR','ALC'].forEach((label,i)=>{const row=document.createElement('div');const labelEl=document.createElement('span');labelEl.className='stat-label';labelEl.textContent=`${label} `;row.append(labelEl,document.createTextNode('▪'.repeat(c.stats[i])+'·'.repeat(5-c.stats[i])));stat.append(row);});
    button.append(portrait,name,title,stat);button.addEventListener('click',()=>{selected=c.id;storage.set('character',selected);renderCharacters();host.children[CHARACTERS.indexOf(c)].focus();});host.append(button);
  }
}

async function loadRanking(){ $('leaderboard').textContent='Esta aventura tem progresso próprio, sem ranking online.'; }
function bestKey(version){return version===LEGACY_VERSION?'best':`best:${version}`;}
function showBest(){const best=storage.get(bestKey(rankingVersion),0);$('personalBest').replaceChildren(document.createTextNode(best?fmt(best):'—'));const small=document.createElement('small');small.textContent=' PTS';$('personalBest').append(small);}
function openRanking(){
  if($('gameDialog').open)$('gameDialog').close();
  if(!$('rankingDialog').open)$('rankingDialog').showModal();
  loadRanking();
  $('closeRanking').focus({preventScroll:true});
}
function closeRanking(){if($('rankingDialog').open)$('rankingDialog').close();$('openRanking').focus({preventScroll:true});}
function showSection(id,sport,scene=null){if(id!=='worldArea')world.leave();if(id!=='endingArea')ending.stop();audio.setScene(scene||musicForSection(id,sport));setWorldInert(false);for(const name of ['selection','playArea','results','worldArea','pickleArea','legacyMenu','legacyProfile','legacyRosterArea','legacyInfo','endingArea','quickPlayArea'])$(name).hidden=name!==id;$('gameDialog').classList.toggle('quick-mode',id==='quickPlayArea');$('gameDialog').classList.toggle('legacy-mode',id.startsWith('legacy'));$('gameDialog').classList.toggle('world-mode',id==='worldArea');$('gameDialog').classList.toggle('match-mode',id==='playArea');$('gameDialog').classList.toggle('pickle-mode',id==='pickleArea');$('gameDialog').classList.toggle('ending-mode',id==='endingArea');$('gameDialog').classList.toggle('results-mode',id==='results');$('gameDialog').scrollTop=0;}
function openSelection(purpose='explore'){selectionPurpose=purpose;showSection('selection');$('startStatus').textContent='';$('nickname').value=storage.get('nickname','');$('nickname').required=purpose==='match';$('startButton').textContent=purpose==='match'?'Entrar na quadra':'Explorar o clube';$('practiceButton').textContent=purpose==='match'?'Treinar sem entrar no ranking':'Voltar ao clube';$('selection').querySelector('.selection-description').textContent=purpose==='match'?`Desafio contra ${opponent.name}. Escolha seu personagem e seu apelido.`:'A turma do Ilha, em versão pixel. O apelido é opcional para passear.';renderCharacters();if(!$('gameDialog').open)$('gameDialog').showModal();}
function stop(){running=false;paused=false;direction=0;power=false;servePressed=false;matchInput.reset();manualTarget=null;cancelAnimationFrame(frameHandle);pickle.stop();ending.stop();audio.setPaused(false);$('pauseOverlay').hidden=true;}
function close(){if(starting)return;if(pickle.active&&!pickle.paused){pickle.pause();return;}if(running&&!paused){pause();return;}stop();world.leave();if(appMode){legacy.menu();return;}$('gameDialog').close();$('openGame').focus();}
function pause(){if(!running)return;pauseSound.textContent=sound?'Som: ligado':'Som: desligado';paused=true;audio.setPaused(true);direction=0;power=false;servePressed=false;matchInput.reset();manualTarget=null;pauseScore.textContent=challenge?challenge.instructions:lesson?`Aula · passo ${lesson.index+1} de ${lessonTasks(lesson).length}`:`${game.playerPoints} × ${game.cpuPoints}`;$('pauseOverlay').hidden=false;updateHud();$('resumeButton').focus();}
function resume(){if(!running)return;paused=false;audio.setPaused(false);$('pauseOverlay').hidden=true;lastTime=performance.now();accumulator=0;canvas.focus({preventScroll:true});updateHud();initAudio();}

async function start(practice=false,local=null){
 practice=true; // All Halloween games are local; never create or finish a ranked run.
  if(starting)return;if(!practice&&!$('startForm').reportValidity())return;
  if(practice&&!local)local={kind:'friendly',id:opponent.id};
  starting=true;$('startButton').disabled=true;$('practiceButton').disabled=true;$('closeGame').disabled=true;
  if(opponent.id===selected&&!local)opponent=CHARACTERS.find(c=>c.id!==selected);
  $('startStatus').textContent=practice?'':'Preparando sua partida…';initAudio();
  const nickname=$('nickname').value.trim();
  try{
    if(!practice&&pending){const saved=await savePending();if(!saved)throw new Error('Sua última partida ainda não foi salva. Tente novamente ou entre no treino.');}
    run=practice?null:await api('start',{identity,nickname,character:selected,version:VERSION});
    if(run&&run.version!==VERSION)throw new Error('A versão do jogo foi atualizada. Recarregue a página antes de jogar.');
    if(!practice)storage.set('nickname',nickname);
    const seed=run?.seed??crypto.getRandomValues(new Uint32Array(1))[0];
    game=local?createRacketMatch({seed,difficulty:local.final?finalRule(campaign).difficulty:local.kind==='lesson'?.6:duelRules(local.id).cpuSpeed,practice:local.kind==='lesson',assisted:true,...(local.kind==='quick'?quickMatchOptions(local.config):{})}):createGame(seed,selected);localMatch=local;lastLocalMatch=local;challenge=local?.kind==='duel'?createChallenge(local.id,game,local.final?finalRule(campaign):null):null;lesson=local?.kind==='lesson'?createRacketLesson(game,local.extra):null;replay=[];target=128;direction=0;power=false;servePressed=false;shotInput=0;lastEvent=0;accumulator=0;lastTime=performance.now();paused=false;running=true;matchInput.reset();manualTarget=null;
    telemetry.track('match_started',{mode:local?.kind||'ranked',sport:game.sport||'tennis'});
    $('playArea').classList.toggle('manual-match',Boolean(local));$('playArea').classList.toggle('assisted-match',Boolean(local));$('matchPad').hidden=true;$('moveLeft').parentElement.hidden=Boolean(local);
    courtOverview=false;updateCourtView();
    const entryCamera=world.snapshot().camera;
    showSection('playArea',game.sport,local?.kind==='duel'&&local.id==='scarlt'?'romulo':musicForMatch(local,game.sport));$('playerName').textContent=(local?matchPlayer().name:game.character.name).toUpperCase();$('playerName').parentElement.lastElementChild.textContent=opponent.name.toUpperCase();$('gameHint').textContent='Arraste para escolher o golpe · toque curto para a deixada';$('pauseOverlay').hidden=true;
    $('lessonHud').hidden=!lesson;$('playArea').classList.toggle('lesson-mode',Boolean(lesson));$('halloweenChallengeHud').hidden=!challenge;if(lesson)$('playerName').textContent=`AULA COM ${opponent.name.toUpperCase()}`;$('results').classList.remove('campaign-won');$('viewRanking').hidden=Boolean(local);$('results').querySelector('.result-score').hidden=Boolean(local);
    if(local)$('gameHint').textContent=lesson?`AULA COM ${opponent.name.toUpperCase()} · erre à vontade, sem cronômetro.`:game.sport==='pickleball'?'PICKLEBALL · Primeiro a 5 pontos.':'TIE-BREAK · 7 pontos, dois de vantagem. Em 10 a 10, ponto decisivo.';
    else $('gameHint').textContent='RANKING CLÁSSICO · controles e regras originais';
    resizeMatchCanvas();canvas.focus({preventScroll:true});draw.enterFrom(entryCamera);draw(game);updateHud();frameHandle=requestAnimationFrame(tick);
  }catch(error){$('startStatus').textContent=error.message;if(!$('worldArea').hidden)$('storyText').textContent=error.message;}finally{starting=false;$('startButton').disabled=false;$('practiceButton').disabled=false;$('closeGame').disabled=false;}
}
function updateHud(){
  const seconds=Math.ceil((MAX_FRAMES-game.frame)/FPS);$('timeLeft').textContent=lesson?'AULA':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  $('liveScore').textContent=fmt(game.score);$('matchScore').textContent=lesson?`${Math.min(lesson.index+1,lessonTasks(lesson).length)}/${lessonTasks(lesson).length}`:`${game.playerPoints} × ${game.cpuPoints}`;
  $('specialButton').disabled=paused||game.charge<3||!game.ball.active||Boolean(game.powerFrames);$('chargeMeter').textContent='▰ '.repeat(game.charge)+'▱ '.repeat(3-game.charge);
  $('serveButton').disabled=paused||!game.awaitingServe;$('serveButton').classList.toggle('ready',!paused&&game.awaitingServe);
  for(const [id,value] of [['sliceButton',INPUT.SLICE],['lobButton',INPUT.LOB],['dropButton',INPUT.DROP],['topspinButton',0]]){if(game.manual)$(id).removeAttribute('aria-pressed');else $(id).setAttribute('aria-pressed',String(shotInput===value));$(id).disabled=paused;}
  const shot=SHOTS.find(s=>s.input===shotInput),description={normal:'rebatida automática',slice:'baixo e com efeito',lob:'alto e fundo',drop:'perto da rede'};
  const hint=paused?'Partida pausada':game.assisted?(game.awaitingServe?(game.horizontal?'Arraste para a direita para sacar.':'Arraste para cima para sacar.'):game.delay?game.message:game.horizontal?'← Topspin · ↕ Slice · Toque: deixada':'↓ Topspin · ↔ Slice · Toque: deixada'):game.awaitingServe?'Sua vez! Toque em Saque para iniciar.':game.tossFrames?'Bola para cima… saque!':game.delay?game.message:`${shot.label} · ${description[shot.id]}`;
  if($('shotStatus').textContent!==hint)$('shotStatus').textContent=hint;
  const task=lesson?lessonTasks(lesson)[lesson.index]:null;
  for(const id of ['matchPad','moveLeft','moveRight','serveButton','sliceButton','lobButton','dropButton','specialButton','topspinButton'])$(id).classList.toggle('lesson-target',Boolean(task?.buttons?.includes(id)));
  if(lesson?.guided)lessonTutorial.render(lesson,opponent.name,paused);
  if(challenge){$('challengeTitle').textContent=challenge.title;$('challengeProgress').textContent=challengeStatus(challenge,game);$('challengeRule').textContent=challenge.instructions;$('gameHint').textContent='Suco entregue · falhar não perde o tratamento';}
}
function chooseShot(value){if(!running||paused||game.manual)return;shotInput=value;updateHud();canvas.focus({preventScroll:true});}
function tick(now){
  if(!running)return;
  if(!paused){
    if(draw.transitioning()){draw(game);lastTime=now;frameHandle=requestAnimationFrame(tick);return;}
    // Pause rather than fast-forward after browser suspension or a long stall.
    if(now-lastTime>1000){pause();lastTime=now;frameHandle=requestAnimationFrame(tick);return;}
    accumulator+=Math.min(now-lastTime,100);
    while(accumulator>=1000/FPS&&!game.done){
      if(direction)target=localMatch?keyboardTarget(game.player.x,direction):clamp(target+direction*5,0,255);
      const input=Math.round(target)|shotInput|(power?INPUT.POWER:0)|(servePressed?INPUT.SERVE:0);power=false;servePressed=false;
      if(game.manual){const manual=matchInput.read();if(manual.moveX||manual.moveY)manualTarget=null;manual.target=manualTarget;if(lesson)stepRacketLesson(lesson,game,manual);else if(challenge)stepChallenge(challenge,game,manual);else stepRacketMatch(game,manual);}
      else{replay.push(input);stepGame(game,input);}accumulator-=1000/FPS;
      if(game.eventId!==lastEvent){beep(game.event);lastEvent=game.eventId;}
    }
    game.gesture=game.assisted?assistInput.preview():null;draw(game);updateHud();if(game.done){finish();return;}
  }
  lastTime=now;frameHandle=requestAnimationFrame(tick);
}
async function savePending(){
  if(!pending)return true;
  try{
    const version=pending.version||LEGACY_VERSION;
    const result=await api('finish',{identity,run_id:pending.run_id,inputs:pending.inputs,version});
    storage.set(bestKey(version),Math.max(storage.get(bestKey(version),0),result.score));showBest();pending=null;storage.remove('pending');$('retrySave').hidden=true;$('saveStatus').textContent='Partida salva! Seu melhor resultado vale no ranking desta versão.';loadRanking();return true;
  }catch(error){
    if([400,404,410].includes(error.status)){pending=null;storage.remove('pending');$('saveStatus').textContent=`${error.message} Você já pode começar uma nova partida.`;$('retrySave').hidden=true;return true;}
    $('saveStatus').textContent=`Ainda não foi salvo: ${error.message} Sua partida ficou guardada para tentar novamente.`;$('retrySave').hidden=false;return false;
  }
}
async function finish(){
  if(lesson?.completed){const coach=npc(localMatch.id),first=!campaign.trained;telemetry.track('match_finished',{mode:'lesson',result:'completed'});progress({type:'lesson-passed'});stop();await enterClub();return story({title:'Aula concluída!',character:coach,text:`${first?'“Parabéns! Nenhuma bola foi para o rio, hahaha! Procure Felipe no bar: ele encontrou uma parte da receita. Não coma nada!”':'“Mandou bem na revisão! Continue variando os golpes, a direção e a força. Quando quiser, a gente treina de novo!”'}\n\n${objective(campaign).text}`,actions:[{label:'Próxima missão',primary:true,run:openJournal},{label:'Até mais!',run:closeWorldPanel}]});}
  stop();showSection('results');const won=localMatch?.kind==='duel'?challenge?.succeeded===true:game.playerPoints>game.cpuPoints,tie=!challenge&&game.playerPoints===game.cpuPoints;
  telemetry.track('match_finished',{mode:localMatch?.kind||'ranked',result:won?'win':tie?'tie':'loss'});
  $('resultTitle').textContent=won?'Deu Ilha! Você venceu.':tie?'Disputa equilibrada!':'A revanche é sua.';
  $('resultEyebrow').textContent=run?'DESAFIO CONCLUÍDO':'TREINO CONCLUÍDO';$('finalScore').textContent=fmt(game.score);$('finalDetails').textContent=`Placar: ${game.playerPoints} × ${game.cpuPoints} · ${game.returns} devoluções · Maior rally: ${game.bestRally}${won?' · +300 pela vitória':''}`;
  $('retrySave').hidden=true;
  $('resultPortrait').hidden=!(localMatch?.kind==='duel'&&won);
  if(!$('resultPortrait').hidden)characterPortrait($('resultPortrait'),opponent);
  quickRematchSetup.hidden=localMatch?.kind!=='quick';setResultActions(won,localMatch?.kind);
  if(localMatch?.kind==='quick'){
    const player=matchPlayer(),venue=QUICK_VENUES.find(v=>v.id===localMatch.config.venue);
    $('resultTitle').textContent=`${won?player.name:opponent.name} venceu!`;
    $('resultEyebrow').textContent='JOGO RÁPIDO · FIM DE PARTIDA';
    $('finalDetails').textContent=`${player.name} ${game.playerPoints} × ${game.cpuPoints} ${opponent.name}\n${venue.name} · Maior rally: ${game.bestRally}`;
    $('saveStatus').textContent='Treino livre: não altera as missões, medalhas ou o ranking.';
    $('playAgain').textContent='Jogar revanche';return;
  }
  if(localMatch?.kind==='duel'){
    if(localMatch.final){
      if(won)progress({type:'final-won',id:localMatch.id,success:true});
      $('resultTitle').textContent=won?'Mistério resolvido!':'Falta só esta última sessão';
      $('resultEyebrow').textContent='O ÚLTIMO JOGO';
      $('finalDetails').textContent=`Placar: ${game.playerPoints} × ${game.cpuPoints}\n\n${challenge.reason}`;
      $('saveStatus').textContent=objective(campaign).text;$('playAgain').textContent=won?'Jogar novamente':'Tentar novamente';
      if(won){characterPortrait($('resultPortrait'),opponent);audio.setScene('medal',{restart:true});}return;
    }
    const firstWin=won&&!campaign.wins.includes(localMatch.id);
    if(won)progress({type:'challenge-completed',id:localMatch.id,success:challenge.succeeded});
    if(won)characterPortrait($('resultPortrait'),opponent);
    $('results').classList.toggle('campaign-won',won);
    $('resultTitle').textContent=won?`${opponent.name} voltou ao normal!`:'Vamos tentar o tratamento de novo';
    const medal=MEDALS.find(m=>m.id===localMatch.id);
    $('finalDetails').textContent=`Placar: ${game.playerPoints} × ${game.cpuPoints}\n\n${challenge?.reason||''}\n\n${won?(firstWin?BOSS_WIN[localMatch.id]:'Desafio repetido! O progresso da história continua onde estava.'):'O suco já está fazendo efeito. A missão e a entrega continuam salvas.'}${firstWin?`\n\n★ Recuperação ${medal.name}!\n\nNOVA PISTA: ${evidenceFor(campaign).at(-1).text}`:''}`;
    if(firstWin){audio.setScene('medal',{restart:true});const art=document.createElement('canvas');art.className='result-medal';art.setAttribute('role','img');art.setAttribute('aria-label',`Medalha ${medal.name}, de ${medal.owner}`);drawMedal(art,medal);$('finalDetails').append(art);}
    $('resultEyebrow').textContent=won?'TRATAMENTO CONCLUÍDO':'DESAFIO ANTIZUMBI';$('saveStatus').textContent=(campaignSaved?'':'Salvamento local indisponível. ')+objective(campaign).text;$('playAgain').textContent=won?'Jogar revanche':'Tentar novamente';return;
  }
  $('playAgain').textContent='Jogar de novo';
  if(!run){$('saveStatus').textContent='Partida amistosa concluída. Seu progresso na história não muda.';return;}
  pending={run_id:run.id,inputs:replay,version:VERSION};storage.set('pending',pending);$('saveStatus').textContent='Salvando seu resultado…';$('playAgain').disabled=true;
  await savePending();$('playAgain').disabled=false;
}

function setResultActions(won,kind){
 const replay=$('playAgain'),club=$('returnToClub'),setup=$('quickRematchSetup');
 const mission=won&&kind==='duel';
 replay.className=won?'text-button':'primary';club.className='text-button';setup.className='text-button';
 club.dataset.nextMission=String(mission);club.textContent=mission?'Próxima missão →':'Voltar para o clube';
 const primary=won?(kind==='quick'?setup:club):replay;
 primary.className='primary';if(primary!==replay)replay.before(primary);
 primary.focus({preventScroll:true});
}

let dragPointer=null;
function updateCourtView(){
  const venue=localMatch?.kind==='quick'?QUICK_VENUES.find(v=>v.id===localMatch.config.venue):null;
  $('courtLabel').textContent=venue?.name||`Quadra ${activeCourt}`;
  const arrows=game?.horizontal?['→','←','↕']:['↑','↓','↔'];
  document.querySelectorAll('#playArea .gesture-guide b').forEach((node,i)=>{if(i<3)node.textContent=arrows[i];});
  $('courtViewButton').textContent=courtOverview?'Aproximar':'Ver 2 quadras';
  $('courtViewButton').setAttribute('aria-pressed',String(courtOverview));
  canvas.setAttribute('aria-label',game?.assisted?`${venue?.name||'Quadra '+activeCourt}. Corrida automática. ${game.horizontal?'Arraste para a direita: saque; para a esquerda: topspin; para cima ou baixo: slice.':'Arraste para cima: saque; para baixo: topspin; para o lado: slice.'} Toque curto: deixada. O gesto e sua inclinação definem força e direção. Use o botão de pausa para interromper a partida.`:`Quadra ${activeCourt} de saibro. Arraste na tela para mover e use os controles de golpe. Use o botão de pausa para interromper a partida.`);
}
$('courtViewButton').addEventListener('click',()=>{courtOverview=!courtOverview;updateCourtView();if(game)draw(game);});
function setTarget(event){if(game.manual){manualTarget=manualDraw.target(event);return;}const r=canvas.getBoundingClientRect(),viewX=(event.clientX-r.left)/r.width*COURT_VIEW.width;target=clamp((viewToCourtX(viewX,activeCourt,courtOverview)-94)/292*255,0,255);}
canvas.addEventListener('pointerdown',e=>{if(!running||paused||game.assisted)return;dragPointer=e.pointerId;canvas.setPointerCapture(e.pointerId);setTarget(e);});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===dragPointer&&running&&!paused)setTarget(e);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{dragPointer=null;manualTarget=null;});
function stopMoving(){direction=0;if(localMatch&&running)target=keyboardTarget(game.player.x);}
for(const [id,value] of [['moveLeft',-1],['moveRight',1]]){const button=$(id);button.addEventListener('pointerdown',e=>{if(paused)return;e.preventDefault();button.setPointerCapture(e.pointerId);direction=value;});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>{if(direction===value)stopMoving();});}
document.addEventListener('keydown',e=>{if(!running||paused||game.manual||e.target!==canvas)return;const key=e.key.toLowerCase();if(['arrowleft','arrowright',' '].includes(key)){e.preventDefault();if(key==='arrowleft')direction=-1;else if(key==='arrowright')direction=1;else power=true;}
  if(!e.repeat&&['a','x','y','s','l','c','n'].includes(key)){e.preventDefault();chooseShot({a:INPUT.SLICE,x:INPUT.DROP,y:0,s:INPUT.SLICE,l:INPUT.LOB,c:INPUT.DROP,n:0}[key]);}
  if(['b','enter'].includes(key)&&game.awaitingServe){e.preventDefault();servePressed=true;}
});
document.addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key))stopMoving();});
function restoreAfterReturn(){
 audio.setHidden(document.hidden);
 if(document.hidden)return;
 if(appMode&&!$('gameDialog').open)legacy.menu();
 audio.recover();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){audio.setHidden(true);if(running)pause();}else restoreAfterReturn();});
window.addEventListener('pagehide',()=>audio.setHidden(true));
window.addEventListener('pageshow',restoreAfterReturn);
window.addEventListener('focus',restoreAfterReturn);
window.addEventListener('blur',()=>{if(running)pause();});
$('gameDialog').addEventListener('close',()=>{if(!$('gameDialog').open){halloweenIntro.stop();audio.setScene(null);fullscreen.close();}});
$('gameDialog').addEventListener('cancel',e=>{e.preventDefault();if(starting)return;if(!$('worldArea').hidden&&(!$('worldStory').hidden||!$('worldMap').hidden))closeWorldPanel();else if(running&&!paused)pause();else close();});
function raiseGameDialog(){
 // Fullscreen and dialog share the browser's top layer. Put the dialog last.
 const dialog=$('gameDialog');if(!dialog.open)return;
 const focus=document.activeElement;dialog.close();dialog.showModal();focus?.focus({preventScroll:true});
}
function openDisplayHelp(){
 if(running&&!paused)pause();if(pickle.active&&!pickle.paused)pickle.pause();
 resetWalkPad();world.block(true);
 renderInstallState(gameInstall.state());
 $('gameInstallLink').hidden=true;
 if(!$('displayHelp').open)$('displayHelp').showModal();
}
function renderInstallState(state){
 for(const id of ['landingDisplayHelp','menuDisplayHelp'])$(id).hidden=state.appMode||state.installed;
 const help=gameDisplayHelp(window,state);$('displayHelpTitle').textContent=help.title;$('displayHelpText').textContent=help.text;
 $('displayHelpSteps').replaceChildren(...help.steps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 $('displayHelpSteps').hidden=!help.steps.length;
 $('installGame').hidden=!(state.canPrompt||state.pending);$('installGame').disabled=state.pending;
 $('installGame').textContent=state.pending?'Aguardando o navegador…':'Instalar jogo';
 $('copyGameLink').hidden=state.appMode||state.installed||state.canPrompt||state.pending;
 $('installIlhaPlay').hidden=state.appMode||state.installed;
 const message=({accepted:'Pedido aceito. Aguarde o navegador concluir a instalação.',dismissed:'Tudo bem! Você pode continuar jogando aqui e instalar depois.',error:'O navegador não concluiu a instalação. Você pode usar as instruções acima.'})[state.outcome]||'';
 $('installStatus').textContent=message;$('installStatus').hidden=!message;
}
$('installGame').addEventListener('click',()=>gameInstall.prompt());
$('copyGameLink').addEventListener('click',async()=>{
 const link=new URL('/game2',location.origin).href;
 try{await navigator.clipboard.writeText(link);$('installStatus').textContent='Link copiado! Cole na barra de endereço do navegador.';}
 catch{const input=$('gameInstallLink');input.value=link;input.hidden=false;input.focus();input.select();$('installStatus').textContent='Selecione e copie o link abaixo para abrir no navegador.';}
 $('installStatus').hidden=false;
});
$('displayHelp').addEventListener('close',()=>world.block(!$('worldStory').hidden||!$('worldMap').hidden));
for(const id of ['landingDisplayHelp','menuDisplayHelp'])$(id).addEventListener('click',openDisplayHelp);
$('openGame').addEventListener('click',async()=>{
 legacy.menu();
 audio.setScene('menu',{restart:true});
 if(!appMode)await fullscreen.enter();
 raiseGameDialog();
});
$('legacyFree').addEventListener('click',()=>openQuickPlay({},'menu'));
$('fullscreenButton').addEventListener('click',async()=>{
 if(appMode)return openDisplayHelp();
 const wasExpanded=displayFullscreen,expanded=await fullscreen.toggle();raiseGameDialog();
 if(!expanded&&!wasExpanded)openDisplayHelp();
});
$('openRanking').addEventListener('click',openRanking);$('closeRanking').addEventListener('click',closeRanking);
$('closeGame').addEventListener('click',close);$('exitMatch').addEventListener('click',()=>localMatch?.kind==='quick'?openQuickPlay(localMatch.config,quickOrigin):enterClub());
$('startForm').addEventListener('submit',e=>{e.preventDefault();if(selectionPurpose==='match')start();else{storage.set('nickname',$('nickname').value.trim());enterClub();}});$('practiceButton').addEventListener('click',()=>selectionPurpose==='match'?start(true):enterClub());
$('challengeHelp').addEventListener('click',pause);$('pauseButton').addEventListener('click',pause);$('resumeButton').addEventListener('click',resume);$('specialButton').addEventListener('click',()=>{if(!paused)power=true;});
$('sliceButton').addEventListener('click',()=>chooseShot(INPUT.SLICE));$('lobButton').addEventListener('click',()=>chooseShot(INPUT.LOB));$('dropButton').addEventListener('click',()=>chooseShot(INPUT.DROP));$('serveButton').addEventListener('click',()=>{if(running&&!paused&&game.awaitingServe){servePressed=true;canvas.focus({preventScroll:true});}});
$('topspinButton').addEventListener('click',()=>chooseShot(0));
$('soundButton').addEventListener('click',toggleSound);
$('playAgain').addEventListener('click',()=>lastLocalMatch?.kind==='quick'?startQuickMatch(lastLocalMatch.config):lastLocalMatch&&lastLocalMatch.kind!=='lesson'?start(true,lastLocalMatch):openSelection('match'));$('retrySave').addEventListener('click',async()=>{$('retrySave').disabled=true;await savePending();$('retrySave').disabled=false;});
$('viewRanking').addEventListener('click',()=>{stop();$('gameDialog').close();openRanking();});
$('refreshRanking').addEventListener('click',loadRanking);
const rankingLabel=document.createElement('label');rankingLabel.className='ranking-version-label';rankingLabel.htmlFor='rankingVersion';rankingLabel.textContent='Versão do jogo';
const rankingSelect=document.createElement('select');rankingSelect.id='rankingVersion';rankingSelect.className='ranking-version';
for(const [value,label] of [[VERSION,'RPG · Quatro golpes'],[LEGACY_VERSION,'Clássico · Recordes anteriores']]){const option=document.createElement('option');option.value=value;option.textContent=label;rankingSelect.append(option);}
rankingSelect.addEventListener('change',()=>{rankingVersion=rankingSelect.value;showBest();loadRanking();});$('ranking').querySelector('.ranking-description').after(rankingLabel,rankingSelect);
$('changeCharacter').addEventListener('click',()=>legacy.profile());$('worldMenu').addEventListener('click',legacy.menu);
$('worldMenu').textContent='Menu';
$('medalsButton').addEventListener('click',openMedals);
$('missionButton').textContent='Missões';
$('missionButton').addEventListener('click',openJournal);$('pickleExit').addEventListener('click',enterClub);
$('openMap').addEventListener('click',openWorldMap);$('miniMapButton').addEventListener('click',openWorldMap);$('closeMap').addEventListener('click',closeWorldPanel);
$('closeStory').addEventListener('click',closeWorldPanel);$('interactButton').addEventListener('click',()=>world.interact());$('skipWorldIntro').addEventListener('click',()=>world.skipIntro());
const returnToClub=document.createElement('button');returnToClub.type='button';returnToClub.id='returnToClub';returnToClub.className='text-button';returnToClub.textContent='Voltar para o clube';returnToClub.addEventListener('click',async()=>{const mission=returnToClub.dataset.nextMission==='true';await enterClub();if(mission){if(world.snapshot().introducing)world.skipIntro();openJournal();}});$('results').append(returnToClub);
const quickRematchSetup=document.createElement('button');quickRematchSetup.type='button';quickRematchSetup.id='quickRematchSetup';quickRematchSetup.className='text-button';quickRematchSetup.hidden=true;quickRematchSetup.textContent='Trocar personagens / quadra';quickRematchSetup.addEventListener('click',()=>openQuickPlay(lastLocalMatch.config,quickOrigin));returnToClub.before(quickRematchSetup);
const walkPad=$('walkPad');let walkingPointer=null;
function updateStick(event){const r=walkPad.getBoundingClientRect(),vector=joystickVector(event.clientX-r.left-r.width/2,event.clientY-r.top-r.height/2,r.width*.3);world.move(vector.x,vector.y);walkPad.style.setProperty('--stick-x',`${vector.x*24}px`);walkPad.style.setProperty('--stick-y',`${vector.y*24}px`);walkPad.classList.toggle('moving',Boolean(vector.x||vector.y));}
walkPad.addEventListener('pointerdown',event=>{if(walkingPointer!==null)return;event.preventDefault();walkingPointer=event.pointerId;walkPad.setPointerCapture(event.pointerId);updateStick(event);});
walkPad.addEventListener('pointermove',event=>{if(event.pointerId===walkingPointer)updateStick(event);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])walkPad.addEventListener(event,e=>{if(e.pointerId===walkingPointer)resetWalkPad();});
for(const button of walkPad.querySelectorAll('button')){
  button.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();world.move(...button.dataset.walk.split(',').map(Number));button.classList.add('pressed');}});
  button.addEventListener('keyup',resetWalkPad);button.addEventListener('blur',resetWalkPad);
}
function resetWalkPad(){walkingPointer=null;walkPad.style.setProperty('--stick-x','0px');walkPad.style.setProperty('--stick-y','0px');walkPad.classList.remove('moving');for(const button of walkPad.querySelectorAll('button'))button.classList.remove('pressed');world.move(0,0);}
window.addEventListener('blur',resetWalkPad);document.addEventListener('visibilitychange',resetWalkPad);
// Keep keyboard focus inside a conversation/map, not on the game behind it.
$('gameDialog').addEventListener('keydown',event=>{if(event.key!=='Tab'||$('worldArea').hidden)return;const panel=!$('worldStory').hidden?$('worldStory'):!$('worldMap').hidden?$('worldMap'):null;if(!panel)return;const buttons=[...panel.querySelectorAll('button:not(:disabled),a[href]')];const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
window.addEventListener('online',()=>{loadRanking();if(pending&&!running)savePending();});
// Unlock only from a user gesture. No autoplay or music requests on the landing page.
let keyboardNavigation=false;
const inGame=target=>target instanceof Element&&(target.closest('#gameDialog')||target.closest('#openGame'));
function menuButton(target){
 const button=target instanceof Element?target.closest('button'):null;
 return button&&inGame(button)&&!button.disabled&&!button.closest('[inert]')&&!button.matches('[data-walk],#moveLeft,#moveRight,#pickleUp,#pickleDown,#serveButton,#pickleServe,#specialButton')?button:null;
}
document.addEventListener('pointerdown',event=>{keyboardNavigation=false;if(inGame(event.target))initAudio();},true);
document.addEventListener('keydown',event=>{if(event.key==='Tab')keyboardNavigation=true;if(!event.repeat&&inGame(event.target))initAudio();},true);
document.addEventListener('focusin',event=>{if(keyboardNavigation&&menuButton(event.target))beep('menu-move');});
document.addEventListener('pointerover',event=>{const button=menuButton(event.target);if(event.pointerType!=='touch'&&button&&!button.contains(event.relatedTarget))beep('menu-move');});
document.addEventListener('click',event=>{
 if(!inGame(event.target))return;initAudio();
 const button=menuButton(event.target);
 if(button&&button.id!=='soundButton'&&!button.textContent.startsWith('Som '))beep('menu-select');
},true);
$('openRanking').hidden=true;$('viewRanking').hidden=true;showBest();soundLabel();
$('openGame').disabled=false;$('openGame').setAttribute('aria-busy','false');
if(appMode)legacy.menu();
requestAnimationFrame(paintScenePreviews);
// Retry a completed run after a reload; a run ID can only score once.
pending=null; // Separate local campaign; old ranking queues never migrate here.
