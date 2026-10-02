import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FURNITURE } from '../domain/furniture';
import { FURNITURE_MODEL_FILES, furnitureModelUrl, modelPieces } from '../domain/furnitureModels';
import { buildComplexLayout, planToWorld } from '../domain/layout';
import type { ComplexModelMsg } from '../domain/messages';
import { SLAB_M, apartmentMatrix, fitItem, fitModel } from './modelFit';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
const TOL = 0.02;

async function bounds(model: string): Promise<THREE.Box3> {
  const buf = readFileSync(`${PUBLIC}${furnitureModelUrl(model)}`);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return new THREE.Box3().setFromObject(gltf.scene);
}

let boxes: Map<string, THREE.Box3>;
beforeAll(async () => {
  boxes = new Map(await Promise.all(FURNITURE_MODEL_FILES.map(async (m) => [m, await bounds(m)] as const)));
});

const scaleOf = (m: THREE.Matrix4) => {
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  return s;
};

test('every fitted piece lies inside its footprint and below its maximum height', () => {
  for (const f of FURNITURE) {
    for (const { piece, matrix } of fitItem(modelPieces(f), (m) => boxes.get(m)!)) {
      const b = boxes.get(piece.model)!.clone().applyMatrix4(matrix);
      const id = `${f.id}/${piece.model}`;
      expect(b.min.x, id).toBeGreaterThanOrEqual(piece.u0 - TOL);
      expect(b.max.x, id).toBeLessThanOrEqual(piece.u1 + TOL);
      expect(b.min.z, id).toBeGreaterThanOrEqual(piece.v0 - TOL);
      expect(b.max.z, id).toBeLessThanOrEqual(piece.v1 + TOL);
      if (piece.maxH !== undefined) expect(b.max.y - b.min.y, id).toBeLessThanOrEqual(piece.maxH + 1e-6);
      if (!piece.stacked) expect(b.min.y, id).toBeCloseTo(SLAB_M, 6);
      // Fills the footprint along at least one side: the model is not shrunk needlessly.
      const fills = Math.max((b.max.x - b.min.x) / (piece.u1 - piece.u0), (b.max.z - b.min.z) / (piece.v1 - piece.v0));
      if (piece.maxH === undefined) expect(fills, id).toBeGreaterThan(0.98);
    }
  }
});

test('the fit scales uniformly, never deforming the model', () => {
  const box = new THREE.Box3(new THREE.Vector3(-0.2, 0, -1), new THREE.Vector3(0.6, 0.9, 1));
  for (const face of ['+u', '-u', '+v', '-v'] as const) {
    const { matrix } = fitModel(box, { model: 'x', face, u0: 1, u1: 3, v0: 4, v1: 4.5 });
    const s = scaleOf(matrix);
    expect(s.y, face).toBeCloseTo(s.x, 9);
    expect(s.z, face).toBeCloseTo(s.x, 9);
  }
});

test('the face turns the model front (+z in the file) towards the requested plan direction', () => {
  const box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const front = (face: '+u' | '-u' | '+v' | '-v') => {
    const { matrix } = fitModel(box, { model: 'x', face, u0: 0, u1: 1, v0: 0, v1: 1 });
    const o = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix), f = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix);
    return f.sub(o).normalize().toArray().map((x) => Math.round(x));
  };
  expect(front('+v')).toEqual([0, 0, 1]);
  expect(front('-v')).toEqual([0, 0, -1]);
  expect(front('+u')).toEqual([1, 0, 0]);
  expect(front('-u')).toEqual([-1, 0, 0]);
});

test('a stacked piece stands on the top of the previous one', () => {
  const tv = FURNITURE.find((f) => f.kind === 'tv')!;
  const [cabinet, set] = fitItem(modelPieces(tv), (m) => boxes.get(m)!);
  const top = boxes.get(cabinet.piece.model)!.clone().applyMatrix4(cabinet.matrix).max.y;
  expect(cabinet.top).toBeCloseTo(top, 9);
  expect(boxes.get(set.piece.model)!.clone().applyMatrix4(set.matrix).min.y).toBeCloseTo(top, 6);
});

test('apartment placement matches the plan in rotated buildings and in the mirrored interno 2', async () => {
  const fixture = (await import('../test/fixtures/model.json')).default;
  const layout = buildComplexLayout(fixture as unknown as ComplexModelMsg);
  const b = layout.buildings.find((v) => Math.abs(Math.abs(v.rotationY) - Math.PI / 2) < 1e-6)!;
  for (const apt of layout.apartments.filter((a) => a.building === b.id && a.floor === 2)) {
    // A piece centred on (u, v), with a corner 0.4 m along u and 0.2 m along v.
    const [u, v] = [2.2, 9.1];
    const m = apartmentMatrix(b, apt, u, v);
    for (const [du, dv, h] of [[0, 0, 0.5], [0.4, 0.2, 1.1]]) {
      const p = new THREE.Vector3(u + du, h, v + dv).applyMatrix4(m);
      const want = planToWorld(b, u + du, v + dv, h, apt.floor, apt.mirrored);
      expect(p.distanceTo(new THREE.Vector3(want.x, want.y, want.z)), apt.id).toBeLessThan(1e-9);
    }
  }
});
