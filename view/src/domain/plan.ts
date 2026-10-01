// Typical floor plan (view spec §7.2), in plan metres: u along the long side (0…26),
// v in depth (0 = side 2, 12 = side 1). All values are for interno 1; interno 2 is
// the same plan rotated by 180° (see `mirror`).

export const PLAN_W = 26;
export const PLAN_D = 12;
export const PLINTH_M = 0.6;
export const PARAPET_M = 1;
export const CUT_WALL_M = 1.1;
export const SILL_M = 0.9;
export const WINDOW_H_M = 1.5;
export const TALL_WINDOW_H_M = 2.4;

export interface PlanRect { u0: number; u1: number; v0: number; v1: number }

export type RoomId = 'living' | 'bedroom' | 'bedroom2' | 'bath' | 'bath2' | 'hall';

export const ROOMS: ({ id: RoomId } & PlanRect)[] = [
  { id: 'living', u0: 0, u1: 6.5, v0: 6.5, v1: 12 },
  { id: 'bedroom', u0: 6.5, u1: 10.5, v0: 6.5, v1: 12 },
  { id: 'bedroom2', u0: 0, u1: 4, v0: 0, v1: 4.5 },
  { id: 'bath', u0: 4, u1: 6.5, v0: 0, v1: 3 },
  { id: 'bath2', u0: 6.5, u1: 10.5, v0: 0, v1: 3 },
  { id: 'hall', u0: 4, u1: 10.5, v0: 3, v1: 6.5 },
  { id: 'hall', u0: 0, u1: 4, v0: 4.5, v1: 6.5 },
];

/** Kitchen counter inside the living room. */
export const KITCHEN: PlanRect = { u0: 0.6, u1: 1.2, v0: 8.2, v1: 11.6 };

/** Interior walls of interno 1 as [u0, v0, u1, v1], with 0.9 m door gaps. */
export const INTERIOR_WALLS: [number, number, number, number][] = [
  [6.5, 6.5, 6.5, 12],                                             // living | bedroom
  [0, 6.5, 4.5, 6.5], [5.4, 6.5, 8, 6.5], [8.9, 6.5, 10.5, 6.5],   // front rooms | hall
  [4, 0, 4, 4.5],                                                  // bedroom 2 | bath, hall
  [0, 4.5, 2.8, 4.5], [3.7, 4.5, 4, 4.5],                          // bedroom 2 | corridor
  [4, 3, 4.8, 3], [5.7, 3, 7.5, 3], [8.4, 3, 10.5, 3],             // baths | hall
  [6.5, 0, 6.5, 3],                                                // bath | bath 2
];

export interface PlanWindow { side: 1 | 2; u0: number; u1: number; tall: boolean; unit: 'apt1' | 'core' }

export const WINDOWS: PlanWindow[] = [
  { side: 1, u0: 0.6, u1: 6.0, tall: true, unit: 'apt1' },
  { side: 1, u0: 7.3, u1: 9.8, tall: false, unit: 'apt1' },
  { side: 2, u0: 0.8, u1: 3.3, tall: false, unit: 'apt1' },
  { side: 2, u0: 4.8, u1: 5.8, tall: false, unit: 'apt1' },
  { side: 2, u0: 7.8, u1: 9.3, tall: false, unit: 'apt1' },
  { side: 2, u0: 11.2, u1: 14.8, tall: false, unit: 'core' },     // stair window, from floor 1
];

export const BALCONY: PlanRect = { u0: 0.4, u1: 6.2, v0: 12, v1: 13.5 };
export const CORE: PlanRect = { u0: 10.5, u1: 15.5, v0: 0, v1: 12 };
export const STAIRS: PlanRect = { u0: 11, u1: 15, v0: 0.5, v1: 4.5 };
export const LANDING: PlanRect = { u0: 10.5, u1: 15.5, v0: 4.5, v1: 8.5 };
export const LIFT: PlanRect = { u0: 11, u1: 13, v0: 8.5, v1: 10.9 };
export const ANDRONE: PlanRect = { u0: 13, u1: 15.5, v0: 8.5, v1: 12 };
export const ENTRY_DOOR = { u: 10.5, v0: 4.6, v1: 5.6 };

export function mirror(u: number, v: number): [number, number] {
  return [PLAN_W - u, PLAN_D - v];
}
