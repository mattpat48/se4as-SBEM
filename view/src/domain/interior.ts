import { BALCONY_DOOR, ENTRY_DOOR, INTERIOR_WALLS, WINDOWS } from './plan';
export const DOOR_OPENINGS = [
  {u0:4.5,u1:5.4,v:6.5}, {u0:8,u1:8.9,v:6.5}, {u0:2.8,u1:3.7,v:4.5}, {u0:4.8,u1:5.7,v:3}, {u0:7.5,u1:8.4,v:3},
];
/** Walls stand whole up to the ceiling, 0.3 m below the next floor (decision V20). */
export function wallHeight(floorHeight:number): number { return floorHeight-.3; }
export interface InteriorBox {u:number;v:number;w:number;d:number;y0:number;y1:number;role:'wall'|'wood'}
export function interiorShell(ceiling:number,{entryOpen=false}:{entryOpen?:boolean}={}): InteriorBox[] {
  const boxes: InteriorBox[]=[];
  const wall=(u0:number,v0:number,u1:number,v1:number,y0=0,y1=ceiling,role:InteriorBox['role']='wall',thickness=.2)=>{
    if(y1<=y0) return;
    boxes.push({u:(u0+u1)/2,v:(v0+v1)/2,w:Math.max(thickness,u1-u0),d:Math.max(thickness,v1-v0),y0,y1,role});
  };
  for(const [u0,v0,u1,v1] of INTERIOR_WALLS) wall(u0,v0,u1,v1);
  wall(0,0,0,12);
  // The entry door is closed during the visit; the cut floor shows its opening, as V19 did.
  if(entryOpen) { wall(10.5,0,10.5,ENTRY_DOOR.v0); wall(10.5,ENTRY_DOOR.v1,10.5,12); wall(10.5,ENTRY_DOOR.v0,10.5,ENTRY_DOOR.v1,2.1); }
  else wall(10.5,0,10.5,12);
  for(const d of DOOR_OPENINGS) {
    wall(d.u0,d.v,d.u1,d.v,2.1);
    for(const u of [d.u0,d.u1]) wall(u,d.v,u,d.v,.12,2.1,'wood',.045);
    wall(d.u0,d.v,d.u1,d.v,2.07,2.12,'wood',.045);
  }
  for(const side of [1,2] as const) {
    const v=side===1?12:0;
    const windows=WINDOWS.filter(w=>w.side===side&&w.unit==='apt1');
    let start=0;
    for(const w of windows) {
      wall(start,v,w.u0,v);
      const sill=w.tall?0:.9, top=sill+(w.tall?2.4:1.5);
      wall(w.u0,v,w.u1,v,0,sill); wall(w.u0,v,w.u1,v,top);
      for(const u of [w.u0,w.u1]) wall(u,v,u,v,Math.max(.12,sill),top,'wood',.05);
      wall(w.u0,v,w.u1,v,Math.max(.12,sill),Math.max(.12,sill)+.045,'wood',.05);
      wall(w.u0,v,w.u1,v,top-.045,top,'wood',.05);
      // The balcony door (V21) is a bay of the french window, between two jambs.
      if(w.tall) for(const u of [BALCONY_DOOR.u0,BALCONY_DOOR.u1]) wall(u,v,u,v,.12,top,'wood',.05);
      start=w.u1;
    }
    wall(start,v,10.5,v);
  }
  return boxes;
}
