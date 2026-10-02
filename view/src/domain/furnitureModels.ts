// External furniture models (decision V20): every FURNITURE footprint is filled by one or more
// Kenney Furniture Kit pieces (CC0). Footprints and plan are unchanged; the boiler stays procedural.
import type { Furniture } from './furniture';
import type { PlanRect } from './plan';

/** Direction the front of the model points to, in plan axes. */
export type Face = '+u' | '-u' | '+v' | '-v';

export interface ModelPiece extends PlanRect {
  model: string;
  face: Face;
  /** Upper bound on the piece height in metres (the fit otherwise follows the footprint). */
  maxH?: number;
  /** Stands on top of the previous piece of the same item instead of the floor. */
  stacked?: boolean;
}

type PieceSpec = Omit<ModelPiece, keyof PlanRect> & Partial<PlanRect>;

const one = (model: string, face: Face, maxH?: number): PieceSpec[] => [{ model, face, maxH }];
const kitchen = (model: string, v0: number, v1: number, maxH?: number): PieceSpec => ({ model, face: '+u', v0, v1, maxH });

const SPECS: Record<string, PieceSpec[]> = {
  kitchen: [
    kitchen('kitchenFridge', 8.2, 8.9, 1.9), kitchen('kitchenCabinetDrawer', 8.9, 9.5), kitchen('kitchenStove', 9.5, 10.1),
    kitchen('kitchenCabinet', 10.1, 10.7), kitchen('kitchenSink', 10.7, 11.6),
  ],
  sofa: one('loungeSofa', '+v'),
  'coffee-table': one('tableCoffee', '+v'),
  'dining-table': one('table', '+v'),
  'dining-west': one('chairCushion', '+u'),
  'dining-east': one('chairCushion', '-u'),
  'dining-north': one('chairCushion', '-v'),
  'dining-south': one('chairCushion', '+v'),
  'tv-console': [
    { model: 'cabinetTelevision', face: '-v' },
    { model: 'televisionModern', face: '-v', u0: 4.3, u1: 5.2, v0: 11.35, v1: 11.65, stacked: true },
  ],
  'living-rug': one('rugRectangle', '+v'),
  'living-plant': one('pottedPlant', '+v'),
  'double-bed': one('bedDouble', '-v'),
  'bedside-left': one('sideTableDrawers', '-v'),
  'bedside-right': one('sideTableDrawers', '-v'),
  'bedroom-wardrobe': one('bookcaseClosedDoors', '-u', 2.0),
  'bedroom-rug': one('rugRectangle', '+v'),
  'single-bed': one('bedSingle', '+v'),
  desk: one('desk', '+v'),
  'desk-chair': one('chairDesk', '-v'),
  'bedroom2-wardrobe': one('bookcaseClosedDoors', '-v', 2.0),
  'bath-shower': one('shower', '+v', 2.1),
  'bath-sink': one('bathroomSink', '+u'),
  'bath-toilet': one('toilet', '-u'),
  boiler: [],
  'bath2-shower': one('shower', '+v', 2.1),
  'bath2-toilet': one('toilet', '+u'),
  'bath2-sink': one('bathroomSink', '+u'),
  'hall-console': one('sideTableDrawers', '+u'),
  'coat-rack': one('coatRackStanding', '+v', 1.75),
  doormat: one('rugDoormat', '+v'),
  'balcony-chair-left': one('chair', '+u'),
  'balcony-table': one('tableRound', '+v'),
  'balcony-chair-right': one('chair', '-u'),
};

/** The model pieces of a furniture item, each with its own footprint inside the item's one. */
export function modelPieces(f: Furniture): ModelPiece[] {
  return (SPECS[f.id] ?? []).map((s) => ({
    ...s, u0: s.u0 ?? f.u0, u1: s.u1 ?? f.u1, v0: s.v0 ?? f.v0, v1: s.v1 ?? f.v1,
  }));
}

export const FURNITURE_MODEL_FILES: readonly string[] = [...new Set(Object.values(SPECS).flat().map((s) => s.model))];

export function furnitureModelUrl(model: string): string {
  return `/models/furniture/${model}.glb`;
}
