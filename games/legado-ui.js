import {NPCS,rewards} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {ROSTER_BIOS,STORY_INTRO} from './legado-story.js';
import {characterPortrait} from './characters.js';
const $=id=>document.getElementById(id);
export const SOUNDTRACK=Object.freeze([
 ['menu','Vamos Lá! · Abertura'],
 ['map','Passeio pelo clube'],
 ['match','Partida de tênis'],
 ['pickleball','Partida de pickleball'],
 ['lesson','Aula do Renato'],
 ['beto','Conversando com o Beto'],
 ['medal','Conquista de medalha'],
 ['romulo','Final contra o Rômulo'],
 ['ending','Valeu a Aventura! · Zeramento'],
]);
export function renderRewards(host,state){
 const data=rewards(state),panel=document.createElement('div');panel.className='legacy-stats';
 const heading=document.createElement('strong');heading.textContent=`${state.name} · Nível ${data.level} · ${data.xp} XP`;panel.append(heading);
 for(const [name,value] of data.attributes){const row=document.createElement('div');row.className='attribute-row';const label=document.createElement('span');label.textContent=name;const meter=document.createElement('meter');meter.min=0;meter.max=5;meter.value=value;meter.setAttribute('aria-label',`${name}: ${value} de 5`);const score=document.createElement('span');score.textContent=`${value}/5`;row.append(label,meter,score);panel.append(row);}
 const badges=document.createElement('div');badges.className='badge-list';for(const name of data.badges){const tag=document.createElement('span');tag.textContent=`★ ${name}`;badges.append(tag);}panel.append(badges);host.replaceChildren(panel);
}
export function createLegadoUI({getState,showSection,enterClub,saveProfile,goTo,onMenu,toggleSound,getSound,onMedals,onSave,onEnding}){
 let avatar='player-m',fresh=false,backToClub=false;
 function info(title,text,actions,scene=null){showSection('legacyInfo',undefined,scene);$('legacyInfoTitle').textContent=title;$('legacyInfoText').textContent=text;$('legacyInfoActions').replaceChildren();for(const [label,fn] of actions){const button=document.createElement('button');button.type='button';button.className='primary';button.textContent=label;button.addEventListener('click',fn);$('legacyInfoActions').append(button);}$('legacyInfoActions').firstElementChild?.focus({preventScroll:true});}
 function menu(){onMenu();showSection('legacyMenu');const s=getState();$('legacyContinue').disabled=!s.begun;const r=rewards(s);$('legacySaveInfo').textContent=s.begun?`${s.champion?'★ ':''}${s.name} · Nível ${r.level} · ${s.wins.length}/6 medalhas`:'Sua história começa aqui.';if(!$('gameDialog').open)$('gameDialog').showModal();$(s.begun?'legacyContinue':'legacyNew').focus({preventScroll:true});}
 function profile(isNew=false){fresh=isNew;avatar=getState().avatar;showSection('legacyProfile');$('adventureName').value=fresh?'':getState().name;$('profileWarning').textContent=fresh&&getState().begun?'Ao começar, este save será substituído. O ranking não muda.':'';$('profileSubmit').textContent=fresh?'Começar aventura ▶':'Salvar personagem';paintChoices();document.querySelector(`[data-avatar="${avatar}"]`).focus({preventScroll:true});}
 function paintChoices(){for(const button of document.querySelectorAll('[data-avatar]')){button.setAttribute('aria-pressed',String(button.dataset.avatar===avatar));characterPortrait(button.querySelector('canvas'),{avatar:button.dataset.avatar});}}
 function roster(fromClub=false){backToClub=fromClub;showSection('legacyRosterArea');$('rosterCards').replaceChildren();const s=getState();
  for(const person of [...NPCS,...AMBIENT_NPCS]){const card=document.createElement('article');card.className='roster-card';card.style.setProperty('--shirt',person.color);const portrait=document.createElement('canvas');portrait.width=144;portrait.height=180;portrait.setAttribute('aria-hidden','true');characterPortrait(portrait,person);const title=document.createElement('h3');title.textContent=person.name;const role=document.createElement('span');role.className='roster-role';role.textContent=person.title;const bio=document.createElement('p');bio.textContent=ROSTER_BIOS[person.id];const button=document.createElement('button');button.type='button';button.textContent=s.begun?`Encontrar ${person.name} →`:'Comece sua aventura';button.addEventListener('click',()=>s.begun?goTo(person):profile(true));card.append(portrait,title,role,bio,button);$('rosterCards').append(card);}$('rosterBack').focus();
 }
 function controls(){info('Comandos por toque','NO CLUBE\nToque no caminho para andar. Chegue perto e toque em Conversar ou Interagir.\n\nNA QUADRA\nO personagem corre sozinho. Faça o gesto na própria quadra e solte para preparar o golpe.\n\nTÊNIS · QUADRAS DE SAIBRO\nArraste para cima: saque.\nPuxe para baixo: topspin.\nArraste para o lado: slice.\nToque curto: deixada.\n\nPICKLEBALL E TÊNIS NA QUADRA VELHA\nArraste para a direita: saque.\nPuxe para a esquerda: topspin.\nArraste para cima ou para baixo: slice.\nToque curto: deixada.\n\nIncline o arrasto para escolher a direção; arraste mais para dar força. Você já pode preparar quando o rival estiver perto de rebater. Nos ralis rápidos, a preparação fica mais curta. Soltar confirma um golpe por devolução; não adianta repetir toques.\n\nSETA E FORÇA\nBranco: margem. Amarelo: atenção. Vermelho: força alta ou trajetória arriscada — não é fora automático! O círculo mostra a previsão do quique. A posição real do contato decide a trajetória.\n\nTÁTICA\nDo fundo você tem mais espaço para bater forte. Do meio da quadra, a mesma força pode passar da linha. A cruzada tem uma diagonal maior; bater forte na mesma lateral tem menos margem. Dê uma bola curta de um lado e depois procure o outro canto. Não precisa força máxima em toda bola. Trocas longas ficam mais rápidas.\n\nRenato ensina os golpes na aula.',[['Voltar às opções',options]]);}
 function soundtrack(active='menu'){
  const current=SOUNDTRACK.find(([id])=>id===active)?.[1]||SOUNDTRACK[0][1];
  info('Trilha sonora',`Tocando agora: ${current}\n\nEscolha uma faixa para ouvir. A música continua enquanto você permanece nesta página.`,[
   ...SOUNDTRACK.map(([id,label])=>[`${id===active?'▶':'♪'} ${label}`,()=>soundtrack(id)]),
   ['Voltar ao menu',menu],
  ],active);
 }
 function options(){info('Opções','Ajuste o jogo do seu jeito.',[[`Som: ${getSound()?'ligado':'desligado'}`,()=>{toggleSound();options();}],['Tela cheia / modo app',()=>$('fullscreenButton').click()],['Consultar comandos',controls],['Save e backup',onSave],...(getState().champion?[['Rever o álbum do final',onEnding]]:[]),...(getState().begun?[['Minhas medalhas',onMedals]]:[]),['Meu personagem',()=>profile()],['Voltar ao menu',menu]]);}
 $('legacyNew').addEventListener('click',()=>getState().begun?info('Começar uma nova história?','Você tem uma aventura salva. Ela só será substituída ao confirmar o novo nome e personagem. O ranking online não será alterado.',[['Escolher novo personagem',()=>profile(true)],['Manter minha aventura',menu]]):profile(true));
 $('legacyContinue').addEventListener('click',enterClub);$('legacyRoster').addEventListener('click',()=>roster());$('legacyMusic').addEventListener('click',()=>soundtrack());$('legacyOptions').addEventListener('click',options);
 $('legacyAbout').addEventListener('click',()=>info('A Copa do Legado',`${STORY_INTRO}\n\nExplore a Ilha, ouça Leandro, treine com Renato e prove o Suco do Tenista. Depois começa a Copa: seis chefes, cada um com seu pedido.\n\nGael, Emerson, Beto e Felipe ajudam no caminho. Tie-breaks de 7 pontos; dois de vantagem, ponto decisivo em 10 a 10. A taça espera por você no bar.`,[['Voltar',menu]]));
 for(const button of document.querySelectorAll('[data-avatar]'))button.addEventListener('click',()=>{avatar=button.dataset.avatar;paintChoices();});
 $('profileForm').addEventListener('submit',async event=>{event.preventDefault();if(!$('profileForm').reportValidity())return;saveProfile({name:$('adventureName').value,avatar},fresh);await enterClub();});
 $('profileCancel').addEventListener('click',()=>fresh?menu():enterClub());$('rosterBack').addEventListener('click',()=>backToClub?enterClub():menu());
 return {menu,profile,roster,info,options,soundtrack};
}
