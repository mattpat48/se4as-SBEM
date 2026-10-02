// Test helper: puts every store back to its initial state.
import { useConnectionStore } from '../store/connection';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';

const initial = {
  model: useModelStore.getState(),
  live: useLiveStore.getState(),
  ui: useUiStore.getState(),
  connection: useConnectionStore.getState(),
  walk: useWalkStore.getState(),
};

export function resetStores(): void {
  useModelStore.setState({ ...initial.model, devices: new Map() }, true);
  useLiveStore.setState({ ...initial.live, readings: new Map(), states: new Map(), scenarios: [] }, true);
  useUiStore.setState(initial.ui, true);
  useConnectionStore.setState(initial.connection, true);
  useWalkStore.setState({ ...initial.walk, doors: {} }, true);
}
