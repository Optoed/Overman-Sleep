import * as THREE from 'three';
import { groundHeight,islandRadius,type Obstacle } from './world-physics';
import { cliffRadius,harbourClearance } from './island-shape';
import { terrainNoise } from './terrain-noise';

/** Erosion is confined to the outer 24 cm, outside the reserved walking area. */
export function rimSurfaceHeight(x:number,z:number,obstacles:Obstacle[]=[]){
  const a=Math.atan2(z,x),edge=islandRadius(a)-Math.hypot(x,z);
  const t=THREE.MathUtils.clamp(1-edge/.24,0,1);
  const erosion=.07+terrainNoise(Math.cos(a)*7.3,Math.sin(a)*7.3)*.18;
  return groundHeight(x,z,obstacles)-t*t*(3-2*t)*erosion*(1-harbourClearance(a));
}

export function cliffCrownHeight(a:number){
  const r=islandRadius(a);
  return Math.min(2.78,rimSurfaceHeight(Math.cos(a)*r,Math.sin(a)*r)-.1);
}

export function soilRimGeometry(segments=192){
  const g=new THREE.BufferGeometry(),p:number[]=[],uv:number[]=[],indices:number[]=[],colors:number[]=[];
  for(let row=0;row<=6;row++)for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI*2,t=row/6;
    p.push(0,0,0);uv.push(a,t);
    const grassEnd=.2+terrainNoise(Math.cos(a)*3,Math.sin(a)*3)*.2;
    const c=new THREE.Color('#8bc979').lerp(new THREE.Color('#9d805b'),THREE.MathUtils.smoothstep(t,grassEnd,grassEnd+.3));
    c.lerp(new THREE.Color('#d6b68e'),THREE.MathUtils.smoothstep(t,.66,1));
    colors.push(c.r,c.g,c.b);
    if(row<6&&i<segments){const n=row*(segments+1)+i;indices.push(n,n+1,n+segments+1,n+1,n+segments+2,n+segments+1);}
  }
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('rimCoordinate',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);
  updateSoilRim(g,[]);return g;
}

export function updateSoilRim(g:THREE.BufferGeometry,obstacles:Obstacle[]){
  const p=g.attributes.position,uv=g.attributes.rimCoordinate;
  for(let i=0;i<p.count;i++){
    const a=uv.getX(i),t=uv.getY(i),radius=islandRadius(a),x=Math.cos(a)*radius,z=Math.sin(a)*radius;
    const top=rimSurfaceHeight(x,z,obstacles),bottom=2.03+terrainNoise(Math.cos(a)*5.1,Math.sin(a)*5.1)*.49;
    const y=THREE.MathUtils.lerp(top,bottom,t);
    const blend=THREE.MathUtils.smoothstep(t,0,.7),r=THREE.MathUtils.lerp(radius,cliffRadius(a,y)+.018,blend);
    p.setXYZ(i,Math.cos(a)*r,y,Math.sin(a)*r);
  }
  p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
}

/** Exposed roots descend from real trees; upper sections remain buried. */
export function cliffRootGeometry(trees:Obstacle[]){
  const vertices:number[]=[],indices:number[]=[],colors:number[]=[];
  for(const tree of trees){
    const a=Math.atan2(tree.z,tree.x),r=Math.hypot(tree.x,tree.z),edge=islandRadius(a);
    if(edge-r>1.2||harbourClearance(a)>.06)continue;
    for(let branch=0;branch<2;branch++){
      const endAngle=a+(branch?-.045:.025),points=[new THREE.Vector3(tree.x,groundHeight(tree.x,tree.z,[])-.12,tree.z)];
      points.push(new THREE.Vector3(Math.cos(a)*(edge-.12),rimSurfaceHeight(Math.cos(a)*(edge-.12),Math.sin(a)*(edge-.12))-.13,Math.sin(a)*(edge-.12)));
      for(let j=0;j<4;j++){
        const angle=THREE.MathUtils.lerp(a,endAngle,(j+1)/4),y=2.5-j*(branch?.13:.22);
        const radius=cliffRadius(angle,y)+.028;
        points.push(new THREE.Vector3(Math.cos(angle)*radius,y,Math.sin(angle)*radius));
      }
      const tube=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),18,.045,5,false),p=tube.attributes.position,uv=tube.attributes.uv;
      const centreline=tube.parameters.path,offset=vertices.length/3;
      for(let i=0;i<p.count;i++){
        const t=uv.getX(i),centre=centreline.getPointAt(t),v=new THREE.Vector3().fromBufferAttribute(p,i).sub(centre).multiplyScalar((branch?.68:1)*(1-t*.87)).add(centre);
        // Keep every root vertex below the ground wherever a resident could stand.
        const angle=Math.atan2(v.z,v.x),inside=Math.hypot(v.x,v.z)<islandRadius(angle);
        if(inside)v.y=Math.min(v.y,rimSurfaceHeight(v.x,v.z)-.1);
        vertices.push(v.x,v.y,v.z);const c=new THREE.Color('#857458').multiplyScalar(.8+terrainNoise(v.x*18,v.z*18)*.3);colors.push(c.r,c.g,c.b);
      }
      for(const index of tube.index!.array)indices.push(offset+index);tube.dispose();
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
}
