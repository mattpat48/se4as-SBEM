import { LANDING, ROOMS, STAIRS } from './plan';
import { PEOPLE_SLOTS, peopleCount, peopleSlots, stairSlots } from './people';

test('count from occupancy', () => {
  expect([peopleCount(2.6), peopleCount(-1), peopleCount(0.4)]).toEqual([3, 0, 0]);
});

test('stable, distinct slots, at most 12', () => {
  expect(PEOPLE_SLOTS.length).toBe(12);
  expect(peopleSlots('A-2-1', 3)).toEqual(peopleSlots('A-2-1', 3));
  expect(peopleSlots('A-2-1', 3)).not.toEqual(peopleSlots('B-1-2', 3));
  expect(new Set(peopleSlots('A-2-1', 20).map((p) => `${p.u},${p.v}`)).size).toBe(12);
  expect(peopleSlots('A-2-1', 0)).toEqual([]);
});

test('slots lie inside rooms, 0.5 m from the walls', () => {
  for (const s of PEOPLE_SLOTS) {
    const inside = ROOMS.some((r) => r.id === s.room && s.u >= r.u0 + 0.5 && s.u <= r.u1 - 0.5 && s.v >= r.v0 + 0.5 && s.v <= r.v1 - 0.5);
    expect(inside, `${s.room} ${s.u},${s.v}`).toBe(true);
  }
});

test('stair slots along the stairs, max 8', () => {
  expect(stairSlots(3).length).toBe(3);
  expect(stairSlots(20).length).toBe(8);
  for (const s of stairSlots(8)) {
    const inStairs = [STAIRS, LANDING].some((r) => s.u >= r.u0 && s.u <= r.u1 && s.v >= r.v0 && s.v <= r.v1);
    expect(inStairs).toBe(true);
  }
});
