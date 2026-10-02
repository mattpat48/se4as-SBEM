// UI state: mode, filters, selection, heat map, panels.
import { create } from 'zustand';
import type { HeatQuantity } from '../domain/heat';

interface UiState {
  mode: '3d' | '2d';
  firstPersonUnit: string | null;
  walkHeatBefore: boolean;
  showDeviceNames: boolean;
  toggleDeviceNames(): void;
  enterApartment(id: string, building: string, floor: number): void;
  exitApartment(): void;
  building: string | null;
  floor: number | null;
  selectedUnit: string | null;
  selectedDevice: string | null;
  heatQuantity: HeatQuantity;
  heatOn: boolean;
  dataMode: boolean;
  debugOpen: boolean;
  debugTab: 'commands' | 'clock';
  setMode(mode: '3d' | '2d'): void;
  setBuilding(id: string | null): void;
  setFloor(floor: number | null): void;
  selectUnit(id: string | null): void;
  selectDevice(id: string | null): void;
  clearSelection(): void;
  setHeatQuantity(q: HeatQuantity): void;
  toggleHeat(): void;
  toggleDataMode(): void;
  toggleDebug(): void;
  setDebugTab(tab: 'commands' | 'clock'): void;
}

export const useUiStore = create<UiState>()((set) => ({
  mode: '3d',
  firstPersonUnit: null,
  walkHeatBefore: true,
  showDeviceNames: true,
  toggleDeviceNames: () => set((s) => ({ showDeviceNames: !s.showDeviceNames })),
  enterApartment: (id, building, floor) => set((s) => ({ firstPersonUnit: id, building, floor, mode: '3d', selectedUnit: null, selectedDevice: null, heatOn: false, walkHeatBefore: s.firstPersonUnit ? s.walkHeatBefore : s.heatOn, debugOpen: false })),
  exitApartment: () => set((s) => ({ firstPersonUnit: null, heatOn: s.firstPersonUnit ? s.walkHeatBefore : s.heatOn, selectedUnit: null, selectedDevice: null })),
  building: null,
  floor: null,
  selectedUnit: null,
  selectedDevice: null,
  heatQuantity: 'temperature',
  heatOn: true,
  dataMode: false,
  debugOpen: false,
  debugTab: 'commands',
  setMode: (mode) => set((s) => ({ mode, firstPersonUnit: null, heatOn: s.firstPersonUnit ? s.walkHeatBefore : s.heatOn })),
  setBuilding: (building) => set({ building }),
  setFloor: (floor) => set({ floor }),
  selectUnit: (selectedUnit) => set({ selectedUnit }),
  selectDevice: (selectedDevice) => set({ selectedDevice }),
  clearSelection: () => set({ selectedUnit: null, selectedDevice: null }),
  setHeatQuantity: (heatQuantity) => set({ heatQuantity }),
  toggleHeat: () => set((s) => ({ heatOn: !s.heatOn })),
  toggleDataMode: () => set((s) => ({ dataMode: !s.dataMode })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  setDebugTab: (debugTab) => set({ debugTab }),
}));
