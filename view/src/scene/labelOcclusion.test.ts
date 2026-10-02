import * as THREE from 'three';
import { facadePoints, isOccluder, labelEye, labelOccluded } from './labelOcclusion';

const wall = (x: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 10, 10), new THREE.MeshStandardMaterial(opts));
  m.position.set(x, 0, 0);
  m.updateMatrixWorld();
  return m;
};
const ray = new THREE.Raycaster();
const eye = new THREE.Vector3(0, 0, 0);
const target = new THREE.Vector3(10, 0, 0);

test('a label behind an opaque wall is hidden; with nothing in between it shows', () => {
  expect(labelOccluded(ray, eye, target, [wall(5)])).toBe(true);
  expect(labelOccluded(ray, eye, target, [wall(-5)])).toBe(false);
  expect(labelOccluded(ray, eye, target, [])).toBe(false);
});

test('surfaces right at the label (the wall its sensor hangs on) do not hide it', () => {
  expect(labelOccluded(ray, eye, target, [wall(10.15)])).toBe(false);
  expect(labelOccluded(ray, eye, target, [wall(9.85)])).toBe(false);
});

test('see-through and hidden objects do not hide labels: ghost floors, faded buildings, glass rails', () => {
  expect(labelOccluded(ray, eye, target, [wall(5, { transparent: true, opacity: 0.25 })])).toBe(false);
  const hidden = wall(5);
  const group = new THREE.Group().add(hidden);
  group.visible = false;
  expect(isOccluder(hidden)).toBe(false);
  expect(labelOccluded(ray, eye, target, [group])).toBe(false);
});

test('an apartment is in sight when the middle of one of its facades is; walls of other units hide it', () => {
  // Apartment from x 4..16, y -1.5..1.5, z -5..5; the camera looks at its x = 4 facade.
  const box = new THREE.Box3(new THREE.Vector3(4, -1.5, -5), new THREE.Vector3(16, 1.5, 5));
  const samples = facadePoints(box);
  expect(samples).toHaveLength(4);
  for (const p of samples) {
    expect(p.y).toBeCloseTo(0);
    expect(box.containsPoint(p)).toBe(false);
  }
  const shell = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 10), new THREE.MeshStandardMaterial());
  shell.position.set(10, 0, 0);
  shell.updateMatrixWorld();
  const seen = (occ: THREE.Object3D[]) => samples.some((p) => !labelOccluded(ray, eye, p, occ));
  expect(seen([shell])).toBe(true);                  // its own shell hides only the far facades
  expect(seen([shell, wall(2)])).toBe(false);        // a building in front hides it
});

test('instanced meshes (windows on the shells, scenery) are not tested', () => {
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 10, 10), new THREE.MeshStandardMaterial(), 1);
  inst.position.set(5, 0, 0);
  inst.updateMatrixWorld();
  expect(isOccluder(inst)).toBe(false);
});

test('the sight line starts at the perspective camera; in 2D (orthographic) it comes straight from above the label', () => {
  const persp = new THREE.PerspectiveCamera();
  persp.position.set(3, 40, 7);
  persp.updateMatrixWorld();
  expect(labelEye(persp, new THREE.Vector3(10, 0, 0)).toArray()).toEqual([3, 40, 7]);

  const ortho = new THREE.OrthographicCamera();
  ortho.position.set(0, 200, 0);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(0, 0, 0);
  ortho.updateMatrixWorld();
  const eye = labelEye(ortho, new THREE.Vector3(30, 2, -12));
  expect(eye.x).toBeCloseTo(30);
  expect(eye.z).toBeCloseTo(-12);
  expect(eye.y).toBeGreaterThan(100);
});


test('ignored instances and transparent meshes never run their costly raycast', () => {
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 100);
  const glass = wall(5, { transparent: true });
  const instancesRay = vi.spyOn(inst, 'raycast');
  const glassRay = vi.spyOn(glass, 'raycast');
  expect(labelOccluded(ray, eye, target, [new THREE.Group().add(inst, glass)])).toBe(false);
  expect(instancesRay).not.toHaveBeenCalled();
  expect(glassRay).not.toHaveBeenCalled();
});
