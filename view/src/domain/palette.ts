// Scene palettes (view spec §7.6, V13), from the approved style prototype:
// "realistico" → DAY, "digital twin" → NIGHT, "plastico" → DATA.

export interface Palette {
  sky: string; ground: string; grass: string; path: string; road: string; wall: string; core: string;
  plinth: string; slab: string; glass: string; trunk: string; leaf: string;
  sunColor: string; sunIntensity: number; hemiSky: string; hemiGround: string; hemiIntensity: number; exposure: number;
}

export const DAY: Palette = {
  sky: '#bcd7f0', ground: '#9fb88a', grass: '#7fb069', path: '#d9cdb6', road: '#555a61', wall: '#efe4d2',
  core: '#e3d6c1', plinth: '#9b958c', slab: '#d9d2c5', glass: '#7fa7c4', trunk: '#6b4f3a', leaf: '#4f8f3a',
  sunColor: '#fff4e0', sunIntensity: 3.0, hemiSky: '#ffffff', hemiGround: '#b9a58a', hemiIntensity: 1.0, exposure: 1.05,
};

export const NIGHT: Palette = {
  sky: '#070b16', ground: '#0d1424', grass: '#10261f', path: '#1b2438', road: '#111827', wall: '#0f172a',
  core: '#0b1222', plinth: '#0f172a', slab: '#1e293b', glass: '#1e293b', trunk: '#1f2937', leaf: '#134e4a',
  sunColor: '#93c5fd', sunIntensity: 0.35, hemiSky: '#1e3a8a', hemiGround: '#020617', hemiIntensity: 0.35, exposure: 1.1,
};

export const DATA: Palette = {
  sky: '#ece8e1', ground: '#c9a97c', grass: '#d8e4c8', path: '#f3efe7', road: '#e6e1d8', wall: '#f7f5f0',
  core: '#efece6', plinth: '#e9e5dd', slab: '#d9d2c5', glass: '#dfe7ee', trunk: '#e9e5dd', leaf: '#cfe0bf',
  sunColor: '#fff4e0', sunIntensity: 2.2, hemiSky: '#ffffff', hemiGround: '#b9a58a', hemiIntensity: 1.3, exposure: 1.0,
};

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, shift: number) => (p >> shift) & 0xff;
  return '#' + [16, 8, 0].map((s) => hex(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t)).join('');
}

export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const k = Math.min(1, Math.max(0, t));
  if (k === 0) return { ...a };
  if (k === 1) return { ...b };
  const out = {} as Record<keyof Palette, string | number>;
  for (const key of Object.keys(a) as (keyof Palette)[]) {
    const va = a[key], vb = b[key];
    out[key] = typeof va === 'number' ? va + ((vb as number) - va) * k : lerpColor(va, vb as string, k);
  }
  return out as unknown as Palette;
}
