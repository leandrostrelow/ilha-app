// Native pixel lettering: the same mark on the title screen and entrance sign.
const glyphs={I:['111','010','010','010','111'],L:['100','100','100','100','111'],H:['101','101','111','101','101'],A:['010','101','111','101','101'],T:['111','010','010','010','010'],E:['111','100','110','100','111'],N:['1001','1101','1011','1001','1001'],S:['111','100','111','001','111'],G:['111','100','101','101','111'],D:['110','101','101','101','110'],O:['111','101','101','101','111']};
Object.assign(glyphs,{M:['10001','11011','10101','10001','10001'],R:['110','101','110','101','101'],W:['10001','10001','10101','11011','10001'],C:['111','100','100','100','111'],P:['110','101','110','100','100']});
const widthOf=(text,size)=>[...text].reduce((n,ch)=>n+(ch===' '?3:(glyphs[ch.normalize('NFD')[0]]?.[0].length||0)+1)*size,0)-size;
function letters(c,text,x,y,size,color){c.fillStyle=color;for(const char of text){if(char===' '){x+=3*size;continue;}const rows=glyphs[char.normalize('NFD')[0]];if(!rows)continue;const accent=Math.min(size,1);if(char==='É')c.fillRect(x+size,y-2*accent,accent,accent);if(char==='Ê'){c.fillRect(x+size,y-2*accent,accent,accent);c.fillRect(x+size-accent,y-accent,accent,accent);c.fillRect(x+size+accent,y-accent,accent,accent);}rows.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1')c.fillRect(x+i*size,y+j*size,size,size);}));x+=(rows[0].length+1)*size;}}
export const LOGO_SIZE=Object.freeze({width:68,height:60});
// Same stacked lettering and upper-right ball position as Legado. The ball
// becomes a little jack-o'-lantern, retaining its cream tennis-ball seam.
function pumpkin(c){
 c.fillStyle='#1d122d';c.fillRect(53,5,12,15);c.fillRect(51,8,16,9);
 c.fillStyle='#80aa42';c.fillRect(59,2,3,4);c.fillRect(61,1,3,2);
 c.fillStyle='#a84e36';c.fillRect(54,5,10,14);c.fillRect(52,8,14,8);
 c.fillStyle='#ed973e';c.fillRect(55,5,7,13);c.fillRect(53,8,11,8);
 c.fillStyle='#ffcb65';c.fillRect(57,5,3,13);c.fillRect(54,7,2,3);
 c.fillStyle='#21152f';c.fillRect(54,10,3,2);c.fillRect(61,10,3,2);c.fillRect(56,14,6,2);c.fillRect(57,16,4,1);
 c.fillStyle='#daf790';c.fillRect(55,10,1,1);c.fillRect(62,10,1,1);c.fillRect(58,14,2,1);
 c.fillStyle='#fff0b5';for(const [x,y]of [[63,6],[62,7],[61,8],[60,9]])c.fillRect(x,y,1,1);
}
export function drawGameLogo(c,x,y,w,h){
 const scale=Math.min(w/LOGO_SIZE.width,h/LOGO_SIZE.height);c.save();c.translate(x+(w-LOGO_SIZE.width*scale)/2,y+(h-LOGO_SIZE.height*scale)/2);c.scale(scale,scale);
 for(const [text,xx,yy,size,color]of [['ILHA',2,3,3,'#fff3ca'],['TÊNIS',2,22,3,'#dbc4f4'],['O MISTÉRIO',2,42,1.5,'#d4ef65']]){
  letters(c,text,xx+1,yy+2,size,'#170f29');letters(c,text,xx,yy+1,size,'#704493');letters(c,text,xx,yy,size,color);
 }
 c.fillStyle='#b9de6e';c.fillRect(2,39,59,1);c.fillRect(46,15,3,1);c.fillRect(48,12,2,1);
 const tag='ESPECIAL HALLOWEEN',tagSize=.72;
 letters(c,tag,(LOGO_SIZE.width-widthOf(tag,tagSize))/2,55,tagSize,'#c5b4d4');
 pumpkin(c);
 c.restore();
}
export function paintGameLogos(){for(const canvas of document.querySelectorAll('[data-game-logo]'))drawGameLogo(canvas.getContext('2d'),0,0,canvas.width,canvas.height);}
