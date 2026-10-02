// Wooden floor of the cut slab (decision V20): plank layout for a generated texture, and the finish
// of the floor (wood, data colour on wood, grey stripes for stale data, plain "plastico" slab).
import { mulberry32 } from './random';

export interface Plank { x: number; y: number; w: number; h: number; tone: number }

/** Planks covering a square texture of `size` px in `rows` rows, joints staggered from row to row. */
export function woodPlanks(size: number, rows: number, seed: number): Plank[] {
  const rnd = mulberry32(seed);
  const h = Math.floor(size / rows);
  const out: Plank[] = [];
  for (let r = 0; r < rows; r++) {
    const y = r * h, rowH = r === rows - 1 ? size - y : h;
    let x = 0;
    let len = Math.round(size * (0.1 + 0.4 * rnd()));          // first plank: the staggered offset
    while (x < size) {
      const w = Math.min(len, size - x);
      out.push({ x, y, w, h: rowH, tone: rnd() });
      x += w;
      len = Math.round(size * (0.35 + 0.3 * rnd()));
    }
  }
  return out;
}

export interface FloorFinish { map: 'wood' | 'stripes' | 'none'; tint: 'heat' | 'wood' | 'slab' }

/** `tint: 'heat'` is the heat colour, already grey when the data are stale or missing. */
export function floorFinish({ heatOn, state, dataMode }: {
  heatOn: boolean; state: 'ok' | 'stale' | 'missing'; dataMode: boolean;
}): FloorFinish {
  if (heatOn && state === 'stale') return { map: 'stripes', tint: 'heat' };
  if (dataMode) return { map: 'none', tint: heatOn ? 'heat' : 'slab' };
  return { map: 'wood', tint: heatOn ? 'heat' : 'wood' };
}
