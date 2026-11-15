import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh,BufferGeometry } from 'three';
import { geometryPass } from '../components/tower/geometry-pass';

test('secondary geometry is confined to its render pass, including nesting and failure',()=>{
  const main=new BufferGeometry(),low=new BufferGeometry(),replacement=new BufferGeometry(),mesh=new Mesh(main),pass=geometryPass();
  pass.add(mesh,low);
  pass.run(()=>{assert.equal(mesh.geometry,low);pass.run(()=>assert.equal(mesh.geometry,low));assert.equal(mesh.geometry,low);});
  assert.equal(mesh.geometry,main);
  assert.throws(()=>pass.run(()=>{assert.equal(mesh.geometry,low);throw new Error('render failed');}),/render failed/);
  assert.equal(mesh.geometry,main);
  mesh.geometry=replacement;pass.run(()=>assert.equal(mesh.geometry,low));assert.equal(mesh.geometry,replacement);
  main.dispose();low.dispose();replacement.dispose();
});
