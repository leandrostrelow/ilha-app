import {compareSuspects,evidenceFor,reconstruction} from './mystery.js';
import {NPCS,personById} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';

const node=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
export function paintNotebook(host,state,{onTalk,paintPortrait}){
 const book=node('div',null,'mystery-notebook'),memories=evidenceFor(state),profiles=compareSuspects(state);
 const resolved=reconstruction(state);
 if(resolved){const solved=node('details',null,'notebook-solved');solved.open=true;solved.append(node('summary','Como as pistas se encaixaram'),node('p',resolved));book.append(solved);}
 const facts=node('section',null,'notebook-facts');facts.append(node('h3','As duas pistas da mesa'));
 for(const [index,source,label,missing]of [[2,'Higor','Objeto','Ajude Higor a recuperar essa lembrança.'],[3,state.witnesses.includes('gael')?'Michele + Gael':'Michele','Recipiente','Ajude Michele a recuperar essa lembrança.']]){
  const row=node('div'),text=memories[index]?profiles[0].checks[index-2].observed:missing;
  row.append(node('strong',label),node('p',text),node('small',memories[index]?'Fonte: '+source:'Pista ainda não recuperada'));facts.append(row);
 }
 book.append(facts,node('h3','Compare os três perfis'));
 const suspects=node('div',null,'notebook-suspects');
 for(const profile of profiles){
  const card=node('article',null,'notebook-suspect'+(profile.matches===2?' notebook-match':''));card.dataset.suspect=profile.id;
  const head=node('div',null,'notebook-person'),portrait=node('canvas');portrait.width=72;portrait.height=90;portrait.setAttribute('aria-hidden','true');paintPortrait(portrait,personById(profile.id));head.append(portrait,node('h4',profile.name));card.append(head);
  card.append(node('strong',!profile.interviewed?'Perfil não confirmado':!profile.ready?'Aguardando as duas pistas':`${profile.matches} de 2 pistas combinam`,'notebook-status'));
  for(const check of profile.checks){const p=node('p'),prefix=check.matches===null?'':check.matches?'✓ Combina · ':'✕ Não combina · ';p.append(node('b',check.label+': '),document.createTextNode(profile.interviewed?check.value:'Converse para confirmar.'));if(profile.interviewed&&check.known)p.append(node('small',prefix+check.label.toLowerCase()));card.append(p);}
  const talk=node('button','Conversar com '+profile.name);talk.type='button';talk.onclick=()=>onTalk(personById(profile.id));card.append(talk);suspects.append(card);
 }
 book.append(suspects,node('p','Só a combinação do objeto com o recipiente aponta para uma pessoa. A roupa, a aparência e os apelidos não são provas.','notebook-tip'));
 const history=node('details');history.append(node('summary',`Lembranças da turma · ${memories.length}/6`));
 for(const memory of memories){const article=node('article',null,'notebook-memory');article.append(node('h4',memory.topic+' · '+memory.who),node('p',memory.text));history.append(article);}
 if(!memories.length)history.append(node('p','Cada paciente recuperado lembra de uma parte da noite. As crianças ajudam a conferir os relatos.'));
 book.append(history);
 const people=[...NPCS,...AMBIENT_NPCS],seen=new Set([...state.visited,...state.witnesses]),roster=node('details');roster.append(node('summary',`Turma do Ilha · ${people.filter(p=>seen.has(p.id)).length}/${people.length} conhecidos`));
 const list=node('div',null,'notebook-roster');for(const person of people){const button=node('button',`${seen.has(person.id)?'✓ ':'○ '}${person.name}`);button.type='button';button.onclick=()=>onTalk(person);list.append(button);}roster.append(list);book.append(roster);
 host.replaceChildren(book);
}
