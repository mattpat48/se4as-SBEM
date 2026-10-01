// How floors and buildings are drawn given the filters (view spec §8.3).

export type FloorMode = 'solid' | 'cut' | 'ghost';

export function floorMode(floor: number, selectedFloor: number | null): FloorMode {
  if (selectedFloor === null || floor < selectedFloor) return 'solid';
  return floor === selectedFloor ? 'cut' : 'ghost';
}

export function buildingMode(id: string, selected: string | null): 'normal' | 'faded' {
  return selected === null || selected === id ? 'normal' : 'faded';
}
