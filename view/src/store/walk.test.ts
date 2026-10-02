import fixtureModel from '../test/fixtures/model.json';
import { dispatch } from '../mqtt/dispatch';
import { resetStores } from '../test/reset';
import { useModelStore } from './model';
import { useUiStore } from './ui';
import { isDoorOpen, useWalkStore, walker } from './walk';

const loadModel = () => dispatch('Complex/model', JSON.stringify(fixtureModel), 0);
const layout = () => useModelStore.getState().layout!;
const walk = () => useWalkStore.getState();

beforeEach(() => { resetStores(); loadModel(); });

test('start opens the building, hides the heat map and clears the filters; exit restores them', () => {
  useUiStore.setState({ building: 'C', floor: 1, selectedUnit: 'C-1-1' });
  expect(walk().start(layout(), 'B-2-2')).toBe(true);
  expect(walk()).toMatchObject({ active: true, openBuilding: 'B', place: { kind: 'apartment', unitId: 'B-2-2' }, lightsUnit: 'B-2-2' });
  expect(useUiStore.getState()).toMatchObject({ mode: '3d', building: null, floor: null, heatOn: false, selectedUnit: null });
  expect(walker.feet).toBeCloseTo(0.6 + 2 * 3.2 + 0.12);
  walk().exit();
  expect(walk()).toMatchObject({ active: false, openBuilding: null });
  expect(useUiStore.getState()).toMatchObject({ building: 'B', floor: 1, heatOn: true });
  expect(walk().start(layout(), 'Z-0-1')).toBe(false);
});

test('a jump keeps the heat map saved at the first entry', () => {
  walk().start(layout(), 'A-0-1');
  useUiStore.setState({ heatOn: true });
  walk().start(layout(), 'C-3-2');
  walk().exit();
  expect(useUiStore.getState().heatOn).toBe(true);
});

test('doors toggle from their default; the locked portone only shows a notice', () => {
  walk().start(layout(), 'A-2-1');
  expect(isDoorOpen(walk().doors, 'A-2-1:bath', true)).toBe(true);
  walk().toggleDoor(layout(), 'A-2-1:entry');
  expect(walk().doors['A-2-1:entry']).toBe(true);
  walk().toggleDoor(layout(), 'A:street');
  expect(walk().doors['A:street']).toBeUndefined();
  expect(walk().notice).toMatch(/chiuso/);
});

test('opening another park portone opens that building and closes the previous portone', () => {
  walk().start(layout(), 'A-0-1');
  walk().toggleDoor(layout(), 'A:park');
  walk().setPlace({ kind: 'outdoor' });
  walk().toggleDoor(layout(), 'B:park');
  expect(walk()).toMatchObject({ openBuilding: 'B', doors: { 'A:park': false, 'B:park': true } });
  walk().toggleDoor(layout(), 'B:park');
  expect(walk().openBuilding).toBeNull();
});

test('a door with the walker in its doorway does not close', () => {
  walk().start(layout(), 'A-2-1');
  const living = useModelStore.getState().layout!.buildings.find((b) => b.id === 'A')!;
  Object.assign(walker, { x: living.center.x + 4.95 - 13, z: living.center.z + 6.5 - 6 });
  walk().toggleDoor(layout(), 'A-2-1:living');
  expect(isDoorOpen(walk().doors, 'A-2-1:living', true)).toBe(true);
  expect(walk().notice).toMatch(/passaggio/);
});

test('a new model ends the visit', () => {
  walk().start(layout(), 'A-2-1');
  dispatch('Complex/model', JSON.stringify({ ...fixtureModel, complex: { ...fixtureModel.complex, name: 'Altro' } }), 0);
  expect(walk().active).toBe(false);
});
