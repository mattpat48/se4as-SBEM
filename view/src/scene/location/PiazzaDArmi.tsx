import { useUiStore } from '../../store/ui';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { atmosphere } from '../atmosphere';
import { UNIT_BOX } from '../materials';
import { SITE } from './site';

// Context scenery has no selectable devices: skip thousands of pointless ray tests.
const ignorePick = () => {};

type Piece = { p: [number, number, number]; s: [number, number, number]; a?: number; tilt?: number };
type Finish = 'asphalt' | 'paving' | 'dryGrass' | 'cream' | 'ochre' | 'brick' | 'roof' | 'glass' | 'trim' | 'wood' | 'steel' | 'white' | 'green' | 'red' | 'rubber' | 'lamp' | 'violet';
const COLORS: Record<Finish, string> = { asphalt: '#626564', paving: '#bdb8a9', dryGrass: '#a59e71', cream: '#e9dfb4', ochre: '#cfaf77', brick: '#995646', roof: '#a46850', glass: '#455f67', trim: '#e5d9bc', wood: '#80755a', steel: '#656e70', white: '#e7e5d9', green: '#607d4c', red: '#a77764', rubber: '#303638', lamp: '#eee3c4', violet: '#bc81d8' };

// Small deterministic tiled surface maps: texture detail, without photographic billboards
// or extra downloads. Shared by all instances of a finish.
function surfaceTexture(kind: Finish) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, 128, 128);
  let seed = 19;
  for (let i = 0; i < 5500; i++) {
    seed = (seed * 16807) % 2147483647; const x = seed % 128;
    seed = (seed * 16807) % 2147483647; const y = seed % 128;
    const v = 195 + seed % 30; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 1, 1);
  }
  ctx.strokeStyle = '#969696'; ctx.lineWidth = 1;
  if (kind === 'roof') for (let y = 0; y < 128; y += 16) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke();
    for (let x = (y % 32 ? 8 : 0); x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke(); }
  }
  if (kind === 'paving') for (let i = 0; i < 128; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(kind === 'roof' ? 6 : 3, kind === 'roof' ? 4 : 3);
  return map;
}

function TileBatch({ pieces, material, geometry = UNIT_BOX, shadow = true }: { pieces: Piece[]; material: THREE.Material; geometry?: THREE.BufferGeometry; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    pieces.forEach((v, i) => { e.set(0, v.a ?? 0, v.tilt ?? 0); m.compose(p.fromArray(v.p), q.setFromEuler(e), s.fromArray(v.s)); ref.current!.setMatrixAt(i, m); });
    ref.current!.instanceMatrix.needsUpdate = true; ref.current!.computeBoundingSphere();
  }, [pieces]);
  return <instancedMesh ref={ref} args={[geometry, material, pieces.length]} castShadow={shadow} receiveShadow raycast={ignorePick} />;
}

/** Spatially bounded instances allow frustum culling during the first-person visit. */
function Batch(props: { pieces: Piece[]; material: THREE.Material; geometry?: THREE.BufferGeometry; shadow?: boolean }) {
  const tiles = useMemo(() => {
    if (props.pieces.length < 1000 && props.geometry !== CROWN && props.geometry !== LOW_CROWN) return [['all', props.pieces] as const];
    const out = new Map<string, Piece[]>();
    for (const piece of props.pieces) {
      const key = `${Math.floor(piece.p[0] / 160)}:${Math.floor(piece.p[2] / 160)}`;
      const group = out.get(key) ?? []; group.push(piece); out.set(key, group);
    }
    return [...out.entries()];
  }, [props.pieces, props.geometry]);
  return <>{tiles.map(([key, pieces]) => <TileBatch key={key} {...props} pieces={pieces} />)}</>;
}

// Hipped terracotta roofs (not flat blocks): ridge, four sloping faces and projecting eaves.
const HIP = new THREE.BufferGeometry();
HIP.setAttribute('position', new THREE.Float32BufferAttribute([
  -.5,0,-.5, -.5,0,.5, -.3,1,0,  -.5,0,.5, .5,0,.5, .3,1,0,
  -.5,0,.5, .3,1,0, -.3,1,0,  .5,0,.5, .5,0,-.5, .3,1,0,
  .5,0,-.5, -.5,0,-.5, -.3,1,0,  .5,0,-.5, -.3,1,0, .3,1,0,
], 3));
HIP.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({length: 6}, () => [0,0,1,0,.5,1]).flat(), 2)); HIP.computeVertexNormals();
const CROWN = new THREE.IcosahedronGeometry(1, 2);
const LOW_CROWN = new THREE.IcosahedronGeometry(1, 1);
const TRUNK = new THREE.CylinderGeometry(.13, .2, 1, 7);
const CONIFER = new THREE.ConeGeometry(1, 1, 10);

function buildScenery() {
  const batches = Object.fromEntries(Object.keys(COLORS).map(k => [k, [] as Piece[]])) as Record<Finish, Piece[]>;
  const pines: Piece[] = [];
  const roofs: Piece[] = [], trunks: Piece[] = [], crowns: Piece[][] = [[], [], []];
  const signs: { text: string; x: number; y: number; z: number; width: number; angle?: number; bg?: string }[] = [];
  const box = (f: Finish, x: number, y: number, z: number, w: number, h: number, d: number, a = 0, tilt = 0) => batches[f].push({p:[x,y,z],s:[w,h,d],a,tilt});
  const line = (f: Finish, x1: number, z1: number, x2: number, z2: number, width: number, y = .16, h = .025) => {
    box(f, (x1+x2)/2, y, (z1+z2)/2, Math.hypot(x2-x1,z2-z1), h, width, -Math.atan2(z2-z1,x2-x1));
  };
  const road = (x1: number, z1: number, x2: number, z2: number, width: number, dash = true) => {
    line('paving',x1,z1,x2,z2,width+5,.015,.03); line('asphalt',x1,z1,x2,z2,width,.055,.06);
    const len = Math.hypot(x2-x1,z2-z1), dx=(x2-x1)/len, dz=(z2-z1)/len;
    for (const side of [-1,1]) line('white',x1-dz*(width/2-.4)*side,z1+dx*(width/2-.4)*side,x2-dz*(width/2-.4)*side,z2+dx*(width/2-.4)*side,.13);
    if(dash) for(let t=1;t<len-4;t+=10) line('white',x1+dx*t,z1+dz*t,x1+dx*(t+4),z1+dz*(t+4),.15);
  };
  const fence = (x1: number,z1: number,x2: number,z2: number, timber = true) => {
    const len=Math.hypot(x2-x1,z2-z1), n=Math.ceil(len/4), dx=(x2-x1)/n,dz=(z2-z1)/n, a=-Math.atan2(dz,dx);
    for(let i=0;i<=n;i++) box(timber?'wood':'steel',x1+dx*i,.68,z1+dz*i,.15,1.35,.15);
    for(let i=0;i<n;i++) {
      const x=x1+dx*(i+.5),z=z1+dz*(i+.5), l=Math.hypot(dx,dz);
      if(timber) for(const t of [-1,1]) box('wood',x,.68,z,Math.hypot(l,1),.09,.09,a,t*Math.atan2(1,l));
      else { box('steel',x,1.28,z,l,.06,.06,a); box('steel',x,.4,z,l,.05,.05,a); }
    }
  };
  const tree = (x: number,z: number,s=1,b=0) => {
    trunks.push({p:[x,1.7*s,z],s:[s,3.4*s,s]});
    for(let j=0;j<3;j++) crowns[b].push({p:[x+(j-1)*1.05*s, (3.7+(j===1?.7:0))*s,z+(j%2)*.7*s],s:[1.7*s,2.1*s,1.65*s]});
  };
  const lamp = (x: number,z: number) => {box('steel',x,4.5,z,.14,9,.14); box('steel',x+.8,8.95,z,1.6,.1,.1); box('lamp',x+1.5,8.86,z,.8,.16,.36);};
  const building = (x: number,z: number,w: number,d: number,h: number,f: Finish='cream', roof=true) => {
    box(f,x,h/2,z,w,h,d);box('trim',x,.45,z,w+.3,.9,d+.3);box('trim',x,h-.25,z,w+.5,.35,d+.5);
    if(roof) roofs.push({p:[x,h,z],s:[w+1.5,Math.min(d*.22,4),d+1.5]});
    else box('paving',x,h+.2,z,w+1,.4,d+1);
    for(let floor=0;floor<Math.floor(h/3);floor++) {
      const y=2+floor*3;
      for(let side of [-1,1]) {
        for(let xx=-w/2+2;xx<w/2-1;xx+=3.8) {box('trim',x+xx,y,z+side*(d/2+.09),1.45,1.75,.15);box('glass',x+xx,y+.04,z+side*(d/2+.18),1.05,1.4,.08);box('trim',x+xx,y-.78,z+side*(d/2+.23),1.55,.12,.34);}
        for(let zz=-d/2+2;zz<d/2-1;zz+=4) {box('trim',x+side*(w/2+.09),y,z+zz,.15,1.75,1.45);box('glass',x+side*(w/2+.18),y+.04,z+zz,.08,1.4,1.05);}
      }
    }
    box('glass',x,1.5,z+d/2+.2,2.3,3,.14);
  };
  const car = (x: number,z: number, f: Finish='white', a=0) => {
    box(f,x,.64,z,1.85,.85,4.25,a);box('glass',x,1.24,z,1.62,.58,2.1,a);
    for(const sx of [-1,1]) for(const sz of [-1,1]) {const dx=sx*.96,dz=sz*1.3;box('rubber',x+dx*Math.cos(a)+dz*Math.sin(a),.4,z-dx*Math.sin(a)+dz*Math.cos(a),.25,.65,.65,a);}
  };

  // Urban ground and the remaining former parade/parking square.
  box('dryGrass',0,-.5,-180,2400,.4,2200);
  // The simulator supplies the central campus slab; do not overlay its paths.

  box('dryGrass',195,.01,-190,170,.04,350);
  for(let i=0;i<80;i++) { const x=115+(i*47%160),z=-360+(i*79%160); box(i%3?'dryGrass':'green',x,.045,z,2+i%5,.02,1+i%4); }

  // SS17 / Via Carlo Vittorini and the western junction with Via Ugo Piccinini.
  road(-580,124,-181,124,15); road(-135,124,590,124,15);
  road(-158,100,-158,-400,10); road(-158,147,-230,340,10);
  const {x:rx,z:rz,radius:r}=SITE.roundabout;
  for(let i=0;i<64;i++) { const a=i*Math.PI/32,b=(i+1)*Math.PI/32; road(rx+Math.cos(a)*r,rz+Math.sin(a)*r,rx+Math.cos(b)*r,rz+Math.sin(b)*r,9,false); }
  // Island, planted ring and inner stone kerb.
  for(let i=0;i<48;i++) {const a=i*Math.PI/24,b=(i+1)*Math.PI/24;line('trim',rx+Math.cos(a)*13.8,rz+Math.sin(a)*13.8,rx+Math.cos(b)*13.8,rz+Math.sin(b)*13.8,.45,.2,.28);}
  box('green',rx,.02,rz,19,.06,19);tree(rx,rz,1.2);
  // Access from the existing south and west campus ring roads.
  road(0,96,0,124,8,false); road(-86,10,-158,10,8,false);
  road(415,124,415,-360,9); road(-158,-400,460,-400,9);
  for(let x=-510;x<560;x+=32) {lamp(x,112); if(x < -186 || x>106) {tree(x,105,.85,2);tree(x,141,.8,2);} }
  for(let z=-370;z<75;z+=32) {lamp(-146,z);tree(-140,z,.85,z%3===0?1:0);}
  for(const crossing of [-118,112]) for(let x=crossing-4;x<crossing+5;x+=2) box('white',x,.17,124,1,.025,14);
  for(let x=-6;x<7;x+=2) box('white',x,.175,110,1,.03,6);
  fence(-115,104,-12,104);fence(12,104,276,104);fence(-126,-350,-126,-2);fence(-126,23,-126,88);

  // Caserma G. Pasquali: pale yellow courtyard wings, red hip roofs, perimeter wall.
  box('paving',-290,.01,-218,235,.08,350);
  for(let row=0;row<3;row++) {
    const z=-72-row*112;
    building(-223,z,60,22,8.7);building(-335,z,61,22,8.7);
    building(-251,z-30,17,42,8.7);building(-307,z-30,17,42,8.7);
  }
  box('brick',-176,1.15,-195,1,2.3,385);box('brick',-290,1.15,-5,226,2.3,1);
  box('steel',-175,1.25,-18,.25,2.5,10);
  signs.push({text:'CASERMA G. PASQUALI  ·  IX REGGIMENTO ALPINI',x:-176,y:3.5,z:-45,width:36,angle:Math.PI/2,bg:'#e7dfc7'});
  for(let i=0;i<20;i++) tree(-393+(i%2)*18,-22-Math.floor(i/2)*38,1.25);

  // The tall evergreens beside the Piccinini gate visible in the second panorama.
  for(const [x,z] of [[-137,-54],[-141,-67],[-139,-81],[-192,-20]]) {
    trunks.push({p:[x,2.2,z],s:[1.6,4.4,1.6]});
    for(let tier=0;tier<4;tier++) pines.push({p:[x,4.1+tier*1.3,z],s:[2.7-tier*.5,4.1-tier*.55,2.7-tier*.5]});
  }

  // My Suite from the roundabout photo: two cream wings, recessed glazed spine,
  // horizontal window bands, flat penthouse and violet facade pilasters.
  const {x:hx,z:hz}=SITE.hotel;
  const ha=Math.PI/2;
  const hotelBox=(f:Finish,x:number,y:number,z:number,w:number,h:number,d:number)=>box(f,hx+z,y,hz-x,w,h,d,ha);
  hotelBox('cream',-11,11,0,20,22,26);hotelBox('cream',11,11,0,20,22,26);
  hotelBox('ochre',0,11,-1,3.4,22,24);hotelBox('glass',0,12.3,12.2,2,17,.15);
  hotelBox('cream',0,24,-2,36,4,22);hotelBox('trim',0,26.2,-2,39,.5,24);
  hotelBox('glass',0,24.5,9.2,32,1.7,.2);
  for(let floor=0;floor<5;floor++)for(const side of [-1,1]) {
    const y=5.8+floor*3.5;
    for(let col=0;col<3;col++) {
      const x=side*(5+col*5.8);
      hotelBox('trim',x,y,13.1,5.3,1.1,.18);hotelBox('glass',x,y,13.23,4.85,.82,.12);
      for(const dx of [-1.6,0,1.6])hotelBox('steel',x+dx,y,13.32,.07,.83,.06);
    }
  }
  for(const x of [-15.5,-6.8,6.8,15.5]) {
    hotelBox('trim',x,12,13.25,.65,18,.45);hotelBox('violet',x,12,13.55,.13,18,.08);
  }
  for(const side of [-1,1])for(let floor=0;floor<5;floor++)for(let col=0;col<5;col++)
    hotelBox('glass',side*21.1,5.8+floor*3.5,-9+col*4.5,.13,.9,2.1);
  for(const x of [-11,11])hotelBox('steel',x,26.9,-4,4,1.1,3);
  hotelBox('trim',0,3.4,15.5,44,.35,5);hotelBox('lamp',0,3.5,18,40,.12,.13);
  hotelBox('glass',0,1.6,13.4,35,2.8,.15);
  hotelBox('ochre',-4,1.8,17,1.1,3.6,1);hotelBox('ochre',4,1.8,17,1.1,3.6,1);
  hotelBox('steel',0,34,-3,.35,17,.35);
  for(const y of [7.6,8.5,14,14.9])for(const x of [-.6,.6]) {
    hotelBox('trim',x,y,12.7,.9,.65,.6);hotelBox('steel',x,y,13.05,.5,.4,.07);
  }
  box('asphalt',hx+33,.01,hz,30,.06,65);
  hotelBox('ochre',-7,4.4,31,25,.5,9);hotelBox('lamp',-7,4.55,35.5,25,.15,.12);
  for(const x of [-15,1])hotelBox('ochre',x,2.2,29,.5,4.4,.5);
  for(let i=0;i<7;i++)car(hx+34,hz-23+i*7,i%2?'white':'steel',Math.PI/2);
  for(let i=0;i<8;i++)box('white',hx+34,.09,hz-27+i*7,6,.02,.1);
  // Contemporary commercial frontage visible across the state road.
  building(-54,186,110,32,7,'brick',false);
  for(let i=0;i<11;i++) box('glass',-102+i*10,2.7,169.85,7,4.6,.16);
  box('trim',-54,6.2,168.5,112,.4,3);
  building(-128,207,31,29,22,'ochre',false);
  for(let f=1;f<7;f++) box('trim',-128,f*3,191.5,34,.3,3);
  box('asphalt',-30,.005,151,220,.05,26);
  for(let i=0;i<23;i++) {box('white',-133+i*9.5,.07,151,.12,.03,6); if(i%3!==1)car(-129+i*9.5,151,i%4===0?'red':'white');}
  signs.push({text:'SS 17  ·  VIA CARLO VITTORINI',x:65,y:4.8,z:139,width:28,bg:'#24557c'});
  signs.push({text:'← MY SUITE     PIAZZA D’ARMI →',x:-149,y:4.4,z:148,width:25,bg:'#275d83'});
  signs.push({text:'VIA UGO PICCININI',x:-147,y:4,z:-4,width:18,angle:Math.PI/2,bg:'#ece8da'});
  for(const s of signs) box('steel',s.x,s.y/2,s.z,.09,s.y,.09);
  // Bus shelter, bench, stop marker and recognisable blue parking signs.
  box('paving',-218,.16,137,12,.25,4);box('steel',-218,3,137,9,.2,3);
  for(const x of [-222,-214])box('steel',x,1.5,138,.08,3,.08);
  box('glass',-218,1.6,138.4,9,2.5,.09);box('wood',-218,.65,137.8,6,.16,.5);
  signs.push({text:'BUS  ·  AMITERNUM',x:-211,y:3,z:137,width:7,bg:'#225a86'});
  for(const x of [-104,109]) {box('steel',x,1.6,102,.07,3.2,.07); signs.push({text:'P  ·  PIAZZA D’ARMI',x,y:3.3,z:102,width:10,bg:'#285e89'});}

  // Remnants of the coloured courts/piazzale from the panoramic parking reference.
  for(const x of [-53,14]) {
    box('paving',x,.03,-130,45,.08,50);
    box('red',x,.09,-130,28,.03,44);
    for(const xx of [x-14,x+14])line('white',xx,-152,xx,-108,.12,.13);
    for(const zz of [-152,-130,-108])line('white',x-14,zz,x+14,zz,.12,.13);
    for(const zz of [-149,-111]){box('steel',x,1.5,zz,.12,3,.12);box('white',x,3,zz,1.8,1,.08);}
  }

  // East: rugby pitch, surrounding athletics oval, bleachers, floodlights and fencing.
  box('green',226,.02,-75,106,.06,173);
  
  for(const x of [177,275])line('white',x,-158,x,8,.2,.11);
  for(const z of [-158,-125,-75,-25,8])line('white',177,z,275,z,.2,.11);
  for(const z of [-152,2]) {for(const x of [221,231])box('white',x,3.5,z,.15,7,.15);box('white',226,3,z,10,.15,.15);}
  fence(171,-167,282,-167,false);fence(171,17,282,17,false);fence(171,-167,171,17,false);
  const {x:tx,z:tz}=SITE.sports;
  // Capsule stadium, six continuous running lanes (straights with semicircular ends).
  box('dryGrass',tx,.01,tz,79,.08,148);
  for(let lane=0;lane<6;lane++) {
    const radius=43+lane*1.4;
    for(const side of [-1,1])line('red',tx+side*radius,tz-65,tx+side*radius,tz+65,1.35,.11);
    for(const end of [-1,1])for(let i=0;i<40;i++) {const a=(end===1?0:Math.PI)+i*Math.PI/40,b=a+Math.PI/40;line('red',tx+radius*Math.cos(a),tz+end*65+radius*Math.sin(a),tx+radius*Math.cos(b),tz+end*65+radius*Math.sin(b),1.35,.11);line('white',tx+(radius+.67)*Math.cos(a),tz+end*65+(radius+.67)*Math.sin(a),tx+(radius+.67)*Math.cos(b),tz+end*65+(radius+.67)*Math.sin(b),.075,.135);}
    for(const side of [-1,1])line('white',tx+side*(radius+.67),tz-65,tx+side*(radius+.67),tz+65,.075,.135);
  }
  for(let i=0;i<7;i++)box('trim',402+i*1.2,.3+i*.4,-55,1.2,.5+i*.8,88);
  box('steel',407,6,-55,15,.28,92);
  for(const x of [167,285,397]) for(const z of [-175,30]) {box('steel',x,10,z,.28,20,.28);box('lamp',x,20,z,4,1,.7);}
  building(224,44,60,14,4,'cream',false);
  signs.push({text:'PIAZZA D’ARMI  ·  IMPIANTI SPORTIVI',x:224,y:3.2,z:51.2,width:43,bg:'#354b3e'});
  fence(425,-200,425,90,false);fence(295,-211,424,-211,false);
  signs.push({text:'PIAZZA D’ARMI  ·  L’AQUILA',x:85,y:2.3,z:105,width:28,bg:'#575f4b'});

  // Other anchors from the annotated aerial: restaurants, residence and the triangular
  // Guardia di Finanza compound on the far side of the open parade ground.
  building(88,204,38,25,5,'ochre',false);
  box('asphalt',95,.01,178,74,.06,24);
  for(let i=0;i<10;i++) {box('white',60+i*7,.08,180,.1,.02,6);if(i%3===0)car(63+i*7,181);}
  signs.push({text:'McDONALD’S',x:88,y:4.5,z:191.3,width:25,bg:'#345a40'});
  box('steel',135,5,186,.25,10,.25);
  signs.push({text:'M',x:135,y:10,z:186,width:7,bg:'#a38324'});
  building(170,256,40,27,17,'ochre',false);
  signs.push({text:'RESIDENCE AZZURRO',x:170,y:15,z:242.3,width:33,bg:'#446c80'});
  // Three connected wings enclosing a triangular courtyard.
  box('paving',353,.02,-315,116,.06,115);
  for(const [x,z,a] of [[353,-354,0],[326,-310,-Math.PI/3],[380,-310,Math.PI/3]]) {
    box('cream',x,6,z,91,12,18,a);box('paving',x,12.2,z,93,.4,20,a);
    for(let f=0;f<3;f++)for(let i=-38;i<40;i+=6)for(const side of [-1,1]) {
      const xx=i,zz=side*9.15;
      box('glass',x+xx*Math.cos(a)+zz*Math.sin(a),2.5+f*3.5,z-xx*Math.sin(a)+zz*Math.cos(a),2,1.8,.12,a);
    }
  }
  signs.push({text:'GUARDIA DI FINANZA',x:353,y:10,z:-278,width:29,bg:'#4e574d'});
  fence(292,-375,408,-375,false);fence(408,-375,408,-253,false);
  // Mown paths and small patches of scrub across the open northern square.
  line('paving',110,-105,170,-355,2.2,.055,.025);
  line('paving',140,-215,283,-263,2,.055,.025);
  for(let i=0;i<28;i++) tree(110+(i*37%42),-117-(i*71%240),.4+i%3*.08);

  // Residential fabric beyond the frontage and low foothills, leaving the square open.
  for(let row=0;row<3;row++)for(let col=0;col<8;col++) {
    const x=-450+col*109+(row%2)*21,z=280+row*87;
    if(Math.abs(x+210)<42 && row===0)continue;
    building(x,z,22+(col%3)*6,22+(row%2)*7,9+(col%4)*3,col%3===0?'brick':col%3===1?'ochre':'cream');
    tree(x+23,z+20,1.2);tree(x-19,z+22,.9);
  }
  for(let i=0;i<45;i++) {tree(110+(i*53%166),-365+(i*31%152),.55+(i%4)*.15);tree(448+(i*43%140),-370+(i*67%440),1.1);}
  return {batches,roofs,trunks,crowns,pines,signs};
}

function Sign({ text, x,y,z,width,angle=Math.atan2(-x,-z),bg='#24557c' }: {text:string;x:number;y:number;z:number;width:number;angle?:number;bg?:string}) {
  const texture = useMemo(() => {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
    const c=canvas.getContext('2d')!;c.fillStyle=bg;c.fillRect(0,0,1024,128);c.strokeStyle='#e8e7db';c.lineWidth=5;c.strokeRect(5,5,1014,118);
    c.fillStyle=bg==='#ece8da'||bg==='#e7dfc7'?'#38423d':'#f3eee1';c.font='600 44px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,67,980);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
  },[text,bg]);
  const material = useMemo(()=>new THREE.MeshStandardMaterial({map:texture,roughness:.85,side:THREE.FrontSide}),[texture]);
  useLayoutEffect(()=>()=>{texture.dispose();material.dispose();},[texture,material]);
  return <group position={[x,y,z]} rotation={[0,angle,0]}>
    <mesh position={[0,0,.012]} material={material} raycast={ignorePick}><planeGeometry args={[width,width/8]} /></mesh>
    <mesh position={[0,0,-.012]} rotation={[0,Math.PI,0]} material={material} raycast={ignorePick}><planeGeometry args={[width,width/8]} /></mesh>
  </group>;
}

export function PiazzaDArmi() {
  const low = useUiStore((s) => s.lowPerformance);
  const data = useMemo(buildScenery, []);
  const materials = useMemo(() => Object.fromEntries(Object.entries(COLORS).map(([key,color]) => [key, new THREE.MeshStandardMaterial({color,roughness:key==='glass'?.38:.94,metalness:key==='steel'?.35:0,map:['asphalt','paving','roof','dryGrass'].includes(key)?surfaceTexture(key as Finish):null})])) as Record<Finish,THREE.MeshStandardMaterial>,[]);
  // Project grain in world metres so a 1 km ground slab never stretches its texture.
  useMemo(() => {
    for (const key of ['asphalt','paving','dryGrass'] as Finish[]) {
      materials[key].onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef USE_MAP
          vec4 sitePoint = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          sitePoint = instanceMatrix * sitePoint;
          #endif
          sitePoint = modelMatrix * sitePoint;
          vMapUv = sitePoint.xz * 0.18;
          #endif`);
      };
      materials[key].customProgramCacheKey = () => 'piazza-world-grain';
    }
  }, [materials]);
  const leaves=useMemo(()=>['#647752','#526447','#815b58'].map(color=>new THREE.MeshStandardMaterial({color,roughness:1})),[]);
  const last=useRef(-1);
  useFrame(()=>{
    const n=atmosphere.dataMode?0:atmosphere.night;
    if(Math.abs(n-last.current)<.02)return;last.current=n;
    for(const [key,m] of Object.entries(materials)) {
      m.color.set(COLORS[key as Finish]).lerp(new THREE.Color('#233247'),n*.45);
      m.emissive.set(COLORS[key as Finish]);m.emissiveIntensity=n*.055;
      if(key === 'lamp' || key === 'glass' || key === 'violet') {m.emissive.set(key === 'lamp' ? '#f6d69c' : key === 'violet' ? '#bb55ff' : '#c5b99b');m.emissiveIntensity=n*(key === 'lamp' ? 2 : key === 'violet' ? 3 : .18);}
    }
    leaves.forEach((m,i)=>m.color.set(['#647752','#526447','#815b58'][i]).lerp(new THREE.Color('#162c28'),n*.6));
  });
  useLayoutEffect(()=>()=>{Object.values(materials).forEach(m=>{m.map?.dispose();m.dispose();});leaves.forEach(m=>m.dispose());},[materials,leaves]);
  return <group name="Piazza d'Armi — contesto urbano">
    {Object.entries(data.batches).map(([key,pieces])=><Batch key={key} pieces={pieces} material={materials[key as Finish]} shadow={['cream','ochre','brick','wood','steel'].includes(key)} />)}
    <Batch pieces={data.roofs} material={materials.roof} geometry={HIP}/>
    <Batch pieces={data.pines} material={leaves[1]} geometry={CONIFER}/>
    <Batch pieces={data.trunks} material={materials.wood} geometry={TRUNK}/>
    {data.crowns.map((pieces,i)=><Batch key={i} pieces={pieces} material={leaves[i]} geometry={low ? LOW_CROWN : CROWN}/>)}
    {data.signs.map((s,i)=><Sign key={i} {...s}/>)}
    <HotelNeon />
    <Foothills />
  </group>;
}

function Foothills() {
  const geometry=useMemo(()=>{
    const g=new THREE.PlaneGeometry(3200,1300,80,32);g.rotateX(-Math.PI/2);
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++) {const x=p.getX(i),z=p.getZ(i);const fade=Math.pow(Math.max(0,Math.sin(Math.PI*(650-z)/1300)),1.3);const edge=Math.max(0,1-Math.pow(Math.abs(x)/1600,4));p.setY(i,fade*edge*(165+75*Math.sin(x*.004)+35*Math.cos(x*.011)+17*Math.sin(x*.025+z*.011)));}
    g.computeVertexNormals();return g;
  },[]);
  useLayoutEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} position={[0,-4,-1160]} receiveShadow raycast={ignorePick}><meshStandardMaterial color="#75816a" roughness={1} /></mesh>;
}


function HotelNeon() {
  const low = useUiStore((s) => s.lowPerformance);
  const lights=useRef<(THREE.PointLight|null)[]>([]);
  const texture=useMemo(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=768;const ctx=c.getContext('2d')!;
    ctx.fillStyle='#3b2039';ctx.fillRect(0,0,128,768);ctx.font='bold 83px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f1a4d7';
    [...'MYSUITE'].forEach((v,i)=>ctx.fillText(v,64,58+i*99));ctx.font='24px Arial';ctx.fillText('★★★★',64,743);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return map;
  },[]);
  const material=useMemo(()=>new THREE.MeshStandardMaterial({map:texture,emissiveMap:texture,emissive:'#ff9cdf',emissiveIntensity:.15,roughness:.6}),[texture]);
  useFrame(()=>{material.emissiveIntensity=.15+atmosphere.night*2.3;lights.current.forEach(l=>{if(l)l.intensity=atmosphere.night*130;});});
  useLayoutEffect(()=>()=>{texture.dispose();material.dispose();},[texture,material]);
  return <>
    {(low ? [-10,10] : [-15.5,-6.8,6.8,15.5]).map((z,i)=><pointLight key={i} ref={l=>{lights.current[i]=l;}} color="#b272ff" position={[SITE.hotel.x+16,12,SITE.hotel.z-z]} intensity={0} distance={22} decay={2}/>)}
    <group position={[SITE.hotel.x+4,35.5,SITE.hotel.z]} rotation={[0,Math.PI/2,0]}>
    <mesh material={material} raycast={ignorePick}><planeGeometry args={[2.5,15]} /></mesh>
    <mesh position={[0,0,-.08]} rotation={[0,Math.PI,0]} material={material} raycast={ignorePick}><planeGeometry args={[2.5,15]} /></mesh>
  </group></>;
}
