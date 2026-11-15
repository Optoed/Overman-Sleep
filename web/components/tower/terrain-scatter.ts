import * as THREE from 'three';

/** Barycentric placement lies on the actual triangulated surface, not a grid
 * vertex or a separately sampled height that might float above the mesh. */
export function terrainScatter(geometry:THREE.BufferGeometry,random:()=>number,position:THREE.Vector3,normal:THREE.Vector3){
  const p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index;
  const count=index?index.count:p.count;
  const triangle=Math.min(Math.floor(random()*Math.floor(count/3)),Math.floor(count/3)-1)*3;
  const root=Math.sqrt(random()),a=1-root,b=root*(1-random()),c=1-a-b;
  const ids=[0,1,2].map(i=>index?index.getX(triangle+i):triangle+i),weights=[a,b,c];
  position.set(0,0,0);normal.set(0,0,0);
  for(let i=0;i<3;i++){
    const j=ids[i],w=weights[i];
    position.x+=p.getX(j)*w;position.y+=p.getY(j)*w;position.z+=p.getZ(j)*w;
    normal.x+=n.getX(j)*w;normal.y+=n.getY(j)*w;normal.z+=n.getZ(j)*w;
  }
  normal.normalize();return position;
}
