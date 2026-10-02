import { apartmentDevicePose, ROOM_LIGHTS } from './deviceAppearance';
import { APARTMENT_PLACEMENTS } from './placement';
import { INTERIOR_WALLS } from './plan';

const walls = [...INTERIOR_WALLS, [0, 0, 0, 12], [0, 0, 10.5, 0], [0, 12, 10.5, 12], [10.5, 0, 10.5, 4.6], [10.5, 5.6, 10.5, 12]];
const nearWall = (p: {u:number;v:number}) => walls.some(([u0,v0,u1,v1]) => {
  const u = Math.max(u0,Math.min(p.u,u1)), v = Math.max(v0,Math.min(p.v,v1));
  return Math.hypot(p.u-u,p.v-v) <= 0.23;
});

test('all apartment fixtures have a visible wall support except the gas pipe', () => {
  for (const [type, p] of Object.entries(APARTMENT_PLACEMENTS)) {
    if (!('room' in p) || type === 'gas_valve') continue;
    const cut = apartmentDevicePose(type)!;
    expect(nearWall(cut), type).toBe(true);
    expect(cut.h).toBeLessThanOrEqual(0.9);
    expect(apartmentDevicePose(type, true)!.h).toBeGreaterThan(1.1);
  }
  expect(apartmentDevicePose('window')).toBeNull();
  expect(apartmentDevicePose('gas_valve')!.h).toBe(0.5);
});

test('every room has a wall sconce and fixture display positions agree in 3D and first person', () => {
  expect(new Set(ROOM_LIGHTS.map((l) => l.room)).size).toBe(6);
  for (const p of ROOM_LIGHTS) expect(nearWall(p)).toBe(true);
  for (const type of ['smoke', 'occupancy', 'noise_level', 'co', 'hvac', 'resident_display']) {
    const a = apartmentDevicePose(type)!, b = apartmentDevicePose(type,true)!;
    expect([a.u,a.v,a.rotationY]).toEqual([b.u,b.v,b.rotationY]);
  }
});
