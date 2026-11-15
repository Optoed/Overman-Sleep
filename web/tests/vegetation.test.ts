import test from 'node:test';
import assert from 'node:assert/strict';
import { grassBladeGeometry, fernGeometry, vegetationFits, FERN_RADIUS } from '../components/tower/vegetation';

test('meadow plants stay rooted and within the footprint reserved around paths',()=>{
  const blade=grassBladeGeometry(),p=blade.attributes.position;
  let roots=0;
  for(let i=0;i<p.count;i++){
    const y=p.getY(i);assert.ok(y>=0&&y<=1);
    if(y===0)roots++;
    // Largest planted blade and maximal wind displacement.
    for(const [height,footprint] of [[.21,.12],[.27,.16]]){
      const x=Math.abs(p.getX(i)*.03)+.034*y*y,z=Math.abs(p.getZ(i)*height*.5)+.018*y*y;
      assert.ok(Math.hypot(x,z)<footprint);
    }
  }
  assert.equal(roots,3);blade.dispose();
  const fern=fernGeometry(),f=fern.attributes.position;
  for(let i=0;i<f.count;i++)assert.ok(Math.hypot(f.getX(i),f.getZ(i))+Math.abs(f.getY(i))*.08<FERN_RADIUS);
  fern.dispose();
});

test('plant placement reserves buildings, shoreline and the width of walking routes',()=>{
  const obstacles=[{x:0,z:0,radius:3.65}],routes=[[{x:3.8,z:0},{x:5.5,z:0}]];
  assert.equal(vegetationFits(3.7,0,.12,obstacles,[]),false);
  assert.equal(vegetationFits(4.5,.2,.12,obstacles,routes),false);
  assert.equal(vegetationFits(4.5,.45,.12,obstacles,routes),true);
  assert.equal(vegetationFits(4.5,.45,.4,obstacles,routes),false);
  assert.equal(vegetationFits(6,0,.4,[],[]),false);
  assert.equal(vegetationFits(4.5,0,.12,[],[[{x:4.5,z:0},{x:4.5,z:0}]]),false);
});
