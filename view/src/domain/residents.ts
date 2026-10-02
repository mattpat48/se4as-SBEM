// Animated residents (decision V20): Quaternius Ultimate Modular characters (CC0), with a variant,
// height and idle clip that stay stable for an apartment and slot.
import { hashString, mulberry32 } from './random';

export const RESIDENT_MODELS = [
  'woman-casual', 'woman-formal', 'woman-suit', 'woman-worker',
  'man-casual', 'man-hoodie', 'man-suit', 'man-worker',
] as const;
export type ResidentModel = (typeof RESIDENT_MODELS)[number];
export type ResidentClip = 'Idle' | 'Idle_Neutral' | 'Walk';

export function residentModelUrl(model: string): string {
  return `/models/people/${model}.glb`;
}

/** Identity of a resident: the unit (apartment or stairwell) and the slot index. */
export function residentKey(unitId: string, slot: number): string {
  return `${unitId}#${slot}`;
}

const draws = (key: string) => mulberry32(hashString(key));

export function residentVariant(key: string): number {
  return Math.floor(draws(key)() * RESIDENT_MODELS.length);
}

export function residentHeight(key: string): number {
  const r = draws(key);
  r();
  return 1.6 + 0.2 * r();
}

/** At home people stand idle; in the stairwell they are passing through. */
export function residentClip(key: string, where: 'home' | 'stairs'): ResidentClip {
  if (where === 'stairs') return 'Walk';
  const r = draws(key);
  r(); r();
  return r() < 0.5 ? 'Idle' : 'Idle_Neutral';
}

/** Facing in the plan frame (0 = towards +v): stable at home, up the flight on the stairs. */
export function residentYaw(key: string, where: 'home' | 'stairs'): number {
  if (where === 'stairs') return Math.PI;
  const r = draws(key);
  r(); r(); r();
  return 2 * Math.PI * r();
}
