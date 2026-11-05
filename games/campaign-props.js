export function drawQuestBall(c,x,y,time=0){
 c.save();c.translate(Math.round(x),Math.round(y));
 c.fillStyle='#0b271766';c.fillRect(-6,0,12,3);
 c.fillStyle='#e4f48644';c.fillRect(-10,-13,20,17);
 c.fillStyle='#f0f58c';c.fillRect(-4,-9,8,9);c.fillRect(-6,-7,12,5);
 c.fillStyle='#96b635';c.fillRect(-4,-1,8,2);c.fillStyle='#fffce0';c.fillRect(-3,-8,2,5);c.fillRect(-1,-4,3,2);c.fillRect(2,-3,2,3);
 const bob=Math.round(Math.sin(time*3)*2);c.fillStyle='#fff7b2';c.fillRect(-12,-16+bob,3,3);c.fillRect(10,-9-bob,2,2);c.restore();
}
export function drawFoice(c,x,y,time=0){
 c.save();c.translate(Math.round(x),Math.round(y));
 c.fillStyle='#eafca633';c.fillRect(-15,-37,31,39);
 c.fillStyle='#76532f';c.fillRect(-2,-29,4,30);c.fillStyle='#d8bb79';c.fillRect(-1,-29,1,28);
 c.fillStyle='#172d37';c.fillRect(-3,-34,22,6);c.fillRect(16,-29,6,10);
 c.fillStyle='#d2e7de';c.fillRect(-2,-33,19,3);c.fillRect(15,-30,4,6);c.fillRect(18,-25,2,8);
 c.fillStyle='#edffab';const bob=Math.round(Math.sin(time*3)*2);c.fillRect(-11,-25+bob,3,3);c.fillRect(24,-13-bob,2,2);
 c.restore();
}
export function drawTrophy(c,x,y,scale=1){
 c.save();c.translate(Math.round(x),Math.round(y));c.scale(scale,scale);
 c.fillStyle='#845823';c.fillRect(-10,-24,20,13);c.fillRect(-3,-11,6,8);c.fillRect(-9,-4,18,4);
 c.fillStyle='#f6cd5d';c.fillRect(-8,-25,16,12);c.fillRect(-5,-13,10,4);c.fillRect(-2,-9,4,6);c.fillRect(-7,-3,14,2);
 c.strokeStyle='#dfad42';c.lineWidth=2;c.strokeRect(-13,-23,5,9);c.strokeRect(8,-23,5,9);
 c.fillStyle='#fff0a7';c.fillRect(-6,-23,3,8);c.restore();
}
