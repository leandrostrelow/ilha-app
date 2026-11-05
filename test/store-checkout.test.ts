import assert from 'node:assert/strict';

Deno.test('real Edge handler: one Pix for a cart, guest/registered flows, idempotent retries and authorization', async () => {
  const originalFetch=globalThis.fetch, originalServe=Deno.serve;
  const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEYS','SUPABASE_ANON_KEY','ASAAS_BASE_URL','ASAAS_API_KEY','ASAAS_PIX_ADDRESS_KEY'];
  const previous=new Map(names.map(name=>[name,Deno.env.get(name)]));
  let handler: (r:Request)=>Promise<Response>;
  const user='11111111-1111-4111-8111-111111111111',jacket='22222222-2222-4222-8222-222222222222',shirt='33333333-3333-4333-8333-333333333333';
  let staff=true, order:Record<string,any>|null=null, payment:Record<string,any>|null=null;
  let staticFailure: ''|'length'|'other'|'server'|'timeout' = '';
  const posts: {path:string;body:any}[]=[],reserves:any[]=[];
  const rows=[{product_id:jacket,product_name:'Jaqueta M',quantity:1,unit_price:150.50,total:150.50},
    {product_id:shirt,product_name:'Camisa G',quantity:2,unit_price:60,total:120}];
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  try{
    Deno.env.set('SUPABASE_URL','https://fixture.supabase.co');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','not-a-real-key');
    Deno.env.set('SUPABASE_SECRET_KEYS','');Deno.env.set('SUPABASE_ANON_KEY','not-a-real-key');
    Deno.env.set('ASAAS_BASE_URL','https://api-sandbox.asaas.com/v3');Deno.env.set('ASAAS_API_KEY','$aact_hmlg_fixture');
    Deno.env.set('ASAAS_PIX_ADDRESS_KEY','fixture-only');
    // Every fetch is intercepted; no network or payment can leave this test.
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      const path=url.pathname,method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):{};
      if(path==='/auth/v1/user')return json({id:user,email:'fixture@example.invalid'});
      if(path==='/rest/v1/rpc/has_club_permission')return json(staff);
      if(path==='/rest/v1/app_clients')return json({full_name:'Cliente Teste',cpf:'52998224725'});
      if(path==='/rest/v1/rpc/store_reserve_cart'){
        reserves.push(body);
        if(!order)order={id:crypto.randomUUID(),client_id:body.p_client,customer_name:body.p_name,created_by:user,quantity:3,total:270.50,
          status:'CREATED',provider_environment:'SANDBOX',payment_flow:body.p_client?'CHARGE':'STATIC_QR',source:body.p_source};
        return json(order);
      }
      if(path==='/rest/v1/app_store_order_items')return json(rows);
      if(path==='/rest/v1/app_store_orders'){
        if(method==='PATCH'){Object.assign(order!,body);return json(body.payment_attempted_at?{id:order!.id}:order);}
        return json(order);
      }
      if(path==='/rest/v1/rpc/store_attach_static_qr'){
        Object.assign(order!,{provider_qr_code_id:body.p_qr_code,pix_payload:body.p_payload,pix_image:body.p_image,status:'PENDING'});return json(order);
      }
      if(path==='/rest/v1/rpc/store_reconcile_payment'){
        assert.equal(body.p_amount,270.50);Object.assign(order!,{provider_payment_id:body.p_payment,status:'PENDING'});return json(order);
      }
      if(url.hostname==='api-sandbox.asaas.com'){
        if(method==='POST')posts.push({path,body});
        if(path==='/v3/pix/qrCodes/static'){
          assert.ok(new TextEncoder().encode(body.description).length<=37,'Asaas static description limit');
          if(staticFailure==='timeout')throw new DOMException('Mock timeout','TimeoutError');
          if(staticFailure==='server')return json({errors:[{code:'server_error'}]},500);
          if(staticFailure==='other')return json({errors:[{code:'invalid_action',description:'An unrelated rejection'}]},400);
          if(staticFailure==='length')return json({errors:[{code:'invalid_action',description:'A descrição deste QR Code não deve ultrapassar 37 caracteres.'}]},400);
          return json({id:'qr_fixture',payload:'PIX-FICTICIO',encodedImage:'aW1hZ2U='});
        }
        if(path==='/v3/customers')return json({data:[{id:'cus_fixture'}]});
        if(path==='/v3/payments'&&method==='POST'){
          payment={id:'pay_fixture',billingType:'PIX',status:'PENDING',value:body.value,externalReference:body.externalReference};return json(payment);
        }
        if(path.endsWith('/pixQrCode'))return json({payload:'PIX-FICTICIO',encodedImage:'aW1hZ2U='});
        if(path==='/v3/payments/pay_fixture')return json(payment);
        if(path==='/v3/payments')return json({data:payment?[payment]:[]});
      }
      throw Error('Unexpected mocked route '+method+' '+url.href);
    };
    Deno.serve=((callback:any)=>{handler=callback;return{};}) as typeof Deno.serve;
    await import('../supabase/functions/store-checkout/index.ts');
    const send=async(body:any,token=true)=>handler(new Request('http://fixture/store-checkout',{method:'POST',
      headers:token?{Authorization:'Bearer fixture-token'}:{},body:JSON.stringify(body)}));
    const body={action:'create',request_id:crypto.randomUUID(),source:'PRESENCIAL',customer_name:'Comprador Teste',
      total:1,items:rows.map(i=>({product_id:i.product_id,quantity:i.quantity,price:0.01}))};
    assert.equal((await send(body,false)).status,401);
    staff=false;assert.equal((await send(body)).status,403);assert.equal(reserves.length,0);staff=true;
    assert.equal((await send({...body,items:[]})).status,400);
    let response=await send(body);let data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.order.items.length,2);assert.equal(data.order.total,270.50);assert.equal(posts.length,1);
    assert.equal(posts[0].path,'/v3/pix/qrCodes/static');assert.equal(posts[0].body.value,270.50);
    assert.equal(posts[0].body.allowsMultiplePayments,false);assert.equal(posts[0].body.description,'Ilha Store - '+data.order.id.slice(0,8));
    assert.deepEqual(reserves[0].p_items,rows.map(i=>({product_id:i.product_id,quantity:i.quantity})));
    response=await send(body);assert.equal(response.status,200);assert.equal(posts.length,1,'repeat must not create another QR');
    order=null;payment=null;posts.length=0;
    response=await send({...body,request_id:crypto.randomUUID(),client_id:user});data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.order.items.length,2);
    assert.equal(posts.length,1);assert.equal(posts[0].path,'/v3/payments');assert.equal(posts[0].body.value,270.50);
    assert.match(posts[0].body.description,/Jaqueta M.*Camisa G/,'registered charges keep item descriptions');
    assert.equal(data.order.pix_payload,'PIX-FICTICIO');

    // Reproduce the production validation rejection, then recover the SAME
    // reservation via the existing manual Consultar pedido button.
    order=null;payment=null;posts.length=0;staticFailure='length';
    response=await send({...body,request_id:crypto.randomUUID()});data=await response.json();
    assert.equal(response.status,400);assert.equal(data.order_id,order!.id);
    assert.equal(order!.payment_attempted_at,null,'only explicit rejection unlocks retry');
    const rejectedId=order!.id,reserveCount=reserves.length;
    staticFailure='';
    response=await send({action:'status',order_id:rejectedId,provider_check:false});
    assert.equal(posts.length,1,'background polling cannot create a QR');
    response=await send({action:'status',order_id:rejectedId,provider_check:true});data=await response.json();
    assert.equal(response.status,200);assert.equal(data.order.id,rejectedId);assert.equal(data.order.pix_payload,'PIX-FICTICIO');
    assert.equal(reserves.length,reserveCount,'recovery cannot reserve stock again');assert.equal(posts.length,2);
    response=await send({action:'status',order_id:rejectedId,provider_check:true});
    assert.equal(response.status,200);assert.equal(posts.length,2,'repeated consultation cannot issue another QR');
    for(const failure of ['other','server','timeout'] as const){
      order=null;payment=null;posts.length=0;staticFailure=failure;
      response=await send({...body,request_id:crypto.randomUUID()});assert.equal(response.status,400);
      assert.ok(order!.payment_attempted_at,'ambiguous/unknown failures keep the claim');
      staticFailure='';
      response=await send({action:'status',order_id:order!.id,provider_check:true});
      assert.equal(response.status,200);assert.equal(posts.length,1,'never retry an uncertain POST');
    }
  }finally{
    globalThis.fetch=originalFetch;Deno.serve=originalServe;
    for(const [name,value]of previous)value===undefined?Deno.env.delete(name):Deno.env.set(name,value);
  }
});
