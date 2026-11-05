import test from 'node:test';
import assert from 'node:assert/strict';
import {drawOldCabin} from '../games/old-cabin.js';
import {BUILDINGS} from '../games/scenery-data.js';
test('original cabin has pale boards, blue windows and deterministic native pixels',()=>{
 const b=BUILDINGS.find(item=>item.id==='wood-cabin');const before=JSON.stringify(b);
 const draw=()=>{const pixels=[];const c={fillStyle:'',fillRect(...box){assert.ok(box.every(Number.isFinite));pixels.push([this.fillStyle,...box]);}};drawOldCabin(c,b);return pixels;};
 const pixels=draw();assert.deepEqual(pixels,draw());assert.equal(JSON.stringify(b),before);
 assert.equal(pixels.filter(p=>p[0]==='#486779').length,2);
 assert.ok(pixels.some(p=>p[0]==='#d3cfb7'));
 assert.ok(pixels.some(p=>p[0]==='#46633b'));
 for(const [,x,y,w,h] of pixels){assert.ok(w>=0&&h>=0);assert.ok(x>=b.x-6&&x+w<=b.x+b.w+13);assert.ok(y>=b.y&&y+h<=b.y+b.h+8);}
});
