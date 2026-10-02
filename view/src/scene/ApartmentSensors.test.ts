import * as THREE from 'three';
import fixtureModel from '../test/fixtures/model.json';
import type { ComplexModelMsg } from '../domain/messages';
import { buildComplexLayout, planToWorld } from '../domain/layout';
import { apartmentDevicePose } from '../domain/deviceAppearance';
import { buildSensorBatches } from './ApartmentSensors';

const layout = buildComplexLayout(fixtureModel as unknown as ComplexModelMsg);

test('cutaway sensors occupy their actual floor and preserve mirrored anchors in every building', () => {
  for (const floor of [0, 1, 2, 3]) {
    const batches = buildSensorBatches(layout, floor);
    expect(batches.size).toBe(12);
    for (const [type, instances] of batches) {
      expect(instances).toHaveLength(8);
      for (const instance of instances) {
        const apt = layout.apartments.find((a) => instance.id === `${a.id}.${type}`)!;
        const b = layout.buildings.find((v) => v.id === apt.building)!;
        const pose = apartmentDevicePose(type)!;
        const actual = new THREE.Vector3().setFromMatrixPosition(instance.matrix);
        const expected = planToWorld(b, pose.u, pose.v, pose.h, apt.floor, apt.mirrored);
        expect(actual.x).toBeCloseTo(expected.x);
        expect(actual.y, instance.id).toBeCloseTo(expected.y);
        expect(actual.z).toBeCloseTo(expected.z);
        expect(instance.id).toContain(`-${floor}-`);
      }
    }
  }
});

test('no apartment fixtures appear on solid or ghost floors', () => {
  expect(buildSensorBatches(layout, null).size).toBe(0);
  expect(buildSensorBatches(layout, 4).size).toBe(0);
});

test('first-person sensors cover every apartment of the open building at full mounting heights (V21)', () => {
  const batches=buildSensorBatches(layout,null,'B');
  expect(batches.size).toBe(12);
  for(const [type,instances] of batches) {
    expect(instances).toHaveLength(8);
    expect(instances.every((i)=>i.id.startsWith('B-'))).toBe(true);
    const pose=apartmentDevicePose(type,true)!;
    const b22=instances.find((i)=>i.id===`B-2-2.${type}`)!;
    expect(new THREE.Vector3().setFromMatrixPosition(b22.matrix).y).toBeCloseTo(.6+2*3.2+pose.h);
  }
});

test('the 3D cut floor, with whole walls, uses the real mounting heights of every apartment (V20)', () => {
  const batches = buildSensorBatches(layout, 2, null, true);
  expect(batches.size).toBe(12);
  for (const [type, instances] of batches) {
    expect(instances).toHaveLength(8);
    const pose = apartmentDevicePose(type, true)!;
    for (const instance of instances)
      expect(new THREE.Vector3().setFromMatrixPosition(instance.matrix).y, instance.id).toBeCloseTo(.6 + 2 * 3.2 + pose.h);
  }
  expect([...batches.values()].some((list) => apartmentDevicePose(list[0].id.split('.')[1], true)!.h > 2)).toBe(true);
});
