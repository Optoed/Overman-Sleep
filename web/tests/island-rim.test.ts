import test from 'node:test';
import assert from 'node:assert/strict';
import { rimSurfaceHeight,cliffCrownHeight,soilRimGeometry,updateSoilRim,cliffRootGeometry } from '../components/tower/island-rim';
import { groundHeight,islandRadius,groundObstacles } from '../components/tower/world-physics';
import { harbourClearance,coastRadius } from '../components/tower/island-shape';

test('eroded rim leaves the walking zone and dock level while joining the ground and cliff',()=>{
  const obstacles=groundObstacles(24,[]),g=soilRimGeometry(),p=g.attributes.position,uv=g.attributes.rimCoordinate;
  updateSoilRim(g,obstacles);
  let deepest=0;
  for(let a=0;a<Math.PI*2;a+=.013){
    const r=islandRadius(a),x=Math.cos(a)*r,z=Math.sin(a)*r;
    for(const inset of [.25,.35,.6,1,2])assert.equal(rimSurfaceHeight(Math.cos(a)*(r-inset),Math.sin(a)*(r-inset),obstacles),groundHeight(Math.cos(a)*(r-inset),Math.sin(a)*(r-inset),obstacles));
    const drop=groundHeight(x,z,obstacles)-rimSurfaceHeight(x,z,obstacles);deepest=Math.max(deepest,drop);
    assert.ok(drop>=0&&drop<.251);
    if(harbourClearance(a)>.995)assert.ok(drop<.0013);
    assert.ok(cliffCrownHeight(a)<rimSurfaceHeight(x,z)-.0999);
  }
  assert.ok(deepest>.15);
  for(let i=0;i<p.count;i++){
    const a=uv.getX(i),r=Math.hypot(p.getX(i),p.getZ(i));
    assert.ok(r<coastRadius(a)+.01);
    if(uv.getY(i)===0)assert.ok(Math.abs(p.getY(i)-rimSurfaceHeight(p.getX(i),p.getZ(i),obstacles))<1e-5);
    const n=g.attributes.normal;
    assert.ok(n.getX(i)*Math.cos(a)+n.getZ(i)*Math.sin(a)>0,'rim faces outward');
  }
  g.dispose();
});

test('exposed roots remain below the walking surface and inside the protected coast',()=>{
  const trees=Array.from({length:30},(_,i)=>({x:Math.cos(i*.7)*5.2,z:Math.sin(i*.7)*5.2,radius:.14}));
  const g=cliffRootGeometry(trees),p=g.attributes.position;assert.ok(p.count>0);
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),r=Math.hypot(x,z);
    assert.ok(r<coastRadius(a));assert.ok(y<3);
    if(r<islandRadius(a)-.001)assert.ok(y<rimSurfaceHeight(x,z)-.099);
    assert.ok(harbourClearance(a)<.2);
  }
  g.dispose();
});
