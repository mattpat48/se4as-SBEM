// Residents (view spec §7.5, decision V20): animated Quaternius characters (CC0) in the apartments
// of the cut floor from `occupancy`, and the stairwell's people walking on its stairs. Only with a
// cut floor (always the case in 2D) or inside an apartment in first person.
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ComplexLayout } from '../domain/layout';
import { peopleCount, peopleSlots, stairSlots } from '../domain/people';
import { PLINTH_M } from '../domain/plan';
import {
  RESIDENT_MODELS, residentClip, residentHeight, residentKey, residentModelUrl, residentVariant, residentYaw,
} from '../domain/residents';
import { stairTread } from '../domain/stairs';
import { useLiveStore } from '../store/live';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { planLocal } from './geom';
import { SLAB_M } from './modelFit';
import { releaseResident } from './residentRig';

const MAX_PEOPLE = 80;
const REFRESH_S = 0.5;
const CORE_SLAB_M = 0.1;
const URLS = RESIDENT_MODELS.map(residentModelUrl);
useGLTF.preload(URLS, false);   // same key as the useGLTF(URLS) call below

interface Resident { root: THREE.Group; mixer: THREE.AnimationMixer }
interface Wanted { key: string; where: 'home' | 'stairs'; x: number; y: number; z: number; yaw: number }

/** Height of a character standing in its idle pose, in file units. */
function standingHeight(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): number {
  const model = cloneSkinned(gltf.scene);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'Idle')!).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  mixer.uncacheRoot(model);
  return box.max.y - box.min.y;
}

export function People({ layout }: { layout: ComplexLayout }) {
  const gltfs = useGLTF(URLS, false);
  const heights = useMemo(() => gltfs.map(standingHeight), [gltfs]);
  const group = useRef<THREE.Group>(null);
  const residents = useRef(new Map<string, Resident>());
  const acc = useRef(REFRESH_S);
  const byId = useMemo(() => new Map(layout.buildings.map((b) => [b.id, b])), [layout]);
  const view = useMemo(() => ({ frustum: new THREE.Frustum(), m: new THREE.Matrix4(), sphere: new THREE.Sphere(new THREE.Vector3(), 1.2) }), []);

  const spawn = (w: Wanted): Resident => {
    const variant = residentVariant(w.key);
    const gltf = gltfs[variant];
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const root = new THREE.Group();
    root.add(model);
    root.scale.setScalar(residentHeight(w.key) / heights[variant]);
    const mixer = new THREE.AnimationMixer(model);
    const clip = THREE.AnimationClip.findByName(gltf.animations, residentClip(w.key, w.where))!;
    const action = mixer.clipAction(clip);
    action.play();
    action.time = Math.random() * clip.duration;             // residents do not move in step
    mixer.update(0);
    return { root, mixer };
  };

  const remove = (key: string, r: Resident) => {
    releaseResident(r.root, r.mixer);
    residents.current.delete(key);
  };
  useEffect(() => () => { for (const [key, r] of residents.current) remove(key, r); }, []);

  const wanted = (): Wanted[] => {
    const ui = useUiStore.getState();
    const walk = useWalkStore.getState();
    const open = walk.active ? walk.openBuilding : null;
    const readings = useLiveStore.getState().readings;
    const out: Wanted[] = [];
    if (ui.floor === null && !open) return out;
    const put = (bId: string, unitId: string, slot: number, where: Wanted['where'], u: number, v: number, f: number, mirrored: boolean) => {
      const b = byId.get(bId);
      if (!b || out.length >= MAX_PEOPLE) return;
      const key = residentKey(unitId, slot);
      const [lx, lz] = planLocal(b, u, v, mirrored);
      const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
      out.push({
        key, where, x: b.center.x + lx * c + lz * s, z: b.center.z - lx * s + lz * c,
        y: PLINTH_M + f * b.floorHeight + (where === 'stairs' ? Math.max(stairTread(u, v, b.floorHeight), CORE_SLAB_M) : SLAB_M),
        yaw: b.rotationY + (mirrored ? Math.PI : 0) + residentYaw(key, where),
      });
    };
    for (const a of layout.apartments) {
      if (open ? a.building !== open : a.floor !== ui.floor) continue;
      if (!byId.get(a.building)?.supportsPlan) continue;
      const occ = readings.get(`${a.id}.occupancy`)?.last ?? 0;
      peopleSlots(a.id, peopleCount(occ)).forEach((slot, i) => put(a.building, a.id, i, 'home', slot.u, slot.v, a.floor, a.mirrored));
    }
    for (const b of layout.buildings) {
      if (open && b.id !== open) continue;
      const occ = readings.get(`${b.id}-S.occupancy`)?.last ?? 0;
      stairSlots(peopleCount(occ)).forEach((slot, i) => {
        // The top floor has no flight of its own (V21): its people walk on the one below.
        const f = Math.min(slot.floorOffset, Math.max(0, b.floors - 2));
        if (open || f === ui.floor) put(b.id, `${b.id}-S`, i, 'stairs', slot.u, slot.v, f, false);
      });
    }
    return out;
  };

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g) return;
    acc.current += dt;
    if (acc.current >= REFRESH_S) {
      acc.current = 0;
      const next = wanted();
      const keep = new Set(next.map((w) => w.key));
      for (const [key, r] of residents.current) if (!keep.has(key)) remove(key, r);
      for (const w of next) {
        let r = residents.current.get(w.key);
        if (!r) {
          r = spawn(w);
          residents.current.set(w.key, r);
          g.add(r.root);
        }
        r.root.position.set(w.x, w.y, w.z);
        r.root.rotation.y = w.yaw;
      }
    }
    // Animate only the residents in view.
    view.frustum.setFromProjectionMatrix(view.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const r of residents.current.values()) {
      view.sphere.center.copy(r.root.position).y += 0.9;
      if (view.frustum.intersectsSphere(view.sphere)) r.mixer.update(dt);
    }
  });

  return <group ref={group} />;
}
