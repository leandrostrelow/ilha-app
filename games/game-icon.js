// Export the existing game mark and real courts; no replacement/generated logo.
import {drawGameLogo} from './game-brand.js';
import {renderClub,sceneryReady} from './scenery-renderer.js';
export {sceneryReady as iconReady};
export function paintGameIcon(canvas,{maskable=false}={}){
 const c=canvas.getContext('2d'),size=canvas.width;
 c.imageSmoothingEnabled=false;
 renderClub(c,{x:522,y:605,w:520,h:520},{time:0,atmosphereTime:0,animate:false,actors:[]});
 c.fillStyle='#072e299e';c.fillRect(0,0,size,size);
 const width=size*(maskable?.64:.86),height=width*44/65;
 drawGameLogo(c,(size-width)/2,(size-height)/2,width,height);
}
