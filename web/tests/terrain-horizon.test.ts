import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizonField, sampleHorizon } from '../components/tower/terrain-horizon';

test('open ground and exposed summits have an unobstructed sky',()=>{
  const flat=buildHorizonField(()=>3,12,30);
  assert.ok(flat.values.every(h=>h===0));
  const peak=buildHorizonField((x,z)=>15*Math.exp(-(x*x+z*z)/45),20,30);
  assert.ok(sampleHorizon(peak,0,0).every(h=>h===0));
});

test('a ridge occludes low sunlight from its own direction, and enclosing slopes reduce sky visibility',()=>{
  const ridge=buildHorizonField((x)=>12*Math.exp(-((x-10)**2)/12),40,30);
  const horizons=sampleHorizon(ridge,0,0);
  assert.ok(horizons[0]>.9);assert.ok(horizons[4]<.001);
  assert.ok(horizons[0]>Math.tan(10*Math.PI/180));
  assert.ok(horizons[0]<Math.tan(65*Math.PI/180));
  const bowl=buildHorizonField((x,z)=>Math.min(18,Math.hypot(x,z)*.8),20,30);
  assert.ok(sampleHorizon(bowl,0,0).every(h=>h>.7&&h<.81));
});

test('horizon sampling stays inside the terrain and is continuous between cells',()=>{
  const field=buildHorizonField((x,z)=>{
    assert.ok(Math.abs(x)<=30&&Math.abs(z)<=30);
    return 8*Math.sin(x*.12)*Math.cos(z*.09);
  },20,30);
  assert.ok(field.values.every(h=>Number.isFinite(h)&&h>=0&&h<=8));
  for(let x=-30;x<=30;x+=3){
    const a=sampleHorizon(field,x-.00001,2),b=sampleHorizon(field,x+.00001,2);
    a.forEach((h,i)=>assert.ok(Math.abs(h-b[i])<.0001));
  }
});
