// Labels by zoom level (view spec §8.4, V11).

export type Lod = 'far' | 'mid' | 'near';
export const MAX_LABELS = 40;

export function lodLevel(distance: number, floorCut: boolean): Lod {
  if (floorCut) return 'near';
  if (distance > 150) return 'far';
  return distance >= 60 ? 'mid' : 'near';
}

/** The nearest `max` items inside the camera frustum. */
export function pickLabels<T extends { distance: number; inView: boolean }>(items: T[], max = MAX_LABELS): T[] {
  return items.filter((i) => i.inView).sort((a, b) => a.distance - b.distance).slice(0, max);
}
