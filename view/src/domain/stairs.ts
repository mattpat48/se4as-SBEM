// The two-flight stair of the core (V21), inside the STAIRS rectangle: from each floor landing
// (v = STAIRS.v1) the up flight rises towards side 2 on the u > 13 half, turns on a mid landing,
// and the second flight climbs back on the u < 13 half to the landing of the floor above.
import { STAIRS, type PlanRect } from './plan';

export const FLIGHT_STEPS = 9;
export const TREAD_M = 0.28;
/** Thickness of the core floor slab: treads are measured from the floor, like the landing. */
export const CORE_SLAB_M = 0.1;
const FLIGHT_RUN = FLIGHT_STEPS * TREAD_M;
const TURN_V = STAIRS.v1 - FLIGHT_RUN;

export const STAIR_DIVIDER: PlanRect = { u0: 12.95, u1: 13.05, v0: TURN_V, v1: STAIRS.v1 };
export const UP_HALF: PlanRect = { u0: STAIR_DIVIDER.u1, u1: STAIRS.u1, v0: TURN_V, v1: STAIRS.v1 };
export const DOWN_HALF: PlanRect = { u0: STAIRS.u0, u1: STAIR_DIVIDER.u0, v0: TURN_V, v1: STAIRS.v1 };
export const MID_LANDING: PlanRect = { u0: STAIRS.u0, u1: STAIRS.u1, v0: STAIRS.v0, v1: TURN_V };

/** 18 risers per storey. */
export function stairRise(floorHeight: number): number {
  return floorHeight / (2 * FLIGHT_STEPS);
}

export interface StairStep extends PlanRect { top: number }

/** The treads of one storey (18) and the mid landing, with their top above the storey floor. */
export function stairSteps(floorHeight: number): StairStep[] {
  const rise = stairRise(floorHeight);
  const out: StairStep[] = [];
  for (let i = 0; i < FLIGHT_STEPS; i++) {
    out.push({ ...UP_HALF, v0: STAIRS.v1 - (i + 1) * TREAD_M, v1: STAIRS.v1 - i * TREAD_M, top: CORE_SLAB_M + (i + 1) * rise });
  }
  out.push({ ...MID_LANDING, top: CORE_SLAB_M + FLIGHT_STEPS * rise });
  for (let j = 0; j < FLIGHT_STEPS; j++) {
    out.push({ ...DOWN_HALF, v0: TURN_V + j * TREAD_M, v1: TURN_V + (j + 1) * TREAD_M, top: CORE_SLAB_M + (FLIGHT_STEPS + j + 1) * rise });
  }
  return out;
}

const inside = (r: PlanRect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

/** Height of the tread under a plan point above the storey floor; 0 off the flights. */
export function stairTread(u: number, v: number, floorHeight = 3.2): number {
  if (inside(STAIR_DIVIDER, u, v) && !inside(MID_LANDING, u, v)) return 0;
  const step = stairSteps(floorHeight).find((s) => inside(s, u, v));
  return step?.top ?? 0;
}
