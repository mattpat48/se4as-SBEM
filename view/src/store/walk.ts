// First-person visit (V21): open building, current place, door states. The walker's pose and the
// animated door openness change every frame, so they live outside React in mutable objects.
import { create } from 'zustand';
import { blindsCover } from '../domain/actuatorVisual';
import { buildingDoors, canClose, nextOpenBuilding, type DoorSpec } from '../domain/doors';
import type { ComplexLayout } from '../domain/layout';
import { WALK_RADIUS_M, startPose, type Walker } from '../domain/walk';
import { toPlan } from '../domain/walkWorld';
import { locate, type Place } from '../domain/whereabouts';
import { useLiveStore } from './live';
import { useUiStore } from './ui';

export const walker: Walker = { x: 0, z: 0, feet: 0, yaw: 0, pitch: 0 };
/** Animated openness (0…1) per door id, stepped by the scene towards the store's state. */
export const doorOpenness = new Map<string, number>();

interface WalkState {
  active: boolean;
  openBuilding: string | null;
  place: Place;
  /** Doors toggled during the visit; the others keep their default. */
  doors: Record<string, boolean>;
  notice: string | null;
  /** Apartment whose rooms hold the fixed pool of room lights: the last one visited. */
  lightsUnit: string | null;
  /** Bumped by every start or jump: the navigation then takes the new pose. */
  seq: number;
  before: { heatOn: boolean; building: string | null; floor: number | null };
  start(layout: ComplexLayout, aptId: string): boolean;
  exit(): void;
  toggleDoor(layout: ComplexLayout, id: string): void;
  setPlace(place: Place): void;
  setNotice(text: string | null): void;
}

export function isDoorOpen(doors: Record<string, boolean>, id: string, defaultOpen: boolean): boolean {
  return doors[id] ?? defaultOpen;
}

function findDoor(layout: ComplexLayout, id: string): DoorSpec | null {
  const building = id.split(':')[0].split('-')[0];
  const b = layout.buildings.find((x) => x.id === building);
  if (!b) return null;
  return buildingDoors(b, layout.apartments.filter((a) => a.building === b.id)).find((d) => d.id === id) ?? null;
}

export const useWalkStore = create<WalkState>()((set, get) => ({
  active: false,
  openBuilding: null,
  place: { kind: 'outdoor' },
  doors: {},
  notice: null,
  lightsUnit: null,
  seq: 0,
  before: { heatOn: true, building: null, floor: null },
  start(layout, aptId) {
    const pose = startPose(layout, aptId);
    const apt = layout.apartments.find((a) => a.id === aptId);
    if (!pose || !apt) return false;
    Object.assign(walker, pose);
    const ui = useUiStore.getState();
    const before = get().active ? get().before : { heatOn: ui.heatOn, building: ui.building, floor: ui.floor };
    if (get().openBuilding !== apt.building) doorOpenness.clear();
    useUiStore.setState({ mode: '3d', building: null, floor: null, selectedUnit: null, selectedDevice: null, heatOn: false, debugOpen: false });
    set((s) => ({
      active: true, openBuilding: apt.building, before, notice: null, lightsUnit: apt.id, seq: s.seq + 1,
      place: { kind: 'apartment', unitId: apt.id, building: apt.building, floor: apt.floor },
      doors: s.active ? s.doors : {},
    }));
    return true;
  },
  exit() {
    const s = get();
    if (!s.active) return;
    const here = s.place.kind === 'outdoor' ? s.openBuilding : s.place.building;
    useUiStore.setState({ heatOn: s.before.heatOn, building: here ?? s.before.building, floor: s.before.floor, selectedUnit: null, selectedDevice: null });
    doorOpenness.clear();
    set({ active: false, openBuilding: null, place: { kind: 'outdoor' }, doors: {}, notice: null, lightsUnit: null });
  },
  toggleDoor(layout, id) {
    const d = findDoor(layout, id);
    const s = get();
    if (!d || !s.active) return;
    if (d.locked) { set({ notice: 'Portone chiuso: si entra dal parco' }); return; }
    const open = isDoorOpen(s.doors, id, d.defaultOpen);
    if (open) {
      const b = layout.buildings.find((x) => x.id === d.building)!;
      const p = toPlan(b, walker.x, walker.z);
      const here = locate(layout, d.building, walker);
      const floor = here.kind === 'outdoor' ? 0 : here.floor;
      if (!canClose(d, { ...p, floor }, WALK_RADIUS_M)) { set({ notice: 'La porta non si chiude: sei sul passaggio' }); return; }
    }
    const doors = { ...s.doors, [id]: !open };
    const openBuilding = nextOpenBuilding(s.openBuilding, id, !open, s.place.kind === 'outdoor');
    if (s.openBuilding && openBuilding !== s.openBuilding) {
      doors[`${s.openBuilding}:park`] = false;
      doorOpenness.set(`${s.openBuilding}:park`, 0);
    }
    const covered = d.kind === 'balcony' && !open
      && blindsCover(useLiveStore.getState().states.get(`${d.unitId}.blinds`)?.state ?? {}) > 0.2;
    set({ doors, openBuilding, notice: covered ? 'Tapparella abbassata: non si passa' : null });
  },
  setPlace(place) {
    set((s) => ({ place, lightsUnit: place.kind === 'apartment' || place.kind === 'balcony' ? place.unitId : s.lightsUnit }));
  },
  setNotice(notice) { set({ notice }); },
}));
