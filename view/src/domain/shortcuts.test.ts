import { shortcutAction } from './shortcuts';

test('keys map to actions', () => {
  expect(['d', 'H', 'm', '2', '3', 'Escape', 'x'].map(shortcutAction))
    .toEqual(['toggleDebug', 'toggleHeat', 'toggleDataMode', 'mode2d', 'mode3d', 'deselect', null]);
  expect(['D', 'h', 'M'].map(shortcutAction)).toEqual(['toggleDebug', 'toggleHeat', 'toggleDataMode']);
});
