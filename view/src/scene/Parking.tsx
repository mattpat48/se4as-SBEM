// Parking lot south of building C with the four chargers.
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { UNIT_BOX, fixedMat, mat } from './materials';

const lineMat = () => fixedMat('stall', () => new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.8 }));
const columnMat = () => fixedMat('charger', () => new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.5 }));

export function Parking({ layout }: { layout: ComplexLayout }) {
  const { center, width, depth } = layout.parking;
  const stalls = Math.max(2, Math.round(width / 4.5));
  return (
    <group>
      <mesh geometry={UNIT_BOX} material={mat('road')} position={[center.x, 0.05, center.z]} scale={[width, 0.1, depth]} receiveShadow />
      {Array.from({ length: stalls + 1 }, (_, i) => (
        <mesh key={i} geometry={UNIT_BOX} material={lineMat()}
          position={[center.x - width / 2 + 2 + i * (width - 4) / stalls, 0.12, center.z - depth / 2 + 4.5]} scale={[0.12, 0.04, 5]} />
      ))}
      {layout.chargers.map((c) => (
        <mesh key={c.id} geometry={UNIT_BOX} material={columnMat()} position={[c.position.x, 0.75, c.position.z]} scale={[0.6, 1.5, 0.4]}
          castShadow userData={{ unitId: c.id }} />
      ))}
    </group>
  );
}
