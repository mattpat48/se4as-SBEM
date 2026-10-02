// Labels by zoom level (view spec §8.4, V11).

export type Lod = 'far' | 'mid' | 'near';
export const MAX_LABELS = 40;

export function lodLevel(distance: number, floorCut: boolean): Lod {
  if (floorCut) return 'near';
  if (distance > 150) return 'far';
  return distance >= 60 ? 'mid' : 'near';
}

/**
 * The nearest `max` items inside the camera frustum that are also `visible` (not hidden behind a
 * building). Visibility is asked nearest first and only until the limit is reached.
 */
export function pickLabels<T extends { distance: number; inView: boolean }>(items: T[], max = MAX_LABELS,
  visible: (item: T) => boolean = () => true): T[] {
  const out: T[] = [];
  for (const it of items.filter((i) => i.inView).sort((a, b) => a.distance - b.distance)) {
    if (out.length >= max) break;
    if (visible(it)) out.push(it);
  }
  return out;
}
