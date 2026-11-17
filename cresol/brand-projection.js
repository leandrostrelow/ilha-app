// The original Cresol PNG is projected onto static photographic mockups.
export const LOGO_SOURCE = '/cresol/assets/cresol-original.png';
const LOGO_WIDTH = 1664;
const LOGO_HEIGHT = 1080;
// Homography maps the exact rectangular PNG onto a physical banner quadrilateral.
export function projectiveMatrix(corners, width = LOGO_WIDTH, height = LOGO_HEIGHT) {
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = corners;
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3;
  const dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  const denominator=dx1*dy2-dx2*dy1;
  if (Math.abs(denominator)<1e-8) return null;
  const g=(dx3*dy2-dx2*dy3)/denominator;
  const h=(dx1*dy3-dx3*dy1)/denominator;
  const a=x1-x0+g*x1, b=x3-x0+h*x3;
  const d=y1-y0+g*y1, e=y3-y0+h*y3;
  return [a/width,d/width,0,g/width,b/height,e/height,0,h/height,0,0,1,0,x0,y0,0,1];
}
