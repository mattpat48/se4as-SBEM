import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A recognisable 1.70 m resident, with skin, hair, clothing, hands and shoes; one draw batch. */
export function personGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[]=[];
  const add=(g:THREE.BufferGeometry,color:string,x:number,y:number,z:number) => {
    g.translate(x,y,z);
    const c=new THREE.Color(color), colors=new Float32Array(g.getAttribute('position').count*3);
    for(let i=0;i<colors.length;i+=3) { colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b; }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3)); parts.push(g);
  };
  const skin='#c48f6b', shirt='#527b85', trousers='#414c60', hair='#3c302b';
  add(new THREE.CapsuleGeometry(.15,.32,4,10).scale(1,.95,.68),shirt,0,1.12,0);
  add(new THREE.CylinderGeometry(.05,.055,.11,8),skin,0,1.43,0);
  add(new THREE.SphereGeometry(.12,12,8).scale(.9,1, .95),skin,0,1.575,0);
  add(new THREE.SphereGeometry(.123,12,6,0,Math.PI*2,0,Math.PI/2).scale(.92,.83,.98),hair,0,1.59,-.006);
  for(const side of [-1,1]) {
    add(new THREE.CapsuleGeometry(.065,.61,3,8),trousers,side*.085,.47,0);
    add(new THREE.BoxGeometry(.13,.12,.23),'#303740',side*.085,.06,.04);
    add(new THREE.CapsuleGeometry(.05,.34,3,8),shirt,side*.2,1.105,0);
    add(new THREE.SphereGeometry(.047,8,6).scale(.85,1.35,.85),skin,side*.2,.855,0);
    add(new THREE.SphereGeometry(.009,6,4),'#242b34',side*.038,1.596,.102);
  }
  add(new THREE.SphereGeometry(.024,6,4),skin,0,1.565,.113);
  const merged=mergeGeometries(parts)!; parts.forEach((g)=>g.dispose()); return merged;
}
