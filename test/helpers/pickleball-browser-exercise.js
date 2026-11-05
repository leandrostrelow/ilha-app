(async () => {
  if (typeof document==='undefined') return;
  if(location.hostname!=='127.0.0.1')throw new Error('Local fixture only');
  const set=(element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));};
  const payer={full_name:'Teste responsável',cpf:'12345678909',phone:'27999999999',email:'local@example.invalid'};
  for(const [key,value] of Object.entries(payer))set(document.querySelector(`[name="${key}"]`),value);
  for(const [label,names] of [['Duplas Masculinas',['Teste Criança A','Teste Adulto B']],['Duplas Mistas',['Teste Criança A','Teste Adulta C']],['Simples Masculina',['Teste Criança A']],['Simples Infantil · até 9 anos',['Teste Criança A']]]){
    const el=Array.from(document.querySelectorAll('.pb-category')).find((e)=>e.querySelector('span').textContent===label);
    el.querySelector('input').click();Array.from(el.querySelectorAll('[data-member-name]')).forEach((input,i)=>set(input,names[i]));
  }
  set(document.querySelector('[data-birth-name]'),'2017-01-01');
  const summary=document.getElementById('summary').innerText;
  if(!summary.includes('200,00'))throw new Error('Wrong frontend estimate: '+summary);
  if(document.querySelectorAll('[data-birth-name]').length!==1)throw new Error('Birth date should appear only once for the child');
  document.getElementById('terms').click();
  document.getElementById('packageForm').requestSubmit();
  for(let i=0;i<50&&!window.__lastPackagePayload;i++)await new Promise((r)=>setTimeout(r,30));
  if(window.__lastPackagePayload?.entries.length!==4)throw new Error('Checkout DTO not sent');
  if(window.__lastPackagePayload.athletes.some((a)=>a.cpf))throw new Error('Unexpected participant CPF');
  return {summary,entries:window.__lastPackagePayload.entries.length,athletes:window.__lastPackagePayload.athletes.length,overflow:document.documentElement.scrollWidth>innerWidth};
})();
