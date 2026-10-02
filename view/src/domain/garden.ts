import { planToWorld, type ComplexLayout } from './layout';
import { PLAN_D } from './plan';

export interface GardenPoint { x: number; z: number }
export interface GardenPath { points: GardenPoint[]; width: number }
export interface GardenSeat extends GardenPoint { angle: number }
export interface GardenObstacle extends GardenSeat { width: number; depth: number; height: number }

/** Shared by landscaping and walking: lawns, entrance routes and furniture footprints. */
export function gardenCore(layout: ComplexLayout) {
  return { ...layout.park, width: Math.max(layout.park.width, 80), depth: Math.max(layout.park.depth, 72) };
}
export function gardenPlan(layout: ComplexLayout) {
  const core = gardenCore(layout), c = core.center;
  const point = (x: number, z: number) => ({ x: c.x + x, z: c.z + z });
  const paths: GardenPath[] = [
    {points:[point(-43,0),point(43,0)],width:3.4},
    {points:[point(0,-38),point(0,38)],width:3.4},
    {points:[point(-68,-60),point(68,-60),point(68,60),point(-68,60),point(-68,-60)],width:3},
    {points:[point(28,0),point(32,31),point(32,62),{x:layout.parking.center.x,z:62},{x:layout.parking.center.x,z:layout.parking.center.z-layout.parking.depth/2}],width:3.5},
    {points:[point(-28,0),point(-32,31),point(-32,62)],width:3},
    {points:[point(-30,-24),point(-32,-60)],width:2.5},
    {points:[point(30,-24),point(32,-60)],width:2.5},
  ];
  for (const b of layout.buildings) {
    const door = planToWorld(b,13.8,PLAN_D + 1.6,0,0,false);
    const dir = { x: Math.sin(b.rotationY), z: Math.cos(b.rotationY) };
    const approach = {x:door.x+dir.x*2,z:door.z+dir.z*2};
    paths.push({points:[door,approach,point(Math.abs(dir.x)>.5 ? (b.center.x>c.x?36:-36):0,Math.abs(dir.z)>.5?(b.center.z>c.z?32:-32):0)],width:3.2});
  }
  const seats: GardenSeat[] = [
    ...[-1,1].flatMap(s=>[{...point(s*9,-6),angle:-s*Math.PI/2},{...point(s*9,6),angle:-s*Math.PI/2}]),
    ...[-1,1].flatMap(s=>[{...point(s*22,-19),angle:0},{...point(s*22,20),angle:Math.PI}]),
    ...[-1,1].flatMap(s=>[{...point(s*64,-32),angle:-s*Math.PI/2},{...point(s*64,33),angle:-s*Math.PI/2}]),
  ];
  const bins = seats.filter((_,i)=>i%2===0).map(s=>({...s,x:s.x+2.1*Math.cos(s.angle),z:s.z-2.1*Math.sin(s.angle)}));
  const pergolas = [point(-48,44),point(48,-43)];
  const obstacles: GardenObstacle[] = [
    ...seats.map(s=>({...s,width:2.8,depth:.8,height:1.1})),
    ...bins.map(s=>({...s,width:.5,depth:.5,height:.85})),
    ...pergolas.map(p=>({...p,angle:0,width:2.8,depth:2.8,height:.95})),
    ...pergolas.flatMap(p=>[-1,1].flatMap(x=>[-1,1].map(z=>({x:p.x+x*3,z:p.z+z*2.3,angle:0,width:.2,depth:.2,height:3})))),
  ];
  return {core,paths,seats,bins,pergolas,obstacles};
}
