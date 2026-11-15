import * as THREE from 'three';

/** Keep the architectural hierarchy as transform anchors, but render glass in
 * two batches instead of one draw for every opening in both camera views. */
export function createWindowLighting(scene:THREE.Scene,geometry:THREE.BufferGeometry,lit:THREE.Material,dark:THREE.Material){
  const createBatches=(capacity:number)=>[lit,dark].map(material=>{
    const batch=new THREE.InstancedMesh(geometry,material,capacity);
    batch.count=0;batch.frustumCulled=false;batch.receiveShadow=true;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(batch);return batch;
  });
  let batches=createBatches(256);
  return {
    update(windows:readonly THREE.Mesh[],strength:number){
      if(windows.length>batches[0].instanceMatrix.count){
        batches.forEach(b=>{b.removeFromParent();b.dispose();});
        batches=createBatches(2**Math.ceil(Math.log2(windows.length)));
      }
      batches.forEach(b=>{b.count=0;});
      windows.forEach((window,i)=>{
        window.visible=false;
        window.updateWorldMatrix(true,false);
        const batch=batches[!window.userData.unlit&&(i%10)/10<strength/100?0:1];
        if(batch.count>=batch.instanceMatrix.count)throw new Error('Window batch capacity exceeded');
        batch.setMatrixAt(batch.count++,window.matrixWorld);
      });
      batches.forEach(b=>{b.instanceMatrix.needsUpdate=true;});
    },
    clear(){batches.forEach(b=>{b.count=0;});},
    dispose(){batches.forEach(b=>{b.removeFromParent();b.dispose();});},
  };
}
