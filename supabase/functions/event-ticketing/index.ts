import "jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { appCorsHeaders } from "../_shared/cors.ts";
import { storeProvider, storeProviderConfig, type StoreRecord } from "../_shared/store-payment.ts";
import { reconcileEventPayment } from "../_shared/event-payment.ts";
import { UUID, validateEventCheckout, safeEventOrder } from "../_shared/event-tickets.js";
import { createTicketPdf, ticketDocumentData } from "../_shared/event-ticket-pdf.ts";
import { dispatchTicketEmails, eventEmailConfigured } from "../_shared/event-ticket-email.ts";

class RequestError extends Error { constructor(message: string, public status=400) { super(message); } }
function secretKey() {
  const keys=Deno.env.get("SUPABASE_SECRET_KEYS")||"";
  try { return JSON.parse(keys).default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; }
  catch { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (keys.startsWith("sb_secret_")?keys:""); }
}
async function hash(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,"0")).join(""); }
function readiness() {
  let environment=""; try { environment=storeProviderConfig().environment; } catch { /* shown in ADM */ }
  const webhook=(Deno.env.get("ASAAS_WEBHOOK_TOKEN")||"").length>=32;
  const captcha=Boolean(Deno.env.get("TURNSTILE_SITE_KEY") && Deno.env.get("TURNSTILE_SECRET_KEY") && Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES"));
  return { configured:environment==="PRODUCTION" && webhook && captcha,environment,webhook,captcha,email:eventEmailConfigured(),method:"Pix Asaas" };
}
async function rate(db:SupabaseClient,key:string,limit:number,seconds:number) {
  const {data,error}=await db.rpc("event_take_rate_limit",{p_key:key,p_limit:limit,p_seconds:seconds});
  if(error) throw new RequestError("Serviço temporariamente indisponível.",503);
  if(data!==true) throw new RequestError("Muitas tentativas. Aguarde um momento e tente novamente.",429);
}
async function captcha(request:Request,token:string) {
  const form=new FormData();form.set("secret",Deno.env.get("TURNSTILE_SECRET_KEY")||"");form.set("response",token);
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();if(ip)form.set("remoteip",ip);
  const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form,signal:AbortSignal.timeout(8000)});
  const result=await response.json();
  const hosts=(Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES")||"").split(",").map(v=>v.trim().toLowerCase());
  if(!result.success || result.action!=="event_tickets" || !hosts.includes(String(result.hostname||"").toLowerCase())) throw new RequestError("Confirme a verificação de segurança novamente.");
}
async function snapshot(db:SupabaseClient,order:StoreRecord) {
  const [items,tickets,event]=await Promise.all([
    db.from("bar_event_order_items").select("ticket_type_id,name,unit_cents,quantity").eq("order_id",order.id),
    db.from("bar_event_tickets").select(order.status==="PAID"?"id,attendee_name,attendee_age,code,checked_in_at,ticket_type_id":"id,attendee_name,attendee_age,ticket_type_id").eq("order_id",order.id),
    db.from("bar_ticket_events").select("slug,event_date,content").eq("id",order.event_id).single(),
  ]);
  if(items.error||tickets.error||event.error)throw new Error("Não foi possível carregar o pedido.");
  const email=await db.from("bar_event_email_deliveries").select("status,sent_at,error_code").eq("order_id",order.id).maybeSingle();
  if(email.error)throw new Error("Não foi possível conferir o envio dos ingressos.");
  return {order:safeEventOrder(order),items:items.data,tickets:tickets.data,event:event.data,email:{status:!eventEmailConfigured()?"NOT_CONFIGURED":email.data?.status||"WAITING_PAYMENT",sent_at:email.data?.sent_at||null}};
}
async function paymentFor(order:StoreRecord) {
  if(order.provider_payment_id)return await storeProvider(`/payments/${encodeURIComponent(order.provider_payment_id)}`);
  const lookup=await storeProvider(`/payments?externalReference=${encodeURIComponent("ilha-event:"+order.id)}&limit=2`);
  if((lookup.data||[]).length>1)throw new Error("Mais de uma cobrança encontrada. Procure a organização.");
  return lookup.data?.[0];
}
async function ensurePayment(db:SupabaseClient,order:StoreRecord,create:boolean) {
  // Free tickets are confirmed by the reservation transaction; never call Asaas for R$ 0.
  if(order.total_cents===0)return order;
  if(order.provider_environment!==storeProviderConfig().environment)throw new Error("Pedido de outro ambiente de pagamento.");
  let payment=await paymentFor(order);
  if(!payment && create && !order.payment_attempted_at && order.status==="CREATED") {
    const lookup=await storeProvider(`/customers?cpfCnpj=${encodeURIComponent(order.buyer_cpf)}&limit=1`);
    let customer=lookup.data?.[0]?.id;
    if(!customer)customer=(await storeProvider("/customers","POST",{name:order.buyer_name,cpfCnpj:order.buyer_cpf,email:order.buyer_email,mobilePhone:order.buyer_phone,notificationDisabled:true})).id;
    if(!customer)throw new Error("Não foi possível preparar o pagamento.");
    // Claim before the financial POST. An uncertain response is recovered by reference, never posted twice.
    const claim=await db.from("bar_event_orders").update({payment_attempted_at:new Date().toISOString()}).eq("id",order.id).is("payment_attempted_at",null).eq("status","CREATED").select("id").maybeSingle();
    if(claim.error)throw claim.error;
    if(claim.data){
      const event=await db.from("bar_ticket_events").select("content").eq("id",order.event_id).single();
      const dueDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      payment=await storeProvider("/payments","POST",{customer,billingType:"PIX",value:order.total_cents/100,dueDate,externalReference:"ilha-event:"+order.id,description:`${event.data?.content?.title||"Evento Ilha"} · ${order.quantity} ingresso(s)`.slice(0,500),interest:{value:0},fine:{value:0}});
    }
  }
  if(payment)order=await reconcileEventPayment(db,order,payment);
  if(payment && ["CREATED","PENDING"].includes(order.status) && !order.pix_payload){
    const pix=await storeProvider(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`);
    if(typeof pix.payload!=="string"||typeof pix.encodedImage!=="string"||!/^[A-Za-z0-9+/=]+$/.test(pix.encodedImage))throw new Error("O Pix está sendo preparado. Atualize este pedido.");
    const updated=await db.from("bar_event_orders").update({pix_payload:pix.payload,pix_image:pix.encodedImage,pix_expires_at:pix.expirationDate}).eq("id",order.id).in("status",["CREATED","PENDING"]).select("*").maybeSingle();
    if(updated.error)throw updated.error;if(updated.data)order=updated.data;
  }
  return order;
}

Deno.serve(async(request)=>{
  const headers={...appCorsHeaders(request,"POST, OPTIONS"),"Content-Type":"application/json","Cache-Control":"no-store"};
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.headers.get("origin")&&headers["Access-Control-Allow-Origin"]==="null")return json({error:"Origem não autorizada."},403);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST")return json({error:"Método inválido."},405);
  let reservedId="";
  try{
    const raw=await request.text();if(raw.length>50000)throw new RequestError("Dados muito grandes.",413);
    const body=JSON.parse(raw);const action=String(body.action||"");
    const url=Deno.env.get("SUPABASE_URL")||"";const secret=secretKey();
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==="dispatch_emails"){
      const allowed=await db.rpc("event_email_dispatch_allowed",{p_token:request.headers.get("x-event-dispatch-token")||""});
      if(allowed.error||allowed.data!==true)throw new RequestError("Não autorizado.",403);
      (globalThis as unknown as {EdgeRuntime:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime.waitUntil(dispatchTicketEmails(db).catch(()=>console.error("event_ticket_email_dispatch_failed")));
      return json({queued:true},202);
    }
    const publicActions=["public","create","status","cancel","pdf"];
    if(publicActions.includes(action)){
      const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
      await rate(db,await hash(secret+":events:"+action+":"+ip),action==="create"?8:90,action==="create"?3600:60);
      if(action==="public"){
        const slug=String(body.slug||"");if(!/^[a-z0-9-]{1,90}$/.test(slug))throw new RequestError("Evento não encontrado.",404);
        const event=await db.from("bar_ticket_events").select("id,slug,event_date,status,content,sales_state,max_per_order,capacity_total").eq("slug",slug).eq("status","PUBLICADO").maybeSingle();
        if(event.error||!event.data)throw new RequestError("Evento não encontrado.",404);
        const [types,inventory]=await Promise.all([db.from("bar_event_ticket_types").select("id,name,description,price_cents,capacity,sales_start,sales_end,sort_order,min_age,max_age,purchase_step").eq("event_id",event.data.id).eq("active",true).order("sort_order"),db.rpc("event_inventory",{p_event:event.data.id})]);
        if(types.error||inventory.error)throw new Error("Não foi possível carregar os ingressos.");
        const occupied=(inventory.data||[]).reduce((n:number,s:StoreRecord)=>n+Number(s.sold||0)+Number(s.held||0),0);
        const remaining=event.data.capacity_total===null?null:Math.max(0,event.data.capacity_total-occupied);
        const lots=(types.data||[]).map(t=>{const stock=(inventory.data||[]).find((s:StoreRecord)=>s.ticket_type_id===t.id);const available=t.capacity===null?null:Math.max(0,t.capacity-Number(stock?.sold||0)-Number(stock?.held||0));return {...t,remaining:remaining===null?available:available===null?remaining:Math.min(remaining,available)};});
        return json({event:{...event.data,remaining},lots,payment_ready:readiness().configured,email_ready:eventEmailConfigured(),captcha_site_key:Deno.env.get("TURNSTILE_SITE_KEY")||""});
      }
      if(action==="create"){
        if(!readiness().configured)throw new RequestError("As vendas serão abertas em breve.",503);
        const checked=validateEventCheckout(body);
        await captcha(request,String(body.captcha_token||""));
        await rate(db,await hash(secret+":event-buyer:"+checked.buyer.cpf),5,3600);
        const {data,error}=await db.rpc("event_reserve_order",{p_slug:body.slug,p_request:body.request_id,p_token_hash:await hash(body.access_token),p_request_hash:await hash(JSON.stringify(checked)),p_buyer:checked.buyer,p_items:checked.items,p_attendees:checked.attendees,p_environment:storeProviderConfig().environment});
        if(error)throw error;let order=Array.isArray(data)?data[0]:data;reservedId=order.id;
        order=await ensurePayment(db,order,true);return json(await snapshot(db,order));
      }
      if((!UUID.test(body.order_id||"")&&!UUID.test(body.request_id||""))||!/^[a-f0-9]{64}$/.test(body.access_token||""))throw new RequestError("Link do pedido inválido.",404);
      const found=await db.from("bar_event_orders").select("*").eq(body.order_id?"id":"request_id",body.order_id||body.request_id).eq("access_token_hash",await hash(body.access_token)).maybeSingle();
      if(found.error||!found.data)throw new RequestError("Pedido não encontrado.",404);
      let order=found.data;
      if(action==="pdf")return json(await createTicketPdf(await ticketDocumentData(db,order)));
      if(body.provider_check===true||action==="cancel"){
        await rate(db,await hash("event-provider:"+order.id),6,60);
        order=await ensurePayment(db,order,false);
      }
      if(action==="cancel"){
        if(!["CREATED","PENDING"].includes(order.status))throw new RequestError("Este pedido não pode ser cancelado aqui. Fale com a organização.");
        if(order.provider_payment_id){
          const deleted=await storeProvider(`/payments/${encodeURIComponent(order.provider_payment_id)}`,"DELETE");
          if(deleted.deleted!==true)throw new Error("O cancelamento ainda não foi confirmado.");
          order=await reconcileEventPayment(db,order,{id:order.provider_payment_id,value:order.total_cents/100,externalReference:"ilha-event:"+order.id,billingType:"PIX",deleted:true});
        }else{
          const updated=await db.from("bar_event_orders").update({status:"CANCELLED",updated_at:new Date().toISOString()}).eq("id",order.id).eq("status","CREATED").is("payment_attempted_at",null).select("*").maybeSingle();
          if(updated.error||!updated.data)throw new Error("O Asaas ainda está processando. Consulte novamente antes de cancelar.");order=updated.data;
        }
      }
      return json(await snapshot(db,order));
    }

    const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    const userDb=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")||secret,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
    const auth=await userDb.auth.getUser(token);if(auth.error||!auth.data.user)throw new RequestError("Entre no ADM para continuar.",401);
    const permission=await userDb.rpc("has_bar_permission",{p_permission:"bar.events"});
    if(permission.error||permission.data!==true)throw new RequestError("Seu acesso não permite gerenciar eventos.",403);
    if(action==="events"){
      const events=await userDb.from("bar_ticket_events").select("*").order("event_date",{ascending:false});if(events.error)throw events.error;
      return json({events:events.data,readiness:readiness()});
    }
    if(action==="save"){
      const event=body.event||{};const c=event.content||{};
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug||"")||String(event.slug).length>90||!/^\d{4}-\d{2}-\d{2}$/.test(event.event_date||"")||String(c.title||"").trim().length<3)throw new RequestError("Preencha nome, data e link do evento.");
      if(JSON.stringify(c).length>35000||!Array.isArray(body.lots)||body.lots.some((l:StoreRecord)=>l.price_cents!==null&&l.price_cents!==undefined&&(!Number.isInteger(l.price_cents)||l.price_cents<0||l.price_cents>10000000)))throw new RequestError("Revise o conteúdo e os valores dos lotes.");
      const saved=await userDb.rpc("event_save",{p_event:event,p_types:body.lots});if(saved.error)throw saved.error;
      return json({id:saved.data});
    }
    if(!UUID.test(body.event_id||""))throw new RequestError("Selecione um evento.");
    const eventResult=await userDb.from("bar_ticket_events").select("*").eq("id",body.event_id).single();if(eventResult.error)throw eventResult.error;const event=eventResult.data;
    if(action==="detail"){
      const [lots,inventory,metrics,activity]=await Promise.all([
        userDb.from("bar_event_ticket_types").select("*").eq("event_id",event.id).order("sort_order"),
        db.rpc("event_inventory",{p_event:event.id}),
        db.rpc("event_metrics",{p_event:event.id}),
        userDb.from("bar_event_activity").select("id,kind,detail,created_at").eq("event_id",event.id).order("created_at",{ascending:false}).limit(8),
      ]);
      if(lots.error||inventory.error||metrics.error||activity.error)throw new Error("Não foi possível carregar o resumo.");
      return json({event,lots:lots.data,inventory:inventory.data,activity:activity.data,readiness:readiness(),metrics:{...metrics.data,checked_in:(inventory.data||[]).reduce((n:number,i:StoreRecord)=>n+Number(i.checked_in),0)}});
    }
    if(action==="publish"||action==="sales"){
      let changes:StoreRecord={updated_at:new Date().toISOString()};
      if(action==="publish")changes={...changes,status:body.published===false?"RASCUNHO":"PUBLICADO",...(body.published===false?{sales_state:"CLOSED"}:{published_at:event.published_at||new Date().toISOString()})};
      else {
        if(body.open===true){
          const lots=await db.from("bar_event_ticket_types").select("price_cents,capacity").eq("event_id",event.id).eq("active",true);
          if(!readiness().configured)throw new RequestError("Confira a configuração do Asaas e da verificação de segurança na aba Pagamentos.");
          if(event.status!=="PUBLICADO"||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(event.content.time||"")||!event.content.location||!lots.data?.length||lots.data.some(l=>l.price_cents===null))throw new RequestError("Publique a página e defina horário, local, preço dos lotes ativos.");
        }
        changes.sales_state=body.open===true?"OPEN":"CLOSED";
      }
      const updated=await userDb.from("bar_ticket_events").update(changes).eq("id",event.id).select("*").single();if(updated.error)throw updated.error;return json({event:updated.data});
    }
    if(action==="orders"){
      const page=Math.max(0,Math.min(10000,Math.floor(Number(body.page)||0)));const search=String(body.search||"").replace(/[^\p{L}\p{N} @._-]/gu,"").slice(0,100);
      let query=userDb.from("bar_event_orders").select("id,buyer_name,buyer_email,buyer_phone,status,total_cents,quantity,created_at,paid_at,provider_status",{count:"exact"}).eq("event_id",event.id);
      if(search)query=query.or(`buyer_name.ilike.%${search}%,buyer_email.ilike.%${search}%,buyer_phone.ilike.%${search}%`);
      if(["CREATED","PENDING","PAID","CANCELLED","REFUNDED","REVIEW"].includes(body.status))query=query.eq("status",body.status);
      const result=await query.order("created_at",{ascending:false}).range(page*50,page*50+49);if(result.error)throw result.error;return json({orders:result.data,total:result.count});
    }
    if(action==="order"||action==="reconcile"||action==="admin_pdf"){
      const result=await db.from("bar_event_orders").select("*").eq("id",body.order_id).eq("event_id",event.id).single();if(result.error)throw new RequestError("Pedido não encontrado.",404);
      const order=action==="reconcile"?await ensurePayment(db,result.data,false):result.data;
      if(action==="admin_pdf")return json(await createTicketPdf(await ticketDocumentData(db,order)));
      return json(await snapshot(db,order));
    }
    if(action==="guests"){
      const page=Math.max(0,Math.floor(Number(body.page)||0));
      const result=await userDb.from("bar_event_tickets").select("id,attendee_name,attendee_age,code,checked_in_at,bar_event_orders!inner(event_id,status),bar_event_ticket_types(name)",{count:"exact"}).eq("bar_event_orders.event_id",event.id).eq("bar_event_orders.status","PAID").order("attendee_name").range(page*100,page*100+99);
      if(result.error)throw result.error;return json({guests:result.data,total:result.count});
    }
    if(action==="ticket_preview"){
      const code=String(body.code||"").trim().replace(/^ILHA-EVENT:/i,"").toUpperCase();
      if(!/^[A-F0-9]{32}$/.test(code))throw new RequestError("Código de ingresso inválido.");
      const result=await userDb.from("bar_event_tickets").select("attendee_name,attendee_age,code,checked_in_at,bar_event_orders!inner(event_id,status),bar_event_ticket_types(name)").eq("code",code).eq("bar_event_orders.event_id",event.id).maybeSingle();
      if(result.error||!result.data)throw new RequestError("Ingresso não encontrado neste evento.",404);
      if((result.data.bar_event_orders as unknown as StoreRecord).status!=="PAID")throw new RequestError("Ingresso sem pagamento confirmado ou cancelado.");
      return json({ticket:result.data});
    }
    if(action==="checkin"){
      const result=await userDb.rpc("event_checkin",{p_event:event.id,p_code:String(body.code||"").trim()});if(result.error)throw result.error;return json(result.data);
    }
    throw new RequestError("Ação inválida.");
  }catch(error){
    const message=error instanceof Error?error.message:(error as StoreRecord)?.message||"Não foi possível concluir. Tente novamente.";
    return json({error:message,order_id:reservedId||undefined},error instanceof RequestError?error.status:400);
  }
});
