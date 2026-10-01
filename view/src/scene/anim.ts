// Tiny animation helpers for discrete states (view spec §6.4: 0.5 s transitions).
export const TRANSITION_S = 0.5;

/** Moves `cur` towards `target` covering `range` in TRANSITION_S seconds. */
export function approach(cur: number, target: number, dt: number, range = 1): number {
  const step = (range * dt) / TRANSITION_S;
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
}

/** 0/1 blink at `hz`. */
export const blink = (t: number, hz: number) => (Math.sin(2 * Math.PI * hz * t) > 0 ? 1 : 0);
