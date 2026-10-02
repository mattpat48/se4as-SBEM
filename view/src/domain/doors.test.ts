import {
  BALCONY_DOOR, buildingDoors, canClose, doorBox, doorLeaves, isPassable, nextOpenBuilding, pickDoor, sashSpans,
} from './doors';
import { FURNITURE } from './furniture';
import { buildComplexLayout } from './layout';
import type { ComplexModelMsg } from './messages';
import { WINDOWS, mirror } from './plan';
import model from '../test/fixtures/model.json';

const layout = buildComplexLayout(model as unknown as ComplexModelMsg);
const A = layout.buildings.find((b) => b.id === 'A')!;
const doorsA = buildingDoors(A, layout.apartments.filter((a) => a.building === 'A'));
const byId = (id: string) => doorsA.find((d) => d.id === id)!;

test('every building has 7 doors per apartment and two portoni (58)', () => {
  expect(doorsA).toHaveLength(58);
  expect(new Set(doorsA.map((d) => d.id)).size).toBe(58);
  expect(byId('A:park')).toMatchObject({ kind: 'portone', floor: 0, leaves: 2, locked: false, axis: 'u', at: 12 });
  expect(byId('A:street')).toMatchObject({ kind: 'portone', locked: true, at: 0 });
  expect(byId('A-2-1:entry')).toMatchObject({ axis: 'v', at: 10.5, a0: 4.6, a1: 5.6, floor: 2, defaultOpen: false });
  expect(byId('A-2-1:bath').defaultOpen).toBe(true);
  expect(byId('A-2-1:balcony')).toMatchObject({ axis: 'u', at: 12, a0: BALCONY_DOOR.u0, a1: BALCONY_DOOR.u1, defaultOpen: false });
});

test('interno 2 doors reflect across the stairwell', () => {
  const entry = byId('A-0-2:entry');
  expect(entry).toMatchObject({ axis: 'v', at: 15.5, swing: 1 });
  expect(entry.a0).toBeCloseTo(4.6);
  expect(entry.a1).toBeCloseTo(5.6);
  expect(byId('A-0-2:balcony')).toMatchObject({ at: 12, swing: -1 });
});

test('a closed leaf lies along the wall, an open one stands across it on the swing side', () => {
  const d = byId('A-1-1:living');
  const [closed] = doorLeaves(d, 0);
  expect(closed).toMatchObject({ hu: 4.5, hv: 6.5 });
  expect(closed.eu).toBeCloseTo(5.4);
  expect(closed.ev).toBeCloseTo(6.5);
  const [open] = doorLeaves(d, 1);
  expect(open.eu).toBeCloseTo(4.5);
  expect(open.ev).toBeCloseTo(7.4);
  expect(doorLeaves(byId('A:park'), 1)).toHaveLength(2);
  expect(doorBox(d)).toEqual({ u0: 4.5, u1: 5.4, v0: 6.4, v1: 6.6 });
});

test('no open leaf hits the furniture, in both interni', () => {
  const solid = FURNITURE.filter((f) => f.kind !== 'rug' && f.room !== 'balcony');
  for (const d of doorsA.filter((x) => x.kind !== 'portone' && x.floor === 1)) {
    const mirrored = d.unitId.endsWith('-2');
    const rects = solid.map((f) => {
      if (!mirrored) return f;
      const [u0, v0] = mirror(f.u1, f.v1);
      const [u1, v1] = mirror(f.u0, f.v0);
      return { ...f, u0, u1, v0: Math.min(v0, v1), v1: Math.max(v0, v1) };
    });
    for (const leaf of doorLeaves(d, 1)) {
      for (let k = 0; k <= 20; k++) {
        const u = leaf.hu + (leaf.eu - leaf.hu) * k / 20, v = leaf.hv + (leaf.ev - leaf.hv) * k / 20;
        const hit = rects.find((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1);
        expect(hit, `${d.id} → ${hit?.id}`).toBeUndefined();
      }
    }
  }
});

test('E picks the nearest door in front within 1.6 m, never one behind', () => {
  const doors = doorsA.filter((d) => d.floor === 2);
  // In the hall facing the living-room door (towards +v).
  expect(pickDoor(doors, { u: 4.95, v: 5.6, floor: 2 }, 0)?.id).toBe('A-2-1:living');
  expect(pickDoor(doors, { u: 4.95, v: 5.6, floor: 2 }, Math.PI)?.id).not.toBe('A-2-1:living');
  expect(pickDoor(doors, { u: 4.95, v: 4.6, floor: 2 }, 0)?.id).not.toBe('A-2-1:living');   // 1.9 m away
  expect(pickDoor(doors, { u: 4.95, v: 5.6, floor: 1 }, 0)).toBeNull();
});

test('a door with someone in its doorway or sweep does not close', () => {
  const d = byId('A-2-1:living');
  expect(canClose(d, { u: 4.95, v: 6.5, floor: 2 }, 0.18)).toBe(false);
  expect(canClose(d, { u: 4.7, v: 7.2, floor: 2 }, 0.18)).toBe(false);
  expect(canClose(d, { u: 4.95, v: 5.2, floor: 2 }, 0.18)).toBe(true);
  expect(canClose(d, { u: 4.95, v: 6.5, floor: 3 }, 0.18)).toBe(true);
});

test('a doorway is passable from 60% open', () => {
  expect(isPassable(0.59)).toBe(false);
  expect(isPassable(0.6)).toBe(true);
});

test('only one building is open: the one whose park portone was opened last', () => {
  expect(nextOpenBuilding('A', 'B:park', true, true)).toBe('B');
  expect(nextOpenBuilding('A', 'A:park', false, true)).toBeNull();
  expect(nextOpenBuilding('A', 'A:park', false, false)).toBe('A');
  expect(nextOpenBuilding(null, 'C:park', true, true)).toBe('C');
  expect(nextOpenBuilding('A', 'A-2-1:entry', true, false)).toBe('A');
  expect(nextOpenBuilding('A', 'B:park', false, true)).toBe('A');
});

test('the french window keeps its sashes beside the balcony door', () => {
  const tall = WINDOWS.find((w) => w.tall)!;
  expect(sashSpans(tall)).toEqual([[0.6, 3.2], [4.1, 6.0]]);
  const small = WINDOWS.find((w) => !w.tall && w.unit === 'apt1')!;
  expect(sashSpans(small)).toEqual([[small.u0, small.u1]]);
});
