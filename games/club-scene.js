import {COURTS} from './scenery-data.js';
export {WORLD_SIZE,COURTS,COURT_OVERVIEW} from './scenery-data.js';
export function courtPoint(x,y,court=1){const c=COURTS[court-1]||COURTS[0];return {x:c.x+(x-100)*c.width/280,y:c.y+(y-112)*c.height/282};}
