import { DATA, DAY, NIGHT, mixPalette } from './palette';

test('furniture roles follow all three palettes, with neutral paper colours in data mode', () => {
  expect([DAY.furnitureEmission, NIGHT.furnitureEmission, DATA.furnitureEmission]).toEqual([0, 0.55, 0]);
  for (const role of ['furniture', 'fabric', 'wood', 'metal'] as const) {
    for (const p of [DAY, NIGHT, DATA]) expect(p[role]).toMatch(/^#[0-9a-f]{6}$/);
    expect(DAY[role]).not.toBe(NIGHT[role]);
    expect(DATA[role]).toBe('#f7f5f0');
    expect(mixPalette(DAY, NIGHT, 0.5)[role]).not.toBe(DAY[role]);
  }
});

test('mix at the ends returns copies of the inputs', () => {
  expect(mixPalette(DAY, NIGHT, 0)).toEqual(DAY);
  expect(mixPalette(DAY, NIGHT, 1)).toEqual(NIGHT);
  expect(mixPalette(DAY, NIGHT, 2)).toEqual(NIGHT);
  expect(mixPalette(DAY, NIGHT, -1)).toEqual(DAY);
  expect(mixPalette(DAY, NIGHT, 0)).not.toBe(DAY);
});

test('numbers and colours are interpolated', () => {
  expect(mixPalette(DAY, NIGHT, 0.5).sunIntensity).toBeCloseTo((DAY.sunIntensity + NIGHT.sunIntensity) / 2);
  const grey = mixPalette({ ...DAY, sky: '#000000' }, { ...DAY, sky: '#ffffff' }, 0.5);
  expect(grey.sky).toBe('#808080');
});

test('palettes come from the approved prototype', () => {
  expect([DAY.sky, NIGHT.sky, DATA.sky]).toEqual(['#bcd7f0', '#070b16', '#ece8e1']);
  for (const p of [DAY, NIGHT, DATA])
    for (const v of Object.values(p)) if (typeof v === 'string') expect(v).toMatch(/^#[0-9a-f]{6}$/);
});
