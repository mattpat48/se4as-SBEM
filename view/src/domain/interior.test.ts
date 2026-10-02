import { interiorShell, DOOR_OPENINGS } from './interior';
test('complete walls retain all five interior door openings up to 2.1 m', () => {
  const walls=interiorShell(2.9);
  for(const d of DOOR_OPENINGS) for(const u of [d.u0+.15,(d.u0+d.u1)/2,d.u1-.15]) {
    expect(walls.some((w)=>w.role==='wall' && Math.abs(u-w.u)<w.w/2 && Math.abs(d.v-w.v)<w.d/2 && 1.65>w.y0 && 1.65<w.y1)).toBe(false);
  }
  expect(walls.every(w=>w.y0>=0 && w.y1<=2.9 && w.w>0 && w.d>0)).toBe(true);
});
test('the facade has glazing openings, a ceiling-level lintel and solid side walls', () => {
  const walls=interiorShell(2.9);
  const blocked=(u:number,v:number,y:number)=>walls.some(w=>w.role==='wall'&&Math.abs(u-w.u)<w.w/2&&Math.abs(v-w.v)<w.d/2&&y>w.y0&&y<w.y1);
  expect(blocked(2,0,1.5)).toBe(false);
  expect(blocked(2,0,.5)).toBe(true);
  expect(blocked(2,0,2.8)).toBe(true);
  expect(blocked(0,7.2,1.5)).toBe(true);
});
