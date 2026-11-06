import {recordHistoricalMonthlyReceipt} from '../supabase/functions/_shared/historical-monthly-receipt.ts';
const id='78000000-0000-4000-8000-000000000001';
const body={action:'historical_receipt',clientId:id,invoiceMonth:'2020-10-01',amount:230,dueDate:'2020-10-05',receivedOn:'2020-10-06',reason:'Pix histórico confirmado'};
Deno.test('Historical receipt forwards the real dates and amount without a provider request',async()=>{
  let called=false;
  await recordHistoricalMonthlyReceipt(body,id,(name,args)=>{
    if(name!=='record_historical_club_monthly_receipt' || args.p_amount!==230 || args.p_received_on!=='2020-10-06' || args.p_actor_id!==id) throw new Error('Incorrect accounting');
    called=true;return Promise.resolve({data:{state:'COMPLETED'},error:null});
  });
  if(!called) throw new Error('Not recorded');
});
Deno.test('Historical receipt rejects provider IDs and missing dates',async()=>{
  for(const request of [{...body,providerId:'other'},{...body,receivedOn:''}]) {
    let called=false,rejected=false;
    try {await recordHistoricalMonthlyReceipt(request,id,()=>{called=true;return Promise.resolve({data:{},error:null});});}catch{rejected=true;}
    if(called || !rejected)throw new Error('Invalid input accepted');
  }
});
