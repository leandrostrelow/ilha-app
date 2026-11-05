// Screen-space pixel rain; bounded work, no textures or flashing lightning.
export function drawClubRain(c,time,{reduced=false}={}){
 const w=c.canvas.width,h=c.canvas.height,t=reduced?0:time;
 c.save();c.fillStyle='#253b5952';c.fillRect(0,0,w,h);
 const drops=reduced?32:Math.min(150,Math.round(w*h/2200));
 c.strokeStyle='#c3dde687';c.lineWidth=1;c.beginPath();
 for(let i=0;i<drops;i++){const x=((i*137.3+t*36)%(w+30))-15,y=((i*83.7+t*(190+i%5*13))%(h+30))-15;c.moveTo(Math.round(x),Math.round(y));c.lineTo(Math.round(x-3),Math.round(y+9));}c.stroke();
 c.strokeStyle='#c7e7ee55';
 for(let i=0;i<10;i++){const phase=(t*.65+i*.37)%1,x=(i*157+29)%w,y=(i*113+91)%h;c.globalAlpha=1-phase;c.beginPath();c.ellipse(x,y,2+phase*5,1+phase*2,0,0,Math.PI*2);c.stroke();}
 c.restore();
}
