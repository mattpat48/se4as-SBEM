// Keyboard shortcuts (view spec §8.1).

export type ShortcutAction = 'toggleDebug' | 'toggleHeat' | 'toggleDataMode' | 'mode2d' | 'mode3d' | 'deselect';

const KEYS: Record<string, ShortcutAction> = {
  d: 'toggleDebug', h: 'toggleHeat', m: 'toggleDataMode', '2': 'mode2d', '3': 'mode3d', escape: 'deselect',
};

export function shortcutAction(key: string): ShortcutAction | null {
  return KEYS[key.toLowerCase()] ?? null;
}
