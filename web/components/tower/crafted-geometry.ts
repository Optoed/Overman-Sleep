import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

/** Unit bounds allow the usual instance transform; the bevel is measured before
 * normalization so a long board does not acquire enormous rounded ends. */
export function timberGeometry(width:number,height:number,depth:number) {
  const radius=Math.min(.025,Math.min(width,height,depth)*.1);
  const size=[width,height,depth],points:THREE.Vector3[]=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])for(let face=0;face<3;face++) {
    const signs=[x,y,z];
    points.push(new THREE.Vector3(...size.map((s,axis)=>signs[axis]*(s/2-(axis===face?0:radius))) as [number,number,number]));
  }
  // 44 triangles instead of a subdivided cube's 108: broad face, bevel strip,
  // and one corner triangle. Normals interpolate across each bevel.
  const geometry=new ConvexGeometry(points),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++) {
    let face=0;
    for(let axis=1;axis<3;axis++)if(Math.abs(Math.abs(p.getComponent(i,axis))-size[axis]/2)<Math.abs(Math.abs(p.getComponent(i,face))-size[face]/2))face=axis;
    n.setXYZ(i,face===0?Math.sign(p.getX(i)):0,face===1?Math.sign(p.getY(i)):0,face===2?Math.sign(p.getZ(i)):0);
  }
  geometry.scale(1/width,1/height,1/depth);
  return geometry;
}

/** Intersect a block with oblique fracture planes, keeping broad rock faces
 * instead of distorting a sphere into another rounded lump. */
export function fracturedRockGeometry(variant:number,detail=5) {
  const planes:{normal:THREE.Vector3;distance:number}[]=[];
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    const normal=new THREE.Vector3();normal.setComponent(axis,sign);
    planes.push({normal,distance:.73+.13*Math.sin(variant*1.7+axis*2.3+sign)});
  }
  for(let i=0;i<10;i++) {
    const angle=i*2.39996+variant*.73;
    const normal=new THREE.Vector3(Math.cos(angle),Math.sin(i*1.71+variant)*.85,Math.sin(angle)).normalize();
    planes.push({normal,distance:.79+.12*Math.sin(i*2.18+variant)});
  }
  // Smooth intersection only removes material around the fractured edges.
  // Broad planes survive; the outline stays inside the original rock envelope.
  const rounding=.085,gradient=new THREE.Vector3();
  const field=(point:THREE.Vector3,withNormal=false)=>{
    let distance=-Infinity;
    for(const plane of planes){
      const d=plane.normal.dot(point)-plane.distance;
      if(distance===-Infinity){distance=d;if(withNormal)gradient.copy(plane.normal);continue;}
      const h=THREE.MathUtils.clamp(.5+.5*(d-distance)/rounding,0,1);
      distance=THREE.MathUtils.lerp(distance,d,h)+rounding*h*(1-h);
      if(withNormal)gradient.lerp(plane.normal,h);
    }
    return distance;
  };
  const geometry=new THREE.IcosahedronGeometry(1,detail),position=geometry.attributes.position,normal=geometry.attributes.normal,colors:number[]=[];
  const direction=new THREE.Vector3(),point=new THREE.Vector3();
  for(let i=0;i<position.count;i++) {
    direction.fromBufferAttribute(position,i).normalize();let low=0,high=1.6;
    for(let step=0;step<17;step++){const radius=(low+high)/2;point.copy(direction).multiplyScalar(radius);if(field(point)>0)high=radius;else low=radius;}
    point.copy(direction).multiplyScalar(low);position.setXYZ(i,point.x,point.y,point.z);
    field(point,true);gradient.normalize();normal.setXYZ(i,gradient.x,gradient.y,gradient.z);
    const brightness=.8+point.y*.07;
    colors.push(brightness,brightness*1.025,brightness*.97);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingSphere();
  return geometry;
}
