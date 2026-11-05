// Native pixel-art interpretation of the club's original weathered wooden house.
// Keep the existing footprint so paths, Beto and the quest item stay accessible.
export function drawOldCabin(c,{x,y,w,h}){
 const r=(color,a,b,ww,hh)=>{c.fillStyle=color;c.fillRect(Math.round(x+a),Math.round(y+b),Math.round(ww),Math.round(hh));};
 const timber=['#bcbcaf','#d0cebc','#a5a99d','#c6c6b7','#999e94'];
 r('#20382b55',7,12,w+5,h-4);
 // Raised floor and exposed, rotten supports.
 r('#23302a',5,h-24,w-9,17);
 for(const a of [9,39,w-45,w-9]){r('#53594a',a,h-24,5,24);r('#92927b',a,h-22,1,20);}
 r('#737561',4,h-27,w-8,4);
 // Dark, open lean-to on the left; pale vertical boards on the main facade.
 r('#19241f',3,35,43,h-63);
 r('#858b7c',43,32,w-43,h-56);
 for(let a=44;a<w-2;a+=7){
  const k=Math.floor(a/7),bottom=h-25+(k%3);
  r(timber[k%timber.length],a,34,6,bottom-34);
  r('#686f62',a+6,36,1,bottom-36);
  r('#e0dcc6',a+1,37,1,18+k%11);
  r('#848a7d',a+3,54+k%13,1,20);
  r('#727b6a',a+1,bottom-10,2,8);
 }
 // Two unmistakable faded-blue window frames, no glass or crossed boards.
 for(const a of [57,w-39]){
  r('#486779',a,49,28,29);r('#7696a7',a,49,28,3);
  r('#24372f',a+4,53,20,21);r('#111e1d',a+6,54,17,19);
  r('#8ca9b0',a+1,53,2,22);r('#577d91',a+2,75,27,4);
  r('#a4aea1',a+2,78,27,1);r('#373f34',a+8,55,1,17);
 }
 // Shallow, sagging grey roof viewed from above, with weathered corrugations.
 for(let row=0;row<33;row++){
  const inset=Math.floor((32-row)*.4);
  r(row%5===0?'#838676':'#62695b',-5+inset,row,w+10-inset*2,1);
 }
 for(let a=8;a<w;a+=9){r('#999b86',a,6,1,23);r('#444f43',a+2,10,1,21);}
 r('#aaa58b',10,0,w-20,2);r('#4d5546',-5,32,w+10,4);
 r('#adab91',-2,32,43,2);r('#202c26',14,25,16,7);r('#747962',16,28,19,2);
 // Broken porch posts and loose off-white door panel leaning in the opening.
 r('#676f5e',4,36,4,h-47);r('#a2a48a',4,36,1,h-49);
 r('#707561',39,36,4,h-54);r('#716e56',10,h-31,29,4);
 for(let row=0;row<41;row++){
  const a=15+Math.floor((40-row)/9);
  r('#777f71',a-1,53+row,19,1);r('#d3cfb7',a,53+row,16,1);
  if(row%9===0)r('#929987',a+1,53+row,14,1);
  r('#a7af9b',a+5,53+row,1,1);r('#9ca490',a+11,53+row,1,1);
 }
 // Dry hanging vines, creeping leaves and tufts around the stilts.
 for(const a of [8,35,49,91,w-5]){
  for(let j=0;j<10;j++){
   const xx=a+(j%4<2?0:2);r('#7b8062',xx,31+j*5,1,6);
   if(j%2===0){r('#46633b',xx-2,34+j*5,4,3);r('#708252',xx-1,34+j*5,2,1);}
  }
 }
 for(let i=0;i<27;i++){
  const a=3+(i*23)%(w-6),b=h-8+(i%3)*3;
  r(i%2?'#486638':'#637e45',a,b-5-i%7,2,8+i%7);
  r('#82905a',a-2,b-3,2,3);r('#304d32',a+2,b-2,3,4);
 }
}
