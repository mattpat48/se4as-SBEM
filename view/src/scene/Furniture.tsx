import { useLayoutEffect, useMemo } from 'react';
import type { ApartmentGeom, BuildingGeom } from '../domain/layout';
import { furnitureForFloor } from '../domain/furniture';
import { PLAN_D, PLAN_W, PLINTH_M } from '../domain/plan';
import { buildFurnitureGeometries } from './furnitureGeometry';
import { planLocal } from './geom';
import { mat } from './materials';

// Let rays pass through scenery to the registered floor and the installed devices.
const ignorePick = () => {};

export function Furniture({ b, apt, faded, immersive = false }: { b: BuildingGeom; apt: ApartmentGeom; faded: boolean; immersive?: boolean }) {
  const geometry = useMemo(() => buildFurnitureGeometries(furnitureForFloor(apt.floor, immersive)), [apt.floor, immersive]);
  useLayoutEffect(() => () => { for (const g of geometry.values()) g.dispose(); }, [geometry]);
  const [x, z] = planLocal(b, 0, 0, apt.mirrored);
  return (
    <group position={[x, PLINTH_M + apt.floor * b.floorHeight, z]} rotation={[0, apt.mirrored ? Math.PI : 0, 0]}
      scale={[b.width / PLAN_W, 1, b.depth / PLAN_D]} userData={{ unitId: apt.id }}>
      {[...geometry].map(([role, g]) => (
        <mesh key={role} geometry={g} material={mat(role, faded)} dispose={null} receiveShadow raycast={ignorePick} />
      ))}
    </group>
  );
}
