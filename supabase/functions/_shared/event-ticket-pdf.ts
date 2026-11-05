import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import qrcode from 'npm:qrcode-generator@1.4.4';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
type Row = Record<string, any>;
// WinAnsi contains Portuguese accents; unsupported decorative symbols are omitted.
const clean = (v: unknown) => String(v ?? '').normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, ' ').trim();
export async function ticketDocumentData(db: SupabaseClient, order: Row) {
 if(order.status !== 'PAID') throw new Error('Os ingressos ficam disponíveis após a confirmação do pagamento.');
 const [event,items,tickets] = await Promise.all([
  db.from('bar_ticket_events').select('slug,event_date,content').eq('id',order.event_id).single(),
  db.from('bar_event_order_items').select('ticket_type_id,name,unit_cents').eq('order_id',order.id),
  db.from('bar_event_tickets').select('attendee_name,attendee_age,ticket_type_id,code').eq('order_id',order.id).order('created_at').order('id'),
 ]);
 if(event.error||items.error||tickets.error||!tickets.data?.length)throw new Error('Não foi possível preparar os ingressos.');
 return {order,event:event.data,items:items.data,tickets:tickets.data};
}
export async function createTicketPdf(data: {order:Row,event:Row,items:Row[],tickets:Row[]}) {
 if(data.order.status !== 'PAID')throw new Error('Pagamento não confirmado.');
 const pdf=await PDFDocument.create();
 // Stable metadata also keeps repeated requests deterministic.
 pdf.setCreationDate(new Date(data.order.created_at));pdf.setModificationDate(new Date(data.order.created_at));
 pdf.setTitle(clean(data.event.content.title)+' - Ingressos');pdf.setAuthor('Ilha Bar');
 const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.06,.14,.12),orange=rgb(1,.60,.24),cream=rgb(.97,.95,.89);
 for(const [index,t] of data.tickets.entries()) {
  const page=pdf.addPage([420,595]);
  const text=(value:unknown,x:number,y:number,size=11,strong=false,width=348)=>{
   const font=strong?bold:normal;let str=clean(value);while(str&&font.widthOfTextAtSize(str,size)>width&&size>8)size-=.25;
   while(str&&font.widthOfTextAtSize(str,size)>width)str=str.slice(0,-1);page.drawText(str,{x,y,size,font,color:ink});
  };
  page.drawRectangle({x:0,y:0,width:420,height:595,color:cream});
  page.drawRectangle({x:0,y:481,width:420,height:114,color:ink});
  page.drawText('ILHA BAR  /  INGRESSO DIGITAL',{x:30,y:562,size:10,font:bold,color:orange});
  let titleSize=23;const title=clean(data.event.content.title);while(bold.widthOfTextAtSize(title,titleSize)>360&&titleSize>9)titleSize-=.5;
  page.drawText(title,{x:30,y:520,size:titleSize,font:bold,color:cream});
  const date=String(data.event.event_date).split('-').reverse().join('/');
  text(date+'  |  '+(data.event.content.scheduleLabel||data.event.content.time||''),30,454,13,true);
  text(data.event.content.location||'Ilha Tênis',30,433,11);
  if(data.event.content.address)text(data.event.content.address,30,416,9);
  text('PARTICIPANTE',30,382,9,true);
  text(t.attendee_name,30,357,21,true);
  const item=data.items.find(i=>i.ticket_type_id===t.ticket_type_id);
  text((item?.name||'Ingresso')+(t.attendee_age!=null?'  |  '+t.attendee_age+' anos':''),30,334,11);
  const qr=qrcode(0,'M');qr.addData('ILHA-EVENT:'+t.code);qr.make();
  const n=qr.getModuleCount(),cell=168/(n+8),left=126,top=310;
  page.drawRectangle({x:left,y:top-168,width:168,height:168,color:rgb(1,1,1)});
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))page.drawRectangle({x:left+(c+4)*cell,y:top-(r+5)*cell,width:cell+.015,height:cell+.015,color:rgb(0,0,0)});
  text(t.code,55,122,10,true,310);
  text('Apresente este QR Code na entrada. Uso único por pessoa.',30,98,10);
  text('Não publique ou compartilhe o código fora do seu grupo.',30,82,9);
  page.drawLine({start:{x:30,y:65},end:{x:390,y:65},thickness:1,color:orange});
  text('Pedido '+String(data.order.id).slice(0,8).toUpperCase(),30,43,9,true);
  text((index+1)+' / '+data.tickets.length,345,43,9,true,45);
 }
 return {filename:'ingressos-'+data.event.slug+'-'+String(data.order.id).slice(0,8)+'.pdf',base64:await pdf.saveAsBase64()};
}
