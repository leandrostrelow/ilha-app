/* A single-person capability link; no account or payment is created here. */
(() => {
  'use strict';
  const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
  const form=document.getElementById('registration'),feedback=document.getElementById('feedback');
  const endpoint='https://lkqtgptebkgfwguykxhv.supabase.co/rest/v1/rpc/'+(token?'bar_submit_day_use_registration':'bar_submit_day_use_public_registration');
  const key='sb_publishable_zcX8te5g99p0bA12xy_E-A_MTyNpJNx';
  form.hidden=false;
  let sending=false,requestId=crypto.randomUUID(),attempt=null;
  const base='https://lkqtgptebkgfwguykxhv.supabase.co';
  async function rpc(name,payload){
    const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000),body:JSON.stringify(payload)});
    const result=await r.json();if(!r.ok||result.ok===false){const safe=['Informe seu nome completo.','Informe um telefone válido com DDD.','Cadastro indisponível. Fale com a equipe do Ilha.','Muitas tentativas. Aguarde um pouco e tente novamente.','Reabra a página para enviar o comprovante.','Envie a imagem antes de concluir.'];throw Error(safe.includes(result.message)?result.message:'Não foi possível confirmar o envio. Confira os dados e tente novamente.');}return result;
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(sending)return;
    const name=form.elements.full_name.value.trim().replace(/\s+/g,' '),phone=form.elements.phone.value;
    if(!/\S+\s+\S+/.test(name)){feedback.textContent='Informe seu nome e sobrenome.';form.elements.full_name.focus();return;}
    let digits=phone.replace(/\D/g,'');if([10,11].includes(digits.length))digits='55'+digits;
    if(!/^55[1-9][0-9]{9,10}$/.test(digits)){feedback.textContent='Confira o WhatsApp e inclua o DDD.';form.elements.phone.focus();return;}
    const proof=form.elements.proof.files[0];
    if(proof&&(!['image/jpeg','image/png','image/webp'].includes(proof.type)||proof.size>5242880||!proof.size)){feedback.textContent='Escolha uma imagem JPG, PNG ou WebP de até 5 MB.';return;}
    const fingerprint=JSON.stringify([name,digits,proof?.name,proof?.size,proof?.lastModified]);
    if(attempt&&attempt!==fingerprint)requestId=crypto.randomUUID();attempt=fingerprint;
    sending=true;feedback.textContent='Enviando…';form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
    try{
      if(proof){
        const extension={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[proof.type];
        const ticket=await rpc('bar_begin_day_use_proof',{p_request_id:requestId,p_name:name,p_phone:digits,p_extension:extension});
        if(!ticket.path)throw Error('Não foi possível preparar o envio. Tente novamente.');
        if(!ticket.uploaded){
          feedback.textContent='Enviando comprovante…';
          const upload=await fetch(base+'/storage/v1/object/day-use-proofs/'+ticket.path,{method:'POST',headers:{apikey:key,'Content-Type':proof.type,'x-upsert':'false'},body:proof,credentials:'omit',signal:AbortSignal.timeout(60000)});
          if(!upload.ok){const failed=await upload.json();if(String(failed.statusCode)!=='409'&&failed.error!=='Duplicate')throw Error('O cadastro foi recebido, mas a imagem não foi confirmada. Toque novamente em enviar para tentar o comprovante.');}
        }
        await rpc('bar_finish_day_use_proof',{p_request_id:requestId});
        form.hidden=true;feedback.className='success';feedback.textContent='Cadastro e comprovante recebidos! A equipe do Ilha vai conferir o pagamento.';history.replaceState(null,'',location.pathname);return;
      }
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
