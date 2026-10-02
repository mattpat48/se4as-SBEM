// UI state: mode, filters, selection, heat map, panels.
import { create } from 'zustand';
import type { HeatQuantity } from '../domain/heat';

interface UiState {
  mode: '3d' | '2d';
  showDeviceNames: boolean;
  toggleDeviceNames(): void;
  building: string | null;
  floor: number | null;
  selectedUnit: string | null;
  selectedDevice: string | null;
  heatQuantity: HeatQuantity;
  heatOn: boolean;
  dataMode: boolean;
  lowPerformance: boolean;
  toggleLowPerformance(): void;
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
  showDeviceNames: true,
  toggleDeviceNames: () => set((s) => ({ showDeviceNames: !s.showDeviceNames })),
  building: null,
  floor: null,
  selectedUnit: null,
  selectedDevice: null,
  heatQuantity: 'temperature',
  heatOn: true,
  dataMode: false,
  lowPerformance: (() => { try { return typeof window !== 'undefined' && window.localStorage.getItem('view.lowPerformance') === 'true'; } catch { return false; } })(),
  toggleLowPerformance: () => set((s) => {
    const lowPerformance = !s.lowPerformance;
    try { if (typeof window !== 'undefined') window.localStorage.setItem('view.lowPerformance', String(lowPerformance)); } catch { /* storage may be disabled */ }
    return { lowPerformance };
  }),
  debugOpen: false,
  debugTab: 'commands',
  setMode: (mode) => set({ mode }),
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
