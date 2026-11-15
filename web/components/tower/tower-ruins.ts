import * as THREE from 'three';
import {floorRadius,towerHeight} from './tower-architecture';
import {seeded} from './world-state';

/** Presentation only. No rewards, clock, history or persistence are changed here. */
export type TowerDamageView={scope:string;earnedFloors:number;visibleFloors:number;integrity:number;status:'intact'|'damaged'|'collapsed'|'repairing'};
export function createTowerRuins(scene:THREE.Scene,seed:number,color:string,reduced:boolean,quality:'high'|'low',ground:(x:number,z:number)=>number){
 const root=new THREE.Group(),ruins=new THREE.Group(),falling=new THREE.Group();root.name='tower-condition-visual';root.add(ruins,falling);scene.add(root);
 const chunkGeometry=new THREE.CylinderGeometry(1,1,1,8,1,false,0,Math.PI*.47);
 const rockGeometry=new THREE.IcosahedronGeometry(1,0);
 const wallGeometry=new THREE.CylinderGeometry(1,1,1,10,1,false,0,Math.PI*.56);
 const stone=new THREE.MeshLambertMaterial({color}),broken=new THREE.MeshLambertMaterial({color:new THREE.Color(color).multiplyScalar(.74)});
 type Piece={mesh:THREE.Mesh;start:THREE.Vector3;end:THREE.Vector3;spin:THREE.Vector3;delay:number;duration:number};
 let pieces:Piece[]=[],elapsed=0,signature='',phase:'intact'|'falling'|'ruins'='intact';
 const valid=(v:TowerDamageView)=>typeof v.scope==='string'&&v.scope.length<=100&&Number.isInteger(v.earnedFloors)&&v.earnedFloors>=0&&v.earnedFloors<=100&&Number.isInteger(v.visibleFloors)&&v.visibleFloors>=0&&v.visibleFloors<=v.earnedFloors&&Number.isFinite(v.integrity)&&v.integrity>=0&&v.integrity<=100&&['intact','damaged','collapsed','repairing'].includes(v.status);
 function set(view:TowerDamageView|null,animate=false){
  if(view&&!valid(view))throw Error('Invalid tower damage presentation');
  const next=JSON.stringify(view);if(next===signature)return;signature=next;
  ruins.clear();falling.clear();ruins.visible=true;pieces=[];elapsed=0;phase='intact';root.visible=false;
  if(!view||view.integrity===100||view.earnedFloors===0)return;
  root.visible=true;phase='ruins';const random=seeded(seed+view.earnedFloors*97+view.visibleFloors*11);
  const lost=view.earnedFloors-view.visibleFloors,count=Math.min(quality==='high'?48:24,8+Math.ceil((100-view.integrity)*.4));
  for(let i=0;i<count;i++){
   const angle=i/count*Math.PI*2+random()*.4,r=view.visibleFloors?2.65+random()*.65:random()*2.7;
   const x=Math.sin(angle)*r,z=Math.cos(angle)*r,size=.13+random()*(view.visibleFloors?.27:.44);
   const rock=new THREE.Mesh(rockGeometry,i%3?stone:broken);rock.position.set(x,ground(x,z)+size*.45,z);rock.scale.set(size*(1+random()),size*.65,size);rock.rotation.set(random()*2,angle,random());rock.castShadow=true;rock.receiveShadow=true;ruins.add(rock);
  }
  if(view.visibleFloors===0){
   for(let i=0;i<3;i++){const wall=new THREE.Mesh(wallGeometry,i%2?broken:stone),h=.4+random()*.75;wall.position.set(0,ground(0,0)+h/2,0);wall.scale.set(1.8,h,1.8);wall.rotation.y=i*2.2;wall.castShadow=true;wall.receiveShadow=true;ruins.add(wall);}
  }
  if(!animate||reduced||lost===0)return;
  phase='falling';ruins.visible=false;
  const bands=Math.min(lost,quality==='high'?20:10),base=3.3+towerHeight(view.visibleFloors),height=towerHeight(view.earnedFloors)-towerHeight(view.visibleFloors);
  for(let band=0;band<bands;band++)for(let side=0;side<4;side++){
   const index=view.visibleFloors+(band+.5)*lost/bands,radius=floorRadius(Math.floor(index)),angle=side*Math.PI/2;
   const mesh=new THREE.Mesh(chunkGeometry,side%2?stone:broken);mesh.scale.set(radius,height/bands*.96,radius);mesh.rotation.y=angle;mesh.castShadow=true;
   const start=new THREE.Vector3(0,base+(band+.5)*height/bands,0),targetAngle=angle+Math.PI*.24,range=2.6+random()*.8;
   const end=new THREE.Vector3(Math.sin(targetAngle)*range,0,Math.cos(targetAngle)*range);end.y=ground(end.x,end.z)+.12;
   mesh.position.copy(start);falling.add(mesh);pieces.push({mesh,start,end,spin:new THREE.Vector3((random()-.5)*1.8,(random()-.5)*2.4,(random()-.5)*1.8),delay:.65+(bands-band-1)/bands*.55+side*.045,duration:1.5+Math.sqrt((band+.5)/bands)*.8});
  }
 }
 function tick(dt:number){
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid tower animation interval');
  if(phase!=='falling')return;elapsed+=Math.min(dt,.1);let active=0;
  for(const piece of pieces){
   const t=Math.max(0,Math.min(1,(elapsed-piece.delay)/piece.duration));piece.mesh.visible=t<1;if(!piece.mesh.visible)continue;active++;
   piece.mesh.position.lerpVectors(piece.start,piece.end,t*t);piece.mesh.rotation.x=piece.spin.x*t;piece.mesh.rotation.z=piece.spin.z*t;piece.mesh.rotation.y+=dt*piece.spin.y*t;
  }
  ruins.visible=elapsed>1.8;
  if(!active){pieces=[];falling.clear();ruins.visible=true;phase='ruins';}
 }
 return {set,tick,get phase(){return phase;},get ruinCount(){return root.visible?ruins.children.length:0;},get fallingCount(){return pieces.filter(p=>p.mesh.visible).length;},
  dispose(){root.removeFromParent();root.clear();pieces=[];chunkGeometry.dispose();rockGeometry.dispose();wallGeometry.dispose();stone.dispose();broken.dispose();}};
}
