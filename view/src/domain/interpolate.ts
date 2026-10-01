// Interpolation between samples and the "stale" rule (view spec §6.4).

export interface ReadingPoint { last: number; lastAt: number; prev?: number }

export const STALE_PERIODS = 3;

/** prev + (last − prev) × clamp((now − lastAt) / period, 0, 1); no interpolation on the first sample. */
export function displayedValue(r: ReadingPoint, nowMs: number, periodMs: number): number {
  if (r.prev === undefined) return r.last;
  const t = Math.min(1, Math.max(0, (nowMs - r.lastAt) / periodMs));
  return r.prev + (r.last - r.prev) * t;
}

export function isStale(lastAt: number, nowMs: number, periodMs: number): boolean {
  return nowMs - lastAt > STALE_PERIODS * periodMs;
}
