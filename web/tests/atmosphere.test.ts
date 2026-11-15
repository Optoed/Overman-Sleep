import test from 'node:test';
import assert from 'node:assert/strict';
import { mountainFog } from '../components/tower/atmosphere';
import { growthFog } from '../components/tower/world-physics';

test('valleys retain mist while summits and mature worlds preserve more contrast',()=>{
  const density=growthFog(0);
  assert.ok(mountainFog(200,8,2,density)>mountainFog(200,8,45,density));
  assert.ok(mountainFog(200,8,45,density)<.65);
  assert.ok(mountainFog(200,8,2,density)>.7);
  for(const height of [0,10,25,50]){
    let previous=1;
    for(let floors=0;floors<=24;floors++){
      const fog=mountainFog(200,8,height,growthFog(floors));
      assert.ok(fog<=previous);previous=fog;
    }
  }
});
test('height fog is continuous on level sight lines and stable in reflections',()=>{
  for(const distance of [0,1,50,200,900])for(const h of [1,8,50,150])for(const density of [0,.003,.012]){
    const level=mountainFog(distance,h,h,density);
    assert.ok(Number.isFinite(level)&&level>=0&&level<=1);
    assert.ok(Math.abs(level-mountainFog(distance,h,h+.00001,density))<.00001);
    assert.equal(level,mountainFog(distance,-h,h,density));
  }
});
