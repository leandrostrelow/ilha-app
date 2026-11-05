// Portraits, world actors and match athletes share this identity mapping.
const npcIds=['gael','lourenco','gabriel','emerson','davi','evandro','romulo','andre','renato','beto','felipe','leandro'];
export function heroFrame(id,facing='down',stride=0){
 const avatar=id==='player-m'||id==='player-f',female=id==='player-f';
 if(avatar&&facing!=='down'){
  const row=(female?2:0)+(facing==='up'?0:1);
  // Two steps per cycle, with passing poses in between. Idle is never a split step.
  const phase=stride===0?0:[1,2,3,0][Math.floor(stride*2)%4];
  return {atlas:'walk',index:row*4+phase,reference:row*4,flip:facing==='left'};
 }
 if(avatar)return {atlas:'players',index:(stride&&Math.floor(stride)%2?2:0)+(female?1:0),flip:false};
 return {atlas:facing==='up'?'backs':'npcs',index:Math.max(0,npcIds.indexOf(id==='alexandre'?'gabriel':id)),flip:facing==='left'};
}

// Adaptive transparent gutters keep hats/shoes intact despite generator padding.
export function indexAtlasFrames({data,width,height},columns,rowCount){
 const density=new Uint32Array(height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>100)density[y]++;
 const rows=[0];for(let r=1;r<rowCount;r++){
  const center=height*r/rowCount;let best=Math.round(center),score=Infinity;
  for(let y=Math.max(0,Math.floor(center-height*.04));y<Math.min(height,Math.ceil(center+height*.04));y++){
   const value=density[y]*100+Math.abs(y-center);if(value<score){best=y;score=value;}
  }rows.push(best);
 }rows.push(height);
 const frames=[];
 for(let row=0;row<rowCount;row++)for(let col=0;col<columns;col++){
  const left=Math.floor(width*col/columns),right=Math.floor(width*(col+1)/columns);
  let x0=right,x1=left-1,y0=rows[row+1],y1=rows[row]-1;
  for(let y=rows[row];y<rows[row+1];y++)for(let x=left;x<right;x++)if(data[(y*width+x)*4+3]>100){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  frames.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1});
 }return frames;
}
