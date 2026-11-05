// Case facts are picked ONCE per new adventure, persisted with the save.
// The same evidence always identifies the same adult. No child is a suspect.
export const CASES=Object.freeze({
 beto:{name:'Beto',object:'um chaveiro de foguete',container:'uma garrafa prateada com uma estrela',phrase:'Isso dá energia para ir até a Lua!',
  excuse:'Eu achei que era um suplemento espacial! Era para a turma ter energia no próximo set… Não para virar marciano.',kind:'rally',target:12,difficulty:.58},
 evandro:{name:'Evandro',object:'uma almofadinha de viagem',container:'uma caneca azul com uma lua',phrase:'Com isso ninguém dorme no próximo set!',
  excuse:'Achei que era um tempero energético. Eu só queria parar de dormir entre os pontos. Li o rótulo pela metade… de olhos fechados.',kind:'streak',target:3,limit:5,difficulty:.56},
 romulo:{name:'Rômulo',object:'um chaveiro de foice de brinquedo',container:'uma garrafa preta com duas raquetes',phrase:'Agora vai dar para jogar mais um set!',
  excuse:'Achei que o Sal do Set Impossível ajudava a aguentar mais um jogo. Joguei na porção para todo mundo render. Eu devia ter perguntado ao Felipe.',kind:'comeback',target:6,startCpu:3,difficulty:.65},
});
export function chooseCase(random=Math.random){return Object.keys(CASES)[Math.min(2,Math.max(0,Math.floor(random()*3)))];}
export function savedCase(value){
 if(Object.hasOwn(CASES,value?.caseId))return value.caseId;
 // Deterministic migration: merely reloading an old save cannot change the case.
 let hash=0;for(const c of String(value?.name||'Ilha'))hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
 return Object.keys(CASES)[hash%3];
}
export function evidenceFor(state){
 const c=CASES[savedCase(state)];
 const memories=[
  ['Gabriel','Felipe estava no balcão. Vi outro adulto perto da porção com um frasco sem tampa. Davi estava na mesa e pode confirmar.'],
  ['Vanessa','A pessoa achava que estava ajudando. Ouvi: “'+c.phrase+'”'],
  ['Higor','Caiu do bolso da pessoa '+c.object+'. Não era parte da decoração.'],
  ['Michele','Ao lado do frasco tinha '+c.container+'. Anotei no caderno para não esquecer de novo.'],
  ['Larissa','As crianças estavam caçando doces. Leandro chegou atrasado e ficou longe da mesa; Renato estava guardando as bolas. Eles não mexeram na porção.'],
  ['Scarlt','Lembrei da etiqueta: era Sal do Set Impossível, da caixa de Halloween. A pessoa confundiu com tempero energético. Emerson guardou o rótulo completo.'],
 ];
 const topics=['Onde estava Felipe','O que foi dito','O objeto','O recipiente','Quem estava longe','De onde veio o pó'];
 return memories.slice(0,Math.min(6,state.wins?.length||0)).map(([who,text],i)=>({who,text,topic:topics[i]}));
}
export function suspectDescription(id){const c=CASES[id];return c?`${c.name} costuma carregar ${c.object} e ${c.container}.`:'';}
export function compareSuspects(state){
 const actual=CASES[savedCase(state)],objectKnown=state.wins?.includes('higor'),containerKnown=state.wins?.includes('michele');
 return Object.entries(CASES).map(([id,c])=>{
  const interviewed=Boolean(state.witnesses?.includes(id));
  const checks=[{label:'Objeto',value:c.object,observed:actual.object,known:objectKnown},{label:'Recipiente',value:c.container,observed:actual.container,known:containerKnown}].map(check=>({...check,known:Boolean(check.known),matches:interviewed&&check.known?check.value===check.observed:null}));
  const ready=interviewed&&objectKnown&&containerKnown;
  return {id,name:c.name,interviewed,checks,ready:Boolean(ready),matches:ready?checks.filter(c=>c.matches).length:null};
 });
}
export function accusationFeedback(state,id){
 const selected=CASES[id],actual=CASES[savedCase(state)];
 if(!selected)return 'Escolha um dos três adultos e confira as duas pistas.';
 return `Vamos conferir: ${selected.name} usa ${selected.object} e ${selected.container}.\n\nHigor viu ${actual.object}. Michele e Gael lembraram de ${actual.container}. As duas pistas precisam combinar com a MESMA pessoa.\n\nNenhum progresso foi perdido. Abra a comparação no caderno.`;
}
export function reconstruction(state){
 if(!state.accused&&!state.champion)return '';
 const c=CASES[savedCase(state)];
 return `POR QUE FOI ${c.name.toLocaleUpperCase('pt-BR')}?\n\n1. Higor viu ${c.object}. ${c.name} confirmou que usa esse objeto.\n\n2. Michele e Gael viram ${c.container} ao lado do frasco. Esse também é o recipiente de ${c.name}.\n\n3. Vanessa e André ouviram: “${c.phrase}” A pessoa achava que o pó dava energia.\n\n4. Scarlt e Emerson confirmaram o rótulo: era um adereço de Halloween, não tempero. ${state.finalWon||state.champion?c.name+' admitiu o engano e ajudou a consertar.':'Falta ouvir a explicação de '+c.name+' e concluir o tratamento.'}\n\nNão foi a roupa, a aparência ou a fama de ninguém. Foi a combinação dos dois objetos com os depoimentos.`;
}
export function finalRule(state){
 const c=CASES[savedCase(state)];
 const instructions=c.kind==='rally'?'Mantenha uma única troca de bolas por 12 segundos.':c.kind==='streak'?'Faça três pontos seguidos antes que o rival chegue a cinco.':'Vire o 0 × 3 e chegue a seis pontos antes do rival.';
 return {...c,title:'Último jogo · '+c.name,instructions:instructions+' É a última etapa do antídoto para quem teve contato direto com o pó.',final:true};
}
