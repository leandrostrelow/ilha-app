// Native pixel lettering: the same mark on the title screen and entrance sign.
const glyphs={I:['111','010','010','010','111'],L:['100','100','100','100','111'],H:['101','101','111','101','101'],A:['010','101','111','101','101'],T:['111','010','010','010','010'],E:['111','100','110','100','111'],N:['1001','1101','1011','1001','1001'],S:['111','100','111','001','111'],G:['111','100','101','101','111'],D:['110','101','101','101','110'],O:['111','101','101','101','111']};
function letters(c,text,x,y,size,color){c.fillStyle=color;for(const char of text){const rows=glyphs[char];if(!rows)continue;rows.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1')c.fillRect(x+i*size,y+j*size,size,size);}));x+=(rows[0].length+1)*size;}}
export function drawGameLogo(c,x,y,w,h){
 const scale=Math.min(w/65,h/44);c.save();c.translate(x+(w-65*scale)/2,y+(h-44*scale)/2);c.scale(scale,scale);
 for(const [text,xx,yy,size]of [['ILHA',1,1,3],['TENIS',1,19,3],['LEGADO',2,38,1]]){
  letters(c,text,xx+1,yy+2,size,'#062d32');letters(c,text,xx,yy+1,size,'#21865c');letters(c,text,xx,yy,size,text==='LEGADO'?'#d4ef65':'#fff3ca');
 }
 c.fillStyle='#d4ef65';c.fillRect(1,35,59,1);c.fillRect(45,11,7,2);c.fillRect(48,8,5,2);
 c.fillStyle='#164236';c.fillRect(52,2,12,12);c.fillStyle='#c8ed47';c.fillRect(54,2,8,12);c.fillRect(52,4,12,8);c.fillStyle='#fff5d5';for(const [xx,yy]of [[54,3],[54,5],[55,7],[57,9],[59,10]])c.fillRect(xx,yy,2,2);
 c.restore();
}
export function paintGameLogos(){for(const canvas of document.querySelectorAll('[data-game-logo]'))drawGameLogo(canvas.getContext('2d'),0,0,canvas.width,canvas.height);}
