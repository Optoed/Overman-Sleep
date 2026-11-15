import test from 'node:test';
import assert from 'node:assert/strict';
import {groundHeight,islandRadius,groundObstacles,makeWalkRoute,pointOnRoute,isWalkable,segmentClear,waterHeight,waterSlope,growthFog,boatApproach,type Obstacle} from '../components/tower/world-physics';
import {createWorld,parseWorld} from '../components/tower/world-state';
import {cliffRadius,coastRadius,dockStairProfile,MAIN_DOCK_ANGLE} from '../components/tower/island-shape';
import {towerWings,towerHeight,floorHeight,floorRadius,towerWallRadius} from '../components/tower/tower-architecture';
import {alpineCoastMask} from '../components/tower/alpine-mask';

test('Alpine tile edges are fully submerged while the central measured ridges remain intact',()=>{
  for(let t=-1;t<=1;t+=.01){
    for(const [x,z] of [[-1,t],[1,t],[t,-1],[t,1]])assert.equal(alpineCoastMask(x,z),0);
  }
  for(let a=0;a<Math.PI*2;a+=.05){
    assert.equal(alpineCoastMask(Math.cos(a)*.4,Math.sin(a)*.4),1);
    let previous=1;
    for(let r=.4;r<=1.4;r+=.01){const value=alpineCoastMask(Math.cos(a)*r,Math.sin(a)*r);assert.ok(value>=0&&value<=previous+1e-12);previous=value;}
  }
});

test('architectural wings remain inside the reserved foundation and below the crane',()=>{
  assert.deepEqual(towerWings(0),[]);assert.deepEqual(towerWings(4),[]);
  for(let floors=6;floors<=24;floors++)for(const wing of towerWings(floors)){
    assert.ok(Math.hypot(wing.x,wing.z)+1.08<groundObstacles(floors,[])[0].radius);
    assert.ok(wing.levels>=2&&towerHeight(wing.levels)+2.43<towerHeight(floors)+.5);
  }
});
test('compact upper storeys join continuously and retain full-size window clearance',()=>{
  assert.equal(towerHeight(0),0);assert.equal(towerHeight(4),8.2);
  assert.ok(towerHeight(24)<41);
  for(let i=0;i<100;i++){
    assert.ok(Math.abs(towerHeight(i+1)-towerHeight(i)-floorHeight(i))<1e-10);
    assert.ok(.46+.95<floorHeight(i)-.05);
    assert.ok(floorRadius(i)>1.3);
    assert.ok(floorRadius(i+1)<=floorRadius(i));
  }
});
test('damage attaches to the tapered wall at each storey, including the compact upper floors',()=>{
  for(const floors of [4,12,24,100])for(let row=0;row<floors;row++)for(const t of [.01,.35,.9]){
    const y=.35+towerHeight(row)+(floorHeight(row)-.05)*t;
    assert.ok(Math.abs(towerWallRadius(floors,y)-(floorRadius(row)+(floorRadius(row+1)-floorRadius(row))*t))<1e-9);
  }
  assert.ok(towerWallRadius(24,35)<2);
});

test('sculpted cliffs join the plateau and reserve water around every boat hull',()=>{
  for(let a=-Math.PI;a<Math.PI;a+=.03){
    assert.ok(Math.abs(cliffRadius(a,2.78)-islandRadius(a)-.1)<1e-9);
    assert.ok(Math.abs(coastRadius(a)-coastRadius(a+Math.PI*2))<1e-9);
    assert.ok(coastRadius(a)>islandRadius(a));
    for(let y=-1.2;y<=2.78;y+=.1)assert.ok(cliffRadius(a,y)>4.5&&cliffRadius(a,y)<8.5);
  }
  for(const [x,z,heading,scale] of [[4.7,7.9,-.2,.68],[-8.3,1.7,.6,1],[8.3,-5.8,1.4,1]]){
    for(let v=-1.9;v<=1.9;v+=.025)for(const side of [-1,1]){
      const u=side*.76*Math.pow(Math.max(0,1-Math.pow(v/1.9,2)),.65);
      const px=x+(Math.cos(heading)*u+Math.sin(heading)*v)*scale,pz=z+(-Math.sin(heading)*u+Math.cos(heading)*v)*scale;
      assert.ok(Math.hypot(px,pz)>coastRadius(Math.atan2(pz,px))+.22,`hull touches shore: ${x}/${z}/${v}`);
    }
  }
});
test('arriving hulls stay offshore for the entire approach, including the final turn',()=>{
  for(const [x,z,heading,scale] of [[4.7,7.9,-.2,.68],[-8.3,1.7,.6,1],[8.3,-5.8,1.4,1]]){
    assert.deepEqual(boatApproach(x,z,0,heading),{x,z,heading});
    for(let arrival=0;arrival<=1;arrival+=.005){
      const p=boatApproach(x,z,arrival,heading);
      for(let v=-1.9;v<=1.9;v+=.06)for(const side of [-1,1]){
        const u=side*.76*Math.pow(Math.max(0,1-Math.pow(v/1.9,2)),.65);
        const px=p.x+(Math.cos(p.heading)*u+Math.sin(p.heading)*v)*scale,pz=p.z+(-Math.sin(p.heading)*u+Math.cos(p.heading)*v)*scale;
        assert.ok(Math.hypot(px,pz)>coastRadius(Math.atan2(pz,px))+.22,`arrival collision ${x}/${z}/${arrival}`);
      }
    }
  }
});
test('dock stair treads clear the cliff and connect the plateau to the pier',()=>{
  const steps=dockStairProfile(),last=steps.at(-1)!;
  assert.ok(Math.abs(steps[0].height+.09-2.91)<.04);
  assert.ok(Math.abs(last.height+.09-(.45+.07))<.04);
  assert.ok(last.distance+.1175<5+15*.21+.095);
  for(const step of steps.slice(1))for(const side of [-.56,.56])for(const along of [-.1175,.1175]){
    const d=step.distance+along,x=Math.cos(MAIN_DOCK_ANGLE)*side+Math.sin(MAIN_DOCK_ANGLE)*d,z=-Math.sin(MAIN_DOCK_ANGLE)*side+Math.cos(MAIN_DOCK_ANGLE)*d;
    assert.ok(Math.hypot(x,z)>cliffRadius(Math.atan2(z,x),step.height-.09),`buried tread at ${step.distance}`);
  }
});

test('boat pitch and roll use the actual derivative of the displaced water',()=>{
  const e=1e-5;
  for(const storm of [0,.45,1])for(const t of [0,3.5,67])for(const [x,z] of [[4.7,7.9],[-8.3,1.7],[8.3,-5.8]]){
    const slope=waterSlope(x,z,t,storm);
    assert.ok(Math.abs(slope.dx-(waterHeight(x+e,z,t,storm)-waterHeight(x-e,z,t,storm))/(2*e))<1e-7);
    assert.ok(Math.abs(slope.dz-(waterHeight(x,z+e,t,storm)-waterHeight(x,z-e,t,storm))/(2*e))<1e-7);
  }
  assert.ok(Math.abs(waterHeight(4.7,7.9,0)-waterHeight(4.7,7.9,2))>.05);
});
test('all development stages have safe routes around buildings, foundations, stairs and trees',()=>{
  const trees:Obstacle[]=Array.from({length:14},(_,i)=>({x:Math.cos(i*2.4)*5,z:Math.sin(i*2.4)*5,radius:.14}));
  for(const floors of [0,4,12,24])for(const motifs of [[],['garden','forge']]){
    const obstacles=groundObstacles(floors,trees,motifs);
    for(const seed of [0,128,27182,4294967295]){
      const path=makeWalkRoute(obstacles,seed);assert.ok(path.length>=2,`no path: ${floors}/${seed}`);
      for(let i=0;i<path.length-1;i++)assert.ok(segmentClear(path[i],path[i+1],obstacles,.22));
      for(let d=0;d<60;d+=.11)assert.ok(isWalkable(pointOnRoute(path,d),obstacles,.21));
    }
  }
});
test('navigation refuses an entirely occupied island and handles degenerate routes',()=>{
  assert.deepEqual(makeWalkRoute([{x:0,z:0,radius:20}],42),[]);
  assert.ok(!segmentClear({x:-4,z:0},{x:4,z:0},[{x:0,z:0,radius:2}]));
  const p=pointOnRoute([{x:1,z:2},{x:1,z:2}],5);assert.deepEqual(p,{x:1,z:2,angle:0});
});
test('irregular shores reserve room for a resident; construction pads remain level',()=>{
  for(let a=0;a<Math.PI*2;a+=.1){const r=islandRadius(a);assert.equal(isWalkable({x:Math.cos(a)*(r-.1),z:Math.sin(a)*(r-.1)},[]),false);assert.ok(isWalkable({x:Math.cos(a)*(r-.5),z:Math.sin(a)*(r-.5)},[]));}
  const obstacles=groundObstacles(24,[]);
  for(const o of obstacles)assert.equal(groundHeight(o.x,o.z,obstacles),2.91);
  for(let x=-5;x<5;x+=.3)for(let z=-5;z<5;z+=.3)assert.ok(Math.abs(groundHeight(x,z,obstacles)-2.91)<=.057001);
});
test('fog recedes with growth, is bounded, and sunset survives storage',()=>{
  assert.ok(growthFog(0)>growthFog(4));assert.ok(growthFog(4)>growthFog(12));
  assert.equal(growthFog(12),growthFog(24));assert.equal(growthFog(-1),growthFog(0));
  const w={...createWorld(42),weather:'sunset'};assert.equal(parseWorld(JSON.stringify(w))?.weather,'sunset');
});
