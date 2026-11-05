import {ABANDONED_COURT,hash} from './scenery-data.js';

// Static, seeded pixel scenery. The optional quick match keeps the worn surface.
export function drawAbandonedCourt(c){
 const {x,y,w,h}=ABANDONED_COURT;
 c.save();c.fillStyle='#384039';c.fillRect(x-3,y-3,w+6,h+6);
 c.fillStyle='#494c49';c.fillRect(x,y,w,h);
 for(let i=0;i<700;i++){
  const px=x+hash(i,10)%w,py=y+hash(i,11)%h;
  c.fillStyle=['#474a47','#4c4f4b','#4e504b','#454a45'][i%4];c.fillRect(px,py,2+hash(i,12)%4,1);
 }
 // A faded tennis layout, horizontal along the long axis.
 const left=x+22,right=x+w-22,top=y+35,bottom=y+h-35;
 const singlesTop=top+18,singlesBottom=bottom-18;
 const serviceLeft=x+w/2-(w-44)*.23,serviceRight=x+w/2+(w-44)*.23;
 c.strokeStyle='#bfc0aa88';c.lineWidth=2;c.strokeRect(left,top,right-left,bottom-top);
 c.beginPath();
 for(const yy of [singlesTop,singlesBottom]){c.moveTo(left,yy);c.lineTo(right,yy);}
 for(const xx of [serviceLeft,serviceRight]){c.moveTo(xx,singlesTop);c.lineTo(xx,singlesBottom);}
 c.moveTo(serviceLeft,y+h/2);c.lineTo(serviceRight,y+h/2);
 c.moveTo(left,y+h/2);c.lineTo(left+4,y+h/2);
 c.moveTo(right-4,y+h/2);c.lineTo(right,y+h/2);c.stroke();
 for(let i=0;i<10;i++){
  let px=x+12+hash(i,20)%(w-24),py=y+12+hash(i,21)%(h-24);
  c.strokeStyle='#262f2b60';c.lineWidth=1;c.beginPath();c.moveTo(px,py);
  for(let j=0;j<5;j++){px+=hash(i,j,22)%17-8;py+=4+hash(i,j,23)%7;c.lineTo(px,py);}c.stroke();
 }
 for(let i=0;i<45;i++){
  const px=x+hash(i,31)%w,py=i%2?y+hash(i,32)%12:y+h-hash(i,32)%14;
  c.fillStyle=i%3?'#677842':'#8b9450';c.fillRect(px,py,2,4+hash(i,33)%5);c.fillRect(px-2,py+3,5,2);
 }
 for(let i=0;i<26;i++){c.fillStyle='#92907188';c.fillRect(x+hash(i,40)%w,y+hash(i,41)%h,3,2);}
 c.restore();
}
export function drawAbandonedNet(c){
 const a=ABANDONED_COURT,x=Math.round(a.x+a.w/2),top=a.y+25,bottom=a.y+a.h-25;
 c.save();c.fillStyle='#16242135';c.fillRect(x+4,top+5,10,bottom-top);
 // Narrow, side-on mesh: faded cord, rusty posts and a few missing knots.
 for(let y=top;y<bottom;y+=3){
  const sag=Math.round(3*Math.sin((y-top)/(bottom-top)*Math.PI));
  c.fillStyle='#c9b994';c.fillRect(x-4+sag,y,2,3);
  c.fillStyle='#4b5442aa';c.fillRect(x-2+sag,y,6,2);
  if((y-top)%15!==0){c.fillStyle='#90947a';c.fillRect(x+3,y,1,3);}
 }
 for(const y of [top,bottom]){c.fillStyle='#4c4437';c.fillRect(x-3,y-7,6,13);c.fillStyle='#a78659';c.fillRect(x-3,y-7,2,11);c.fillStyle='#beb593';c.fillRect(x-3,y-8,6,2);}
 c.restore();
}
