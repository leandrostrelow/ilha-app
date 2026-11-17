import test from 'node:test';
import assert from 'node:assert/strict';
import { sphericalPoint, projectPoint, projectiveMatrix, LOGO_SOURCE } from '../cresol/tour-branding.js';
import { readFile } from 'node:fs/promises';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7, `${a} ≠ ${b}`);
test('360 brand anchors follow camera yaw, pitch and zoom and hide behind the camera',()=>{
  const view={yaw:0,pitch:0,hfov:90,width:1000,height:600};
  const center=sphericalPoint(887,443.5);
  const [x,y]=projectPoint(center,view); close(x,500); close(y,300);
  const right=sphericalPoint(1108.75,443.5);
  close(projectPoint(right,view)[0],1000);
  close(projectPoint(right,{...view,yaw:45})[0],500);
  assert.ok(projectPoint(right,{...view,hfov:60})[0]>1000);
  assert.equal(projectPoint(center,{...view,yaw:180}),null);
  const up=sphericalPoint(887,221.75);
  close(projectPoint(up,{...view,pitch:45})[1],300);
});
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
test('preview uses the same original PNG as the Cresol header and keeps alpha',async()=>{
  assert.equal(LOGO_SOURCE,'/cresol/assets/cresol-original.png');
  const png=await readFile(new URL('../cresol/assets/cresol-original.png',import.meta.url));
  assert.equal(png.readUInt32BE(16),1664);
  assert.equal(png.readUInt32BE(20),1080);
  assert.ok(png[25] === 6 || png[25] === 4 || (png[25] === 3 && png.includes(Buffer.from('tRNS'))), 'source must retain PNG transparency');
});
