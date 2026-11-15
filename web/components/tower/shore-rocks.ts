import * as THREE from 'three';
import { seeded } from './world-state';
import { cliffRadius,coastRadius,harbourClearance } from './island-shape';

export type ShoreRock={geometry:number;matrix:THREE.Matrix4};
/** Outcrops and spalls share the collision/foam coast. The full transformed
 * geometry, not merely its centre, must fit inside that reserved envelope. */
export function shoreRocks(seed:number,geometries:THREE.BufferGeometry[]):ShoreRock[]{
  const random=seeded(seed+6321),rocks:ShoreRock[]=[],p=new THREE.Vector3(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion(),matrix=new THREE.Matrix4();
  for(let group=0;group<6;group++){
    const centre=group*Math.PI/3+(random()-.5)*.32;
    for(let j=0;j<14;j++){
      const chip=j>=4,variant=(group+j)%4+(chip?4:0),geometry=geometries[variant];
      const angle=centre+(random()-.5)*(chip?.52:.32),height=chip?-.01+random()*.21:j===0?.7:j===1?1.3:.2+random()*.55;
      if(harbourClearance(angle)>.18)continue;
      if(chip){const s=.12+random()*.2;scale.set(s*.8,s*.48,s*(1+random()*.6));}
      else scale.set(.55+random()*.3,j===1?.45:.5+random()*.55,.7+random()*.65);
      rotation.setFromEuler(new THREE.Euler((random()-.5)*.18,-angle,(random()-.5)*.16));
      const start=chip?coastRadius(angle)-.18:cliffRadius(angle,height)-.12;
      let fitted=false,exposed=false;
      for(let inset=0;inset<=.7;inset+=.05){
        position.set(Math.cos(angle)*(start-inset),height,Math.sin(angle)*(start-inset));matrix.compose(position,rotation,scale);
        let safe=true;exposed=false;
        const vertices=geometry.attributes.position;
        for(let v=0;v<vertices.count;v++){
          p.fromBufferAttribute(vertices,v).applyMatrix4(matrix);const a=Math.atan2(p.z,p.x),r=Math.hypot(p.x,p.z);
          if(r>coastRadius(a)-.09||harbourClearance(a)>.35||p.y>2.65){safe=false;break;}
          if(p.y>-.25&&r>cliffRadius(a,p.y)+.025)exposed=true;
        }
        if(safe){fitted=true;break;}
      }
      if(fitted&&exposed)rocks.push({geometry:variant,matrix:matrix.clone()});
    }
  }
  return rocks;
}
