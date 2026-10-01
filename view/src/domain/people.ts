// People silhouettes from the occupancy sensors (view spec §7.5), at stable seeded slots.
import { hashString, mulberry32 } from './random';
import type { RoomId } from './plan';

/** 12 fixed spots in the rooms of interno 1, at least 0.5 m from the walls. */
export const PEOPLE_SLOTS: { room: RoomId; u: number; v: number }[] = [
  { room: 'living', u: 2.2, v: 7.4 }, { room: 'living', u: 4.2, v: 8.2 }, { room: 'living', u: 5.6, v: 10.6 },
  { room: 'living', u: 3.0, v: 10.2 }, { room: 'living', u: 5.4, v: 7.2 },
  { room: 'bedroom', u: 8.0, v: 9.0 }, { room: 'bedroom', u: 9.6, v: 11.2 },
  { room: 'bedroom2', u: 1.5, v: 2.0 }, { room: 'bedroom2', u: 2.8, v: 3.4 },
  { room: 'bath', u: 5.2, v: 1.6 }, { room: 'bath2', u: 8.5, v: 1.5 }, { room: 'hall', u: 7.5, v: 4.8 },
];

export function peopleCount(occupancy: number): number {
  return Math.max(0, Math.round(occupancy));
}

/** A stable pick of min(count, 12) distinct slots, seeded by the apartment id. */
export function peopleSlots(apartmentId: string, count: number): { u: number; v: number }[] {
  const rnd = mulberry32(hashString(apartmentId));
  const idx = PEOPLE_SLOTS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(Math.max(0, count), PEOPLE_SLOTS.length)).map((i) => ({ u: PEOPLE_SLOTS[i].u, v: PEOPLE_SLOTS[i].v }));
}

const STAIR_MAX = 8;

/** Spots along the stairs and landings, two per floor from the ground up. */
export function stairSlots(count: number): { u: number; v: number; floorOffset: number }[] {
  return Array.from({ length: Math.min(Math.max(0, count), STAIR_MAX) }, (_, i) => ({
    u: i % 2 === 0 ? 12 : 14.2, v: i % 2 === 0 ? 2.0 : 5.6, floorOffset: Math.floor(i / 2),
  }));
}
