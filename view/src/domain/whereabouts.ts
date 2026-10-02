// Where the walker is (V21 §3.3): apartment, balcony, stairwell of the open building, or outdoors.
import type { ComplexLayout } from './layout';
import { BALCONY, PLAN_D, PLAN_W, PLINTH_M, mirror, type PlanRect } from './plan';
import { CORE_SLAB_M } from './stairs';
import { toPlan } from './walkWorld';

export type Place =
  | { kind: 'apartment' | 'balcony'; unitId: string; building: string; floor: number }
  | { kind: 'stairwell'; unitId: string; building: string; floor: number }
  | { kind: 'outdoor' };

const OUTDOOR: Place = { kind: 'outdoor' };
const inside = (r: PlanRect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
const [bu0, bv0] = mirror(BALCONY.u1, BALCONY.v1);
const [bu1, bv1] = mirror(BALCONY.u0, BALCONY.v0);
const BALCONY_2: PlanRect = { u0: bu0, u1: bu1, v0: Math.min(bv0, bv1), v1: Math.max(bv0, bv1) };

export function locate(layout: ComplexLayout, openBuilding: string | null, w: { x: number; z: number; feet: number }): Place {
  const b = layout.buildings.find((x) => x.id === openBuilding);
  if (!b) return OUTDOOR;
  const { u, v } = toPlan(b, w.x, w.z);
  const floor = Math.max(0, Math.min(b.floors - 1, Math.round((w.feet - PLINTH_M - CORE_SLAB_M) / b.floorHeight)));
  const apartment = (n: 1 | 2, kind: 'apartment' | 'balcony'): Place => {
    const unitId = `${b.id}-${floor}-${n}`;
    return layout.apartments.some((a) => a.id === unitId) ? { kind, unitId, building: b.id, floor } : OUTDOOR;
  };
  if (u >= 0 && u <= PLAN_W && v >= 0 && v <= PLAN_D) {
    if (u < 10.5) return apartment(1, 'apartment');
    if (u > PLAN_W - 10.5) return apartment(2, 'apartment');
    return { kind: 'stairwell', unitId: `${b.id}-S`, building: b.id, floor };
  }
  if (inside(BALCONY, u, v)) return apartment(1, 'balcony');
  if (inside(BALCONY_2, u, v)) return apartment(2, 'balcony');
  return OUTDOOR;
}

export function placeLabel(p: Place): string {
  switch (p.kind) {
    case 'apartment': return p.unitId;
    case 'balcony': return `${p.floor === 0 ? 'Patio' : 'Balcone'} di ${p.unitId}`;
    case 'stairwell': return `Vano scale ${p.building} · ${p.floor === 0 ? 'piano terra' : `piano ${p.floor}`}`;
    case 'outdoor': return 'All’aperto';
  }
}

export function samePlace(a: Place, b: Place): boolean {
  return a.kind === b.kind && (a.kind === 'outdoor' || (b.kind !== 'outdoor' && a.unitId === b.unitId && a.floor === b.floor));
}
