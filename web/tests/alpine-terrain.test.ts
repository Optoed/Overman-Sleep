import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlpineGeometry } from '../components/tower/alpine-terrain';

test('terrain detail preserves surveyed relief, submerges every tile edge, and matches across quality levels',()=>{
  const values=new Float32Array(512*512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)values[y*512+x]=2000+1000*Math.exp(-((x-256)**2+(y-256)**2)/18000)+x*.6;
  const low=buildAlpineGeometry(values,2000,40),high=buildAlpineGeometry(values,2000,80);
  for(const g of [low,high]){
    const p=g.attributes.position,n=g.attributes.normal;
    for(let i=0;i<p.count;i++){
      assert.ok(Number.isFinite(p.getY(i)));
      if(Math.abs(p.getX(i))===90||Math.abs(p.getZ(i))===90)assert.equal(p.getY(i),-4);
      assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);
      assert.ok(n.getY(i)>0);
    }
    g.computeBoundingBox();assert.ok(g.boundingBox!.max.y>13&&g.boundingBox!.max.y<16);
  }
  for(let row=0;row<=40;row++)for(let col=0;col<=40;col++){
    const a=row*41+col,b=row*2*81+col*2;
    for(const attribute of ['position','normal'])for(let axis=0;axis<3;axis++)
      assert.ok(Math.abs(low.attributes[attribute].getComponent(a,axis)-high.attributes[attribute].getComponent(b,axis))<1e-6);
    for(const attribute of ['terrainHorizon0','terrainHorizon1'])for(let axis=0;axis<4;axis++)
      assert.ok(Math.abs(low.attributes[attribute].getComponent(a,axis)-high.attributes[attribute].getComponent(b,axis))<1e-6);
  }
  low.dispose();high.dispose();
});
