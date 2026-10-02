import { FURNITURE, furnitureForFloor } from './furniture';
import { PEOPLE_SLOTS } from './people';
import { APARTMENT_PLACEMENTS } from './placement';
import { BALCONY, CUT_WALL_M, ENTRY_DOOR, INTERIOR_WALLS, ROOMS, type PlanRect } from './plan';

const overlaps = (a: PlanRect, b: PlanRect) =>
  a.u0 < b.u1 - 1e-8 && a.u1 > b.u0 + 1e-8 && a.v0 < b.v1 - 1e-8 && a.v1 > b.v0 + 1e-8;
const contains = (a: PlanRect, b: PlanRect) =>
  b.u0 >= a.u0 - 0.05 && b.u1 <= a.u1 + 0.05 && b.v0 >= a.v0 - 0.05 && b.v1 <= a.v1 + 0.05;

test('furniture stays in its room or balcony and clear of interior wall thickness', () => {
  for (const f of FURNITURE) {
    expect(f.u1 > f.u0 && f.v1 > f.v0, f.id).toBe(true);
    const rooms = f.room === 'balcony' ? [BALCONY] : ROOMS.filter((r) => r.id === f.room);
    expect(rooms.some((r) => contains(r, f)), f.id).toBe(true);
    for (const [u0, v0, u1, v1] of INTERIOR_WALLS)
      expect(overlaps(f, { u0: u0 - 0.1, u1: u1 + 0.1, v0: v0 - 0.1, v1: v1 + 0.1 }), f.id).toBe(false);
  }
});

test('footprints do not overlap, including small rugs', () => {
  expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
  FURNITURE.forEach((a, i) => FURNITURE.slice(i + 1).forEach((b) => {
    expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
  }));
});

test('all five room doors and the entrance retain a 0.9 m approach on both sides', () => {
  const approaches = [[4.5, 5.4, 6.5], [8, 8.9, 6.5], [2.8, 3.7, 4.5], [4.8, 5.7, 3], [7.5, 8.4, 3]]
    .map(([u0, u1, v]) => ({ u0, u1, v0: v - 0.9, v1: v + 0.9 }));
  approaches.push({ u0: ENTRY_DOOR.u - 0.9, u1: ENTRY_DOOR.u + 0.9, v0: ENTRY_DOOR.v0, v1: ENTRY_DOOR.v1 });
  for (const f of FURNITURE)
    for (const door of approaches) expect(overlaps(f, door), f.id).toBe(false);
});

test('all twelve standing people retain a 0.3 m radius free of furniture', () => {
  for (const f of FURNITURE) for (const p of PEOPLE_SLOTS) {
    const du = Math.max(f.u0 - p.u, 0, p.u - f.u1);
    const dv = Math.max(f.v0 - p.v, 0, p.v - f.v1);
    expect(Math.hypot(du, dv), `${f.id} / ${p.room} (${p.u}, ${p.v})`).toBeGreaterThanOrEqual(0.3 - 1e-8);
  }
});

test('low device anchors stay free, except the declared hob above the gas valve', () => {
  for (const [type, p] of Object.entries(APARTMENT_PLACEMENTS)) {
    if (!('room' in p) || p.h === 'ceiling' || p.h > CUT_WALL_M) continue;
    for (const f of FURNITURE) {
      if (f.kind === 'kitchen' && type === 'gas_valve') continue;
      expect(p.u >= f.u0 && p.u <= f.u1 && p.v >= f.v0 && p.v <= f.v1, `${f.id} / ${type}`).toBe(false);
    }
  }
});

test('furniture is below the cut, including sectioned cabinets and boiler', () => {
  for (const f of FURNITURE) {
    expect(f.h, f.id).toBeGreaterThan(0.12);
    expect(f.h, f.id).toBeLessThanOrEqual(CUT_WALL_M);
  }
});

test('less than 40 percent of every room is covered, conservatively counting full footprints', () => {
  for (const room of new Set(FURNITURE.map((f) => f.room))) {
    const areas = room === 'balcony' ? [BALCONY] : ROOMS.filter((r) => r.id === room);
    const area = areas.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
    const covered = FURNITURE.filter((f) => f.room === room).reduce((s, f) => s + (f.u1 - f.u0) * (f.v1 - f.v0), 0);
    expect(covered / area, room).toBeLessThan(0.4);
  }
});

test('all requested furniture exists and balcony chairs appear only above ground floor', () => {
  expect(new Set(FURNITURE.map((f) => f.kind))).toEqual(new Set([
    'kitchen', 'sofa', 'table', 'chair', 'tv', 'rug', 'plant', 'doubleBed', 'singleBed', 'cabinet', 'desk', 'toilet', 'sink', 'shower', 'boiler', 'coatRack',
  ]));
  expect(FURNITURE.filter((f) => f.room === 'living' && f.kind === 'chair')).toHaveLength(4);
  expect(FURNITURE.filter((f) => f.room === 'balcony' && f.kind === 'chair')).toHaveLength(2);
  expect(furnitureForFloor(0).some((f) => f.room === 'balcony')).toBe(false);
  expect(furnitureForFloor(1)).toEqual(FURNITURE);
});

test('dining and balcony chairs face their table', () => {
  for (const room of ['living', 'balcony']) {
    const table = FURNITURE.find((f) => f.id === (room === 'living' ? 'dining-table' : 'balcony-table'))!;
    for (const chair of FURNITURE.filter((f) => f.room === room && f.kind === 'chair')) {
      const du = (table.u0 + table.u1 - chair.u0 - chair.u1) / 2;
      const dv = (table.v0 + table.v1 - chair.v0 - chair.v1) / 2;
      const facing = (Math.sin(chair.rotation ?? 0) * du + Math.cos(chair.rotation ?? 0) * dv) / Math.hypot(du, dv);
      expect(facing, chair.id).toBeGreaterThan(0.95);
    }
  }
});

test('first person restores full-height cabinets and showers without changing footprints', () => {
  const full=furnitureForFloor(2,true);
  for(const f of full) {
    const original=FURNITURE.find(x=>x.id===f.id)!;
    expect([f.u0,f.u1,f.v0,f.v1]).toEqual([original.u0,original.u1,original.v0,original.v1]);
    expect(f.h).toBeLessThan(2.9);
    if(f.sectioned) expect(f.h).toBeGreaterThan(1.1);
  }
});
