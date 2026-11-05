// Runtime visual state, scoped to this copy. Never reads or writes Legado saves.
import {HEALTHY_IDS} from './adventure.js';
let cured=new Set(),allCured=false;
export function syncHalloween(state){cured=new Set(state.wins||[]);if(state.finalWon&&state.accused)cured.add(state.accused);allCured=state.champion===true;}
export function isZombie(person){return Boolean(person&&person.id&&!person.id.startsWith('player-')&&!HEALTHY_IDS.includes(person.id)&&!allCured&&!cured.has(person.id));}
export function clubCured(){return allCured;}
