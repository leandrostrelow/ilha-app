// Optional visual upgrade. Identity, height, movement and hitboxes are unchanged.
export const PREMIUM_AVATAR_URL='/games/assets/ilha-avatars-premium-v1.webp';
export const VICTORY_AVATAR_URL='/games/assets/ilha-avatars-victory-v1.webp';
export function premiumVictoryFrame(id){
 if(id!=='player-m'&&id!=='player-f')return null;
 return {atlas:'victory',index:id==='player-f'?1:0,flip:false};
}
const steps=[1,0,2,0];
export function premiumAvatarFrame(id,facing='down',stride=0,ready=false){
 if(id!=='player-m'&&id!=='player-f')return null;
 const female=id==='player-f',direction=facing==='up'?1:facing==='left'||facing==='right'?2:0;
 const base=direction*6+(female?3:0);
 const phase=stride===0?0:steps[((Math.floor(stride*2)%4)+4)%4];
 const index=ready?18+(female?3:0)+direction:base+phase;
 // Grip is relative to the rendered frame height, including the crouching pose.
 const grip=ready?(direction===1?[.22,-.45]:[.10,-.34]):direction===0?[.18,-.26]:direction===1?[.20,-.42]:[.01,-.34];
 return {atlas:'premium',index,reference:base,flip:facing==='left',grip,angle:ready||direction===2?1.28:.8};
}
