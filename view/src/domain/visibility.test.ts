import { buildingMode, floorMode } from './visibility';

test('floor mode from the selected floor', () => {
  expect([floorMode(1, null), floorMode(1, 2), floorMode(2, 2), floorMode(3, 2)]).toEqual(['solid', 'solid', 'cut', 'ghost']);
});

test('building mode from the selected building', () => {
  expect([buildingMode('A', null), buildingMode('A', 'A'), buildingMode('B', 'A')]).toEqual(['normal', 'normal', 'faded']);
});
