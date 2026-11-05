import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createTicketPdf, ticketDocumentData } from './event-ticket-pdf.ts';
const config=()=>({key:(Deno.env.get('RESEND_API_KEY')||'').trim(),from:(Deno.env.get('EVENT_EMAIL_FROM')||Deno.env.get('PREDICTION_EMAIL_FROM')||'').trim(),reply:(Deno.env.get('EVENT_EMAIL_REPLY_TO')||Deno.env.get('PREDICTION_EMAIL_REPLY_TO')||'').trim()});
export function eventEmailConfigured(){const c=config();return c.key.startsWith('re_')&&c.from.length>=5;}
export async function dispatchTicketEmails(db:SupabaseClient) {
 if(!eventEmailConfigured())return {configured:false};
 const due=await db.from('bar_event_email_deliveries').select('order_id').in('status',['PENDING','FAILED','SENDING']).lte('next_attempt_at',new Date().toISOString()).order('next_attempt_at').limit(10);
 if(due.error)throw due.error;
 for(const row of due.data||[]) await deliverTicketEmail(db,row.order_id);
 return {configured:true};
}
export async function deliverTicketEmail(db:SupabaseClient,orderId:string,send:typeof fetch=fetch) {
 const c=config();if(!eventEmailConfigured())return;
 const claim=await db.rpc('event_claim_ticket_email',{p_order:orderId});if(claim.error)throw claim.error;
 const job=claim.data?.[0];if(!job)return;
 let provider:string|null=null,errorCode='delivery_error';
 try {
  const result=await db.from('bar_event_orders').select('*').eq('id',orderId).eq('status','PAID').single();
  if(result.error)throw new Error('order_not_paid');
  let payload=job.payload;
  if(!payload){
   const data=await ticketDocumentData(db,result.data),pdf=await createTicketPdf(data);
   const content=data.event.content;
   const text=`Olá, ${result.data.buyer_name}!\n\nSua compra para ${content.title} está confirmada.\n\n${String(data.event.event_date).split('-').reverse().join('/')} · ${content.scheduleLabel||content.time||''}\n${content.location||'Ilha Tênis'}\n\nOs ${data.tickets.length} ingressos estão no PDF anexo, cada um com o nome do participante e seu QR Code. Apresente o ingresso na entrada, no celular ou impresso. Cada código permite uma única entrada.\n\nGuarde este e-mail e não publique os códigos.\n\nPedido ${orderId.slice(0,8).toUpperCase()} · Ilha Bar`;
   payload={from:c.from,to:[result.data.buyer_email],subject:`Seus ingressos · ${content.title}`.slice(0,180),text,attachments:[{filename:pdf.filename,content:pdf.base64}],...(c.reply?{reply_to:c.reply}:{})};
   // Store the exact payload before calling Resend. Retries use identical content/key.
   const saved=await db.from('bar_event_email_deliveries').update({payload}).eq('order_id',orderId).eq('lease_token',job.lease_token).select('order_id').single();if(saved.error)throw saved.error;
  }
  const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json','Idempotency-Key':'ilha-event-tickets/'+orderId},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const answer=await response.json().catch(()=>({}));
  if(response.ok&&typeof answer.id==='string')provider=answer.id;
  else errorCode='provider_'+response.status;
 } catch {errorCode='delivery_or_network_error';}
 const finished=await db.rpc('event_finish_ticket_email',{p_order:orderId,p_lease:job.lease_token,p_provider:provider,p_error:provider?null:errorCode});
 if(finished.error)throw finished.error;
 return {sent:Boolean(provider)};
}
