import assert from 'node:assert/strict';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import {createTicketPdf,ticketDocumentData} from '../supabase/functions/_shared/event-ticket-pdf.ts';
import {deliverTicketEmail} from '../supabase/functions/_shared/event-ticket-email.ts';
const data={order:{id:'11111111-1111-4111-8111-111111111111',status:'PAID',created_at:'2026-10-07T12:00:00Z',buyer_name:'Pessoa Teste',buyer_email:'test@example.invalid'},event:{slug:'qa-halloween',event_date:'2026-10-29',content:{title:'Halloween no Ilha',scheduleLabel:'18h30 às 00h30',location:'Ilha Tênis Colatina',address:'Colatina · ES'}},items:[{ticket_type_id:'adult',name:'Integral - a partir de 15 anos'},{ticket_type_id:'child',name:'Criança - até 8 anos'}],tickets:[{attendee_name:'Maria Júlia de Assunção',attendee_age:32,ticket_type_id:'adult',code:'A'.repeat(32)},{attendee_name:'João Miguel',attendee_age:8,ticket_type_id:'child',code:'B'.repeat(32)}]};
Deno.test('PDF contains one page per attendee, deterministic bytes and blocks unpaid/refunded',async()=>{
 const pdf=await createTicketPdf(data),again=await createTicketPdf(data);
 assert.equal(pdf.base64,again.base64);assert.equal((await PDFDocument.load(pdf.base64)).getPageCount(),2);
 for(const status of ['PENDING','REFUNDED','CANCELLED','REVIEW'])await assert.rejects(()=>createTicketPdf({...data,order:{...data.order,status}}));
 await assert.rejects(()=>ticketDocumentData({} as any,{status:'PENDING'}));
 await Deno.mkdir('tmp/pdfs',{recursive:true});await Deno.writeFile('tmp/pdfs/event-tickets-qa.pdf',Uint8Array.from(atob(pdf.base64),c=>c.charCodeAt(0)));
});
Deno.test('mail retries reuse exact attachment and idempotency key; confirmed sends do not resend',async()=>{
 Deno.env.set('RESEND_API_KEY','re_fixture');Deno.env.set('EVENT_EMAIL_FROM','Ilha <test@example.invalid>');
 const job:any={order_id:data.order.id,lease_token:'lease',payload:null,status:'PENDING'};const requests:any[]=[];
 const db:any={rpc:async(name:string,args:any)=>{if(name==='event_claim_ticket_email')return {data:job.status==='SENT'?[]:[{...job}],error:null};if(name==='event_finish_ticket_email'){job.status=args.p_provider?'SENT':'FAILED';return {data:true};}throw new Error(name);},from:(table:string)=>{let update:any;const result=()=>table==='bar_event_orders'?{data:data.order}:table==='bar_ticket_events'?{data:data.event}:table==='bar_event_order_items'?{data:data.items}:table==='bar_event_tickets'?{data:data.tickets}:{data:{order_id:data.order.id}};const q:any={select:()=>q,eq:()=>q,order:()=>q,update:(value:any)=>{update=value;job.payload=value.payload;return q;},single:async()=>result(),then:(resolve:any)=>resolve(result())};return q;}};
 const send:any=async(_url:string,init:any)=>{requests.push(init);return requests.length===1?new Response('{}',{status:503}):Response.json({id:'email-fixture'});};
 await deliverTicketEmail(db,data.order.id,send);assert.equal(job.status,'FAILED');assert.ok(job.payload.attachments[0].content);
 await deliverTicketEmail(db,data.order.id,send);await deliverTicketEmail(db,data.order.id,send);
 assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);assert.equal(job.status,'SENT');
 assert.match(JSON.parse(requests[0].body).text,/confirmada/);
});
