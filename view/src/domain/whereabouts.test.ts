import { buildComplexLayout } from './layout';
import type { ComplexModelMsg } from './messages';
import { locate, placeLabel, samePlace } from './whereabouts';
import model from '../test/fixtures/model.json';

const layout = buildComplexLayout(model as unknown as ComplexModelMsg);

test('labels for the panel', () => {
  expect(placeLabel({ kind: 'apartment', unitId: 'A-2-1', building: 'A', floor: 2 })).toBe('A-2-1');
  expect(placeLabel({ kind: 'balcony', unitId: 'A-2-1', building: 'A', floor: 2 })).toBe('Balcone di A-2-1');
  expect(placeLabel({ kind: 'balcony', unitId: 'A-0-2', building: 'A', floor: 0 })).toBe('Patio di A-0-2');
  expect(placeLabel({ kind: 'stairwell', unitId: 'A-S', building: 'A', floor: 0 })).toBe('Vano scale A · piano terra');
  expect(placeLabel({ kind: 'stairwell', unitId: 'A-S', building: 'A', floor: 3 })).toBe('Vano scale A · piano 3');
  expect(placeLabel({ kind: 'outdoor' })).toBe('All’aperto');
});

test('without an open building the walker is outdoors; places compare by unit and floor', () => {
  expect(locate(layout, null, { x: 0, z: -45, feet: 0.7 })).toEqual({ kind: 'outdoor' });
  expect(locate(layout, 'A', { x: 0, z: -45, feet: 0.7 })).toMatchObject({ kind: 'stairwell', unitId: 'A-S', floor: 0 });
  expect(locate(layout, 'A', { x: 10, z: -45, feet: 0.6 + 3.2 + 0.12 })).toMatchObject({ kind: 'apartment', unitId: 'A-1-2' });
  expect(samePlace({ kind: 'outdoor' }, { kind: 'outdoor' })).toBe(true);
  expect(samePlace({ kind: 'stairwell', unitId: 'A-S', building: 'A', floor: 1 }, { kind: 'stairwell', unitId: 'A-S', building: 'A', floor: 2 })).toBe(false);
});
