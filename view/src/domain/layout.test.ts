import fixtureModel from '../test/fixtures/model.json';
import type { ComplexModelMsg } from './messages';
import { APARTMENT_PLACEMENTS } from './placement';
import { ROOMS } from './plan';
import { buildComplexLayout, facingRotation, planToWorld, toScene, worldToPlan } from './layout';

const model = fixtureModel as unknown as ComplexModelMsg;
const clone = (): ComplexModelMsg => JSON.parse(JSON.stringify(fixtureModel));
const L = buildComplexLayout(model);
const B = (id: string) => L.buildings.find((b) => b.id === id)!;

test('coordinates and facing', () => {
  expect(toScene(3, 45)).toEqual({ x: 3, z: -45 });
  expect([facingRotation('S'), facingRotation('N'), facingRotation('E'), facingRotation('O')])
    .toEqual([0, Math.PI, Math.PI / 2, -Math.PI / 2]);
});

test('building A geometry', () => {
  const A = B('A');
  expect([A.center.x, A.center.z, A.width, A.floorHeight, A.floors]).toEqual([0, -45, 26, 3.2, 4]);
  expect(A.rotationY).toBeCloseTo(0);
  expect(A.supportsPlan).toBe(true);
  expect(L.warnings).toEqual([]);
});

test('side 1 of every building faces the park', () => {
  expect(B('B').rotationY).toBeCloseTo(-Math.PI / 2);
  expect(B('C').rotationY).toBeCloseTo(Math.PI);
  expect(B('D').rotationY).toBeCloseTo(Math.PI / 2);
  const p = planToWorld(B('A'), 13, 12, 0, 0, false);
  expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(0.6); expect(p.z).toBeCloseTo(-39);
  expect(planToWorld(B('C'), 13, 12, 0, 0, false).z).toBeCloseTo(39);
  expect(planToWorld(B('B'), 13, 12, 0, 0, false).x).toBeCloseTo(44);
  expect(planToWorld(B('D'), 13, 12, 0, 0, false).x).toBeCloseTo(-44);
});

test('interno 2 reflects across the stairwell', () => {
  expect(L.apartments.length).toBe(32);
  expect(L.apartments.find((a) => a.id === 'A-2-2')!.mirrored).toBe(true);
  expect(L.apartments.find((a) => a.id === 'A-2-1')!.mirrored).toBe(false);
  const a = planToWorld(B('A'), 2, 9, 1, 2, true);
  const b = planToWorld(B('A'), 24, 9, 1, 2, false);
  expect(a.x).toBeCloseTo(b.x); expect(a.z).toBeCloseTo(b.z); expect(a.y).toBeCloseTo(0.6 + 2 * 3.2 + 1);
});

test('worldToPlan inverts planToWorld', () => {
  for (const id of ['A', 'B', 'C', 'D']) {
    for (const mirrored of [false, true]) {
      const p = worldToPlan(B(id), planToWorld(B(id), 3.2, 7.1, 1.5, 3, mirrored), mirrored);
      expect(p.u).toBeCloseTo(3.2); expect(p.v).toBeCloseTo(7.1); expect(p.floor).toBe(3); expect(p.h).toBeCloseTo(1.5);
    }
  }
});

test('no overlaps between buildings, park and parking', () => {
  type Box = { x0: number; x1: number; z0: number; z1: number };
  const boxes: Box[] = L.buildings.map((b) => {
    const along = Math.abs(Math.cos(b.rotationY)) > 0.5;
    const w = along ? b.width : b.depth, d = along ? b.depth : b.width;
    return { x0: b.center.x - w / 2, x1: b.center.x + w / 2, z0: b.center.z - d / 2, z1: b.center.z + d / 2 };
  });
  for (const r of [L.park, L.parking])
    boxes.push({ x0: r.center.x - r.width / 2, x1: r.center.x + r.width / 2, z0: r.center.z - r.depth / 2, z1: r.center.z + r.depth / 2 });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0).toBe(true);
    }
});

test('every apartment device sits in its room', () => {
  const tol = 0.15;
  for (const apt of L.apartments) {
    const b = B(apt.building);
    for (const [type, pl] of Object.entries(APARTMENT_PLACEMENTS)) {
      if (!('room' in pl)) continue;
      const d = L.devices.get(`${apt.id}.${type}`)!;
      const p = worldToPlan(b, d.position!, apt.mirrored);
      expect(p.floor).toBe(apt.floor);
      expect(p.h).toBeGreaterThanOrEqual(0); expect(p.h).toBeLessThanOrEqual(b.floorHeight);
      const inside = ROOMS.some((r) => r.id === pl.room && p.u >= r.u0 - tol && p.u <= r.u1 + tol && p.v >= r.v0 - tol && p.v <= r.v1 + tol);
      expect(inside, `${apt.id}.${type}`).toBe(true);
    }
  }
});

test('20 apartment placements; distributed devices', () => {
  expect(Object.keys(APARTMENT_PLACEMENTS).length).toBe(20);
  expect(L.devices.get('A-2-1.window')?.distributed).toBe('windows');
  expect(L.devices.get('A-2-1.lights')?.distributed).toBe('rooms');
  expect(L.devices.get('A-S.stair_lights')?.distributed).toBe('landings');
  expect(L.devices.get('A-S.evacuation_siren')?.distributed).toBe('landings');
});

test('stairwell, building and park devices', () => {
  const A = B('A');
  const t = worldToPlan(A, L.devices.get('A-S.temperature')!.position!, false);
  expect([t.u, t.v, t.floor]).toEqual([expect.closeTo(15.3), expect.closeTo(10), 0]);
  expect(worldToPlan(A, L.devices.get('A-S.smoke')!.position!, false).floor).toBe(3);
  expect(L.devices.get('A-S.smoke_vent')!.position!.y).toBeGreaterThan(0.6 + 4 * 3.2);
  expect(L.devices.get('A.pv_power')!.position!.y).toBeGreaterThan(0.6 + 4 * 3.2);
  const station = L.devices.get('park.temperature')!.position!;
  expect([station.x, station.z]).toEqual([26, 21]);          // SE corner of the park, inset 4 m
  expect(L.devices.get('park.humidity')!.position!.y).toBeCloseTo(2.3);
  expect(L.devices.get('park.seismic')!.position!.y).toBeCloseTo(0.3);
  expect(L.parkFixtures.irrigation.length).toBe(6);
  expect(L.parkFixtures.lamps.length).toBe(6);
  expect(L.parkFixtures.signs.length).toBe(5);
});

test('all devices are placed', () => {
  expect(L.devices.size).toBe(697);
  for (const d of L.devices.values()) expect(d.position, d.deviceId).not.toBeNull();
});

test('chargers inside the parking lot, west to east', () => {
  expect(L.chargers.map((c) => c.id)).toEqual(['EV-A', 'EV-B', 'EV-C', 'EV-D']);
  const xs = L.chargers.map((c) => c.position.x);
  for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  for (const c of L.chargers) {
    expect(Math.abs(c.position.x - L.parking.center.x)).toBeLessThan(L.parking.width / 2);
    expect(Math.abs(c.position.z - L.parking.center.z)).toBeLessThan(L.parking.depth / 2);
    expect(c.position.z).toBeLessThan(L.parking.center.z);   // edge facing the buildings (north)
  }
});

test('rotation mismatch gives a warning', () => {
  const m = clone();
  m.units.find((u) => u.id === 'A')!.attrs.layout.rotation_deg = 90;
  expect(buildComplexLayout(m).warnings.some((w) => w.startsWith('A: rotation_deg 90'))).toBe(true);
});

test('three apartments per floor falls back to blocks', () => {
  const m = clone();
  const base = m.units.find((u) => u.id === 'A-0-1')!;
  m.units.push({ ...base, id: 'A-0-3', attrs: { ...base.attrs, number: 3 } });
  const l = buildComplexLayout(m);
  expect(l.buildings.find((b) => b.id === 'A')!.supportsPlan).toBe(false);
  expect(l.warnings).toContain('A: pianta tipo non applicabile, uso blocchi');
  expect(l.devices.get('A-0-1.temperature')!.position).toBeNull();
  expect(l.devices.get('B-0-1.temperature')!.position).not.toBeNull();
});

test('both apartments of every building have their balconies facing the central park', () => {
  for (const b of L.buildings) {
    for (const mirrored of [false, true]) {
      const inside = planToWorld(b, 3.3, 6, 0, 0, mirrored);
      const balcony = planToWorld(b, 3.3, 12.75, 0, 0, mirrored);
      const facingPark = (balcony.x - inside.x) * -b.center.x + (balcony.z - inside.z) * -b.center.z;
      expect(facingPark, `${b.id} interno ${mirrored ? 2 : 1}`).toBeGreaterThan(0);
    }
  }
});
