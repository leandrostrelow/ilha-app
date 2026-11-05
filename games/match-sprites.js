// Each pair is front/back. Keep this contract identical to the generated atlas.
export const EXTRA_MATCH_ATLAS_URL='/games/assets/ilha-extra-match-v1.png';
export const EXTRA_MATCH_IDS=['kalinca','malu','higor','vanessa','bernar','scarlt','michele','larissa','betinho'];
export function extraMatchFrame(id,facing='down'){
 const i=EXTRA_MATCH_IDS.indexOf(id);if(i<0)return null;
 return {atlas:'extras-match',index:Math.floor(i/3)*6+i%3*2+Number(facing==='up'),flip:facing==='left'};
}
// Empty hands in the atlas: the same animated attachment draws the racket or
// pickleball paddle in both match roles, without baking one sport into the art.
export function extraMatchGrip(id,facing='down'){
 if(!EXTRA_MATCH_IDS.includes(id))return null;
 return facing==='up'?[.20,-.35]:[.20,-.35];
}
