export function ticketFile(pdf) {
 const bytes=Uint8Array.from(atob(pdf.base64),c=>c.charCodeAt(0));
 return new File([bytes],pdf.filename,{type:'application/pdf'});
}
export function downloadTicketFile(file) {
 const url=URL.createObjectURL(file),a=document.createElement('a');
 a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function confirmationMessage(order,event) {
 const c=event.content||{},date=String(event.event_date).split('-').reverse().join('/');
 return `Olá, ${order.buyer_name}! Sua compra para ${c.title} está confirmada.\n\n${date} · ${c.scheduleLabel||c.time||''}\n${c.location||'Ilha Tênis'}\n\n${order.quantity} ingresso(s) · Pedido ${order.id.slice(0,8).toUpperCase()}\nApresente o QR Code de cada participante na entrada. Cada ingresso permite uma entrada.\n\nSeus ingressos seguem no PDF.`;
}
let decoderPromise;
function loadDecoder(){
 if(window.jsQR)return Promise.resolve();
 if(!decoderPromise)decoderPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/vendor/jsQR.js';s.onload=resolve;s.onerror=()=>{decoderPromise=null;s.remove();reject(new Error('Não foi possível carregar o leitor. Use o código do ingresso.'));};document.head.append(s);});
 return decoderPromise;
}
export function createTicketScanner(video,onCode,onError) {
 let stream=null,stopped=false,frame=0,last=0;
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
 function stop(){stopped=true;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;}
 async function start(){
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Câmera indisponível. Abra o ADM no navegador ou digite o código.');
   await loadDecoder();if(stopped)return;
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(stopped){stream.getTracks().forEach(t=>t.stop());return;}
   video.srcObject=stream;await video.play();
   function scan(now){
    if(stopped)return;
    if(!video.isConnected||document.hidden){stop();return;}
    if(now-last>180&&video.readyState>=2){
     last=now;canvas.width=Math.min(640,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
     if(canvas.width&&canvas.height){context.drawImage(video,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height);const code=window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});if(code){stop();onCode(code.data);return;}}
    }
    frame=requestAnimationFrame(scan);
   }
   frame=requestAnimationFrame(scan);
  }catch(error){const cancelled=stopped;stop();if(!cancelled)onError(error.name==='NotAllowedError'?'Permita a câmera no navegador ou digite o código abaixo.':error.message);}
 }
 return {start,stop};
}
