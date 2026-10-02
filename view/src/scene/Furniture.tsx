// Furniture of the furnished apartments (decision V20): Kenney Furniture Kit models (CC0) fitted to
// the footprints of `domain/furniture.ts`, drawn as instances for every apartment of the cut floor,
// or of the open building in first person (V21). The boiler is the only piece drawn in code.
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { furnitureForFloor } from '../domain/furniture';
import { FURNITURE_MODEL_FILES, furnitureModelUrl, modelPieces } from '../domain/furnitureModels';
import type { ApartmentGeom, BuildingGeom, ComplexLayout } from '../domain/layout';
import { buildingMode } from '../domain/visibility';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { atmosphere } from './atmosphere';
import { mat } from './materials';
import { apartmentMatrix, fitItem } from './modelFit';

const URLS = FURNITURE_MODEL_FILES.map(furnitureModelUrl);
useGLTF.preload(URLS, false);   // same key as the useGLTF(URLS) call below

const BOILER = 'boiler';

interface ModelPart { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }
interface Placement { model: string; matrix: THREE.Matrix4; u: number; v: number }

/** Wall-hung boiler with its pipes, in plan metres around the centre of its footprint. */
function boilerGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(0.4, 0.7, 0.32).translate(0, 1.65, 0),
    ...[-0.1, 0.1].map((x) => new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8).translate(x, 1.1, 0)),
  ];
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** Meshes of each model with their transform inside the file, and the model bounds. */
function useModelParts(): { parts: Map<string, ModelPart[]>; bounds: Map<string, THREE.Box3>; materials: Set<THREE.MeshStandardMaterial> } {
  const gltfs = useGLTF(URLS, false);
  const boiler = useMemo(boilerGeometry, []);
  useLayoutEffect(() => () => boiler.dispose(), [boiler]);
  return useMemo(() => {
    const parts = new Map<string, ModelPart[]>();
    const bounds = new Map<string, THREE.Box3>();
    const materials = new Set<THREE.MeshStandardMaterial>();
    FURNITURE_MODEL_FILES.forEach((model, i) => {
      const scene = gltfs[i].scene;
      scene.updateMatrixWorld(true);
      const list: ModelPart[] = [];
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        list.push({ geometry: o.geometry, material: o.material as THREE.Material, local: o.matrixWorld.clone() });
        if (o.material instanceof THREE.MeshStandardMaterial) materials.add(o.material);
      });
      parts.set(model, list);
      bounds.set(model, new THREE.Box3().setFromObject(scene));
    });
    parts.set(BOILER, [{ geometry: boiler, material: mat('furniture'), local: new THREE.Matrix4() }]);
    return { parts, bounds, materials };
  }, [gltfs, boiler]);
}

/** Model placements of one apartment in the plan frame (x = u, z = v). */
function planPlacements(floor: number, bounds: Map<string, THREE.Box3>): Placement[] {
  const out: Placement[] = [];
  for (const f of furnitureForFloor(floor)) {
    const u = (f.u0 + f.u1) / 2, v = (f.v0 + f.v1) / 2;
    if (f.kind === 'boiler') out.push({ model: BOILER, matrix: new THREE.Matrix4().makeTranslation(u, 0, v), u, v });
    else for (const fit of fitItem(modelPieces(f), (m) => bounds.get(m)!)) out.push({ model: fit.piece.model, matrix: fit.matrix, u, v });
  }
  return out;
}

const ignorePick = () => {};

export function Furniture({ layout }: { layout: ComplexLayout }) {
  const floor = useUiStore((s) => s.floor);
  const walking = useWalkStore((s) => s.active);
  const open = useWalkStore((s) => (s.active ? s.openBuilding : null));
  const selectedBuilding = useUiStore((s) => s.building);
  const dataMode = useUiStore((s) => s.dataMode);
  const { parts, bounds, materials } = useModelParts();

  const furnished = useMemo(() => {
    const byId = new Map(layout.buildings.map((b) => [b.id, b]));
    const out: { b: BuildingGeom; apt: ApartmentGeom; faded: boolean }[] = [];
    for (const apt of layout.apartments) {
      const b = byId.get(apt.building);
      if (!b?.supportsPlan) continue;
      if (walking ? apt.building !== open : apt.floor !== floor) continue;
      out.push({ b, apt, faded: !walking && buildingMode(b.id, selectedBuilding) === 'faded' });
    }
    return out;
  }, [layout, floor, walking, open, selectedBuilding]);

  // One instanced mesh per model mesh, and per faded / normal look.
  const meshes = useMemo(() => {
    const groups = new Map<string, { part: ModelPart; faded: boolean; matrices: THREE.Matrix4[] }>();
    const byFloor = new Map<number, Placement[]>();
    for (const { b, apt, faded } of furnished) {
      let placements = byFloor.get(apt.floor);
      if (!placements) byFloor.set(apt.floor, placements = planPlacements(apt.floor, bounds));
      for (const p of placements) {
        const world = apartmentMatrix(b, apt, p.u, p.v).multiply(p.matrix);
        parts.get(p.model)!.forEach((part, i) => {
          const key = `${p.model}:${i}:${faded}`;
          const g = groups.get(key) ?? { part, faded, matrices: [] };
          g.matrices.push(world.clone().multiply(part.local));
          groups.set(key, g);
        });
      }
    }
    return [...groups.values()].map(({ part, faded, matrices }) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      mesh.castShadow = !faded;
      mesh.receiveShadow = true;
      mesh.raycast = ignorePick;
      mesh.userData = { original: part.material, faded };
      return mesh;
    });
  }, [furnished, parts, bounds]);
  useLayoutEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);

  // "Plastico" (data mode) and faded buildings: one neutral material, colour stays on the data.
  useLayoutEffect(() => {
    for (const m of meshes) {
      const { original, faded } = m.userData as { original: THREE.Material; faded: boolean };
      m.material = faded ? mat('furniture', true) : dataMode ? mat('furniture') : original;
    }
  }, [meshes, dataMode]);

  // Night style: the models glow faintly in their own colours, as the palette asks.
  const emission = useRef(-1);
  useFrame(() => {
    const k = atmosphere.palette.furnitureEmission;
    if (k === emission.current) return;
    emission.current = k;
    for (const m of materials) {
      m.emissive.copy(m.color);
      m.emissiveIntensity = k;
    }
  });

  return <>{meshes.map((m) => <primitive key={m.uuid} object={m} />)}</>;
}
