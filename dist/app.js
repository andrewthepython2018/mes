import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { TransferLine, routePoint } from './flow.js';

const $ = id => document.getElementById(id);
const fmt = (v,n=1) => v.toLocaleString('ru-RU',{minimumFractionDigits:n,maximumFractionDigits:n});
const statusNames={run:'В работе',idle:'Ожидание',warning:'Внимание',critical:'Останов'};
const statusColors={run:0x398157,idle:0x7c8b97,warning:0xd79824,critical:0xc4483e};
const machines=[
  {id:'CNC-01',code:'М-101',name:'Проходная токарная ячейка',description:'Автоподача паллет · токарный узел · боковые транспортные окна',parts:'Паллета входит слева, останавливается у загрузчика и выходит справа после точения.',operation:'Точение / оп. 10',kind:'lathe',x:-5,z:-2.6,baseTemp:58,baseLoad:78,baseCycle:45,basePower:6.2,baseQueue:2},
  {id:'CNC-02',code:'М-102',name:'Проходная фрезерная ячейка',description:'3 оси · обработка на транспортной паллете · шпиндель BT40',parts:'Конвейер проходит через рабочую камеру. Паллета фиксируется под шпинделем на время фрезерования.',operation:'Фрезерование / оп. 20',kind:'mill',x:0,z:-2.6,baseTemp:64,baseLoad:86,baseCycle:60,basePower:8.4,baseQueue:3},
  {id:'CNC-03',code:'М-103',name:'Проходная сверлильная ячейка',description:'Инструментальный магазин · фиксация паллеты · сверление',parts:'Сквозной транспортный канал под сверлильной головкой. После операции паллета идёт на контроль.',operation:'Сверление / оп. 30',kind:'drill',x:5,z:-2.6,baseTemp:55,baseLoad:72,baseCycle:50,basePower:5.8,baseQueue:2},
  {id:'QC-01',code:'К-201',name:'Портал измерительного контроля',description:'Проходная измерительная станция · контактный щуп',parts:'Конвейер проходит между опорами портала. Деталь останавливается под измерительной головкой.',operation:'Контроль размеров / оп. 40',kind:'cmm',x:5,z:3,baseTemp:24,baseLoad:63,baseCycle:40,basePower:1.2,baseQueue:2},
  {id:'PACK-01',code:'У-301',name:'Упаковочный пост',description:'Сквозной роликовый транспортёр · рамка обвязки',parts:'Проверенная деталь поступает справа. После упаковки коробка продолжает движение влево, к приёмке.',operation:'Упаковка / оп. 50',kind:'pack',x:0,z:3,baseTemp:31,baseLoad:57,baseCycle:35,basePower:2.3,baseQueue:1},
  {id:'STORE',code:'С-001',name:'Приёмка готовой продукции',description:'Выходной конвейер · приёмочный пост · накопительный стеллаж',parts:'Последний узел маршрута: регистрация упаковки, выход с линии и передача на склад.',operation:'Приёмка / оп. 60',kind:'rack',x:-5,z:3,baseTemp:22,baseLoad:42,baseCycle:12,basePower:.3,baseQueue:0}
];
const state={selected:'CNC-02',scenario:'normal',paused:false,speed:5,elapsed:0,good:408,rejected:8,progress:0,outputCount:0,cutaway:false,view:'overview',events:[],lastSample:0};
const flow=new TransferLine();
machines.forEach(m=>Object.assign(m,{temp:m.baseTemp,load:m.baseLoad,cycle:m.baseCycle,power:m.basePower,queue:m.baseQueue,status:m.kind==='rack'?'idle':'run',history:Array(60).fill(m.baseTemp)}));
const scene=new THREE.Scene();scene.background=new THREE.Color(0xe4e8ec);
const container=$('scene');let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});}catch(e){$('loadError').hidden=false;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.32;
container.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','Трёхмерная модель цеха. Выбор оборудования также доступен в таблице.');
const camera=new THREE.OrthographicCamera(-12,12,8,-8,.1,130);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.maxPolarAngle=Math.PI*.49;controls.minZoom=.65;controls.maxZoom=5;controls.screenSpacePanning=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x8995a2,2.6));
const sun=new THREE.DirectionalLight(0xfff9ee,3.3);sun.position.set(-9,17,10);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-15,right:15,top:12,bottom:-12,near:1,far:50});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun);
const fillLight=new THREE.DirectionalLight(0xd8e7ff,1.6);fillLight.position.set(10,8,-6);scene.add(fillLight);
const materials={};
function mat(color,metal=.05,rough=.63){const key=color+'-'+metal+'-'+rough;return materials[key]??=new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough});}
const C={body:0xd4dbdf,light:0xe9edf0,base:0x485865,blue:0x486b88,dark:0x27333d,steel:0x9eaeb8,black:0x30383c,orange:0xb9883c,granite:0x505a60};
function mesh(g,geometry,color,x,y,z,metal=.05){const o=new THREE.Mesh(geometry,mat(color,metal));o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;g.add(o);return o;}
function box(g,x,y,z,w,h,d,color=C.body,edges=false){const o=mesh(g,new THREE.BoxGeometry(w,h,d),color,x,y,z);if(edges){const e=new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry),new THREE.LineBasicMaterial({color:0x52606b,transparent:true,opacity:.35}));o.add(e);}return o;}
function cyl(g,x,y,z,r,h,color=C.steel,axis='y',segments=24){const o=mesh(g,new THREE.CylinderGeometry(r,r,h,segments),color,x,y,z,.6);if(axis==='x')o.rotation.z=Math.PI/2;if(axis==='z')o.rotation.x=Math.PI/2;return o;}
function line(points,color){const geom=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const o=new THREE.Line(geom,new THREE.LineBasicMaterial({color}));scene.add(o);return o;}
function labelPlate(g,text,x,y,z,w=1.05,h=.24){const cv=document.createElement('canvas');cv.width=512;cv.height=100;const ct=cv.getContext('2d');ct.fillStyle='#eef1f3';ct.fillRect(0,0,512,100);ct.fillStyle='#304353';ct.font='bold 50px Arial';ct.textAlign='center';ct.textBaseline='middle';ct.fillText(text,256,53);const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex}));o.position.set(x,y,z);g.add(o);}
function feet(g,w=2.8,d=1.8){for(const x of [-w/2+.2,w/2-.2])for(const z of [-d/2+.2,d/2-.2])cyl(g,x,.1,z,.09,.18,C.black);}
function controlPanel(g,x,y,z){box(g,x,y,z,.42,.75,.2,C.dark,true);box(g,x,y+.15,z+.108,.31,.24,.016,0x76919d);for(let i=0;i<4;i++)for(let j=0;j<3;j++)box(g,x-.12+i*.078,y-.09-j*.075,z+.113,.044,.036,.013,0xb8c1c8);cyl(g,x+.08,y-.28,z+.13,.037,.025,0xc74739,'z',16);box(g,x,y-.72,z-.03,.06,.75,.08,C.base);}
function beacon(g,x,y,z,m){cyl(g,x,y,z,.028,.36,C.steel);m.lamps=[];for(let i=0;i<3;i++){const o=cyl(g,x,y+.23+i*.13,z,.075,.11,[0x348051,0xc58b25,0xb6423b][i]);o.material=o.material.clone();m.lamps.push(o);}}
function enclosure(g,m,w=3,d=1.85,h=2.35){
  feet(g,w,d);box(g,0,.32,0,w,.43,d,C.base,true);box(g,0,.59,0,w,.12,d,C.blue);
  box(g,0,1.46,-d/2+.1,w,1.66,.15,C.body,true);
  const panels=[box(g,0,h-.07,0,w,.16,d,C.light,true)];
  // Split side panels leave real openings around the transfer conveyor.
  for(const side of [-1,1]){
    const x=side*(w/2-.12);
    panels.push(box(g,x,1.94,0,.22,.68,d,C.body,true));
    for(const z of [-d/2+.16,d/2-.16])panels.push(box(g,x,1.14,z,.22,.92,.3,C.body,true));
    box(g,x,1.56,0,.26,.05,1.23,C.orange);
    box(g,x,.69,0,.26,.06,1.23,C.orange);
  }
  box(g,0,.91,d/2+.01,w,.47,.16,C.body,true);box(g,0,h-.29,d/2+.01,w,.25,.15,C.body,true);
  box(g,-w/2+.33,1.63,d/2+.01,.3,.98,.16,C.body);box(g,w/2-.36,1.63,d/2+.01,.35,.98,.16,C.body);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(w-.9,.89,.022),new THREE.MeshStandardMaterial({color:0x6f959e,transparent:true,opacity:.2,roughness:.23,metalness:.05,depthWrite:false}));
  glass.position.set(-.02,1.64,d/2+.06);g.add(glass);panels.push(glass);
  box(g,0,1.64,d/2+.09,.042,.99,.035,C.base);box(g,.16,1.48,d/2+.14,.035,.3,.045,C.dark);box(g,-.16,1.48,d/2+.14,.035,.3,.045,C.dark);
  labelPlate(g,m.id,-.48,h-.29,d/2+.096,1.1,.17);controlPanel(g,w/2+.26,1.43,d/2-.07);beacon(g,w/2-.35,h+.16,-.55,m);
  // Rear electrical cabinet and ventilation slots.
  box(g,w/2+.16,1.14,-.87,.43,1.65,.4,C.body,true);for(let i=0;i<6;i++)box(g,w/2+.385,.75+i*.1,-.87,.016,.022,.26,C.base);
  m.shell=panels;m.height=h+.7;
}
function makeLathe(root,m){
  enclosure(root,m,3.35,2.6,2.2);
  const g=new THREE.Group();g.position.z=-.8;root.add(g);box(g,0,.71,0,2.8,.14,.8,C.dark);
  for(const z of [-.46,.48])box(g,.03,.76,z,2.48,.08,.08,C.steel,true);
  box(g,-1.03,1.37,-.05,.57,.7,.85,C.blue,true);
  const spin=new THREE.Group();spin.position.set(-.69,1.45,.02);g.add(spin);cyl(spin,0,0,0,.29,.2,C.steel,'x',40);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;box(spin,.14,Math.cos(a)*.15,Math.sin(a)*.15,.16,.1,.12,C.dark);}
  cyl(spin,.55,0,0,.12,.88,0xb5bcc1,'x',32);m.rotor=spin;
  const tool=new THREE.Group();tool.position.set(.5,1.12,.36);g.add(tool);box(tool,0,0,0,.7,.22,.5,C.blue,true);box(tool,0,.2,-.12,.18,.2,.3,C.steel);box(tool,-.14,.27,-.2,.33,.055,.07,C.black);m.motion=tool;
  box(g,1.05,1.25,-.04,.45,.4,.55,C.base,true);cyl(g,.84,1.45,0,.085,.22,C.steel,'x');
  // Compact overhead loader relates the transport pallet to the turning spindle.
  box(g,0,1.98,-.43,2.1,.09,.12,C.steel);box(g,0,1.8,-.43,.09,.36,.12,C.blue);
  box(g,0,1.58,.22,.28,.09,1.3,C.dark);
}
function makeMill(g,m,drill=false){
  enclosure(g,m,drill?2.85:3.05,2,drill?2.65:2.55);
  box(g,0,1.26,-.53,.9,1.33,.51,C.blue,true);
  for(const x of [-.27,.27])box(g,x,1.45,-.23,.065,1.55,.09,C.steel);
  const table=new THREE.Group();table.position.set(0,.69,.12);g.add(table);box(table,0,0,0,1.66,.16,1.08,C.steel,true);
  for(let i=0;i<5;i++)box(table,0,.086,-.39+i*.195,1.52,.008,.025,C.dark);
  // Stopper and side clamps fix the travelling pallet without covering the lane.
  for(const side of [-1,1])box(table,0,.29,side*.48,.62,.21,.13,C.base,true);
  const head=new THREE.Group();head.position.set(0,1.88,-.1);g.add(head);box(head,0,0,0,.57,.46,.57,C.body,true);cyl(head,0,-.31,.12,.115,.23,C.steel);cyl(head,0,-.52,.12,.026,.23,C.black);m.motion=table;m.head=head;
  if(drill){cyl(g,-.87,1.9,-.32,.34,.15,C.dark,'z',32);for(let i=0;i<8;i++){const a=i*Math.PI/4;cyl(g,-.87+Math.cos(a)*.26,1.9+Math.sin(a)*.26,-.2,.032,.19,C.steel,'z');}}
}
function makeCMM(g,m){
  feet(g,2.7,1.9);
  for(const z of [-.8,.8]){box(g,0,.48,z,2.7,.69,.35,C.body,true);box(g,0,.91,z,2.85,.16,.46,C.granite,true);}
  // Portal spans across the conveyor, leaving an unobstructed X-axis passage.
  for(const z of [-.84,.84])box(g,0,1.48,z,.22,1.08,.19,C.light,true);
  const portal=new THREE.Group();portal.position.y=2.05;g.add(portal);box(portal,0,0,0,.32,.26,1.96,C.body,true);box(portal,.18,0,0,.04,.09,1.68,C.blue);
  const probe=new THREE.Group();probe.position.set(.3,-.23,.1);portal.add(probe);box(probe,0,0,0,.28,.36,.36,C.dark,true);cyl(probe,0,-.37,0,.025,.55,C.steel);mesh(probe,new THREE.SphereGeometry(.047,12,8),0xb94035,0,-.65,0);m.motion=probe;
  controlPanel(g,1.1,1.25,.91);beacon(g,0,2.34,-.84,m);labelPlate(g,m.id,0,.54,1.0);m.height=2.9;m.shell=[];
}
function rollerBelt(g,x,z,length,width=1,height=.72){
  box(g,x,height-.08,z,length,.16,width,C.base,true);
  for(let a=-length/2+.14;a<length/2;a+=.22)cyl(g,x+a,height+.05,z,.075,width-.08,C.steel,'z',12);
  for(const side of [-1,1]){box(g,x,height+.06,z+side*(width/2),length,.12,.055,C.light);for(const end of [-1,1])box(g,x+end*(length/2-.25),height/2-.02,z+side*(width/2-.06),.07,height-.13,.07,C.base);}
}
function makePack(g,m){
  for(const z of [-.72,.72])box(g,0,1.36,z,.16,1.12,.15,C.blue,true);
  box(g,0,1.96,0,.94,.12,1.57,C.blue,true);box(g,0,1.73,-.61,.84,.28,.2,C.body);box(g,.7,.42,-.75,.55,.6,.55,C.body,true);
  cyl(g,.65,.46,-1.06,.3,.12,C.dark,'z');controlPanel(g,1.65,1.22,.65);beacon(g,-.4,2.22,-.64,m);labelPlate(g,m.id,0,.69,.64,1,.17);
  m.height=2.8;m.shell=[];
}
function carton(g,x,y,z,w=.6,h=.45,d=.48){
  box(g,x,y,z,w,h,d,0xb69c74,true);box(g,x,y+h/2+.005,z,w,.012,.065,0xd6c6a6);
  box(g,x,y,z+d/2+.004,.17,.14,.012,0xe7e4d9);
  for(let i=0;i<5;i++)box(g,x-.055+i*.024,y-.005,z+d/2+.013,.006,.073,.006,C.dark);
}
function makeRack(root,m){
  const g=new THREE.Group();g.position.z=1.72;root.add(g);
  for(const x of [-1.48,0,1.48])for(const z of [-.62,.62]){box(g,x,1.3,z,.08,2.6,.08,C.blue);box(g,x,.05,z,.2,.08,.19,C.dark);}
  for(let level=0;level<3;level++){const y=.23+level*.83;for(const z of [-.62,.62])box(g,0,y,z,3.05,.12,.1,0xad773a);box(g,0,y,0,3,.075,1.21,0xa0a9ac);for(const x of [-.76,.76]){box(g,x,y+.12,0,1.21,.14,1.06,0x9e8869);carton(g,x-.28,y+.43,.02,.49,.44,.76);carton(g,x+.28,y+.43,.02,.49,.44,.76);}}
  labelPlate(g,m.id,0,2.57,.68,1.18,.22);controlPanel(root,-.6,1.23,-.85);m.height=3;m.shell=[];
}
// Floor, service markings and the material aisle remain separate from machine geometry.
const floor=box(scene,0,-.12,.3,18,.2,13,0xcbd1d4);floor.castShadow=false;
const grid=new THREE.GridHelper(18,36,0xb8c0c6,0xc1c8cd);grid.position.y=-.014;grid.scale.z=12/18;scene.add(grid);
for(const z of [-.72,1.2])for(let x=-7.7;x<7;x+=1)box(scene,x,.006,z,.68,.01,.035,0xd6b24b);
for(const x of [-8.7,8.7])box(scene,x,.012,0,.025,.016,11.4,0xaeb8bf);
// A single continuous route goes THROUGH all five process stations and outfeed.
rollerBelt(scene,-.35,-2.6,15.7,.86,.88);
rollerBelt(scene,-.35,3,15.7,.86,.88);
const turn=new THREE.Group();turn.position.set(7.5,0,.2);turn.rotation.y=Math.PI/2;scene.add(turn);rollerBelt(turn,0,0,5.6,.86,.88);
for(const z of [-2.6,3]){box(scene,7.5,.76,z,1.08,.26,1.08,C.base,true);cyl(scene,7.5,.955,z,.48,.08,C.steel,'y',32);}
function floorArrow(x,z,angle){
  const shape=new THREE.Shape();shape.moveTo(-.25,-.09);shape.lineTo(.05,-.09);shape.lineTo(.05,-.2);shape.lineTo(.34,0);shape.lineTo(.05,.2);shape.lineTo(.05,.09);shape.lineTo(-.25,.09);
  const a=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:0x4d6d88,side:THREE.DoubleSide}));a.rotation.x=-Math.PI/2;a.rotation.z=angle;a.position.set(x,.02,z);scene.add(a);
}
for(const x of [-7.4,-2.5,2.5,6.9])floorArrow(x,-1.92,0);
for(const x of [-7.4,-2.5,2.5,6.9])floorArrow(x,2.32,Math.PI);
floorArrow(8.17,.2,-Math.PI/2);
const selectionRing=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.94,.025,-1.3),new THREE.Vector3(1.94,.025,-1.3),new THREE.Vector3(1.94,.025,1.3),new THREE.Vector3(-1.94,.025,1.3)]),new THREE.LineBasicMaterial({color:0x315b85}));scene.add(selectionRing);
const selectable=[];
machines.forEach(m=>{
  const g=new THREE.Group();g.position.set(m.x,0,m.z);g.userData.machineId=m.id;scene.add(g);m.group=g;
  ({lathe:makeLathe,mill:makeMill,drill:(g,m)=>makeMill(g,m,true),cmm:makeCMM,pack:makePack,rack:makeRack}[m.kind])(g,m);
  g.traverse(o=>{if(o.isMesh){o.userData.machineId=m.id;selectable.push(o);}});
  // Working area boundary.
  for(const z of [-1.4,1.4])box(scene,m.x,.003,m.z+z,3.9,.008,.028,0xe7e8df);
  for(const x of [-1.95,1.95])box(scene,m.x+x,.003,m.z,.028,.008,2.8,0xe7e8df);
  const b=document.createElement('button');b.className='machine-label';b.innerHTML='<i class="dot run"></i>'+String(machines.indexOf(m)+1).padStart(2,'0')+' · '+m.id;b.setAttribute('aria-label',m.id+' — '+m.name);b.onclick=()=>selectMachine(m.id);$('labels').appendChild(b);m.label=b;
});
const partMeshes=new Map();
function partMesh(part){
  const root=new THREE.Group(),bare=new THREE.Group(),packed=new THREE.Group();root.add(bare,packed);scene.add(root);
  box(bare,0,1.055,0,.6,.14,.59,C.blue,true);const stock=cyl(bare,0,1.22,0,.18,.2,C.steel,'y',24);
  for(const x of [-.12,.12])for(const z of [-.12,.12])cyl(bare,x,1.326,z,.026,.015,C.dark,'y',10);
  carton(packed,0,1.25,0,.6,.5,.58);labelPlate(packed,'P'+String(part.id).padStart(3,'0'),0,1.22,.303,.3,.095);
  const item={root,bare,packed,stock};partMeshes.set(part.id,item);return item;
}

function setView(mode){
  state.view=mode;const m=machines.find(x=>x.id===state.selected);
  machines.forEach(x=>x.group.visible=mode!=='focus'||x.id===state.selected);
  if(mode==='focus'){controls.target.set(m.x,1.1,m.z);camera.position.set(m.x+4.7,4.7,m.z+6.8);camera.zoom=2.7;}
  else if(mode==='top'){controls.target.set(0,0,0);camera.position.set(0,25,.01);camera.zoom=1;}
  else{controls.target.set(0,.6,0);camera.position.set(15,14,19);camera.zoom=1;}
  camera.updateProjectionMatrix();controls.update();
  $('overview').setAttribute('aria-pressed',String(mode==='overview'));$('overview').classList.toggle('selected',mode==='overview');$('topview').setAttribute('aria-pressed',String(mode==='top'));
}
function resize(){const w=container.clientWidth,h=container.clientHeight;const span=Math.max(14.5,22/(w/h));camera.left=-span*w/h/2;camera.right=span*w/h/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();renderer.setSize(w,h);drawTrend();}
new ResizeObserver(resize).observe(container);
function selectMachine(id){
  const m=machines.find(x=>x.id===id);if(!m)return;state.selected=id;
  $('assetId').textContent=m.id;$('assetName').textContent=m.name;$('assetTag').textContent=m.code;$('assetDescription').textContent=m.description;$('assetParts').textContent=m.parts;
  selectionRing.position.set(m.x,0,m.z);machines.forEach(x=>{x.label.classList.toggle('selected',x.id===id);x.label.setAttribute('aria-pressed',String(x.id===id));});
  $('cutaway').disabled=!m.shell.length;if(!m.shell.length)state.cutaway=false;applyCutaway();updateUI();if(state.view==='focus')setView('focus');
}
function applyCutaway(){machines.forEach(m=>m.shell.forEach(o=>o.visible=!(state.cutaway&&m.id===state.selected)));$('cutaway').setAttribute('aria-pressed',String(state.cutaway));}
function modelTime(){return new Date((8*3600+state.elapsed)*1000).toISOString().slice(11,19);}
function addEvent(level,asset,text){state.events.unshift({time:modelTime(),level,asset,text});state.events=state.events.slice(0,60);$('eventCount').textContent=state.events.length;$('eventRows').innerHTML=state.events.map(e=>'<tr><td>'+e.time+'</td><td><span class="status-tag '+e.level+'">'+({run:'Информация',warning:'Предупреждение',critical:'Останов'}[e.level]||'Информация')+'</span></td><td>'+e.asset+'</td><td>'+e.text+'</td></tr>').join('');}
function setScenario(name){
  if(!['normal','heat','bottleneck','defect'].includes(name))throw Error('Неизвестный сценарий');
  state.scenario=name;state.scenarioStarted=state.elapsed;$('scenario').value=name;
  const spec={normal:[state.selected,'run','Восстановлен нормальный режим участка.'],heat:['CNC-02','critical','Шпиндель выше 90 °C: паллета удерживается в ячейке, входной поток накапливается.'],bottleneck:['QC-01','warning','Цикл контроля увеличен до 150 с: очередь формируется перед измерительным порталом.'],defect:['CNC-03','warning','Отклонение размера +0,18 мм при допуске ±0,05 мм.']};
  const [id,level,text]=spec[name];addEvent(level,id,text);updateModel(0);selectMachine(id);
}
function updateModel(dt){
  state.elapsed+=dt;
  const completed=flow.tick(dt,{blocked:state.scenario==='heat'?['CNC-02']:[],cycles:state.scenario==='bottleneck'?{'QC-01':150}:{},defect:state.scenario==='defect'});
  completed.forEach(p=>{state.outputCount++;if(p.rejected){state.rejected++;addEvent('warning','STORE','Упаковка P'+p.id+' передана в карантин по результатам контроля.');}else{state.good++;addEvent('run','STORE','Упаковка P'+p.id+' прошла все 6 операций и вышла с линии.');}});
  machines.forEach((m,i)=>{
    const station=flow.station(m.id);m.active=station.active;m.part=station.part;
    m.status=station.active?'run':'idle';m.temp=m.baseTemp+Math.sin(state.elapsed*.022+i)*1.3;m.load=station.active?Math.round(m.baseLoad+Math.sin(state.elapsed*.03+i)*2):0;m.cycle=m.baseCycle;m.power=station.active?m.basePower*(1+Math.sin(state.elapsed*.026+i)*.025):m.basePower*.12;m.queue=station.queue;
  });
  if(state.scenario==='heat'){const m=machines[1];Object.assign(m,{status:'critical',temp:93+Math.sin(state.elapsed*.04),load:0,cycle:0,power:.9});}
  if(state.scenario==='bottleneck'){const m=machines[3];Object.assign(m,{status:'warning',cycle:150});}
  if(state.scenario==='defect'){const m=machines[2];Object.assign(m,{status:'warning',temp:69+Math.sin(state.elapsed*.03),cycle:50});}
  const rate={normal:48,heat:0,bottleneck:24,defect:48}[state.scenario];state.rate=rate;
  const total=state.good+state.rejected,availability=state.scenario==='heat'?.76:.96,performance=rate/52,quality=state.good/total;
  state.oee=availability*performance*quality*100;state.quality=quality;state.availability=availability;state.performance=performance;
  machines.forEach(m=>{
    const lampIndex=m.status==='critical'?2:m.status==='warning'?1:0;
    m.lamps?.forEach((lamp,i)=>{lamp.material.emissive.setHex(i===lampIndex?statusColors[m.status]:0);lamp.material.emissiveIntensity=i===lampIndex?.65:0;});
    m.label.querySelector('.dot').className='dot '+m.status;
  });
}
function cycleText(m){if(!m.cycle)return m.status==='critical'?'Остановлен':'—';const n=Math.round(m.cycle);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
function diagnostic(m){
  if(m.status==='critical')return {title:'Останов по температуре',text:'Шпиндель '+fmt(m.temp)+' °C. Уставка останова: 90 °C. Паллета удерживается в ячейке; входящие паллеты ждут. После охлаждения операция продолжится.',action:'Охладить и возобновить'};
  if(m.id==='QC-01'&&state.scenario==='bottleneck')return {title:'Замедлен контроль',text:m.queue+' паллет перед порталом. Цикл вырос с 40 до 150 с. Накопление очереди видно на конвейере. Действие: восстановить штатный цикл.',action:'Восстановить цикл контроля'};
  if(m.id==='CNC-03'&&state.scenario==='defect')return {title:'Отклонение размера',text:'Измерено +0,18 мм при допуске ±0,05 мм. Проверьте корректор инструмента; результат повторного контроля записывается в журнал.',action:'Скорректировать инструмент'};
  return {title:m.status==='idle'?'Ожидание следующей паллеты':'Выполняется операция',text:m.part?'Паллета P'+m.part.id+'. До завершения операции: '+Math.ceil(m.part.remaining??m.cycle)+' с. Затем паллета продолжит маршрут.':'Транспортный канал свободен. Очередь перед узлом: '+m.queue+' паллет. Температура в пределах рабочего режима.'};
}
function updateUI(){
  const m=machines.find(x=>x.id===state.selected);$('clock').textContent=modelTime();$('plan').textContent=fmt(state.good/600*100);$('planDetail').textContent=state.good+' из 600 годных деталей';$('planBar').value=Math.min(600,state.good);
  $('oee').textContent=fmt(state.oee);$('oeeDetail').textContent=fmt(state.availability*100,0)+'% × '+fmt(state.performance*100,0)+'% × '+fmt(state.quality*100,1)+'%';
  $('rate').textContent=state.rate;$('reject').textContent=fmt(state.rejected/(state.good+state.rejected)*100);$('rejectDetail').textContent=state.rejected+' из '+(state.good+state.rejected)+' обработанных';
  const alarmCount=machines.filter(m=>['warning','critical'].includes(m.status)).length;$('alarms').textContent=alarmCount;$('alarms').style.color=alarmCount?'#a04438':'inherit';$('alarmDetail').textContent=alarmCount?'Откройте карточку отмеченного станка':'Параметры в пределах нормы';
  $('assetState').textContent=statusNames[m.status];$('assetState').className='status-tag '+m.status;$('operation').textContent=m.operation;$('load').textContent=m.load+'%';$('temp').textContent=fmt(m.temp)+' °C';$('temp').style.color=m.temp>=80?'#af3b32':'inherit';$('cycle').textContent=cycleText(m);$('power').textContent=fmt(m.power)+' кВт';$('queue').textContent=m.queue+' паллет';
  $('flowState').textContent=flow.parts.length+' паллет на линии · '+(state.scenario==='heat'?'CNC-02 удерживает поток':'маршрут активен');
  machines.forEach(m=>{const li=$('route-'+m.id);li.className=m.status;li.querySelector('small').textContent=m.part?'P'+m.part.id+' · '+(m.status==='critical'?'удержание':Math.ceil(m.part.remaining??m.cycle)+' с'):m.queue?'очередь: '+m.queue:'ожидание';});
  const d=diagnostic(m);$('diagnostic').className='diagnostic '+m.status;$('diagnosticTitle').textContent=d.title;$('diagnosticText').textContent=d.text;$('resolve').hidden=!d.action;if(d.action)$('resolve').textContent=d.action;
  // Preserve focused row buttons during telemetry refresh.
  machines.forEach(m=>{
    const row=$('row-'+m.id);row.classList.toggle('active-row',m.id===state.selected);row.querySelector('[data-state]').className='status-tag '+m.status;row.querySelector('[data-state]').textContent=statusNames[m.status];row.querySelector('[data-load]').innerHTML='<span class="load-bar"><i style="width:'+m.load+'%"></i></span>'+m.load+'%';row.querySelector('[data-temp]').textContent=fmt(m.temp)+' °C';row.querySelector('[data-cycle]').textContent=cycleText(m);row.querySelector('[data-queue]').textContent=m.queue+' дет.';
  });drawTrend();
}
function drawTrend(){
  const cv=$('trend'),ct=cv.getContext('2d'),w=cv.clientWidth,h=cv.clientHeight;if(!w)return;const dpr=Math.min(devicePixelRatio,2);cv.width=w*dpr;cv.height=h*dpr;ct.scale(dpr,dpr);
  const m=machines.find(x=>x.id===state.selected),min=Math.floor(Math.min(...m.history,m.temp)/10)*10-5,max=Math.max(min+25,Math.ceil(Math.max(...m.history,m.temp)/10)*10+5),left=29,right=w-5;
  ct.font='11px Arial';ct.textBaseline='middle';ct.fillStyle='#6a7782';ct.strokeStyle='#e1e6eb';ct.lineWidth=1;
  for(let i=0;i<3;i++){const y=9+i*(h-22)/2;ct.beginPath();ct.moveTo(left,y);ct.lineTo(right,y);ct.stroke();ct.fillText(Math.round(max-i*(max-min)/2),0,y);}
  ct.beginPath();m.history.forEach((v,i)=>{const x=left+i/59*(right-left),y=9+(max-v)/(max-min)*(h-22);i?ct.lineTo(x,y):ct.moveTo(x,y);});ct.strokeStyle=m.temp>=80?'#b44538':'#527da2';ct.lineWidth=1.8;ct.stroke();
}
function buildTable(){$('equipmentRows').innerHTML=machines.map(m=>'<tr id="row-'+m.id+'"><td><button data-id="'+m.id+'">'+m.id+'</button><span class="equipment-name">'+m.name+'</span></td><td><span data-state class="status-tag"></span></td><td>'+m.operation+'</td><td data-load></td><td data-temp></td><td data-cycle></td><td data-queue></td></tr>').join('');$('equipmentRows').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)selectMachine(b.dataset.id);});}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),4000);}
function resolveScenario(){if(state.scenario==='normal')return;const previous=state.scenario;if(previous==='bottleneck'){const p=flow.station('QC-01').part;if(p&&p.remaining!==null)p.remaining=Math.min(p.remaining,40);}addEvent('run',state.selected,'Действие оператора: '+({heat:'охлаждение шпинделя и возобновление цикла',bottleneck:'восстановление штатного цикла контроля',defect:'коррекция инструмента и повторный контроль'}[previous])+'.');setScenario('normal');toast('Нормальный режим восстановлен. Паллеты продолжают маршрут.');}
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerStart;
renderer.domElement.addEventListener('pointerdown',e=>pointerStart={x:e.clientX,y:e.clientY});
renderer.domElement.addEventListener('pointerup',e=>{if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(selectable).find(h=>h.object.visible&&h.object.parent.visible);if(hit)selectMachine(hit.object.userData.machineId);});
$('overview').onclick=()=>setView('overview');$('topview').onclick=()=>setView('top');$('focus').onclick=()=>setView('focus');$('cutaway').onclick=()=>{state.cutaway=!state.cutaway;applyCutaway();};
$('scenario').onchange=e=>setScenario(e.target.value);$('resolve').onclick=resolveScenario;
function runLabel(){$('simulationState').textContent=(state.paused?'Симуляция на паузе':'Симуляция запущена')+' · ×'+state.speed;}
$('pause').onclick=()=>{state.paused=!state.paused;$('pause').textContent=state.paused?'Продолжить':'Пауза';runLabel();};$('speed').onchange=e=>{state.speed=Number(e.target.value);runLabel();};
function openTab(eventMode){$('equipmentView').hidden=eventMode;$('eventsView').hidden=!eventMode;for(const [id,active] of [['equipmentTab',!eventMode],['eventsTab',eventMode]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));}}
$('equipmentTab').onclick=()=>openTab(false);$('eventsTab').onclick=()=>openTab(true);
['equipmentTab','eventsTab'].forEach((id,i)=>$(id).onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();openTab(i===0);$(i===0?'eventsTab':'equipmentTab').focus();}});
let last=performance.now(),sampleTimer=0;
function animate(now){
  const dt=Math.max(0,Math.min((now-last)/1000,.08));last=now;
  if(!state.paused){updateModel(dt*state.speed);sampleTimer+=dt;if(sampleTimer>=1){sampleTimer=0;machines.forEach(m=>{m.history.push(m.temp);m.history.shift();});updateUI();}}
  const time=state.elapsed;
  machines.forEach(m=>{const working=m.active&&m.status!=='critical';
    if(m.rotor&&working)m.rotor.rotation.x=time*1.2;
    if(m.motion&&working){if(m.kind==='lathe')m.motion.position.x=.45+Math.sin(time*.13)*.32;else if(m.kind==='cmm')m.motion.position.x=Math.sin(time*.08)*.67;else{m.motion.position.x=Math.sin(time*.07)*.2;if(m.head)m.head.position.y=1.9+Math.sin(time*.1)*.08;}}
  });
  const present=new Set(flow.parts.map(p=>p.id));
  for(const [id,item] of partMeshes)if(!present.has(id)){scene.remove(item.root);item.root.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(o.material.map)o.material.map.dispose();}});partMeshes.delete(id);}
  flow.parts.forEach(p=>{
    const item=partMeshes.get(p.id)||partMesh(p),point=routePoint(p.s),selected=machines.find(m=>m.id===state.selected);
    item.root.position.set(point.x,0,point.z);item.root.rotation.y=point.angle;
    item.root.visible=state.view!=='focus'||Math.hypot(point.x-selected.x,point.z-selected.z)<2.1;
    item.packed.visible=p.next>=5;item.bare.visible=p.next<5;
    item.stock.material=mat(p.rejected?0xbe5142:p.next>=2?0xaebfc9:C.steel,.6);
  });
  controls.update();renderer.render(scene,camera);
  const w=container.clientWidth,h=container.clientHeight;
  machines.forEach(m=>{const p=new THREE.Vector3(m.x,m.height+.22,m.z).project(camera),x=(p.x*.5+.5)*w,y=(-p.y*.5+.5)*h;m.label.style.left=x+'px';m.label.style.top=y+'px';m.label.hidden=p.z< -1||p.z>1||x<28||x>w-28||y<15||y>h-25||(state.view==='focus'&&state.selected!==m.id);});
  requestAnimationFrame(animate);
}
buildTable();updateModel(0);selectMachine('CNC-02');setView('overview');resize();
addEvent('run','Участок 01','Загружено сменное задание: 600 годных деталей.');
addEvent('run','QC-01','Контроль измерительной системы завершён.');
addEvent('run','Участок 01','Симуляция запущена в нормальном режиме.');
requestAnimationFrame(animate);
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'set_factory_scenario',title:'Изменить сценарий цеха',description:'Изменяет учебный сценарий и обновляет видимую MES-панель.',inputSchema:{type:'object',properties:{scenario:{type:'string',enum:['normal','heat','bottleneck','defect']}},required:['scenario'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!['normal','heat','bottleneck','defect'].includes(input.scenario))throw Error('Неизвестный сценарий');setScenario(input.scenario);return{scenario:state.scenario,selected:state.selected,alarms:state.scenario==='normal'?0:1};}})).catch(()=>{});}catch{}}
