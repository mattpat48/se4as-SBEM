// Conservative, axis-aligned footprints in plan metres. Height includes the 0.12 m slab.
// Rotations change the orientation of details within a footprint, never its bounds.
import { KITCHEN, type PlanRect, type RoomId } from './plan';

export type FurnitureKind = 'kitchen' | 'sofa' | 'table' | 'chair' | 'tv' | 'rug' | 'plant'
  | 'doubleBed' | 'singleBed' | 'cabinet' | 'desk' | 'toilet' | 'sink' | 'shower' | 'boiler' | 'coatRack';
export interface Furniture extends PlanRect {
  id: string;
  kind: FurnitureKind;
  room: RoomId | 'balcony';
  h: number;
  rotation?: number;
  sectioned?: boolean;
}

const item = (id: string, kind: FurnitureKind, room: Furniture['room'],
  u0: number, u1: number, v0: number, v1: number, h: number, rotation = 0, sectioned = false): Furniture =>
  ({ id, kind, room, u0, u1, v0, v1, h, rotation, sectioned });

export const FURNITURE: readonly Furniture[] = [
  { id: 'kitchen', kind: 'kitchen', room: 'living', ...KITCHEN, h: 1.04 },
  item('sofa', 'sofa', 'living', 2.6, 4.3, 6.85, 7.65, 1.0),
  item('coffee-table', 'table', 'living', 2.85, 3.65, 8.0, 8.5, 0.52),
  item('dining-table', 'table', 'living', 1.8, 2.7, 8.75, 9.55, 0.86),
  item('dining-west', 'chair', 'living', 1.25, 1.7, 8.9, 9.35, 0.94, Math.PI / 2),
  item('dining-east', 'chair', 'living', 2.85, 3.3, 8.9, 9.35, 0.94, -Math.PI / 2),
  item('dining-north', 'chair', 'living', 2.05, 2.5, 9.65, 10.1, 0.94, Math.PI),
  item('dining-south', 'chair', 'living', 2.05, 2.5, 8.2, 8.65, 0.94),
  item('tv-console', 'tv', 'living', 4.15, 5.35, 11.3, 11.7, 1.05),
  item('living-rug', 'rug', 'living', 3.8, 4.9, 9.1, 10.0, 0.145),
  item('living-plant', 'plant', 'living', 0.2, 0.7, 7.1, 7.6, 1.02),
  item('double-bed', 'doubleBed', 'bedroom', 7.2, 8.8, 9.55, 11.65, 1.02),
  item('bedside-left', 'cabinet', 'bedroom', 6.65, 7.1, 11.15, 11.6, 0.63),
  item('bedside-right', 'cabinet', 'bedroom', 8.9, 9.25, 11.15, 11.6, 0.63),
  item('bedroom-wardrobe', 'cabinet', 'bedroom', 9.85, 10.3, 7.7, 9.5, 1.1, 0, true),
  item('bedroom-rug', 'rug', 'bedroom', 6.9, 7.9, 7.1, 8.1, 0.145),
  item('single-bed', 'singleBed', 'bedroom2', 0.2, 1.1, 0.35, 2.35, 0.95),
  item('desk', 'desk', 'bedroom2', 2.0, 3.3, 0.2, 0.75, 0.86),
  item('desk-chair', 'chair', 'bedroom2', 2.5, 2.95, 0.9, 1.35, 0.94, Math.PI),
  item('bedroom2-wardrobe', 'cabinet', 'bedroom2', 0.2, 1.6, 3.65, 4.15, 1.1, 0, true),
  item('bath-shower', 'shower', 'bath', 4.15, 5.0, 0.15, 1.0, 1.1, 0, true),
  item('bath-sink', 'sink', 'bath', 4.2, 4.75, 1.15, 1.7, 0.95),
  item('bath-toilet', 'toilet', 'bath', 5.7, 6.25, 1.2, 1.85, 0.89),
  item('boiler', 'boiler', 'bath', 5.95, 6.35, 0.15, 0.55, 1.1, 0, true),
  item('bath2-shower', 'shower', 'bath2', 9.15, 10.2, 0.2, 1.2, 1.1, 0, true),
  item('bath2-toilet', 'toilet', 'bath2', 6.75, 7.3, 0.3, 1.0, 0.89),
  item('bath2-sink', 'sink', 'bath2', 6.75, 7.35, 1.5, 2.05, 0.95),
  item('hall-console', 'cabinet', 'hall', 4.2, 4.65, 4.2, 5.5, 0.9),
  item('coat-rack', 'coatRack', 'hall', 9.85, 10.25, 5.95, 6.35, 1.1, 0, true),
  item('doormat', 'rug', 'hall', 8.65, 9.35, 4.65, 5.25, 0.145),
  item('balcony-chair-left', 'chair', 'balcony', 1.0, 1.55, 12.45, 13.0, 0.94, Math.PI / 2),
  item('balcony-table', 'table', 'balcony', 1.9, 2.45, 12.45, 13.0, 0.72),
  item('balcony-chair-right', 'chair', 'balcony', 2.8, 3.35, 12.45, 13.0, 0.94, -Math.PI / 2),
];

export function furnitureForFloor(floor: number, immersive = false): readonly Furniture[] {
  const items = floor > 0 ? FURNITURE : FURNITURE.filter((f) => f.room !== 'balcony');
  if (!immersive) return items;
  return items.map((f) => f.sectioned ? { ...f, h: f.kind === 'coatRack' ? 1.75 : f.kind === 'shower' ? 2.1 : 2.2 } : f);
}
