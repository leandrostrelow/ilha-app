// A small DOM guide; simulation and progression live in racket-lesson.js.
export function createLessonTutorial(root,onAction){
 root.innerHTML=`<div class="coach-heading"><span id="coachStep"></span><span id="coachPhase"></span></div>
 <div class="coach-copy" role="status" aria-live="polite" aria-atomic="true"><strong id="lessonTitle"></strong><p id="lessonText"></p></div>
 <div class="coach-demo" id="coachDemo" aria-hidden="true"><svg viewBox="0 0 180 110"><path class="gesture-trail"/><circle class="gesture-start" r="5"/><path class="gesture-arrow"/><g class="gesture-finger"><circle class="finger-touch" r="11"/><path d="M-4 14V0Q-4-7 1-7Q6-7 6 0V14L9 10Q12 8 15 12L18 14Q22 12 25 17L29 21V34L23 42H2L-9 24Q-12 18-7 17Z"/></g></svg><span id="coachGestureLabel">Encoste · arraste · solte</span></div>
 <p id="lessonFeedback"></p><div class="coach-actions"><button id="coachNext" class="primary" type="button">Minha vez!</button><button id="coachReplay" type="button">Ver o gesto de novo</button></div>`;
 const $=id=>root.querySelector('#'+id),write=(id,text)=>{if($(id).textContent!==text)$(id).textContent=text;};
 $('coachNext').addEventListener('click',()=>onAction('next'));
 $('coachReplay').addEventListener('click',()=>onAction('demo'));
 let previousKey='';
 return {render(lesson,coach,paused){
  const task=lesson.tasks[lesson.index];if(!task)return;
  const practice=lesson.phase==='practice',success=lesson.outcome==='success',final=lesson.index===lesson.tasks.length-1;
  root.dataset.phase=lesson.phase;root.dataset.outcome=lesson.outcome||'';root.classList.toggle('coach-paused',paused);
  write('coachStep',`${coach} · ${lesson.index+1} de ${lesson.tasks.length}`);
  write('coachPhase',practice?'SUA VEZ':lesson.phase==='demo'?'VEJA O GESTO':success?'ACERTOU!':'VAMOS TENTAR');
  write('lessonTitle',lesson.phase==='feedback'?(success?(final?'Você aprendeu!':'Muito bem!'):'Quase lá!'):task.title);
  write('lessonText',lesson.phase==='feedback'?lesson.feedback:task.text);
  write('lessonFeedback',practice?lesson.feedback:lesson.phase==='feedback'?(success?'Respire. Continue quando quiser.':'Sem perder pontos. Você pode tentar quantas vezes quiser.'):task.tip);
  $('coachDemo').hidden=practice||success;
  $('coachNext').hidden=practice;$('coachNext').disabled=paused||lesson.pauseFrames>0;
  $('coachReplay').hidden=lesson.phase==='demo';$('coachReplay').disabled=paused;
  write('coachNext',lesson.phase==='demo'?'Minha vez!':success?(final?'Concluir aula ★':'Próximo passo →'):'Tentar de novo');
  const key=`${lesson.index}-${lesson.phase}`;
  if(key!==previousKey){
   previousKey=key;
   const [sx,sy,ex,ey]={up:[90,78,90,16],down:[90,10,90,68],side:[38,40,132,40],tap:[90,40,90,40],left:[114,10,63,67],right:[63,10,114,67],power:[90,1,90,70]}[task.gesture];
   const dx=ex-sx,dy=ey-sy,len=Math.max(1,Math.hypot(dx,dy)),ux=dx/len,uy=dy/len;
   root.querySelector('.gesture-trail').setAttribute('d',`M${sx} ${sy}L${ex} ${ey}`);
   root.querySelector('.gesture-arrow').setAttribute('d',task.gesture==='tap'?'':`M${ex-ux*10-uy*6} ${ey-uy*10+ux*6}L${ex} ${ey}L${ex-ux*10+uy*6} ${ey-uy*10-ux*6}`);
   const dot=root.querySelector('.gesture-start');dot.setAttribute('cx',sx);dot.setAttribute('cy',sy);
   for(const [name,val] of Object.entries({sx,sy,ex,ey}))root.style.setProperty('--finger-'+name,val+'px');
   root.dataset.gesture=task.gesture;
   write('coachGestureLabel',task.gesture==='tap'?'Encoste e solte. Sem arrastar.':'Encoste · arraste · solte');
  }
 }};
}
