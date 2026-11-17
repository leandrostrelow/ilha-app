import test from 'node:test';
import assert from 'node:assert/strict';
import { projectiveMatrix, LOGO_SOURCE } from '../cresol/brand-projection.js';
import { readFile } from 'node:fs/promises';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7, `${a} ≠ ${b}`);
test('projective placement maps all four original-logo corners to the banner without redrawing',()=>{
  const corners=[[100,110],[300,70],[310,220],[95,230]];
  const m=projectiveMatrix(corners,1664,1080);
  const points=[[0,0],[1664,0],[1664,1080],[0,1080]];
  points.forEach(([x,y],i)=>{
    const w=m[3]*x+m[7]*y+m[15];
    close((m[0]*x+m[4]*y+m[12])/w,corners[i][0]);
    close((m[1]*x+m[5]*y+m[13])/w,corners[i][1]);
  });
  assert.equal(projectiveMatrix([[1,1],[1,1],[1,1],[1,1]]),null);
});
test('static mockups use the same original PNG as the Cresol header and keeps alpha',async()=>{
  assert.equal(LOGO_SOURCE,'/cresol/assets/cresol-original.png');
  const png=await readFile(new URL('../cresol/assets/cresol-original.png',import.meta.url));
  assert.equal(png.readUInt32BE(16),1664);
  assert.equal(png.readUInt32BE(20),1080);
  assert.ok(png[25] === 6 || png[25] === 4 || (png[25] === 3 && png.includes(Buffer.from('tRNS'))), 'source must retain PNG transparency');
});

test('static brand placements stay on the image and remain projectable after resizing',async()=>{
  const {SPONSOR_PLACEMENTS,MOCKUP_WIDTH,MOCKUP_HEIGHT}=await import('../cresol/sponsor-placements.js');
  for (const placements of Object.values(SPONSOR_PLACEMENTS)) {
    for (const corners of placements) {
      assert.equal(corners.length,4);
      for (const [x,y] of corners) assert.ok(x>=0&&x<=MOCKUP_WIDTH&&y>=0&&y<=MOCKUP_HEIGHT);
      for (const scale of [.22,.5,1]) assert.ok(projectiveMatrix(corners.map(([x,y])=>[x*scale,y*scale])).every(Number.isFinite));
    }
  }
});
