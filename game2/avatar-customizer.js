const SKINS=['#f6c89f','#dca273','#a96f4f','#704536'];
const SHIRTS=['#1f8b68','#6f43bd','#1f6fb2','#c84c52','#e39a2d','#202d39'];
const RACKETS=['#dafa55','#8b5cf6','#3ac7d3','#ff728b','#f3f0d0'];
const HAIRS=['short','curly','long','ponytail','shaved'];
const BEARDS=['none','mustache','short','full'];
const TOPS=['polo','classic','stripe'];
const CAPS=['none','front','back'];
const pick=(value,list,fallback)=>list.includes(value)?value:fallback;
export function defaultAppearance(gender='male'){
 return {gender:gender==='female'?'female':'male',skin:'#dca273',hair:gender==='female'?'ponytail':'curly',hairColor:'#40271f',beard:'none',top:'polo',shirt:'#1f8b68',cap:'none',racket:'#dafa55'};
}
export function normalizeAppearance(value,avatar='player-m'){
 const gender=value?.gender==='female'||avatar==='player-f'?'female':'male',base=defaultAppearance(gender);
 return {gender,skin:pick(value?.skin,SKINS,base.skin),hair:pick(value?.hair,HAIRS,base.hair),hairColor:pick(value?.hairColor,['#241b19','#40271f','#75452b','#d6a55d','#c9c5ba'],base.hairColor),beard:pick(value?.beard,BEARDS,'none'),top:pick(value?.top,TOPS,'polo'),shirt:pick(value?.shirt,SHIRTS,base.shirt),cap:pick(value?.cap,CAPS,'none'),racket:pick(value?.racket,RACKETS,base.racket)};
}
const px=(c,color,x,y,w,h)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));};
function racket(c,color,facing,swing,ready){
 const side=facing==='left'?-1:1;c.save();c.translate(side*13,-22);if(facing==='up')c.translate(-side*4,-2);c.rotate(side*((ready?-.42:.16)+Math.sin(swing/23*Math.PI)*.8));
 px(c,'#32251f',-1,0,3,12);px(c,'#d39b68',-1,7,3,4);c.strokeStyle='#182b31';c.lineWidth=2;c.beginPath();c.ellipse(0,-5,5,7,0,0,Math.PI*2);c.stroke();c.fillStyle=color+'55';c.fill();c.strokeStyle=color;c.lineWidth=1;c.stroke();c.strokeStyle='#f7f0d6';c.lineWidth=.65;for(let i=-3;i<=3;i+=2){c.beginPath();c.moveTo(i,-11);c.lineTo(i,1);c.stroke();}for(let y=-9;y<=-1;y+=2){c.beginPath();c.moveTo(-4,y);c.lineTo(4,y);c.stroke();}c.restore();
}
function hair(c,a,facing){
 const col=a.hairColor;if(a.hair==='shaved'){px(c,col,-7,-40,14,3);return;}
 if(a.hair==='long'){px(c,col,-9,-39,18,16);px(c,col,-10,-30,4,12);px(c,col,6,-30,4,12);}
 else if(a.hair==='ponytail'){px(c,col,-9,-39,18,8);px(c,col,7,-34,5,12);px(c,col,9,-24,3,5);}
 else if(a.hair==='curly'){for(const [x,y] of [[-9,-39],[-4,-42],[2,-41],[7,-38],[-10,-34],[-2,-36],[5,-35]])px(c,col,x,y,6,6);}
 else{px(c,col,-9,-40,18,8);px(c,col,-8,-34,4,4);}
 if(facing==='up')px(c,col,-8,-35,16,9);
}
function cap(c,a,facing){if(a.cap==='none')return;const dark=a.cap==='back'?'#25333c':a.shirt;px(c,dark,-9,-42,18,6);px(c,'#17242b',facing==='left'?-13:5,-37,9,3);px(c,'#f0e6c8',-5,-40,10,2);}
function face(c,a,facing){if(facing==='up')return;const side=facing==='left';px(c,'#17242b',side?-6:-5,-33,2,3);px(c,'#17242b',side?2:4,-33,2,3);px(c,'#d68067',side?-5:-1,-27,5,1);if(a.beard==='mustache')px(c,a.hairColor,-4,-28,8,2);if(a.beard==='short'){px(c,a.hairColor,-6,-27,12,3);px(c,a.hairColor,-7,-31,2,5);px(c,a.hairColor,5,-31,2,5);}if(a.beard==='full'){px(c,a.hairColor,-7,-29,14,7);px(c,a.skin,-3,-29,6,2);}}
export function drawCustomAvatar(c,x,y,value,{facing='down',stride=0,height=40,player=false,champion=false,swing=0,ready=false,celebrating=false,shadow=true,equipment=null}={}){
 const a=normalizeAppearance(value,value?.gender==='female'?'player-f':'player-m'),moving=stride!==0,step=moving?Math.sin(stride*Math.PI):0,bob=moving?-Math.abs(step)*.8:0,side=facing==='left'?-1:1;
 c.save();c.translate(Math.round(x),Math.round(y));c.scale(height/48,height/48);if(shadow){c.fillStyle='#071d1b66';c.beginPath();c.ellipse(1,0,13,3,0,0,Math.PI*2);c.fill();}
 if(player||champion){c.strokeStyle=champion?'#ffe479':'#fff0a688';c.lineWidth=1;c.beginPath();c.ellipse(0,0,15,4,0,0,Math.PI*2);c.stroke();}
 c.translate(0,bob);if(equipment)racket(c,a.racket,facing,swing,ready);
 const legA=Math.round(step*2),legB=-legA,skin=a.skin,shorts='#172c42',shoe='#f4eed8',outline='#14272d';
 if(celebrating){px(c,skin,-16,-34,5,14);px(c,skin,11,-34,5,14);}else{const arm=Math.round(step*1.5);px(c,skin,-11,-25+arm,5,14);px(c,skin,6,-25-arm,5,14);}
 px(c,outline,-9,-25,18,16);px(c,a.shirt,-8,-24,16,14);if(a.top==='polo'){px(c,'#f4eed8',-7,-24,14,2);px(c,'#f4eed8',-1,-23,2,5);}if(a.top==='classic')px(c,'#f4eed8',-7,-16,14,2);if(a.top==='stripe'){px(c,'#f4eed8',-2,-24,4,14);px(c,'#f4eed8',-8,-20,16,2);}
 px(c,shorts,-8,-10,16,7);px(c,skin,-7,-3+legA,5,10);px(c,skin,2,-3+legB,5,10);px(c,shoe,-9,5+legA,8,4);px(c,shoe,1,5+legB,8,4);px(c,a.shirt,-8,-13,16,2);
 px(c,outline,-9,-39,18,16);px(c,skin,-8,-38,16,15);if(facing==='left'||facing==='right'){px(c,skin,side>0?7:-9,-34,3,6);}hair(c,a,facing);cap(c,a,facing);face(c,a,facing);
 if(!equipment)racket(c,a.racket,facing,swing,ready);c.restore();
}
export const AVATAR_OPTIONS=Object.freeze({skins:SKINS,shirts:SHIRTS,rackets:RACKETS,hairs:HAIRS,beards:BEARDS,tops:TOPS,caps:CAPS});
