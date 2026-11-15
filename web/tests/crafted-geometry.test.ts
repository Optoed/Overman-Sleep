import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { timberGeometry, fracturedRockGeometry } from '../components/tower/crafted-geometry';

test('bevelled boards retain their physical envelope for stairs, rails and long beams',()=>{
  for(const size of [[1.12,.18,.235],[.055,.72,.055],[.13,4.18,.13],[2.8,.14,.45]]) {
    const g=timberGeometry(size[0],size[1],size[2]);g.scale(...size as [number,number,number]);g.computeBoundingBox();
    const extent=g.boundingBox!.getSize(new Vector3());
    size.forEach((s,i)=>assert.ok(Math.abs(extent.getComponent(i)-s)<1e-5));
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(p.getComponent(i,axis))<=size[axis]/2+1e-6);
    g.dispose();
  }
});

test('fractured rocks are closed, outward-facing volumes within their shore envelope',()=>{
  for(let variant=0;variant<4;variant++) {
    const g=fracturedRockGeometry(variant),p=g.attributes.position,n=g.attributes.normal;
    const edgeCounts=new Map<string,number>();let volume=0;
    const point=(i:number)=>new Vector3(p.getX(i),p.getY(i),p.getZ(i));
    const key=(v:Vector3)=>v.toArray().map(x=>x.toFixed(5)).join(',');
    for(let i=0;i<p.count;i+=3){
      const a=point(i),b=point(i+1),c=point(i+2);
      volume+=a.dot(b.clone().cross(c))/6;
      assert.ok(a.dot(new Vector3(n.getX(i),n.getY(i),n.getZ(i)))>0);
      for(const v of [a,b,c])assert.ok(v.toArray().every(x=>Number.isFinite(x)&&Math.abs(x)<.87));
      for(const [u,v] of [[a,b],[b,c],[c,a]]){const e=[key(u),key(v)].sort().join('|');edgeCounts.set(e,(edgeCounts.get(e)??0)+1);}
    }
    assert.ok(volume>1&&volume<6);
    assert.ok([...edgeCounts.values()].every(count=>count===2));g.dispose();
  }
});
