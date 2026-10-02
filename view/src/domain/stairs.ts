// The stair flight of the core (view spec §7.2): steps rise from STAIRS.v1 towards STAIRS.v0.
import { STAIRS } from './plan';

export const STAIR_STEPS = 9;
export const STAIR_RISE_M = 0.18;

/** Height of the tread under a plan point, above the floor; 0 off the flight. */
export function stairTread(u: number, v: number): number {
  if (u < STAIRS.u0 || u > STAIRS.u1 || v < STAIRS.v0 || v > STAIRS.v1) return 0;
  const depth = (STAIRS.v1 - STAIRS.v0) / STAIR_STEPS;
  return STAIR_RISE_M * Math.min(STAIR_STEPS, Math.floor((STAIRS.v1 - v) / depth) + 1);
}
