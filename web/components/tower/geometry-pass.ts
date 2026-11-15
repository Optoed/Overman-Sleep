import type { BufferGeometry,Mesh } from 'three';

/** A synchronous secondary view can use cheaper meshes without mutating the
 * main scene permanently. Nested draws inherit the active geometry override. */
export function geometryPass(){
  const entries:{mesh:Mesh;secondary:BufferGeometry;original:BufferGeometry|null}[]=[];
  let active=false;
  return {
    add(mesh:Mesh,secondary:BufferGeometry){entries.push({mesh,secondary,original:null});},
    run(draw:()=>void){
      if(active){draw();return;}
      active=true;
      try{
        for(const entry of entries){entry.original=entry.mesh.geometry;entry.mesh.geometry=entry.secondary;}
        draw();
      }finally{
        for(const entry of entries)if(entry.original){entry.mesh.geometry=entry.original;entry.original=null;}
        active=false;
      }
    },
  };
}
