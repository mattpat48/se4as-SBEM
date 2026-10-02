/** Piazza d'Armi context reconstructed from the annotated aerial and the three supplied
 * panoramas (2026-10-01). Local site axes follow the resort/SS17 frontage, not survey north.
 * Distances are adapted to the simulator's existing 170 m campus; this is not GIS data.
 * Keep scenery outside the interactive/walkable campus [-100,100]. */
export const SITE = {
  roadZ: 124,
  roundabout: { x: -158, z: 124, radius: 19 },
  hotel: { x: -267, z: 77 },
  barracks: { x: -205, z: -160 },
  field: { x: 195, z: -205 },
  sports: { x: 330, z: -53 },
} as const;
export const LOCATION_CAMERA = { position: [300, 270, 460], target: [25, 0, -65] } as const;
