/* A single-person capability link; no account or payment is created here. */
(() => {
  'use strict';
  const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
  const form=document.getElementById('registration'),feedback=document.getElementById('feedback');
  const endpoint='https://lkqtgptebkgfwguykxhv.supabase.co/rest/v1/rpc/'+(token?'bar_submit_day_use_registration':'bar_submit_day_use_public_registration');
  const key='sb_publishable_zcX8te5g99p0bA12xy_E-A_MTyNpJNx';
  form.hidden=false;
  let sending=false;
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(sending)return;
    const name=form.elements.full_name.value.trim().replace(/\s+/g,' '),phone=form.elements.phone.value;
    if(!/\S+\s+\S+/.test(name)){feedback.textContent='Informe seu nome e sobrenome.';form.elements.full_name.focus();return;}
    let digits=phone.replace(/\D/g,'');if([10,11].includes(digits.length))digits='55'+digits;
    if(!/^55[1-9][0-9]{9,10}$/.test(digits)){feedback.textContent='Confira o WhatsApp e inclua o DDD.';form.elements.phone.focus();return;}
    sending=true;feedback.textContent='Enviando…';form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000),body:JSON.stringify({...token?{p_token:token}:{},p_name:name,p_phone:digits})});
      const result=await response.json();
      if(!response.ok||result.ok!==true){
        const safe=['Link inválido ou expirado. Peça um novo link ao Ilha.','Este link já foi utilizado. Peça um novo link ao Ilha.','Informe seu nome completo.','Informe um telefone válido com DDD.','Não foi possível concluir. Fale com a equipe do Ilha.'];
        throw Error(safe.includes(result.message)?result.message:'Não foi possível confirmar o cadastro. Tente novamente neste mesmo link.');
      }
      form.hidden=true;feedback.className='success';feedback.textContent='Cadastro recebido! Combine o pagamento com a equipe do Ilha para liberar seu Day Use.';
      history.replaceState(null,'',location.pathname);
    }catch(error){feedback.textContent=error.name==='TimeoutError'?'A conexão demorou. Tente novamente neste mesmo link.':error.name==='TypeError'?'Confira sua conexão e tente novamente neste mesmo link.':error.message;}
    finally{sending=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
  });
})();
