// Global keyboard shortcuts (view spec §8.1); ignored while typing in form fields.
import { useEffect } from 'react';
import { shortcutAction } from '../domain/shortcuts';
import { useUiStore } from '../store/ui';

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const inside = useUiStore.getState().firstPersonUnit;
      if (inside && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) return;
      if (inside && e.key === 'Escape') { useUiStore.getState().exitApartment(); return; }
      const action = shortcutAction(e.key);
      if (!action) return;
      const ui = useUiStore.getState();
      switch (action) {
        case 'toggleDebug': ui.toggleDebug(); break;
        case 'toggleHeat': ui.toggleHeat(); break;
        case 'toggleDataMode': ui.toggleDataMode(); break;
        case 'mode2d': ui.setMode('2d'); break;
        case 'mode3d': ui.setMode('3d'); break;
        case 'deselect':
          ui.clearSelection();
          if (ui.mode === '3d') { ui.setBuilding(null); ui.setFloor(null); }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
