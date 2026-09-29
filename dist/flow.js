// Distances follow one continuous U-shaped transfer line, in metres.
export const ROUTE = [[-8.2,-2.6],[7.5,-2.6],[7.5,3],[-8.2,3]];
export const STATIONS = [
  {id:'CNC-01',distance:3.2,cycle:45},
  {id:'CNC-02',distance:8.2,cycle:60},
  {id:'CNC-03',distance:13.2,cycle:50},
  {id:'QC-01',distance:23.8,cycle:40},
  {id:'PACK-01',distance:28.8,cycle:35},
  {id:'STORE',distance:33.8,cycle:12}
];
export const LENGTH = 37;
export function routePoint(distance){
  let remaining=Math.max(0,Math.min(LENGTH,distance));
  for(let i=1;i<ROUTE.length;i++){
    const a=ROUTE[i-1],b=ROUTE[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    if(remaining<=length||i===ROUTE.length-1)return {x:a[0]+dx*remaining/length,z:a[1]+dz*remaining/length,angle:-Math.atan2(dz,dx)};
    remaining-=length;
  }
}
export class TransferLine {
  constructor(){
    this.nextId=1;this.releaseClock=0;this.completed=[];
    this.parts=[1,3.2,6.2,8.2,11.2,13.2,17,21,23.8,26.4,28.8,33.8].map(s=>this.create(s));
  }
  create(s=0){
    const next=STATIONS.findIndex(st=>st.distance>=s-1e-6);
    return {id:this.nextId++,s,next:next<0?STATIONS.length:next,remaining:null,waiting:false,active:false,rejected:false};
  }
  tick(dt,{blocked=[],cycles={},defect=false}={}){
    if(!Number.isFinite(dt)||dt<0)throw Error('Invalid time step');
    let left=dt;
    while(left>0){const step=Math.min(.25,left);this.step(step,{blocked,cycles,defect});left-=step;}
    const done=this.completed;this.completed=[];return done;
  }
  step(dt,{blocked,cycles,defect}){
    this.parts.sort((a,b)=>b.s-a.s);
    let ahead=Infinity;
    for(const p of this.parts){
      p.waiting=false;p.active=false;
      const st=STATIONS[p.next];
      if(st&&Math.abs(p.s-st.distance)<1e-5){
        if(blocked.includes(st.id)){p.waiting=true;ahead=p.s;continue;}
        if(p.remaining===null)p.remaining=cycles[st.id]??st.cycle;
        p.active=true;p.remaining=Math.max(0,p.remaining-dt);
        if(p.remaining===0){
          if(st.id==='QC-01'&&defect&&p.id%3===0)p.rejected=true;
          p.next++;p.remaining=null;p.active=false;
        }
      }else{
        const target=Math.min(p.s+.24*dt,ahead-.82,st?.distance??LENGTH);
        if(target<=p.s+1e-7)p.waiting=true;
        p.s=Math.max(p.s,target);
      }
      ahead=p.s;
    }
    this.parts=this.parts.filter(p=>{if(p.s>=LENGTH-1e-6){this.completed.push({...p});return false;}return true;});
    this.releaseClock+=dt;
    if(this.releaseClock>=75&&(!this.parts.length||this.parts.at(-1).s>.9)){
      this.parts.push(this.create());this.releaseClock=0;
    }
  }
  station(id){
    const index=STATIONS.findIndex(st=>st.id===id),station=STATIONS[index];
    const part=this.parts.find(p=>p.next===index&&Math.abs(p.s-station.distance)<1e-5);
    const queue=this.parts.filter(p=>p.next===index&&p.s<station.distance-1e-5);
    return {part,queue:queue.length,active:!!part?.active,blocked:!!part?.waiting};
  }
}
