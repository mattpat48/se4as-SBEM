// First-person navigation in apartment plan metres; independent of rendering and input.
import { FURNITURE } from './furniture';
import type { ApartmentGeom, ComplexLayout } from './layout';
import { INTERIOR_WALLS, type PlanRect } from './plan';

export interface WalkPoint { u: number; v: number }
export const WALK_START: WalkPoint = { u: 4.8, v: 10.5 };
export const WALK_EYE_M = 1.65;
export const WALK_RADIUS_M = 0.18;
const obstacles: PlanRect[] = [
  ...INTERIOR_WALLS.map(([u0,v0,u1,v1]) => ({u0:u0-.1,u1:u1+.1,v0:v0-.1,v1:v1+.1})),
  ...FURNITURE.filter((f) => f.kind !== 'rug' && f.room !== 'balcony'),
];
export function canStand(p: WalkPoint): boolean {
  const r = WALK_RADIUS_M;
  if (!Number.isFinite(p.u) || !Number.isFinite(p.v) || p.u < .1+r || p.u > 10.4-r || p.v < .1+r || p.v > 11.9-r) return false;
  return !obstacles.some((o) => Math.hypot(Math.max(o.u0-p.u,0,p.u-o.u1),Math.max(o.v0-p.v,0,p.v-o.v1)) < r);
}
export function moveWalker(p: WalkPoint, du: number, dv: number): WalkPoint {
  if (!Number.isFinite(du) || !Number.isFinite(dv)) return p;
  const steps = Math.max(1, Math.ceil(Math.hypot(du,dv)/.06));
  const next = {...p};
  for (let i=0;i<steps;i++) {
    const x = {u:next.u+du/steps,v:next.v};
    if (canStand(x)) next.u=x.u;
    const z = {u:next.u,v:next.v+dv/steps};
    if (canStand(z)) next.v=z.v;
  }
  return next;
}
export function chooseWalkApartment(layout: ComplexLayout, selected: string|null, building: string|null, floor: number|null): ApartmentGeom|null {
  const supported = layout.apartments.filter((a) => layout.buildings.some((b) => b.id===a.building && b.supportsPlan));
  return supported.find((a) => a.id===selected) ?? supported.find((a) => (!building || a.building===building) && (floor===null || a.floor===floor)) ?? null;
}
