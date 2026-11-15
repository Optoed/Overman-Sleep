export type Point2={x:number;z:number};
export type Obstacle=Point2&{radius:number};
export function boatApproach(x:number,z:number,arrival:number,mooredHeading:number){
  const remaining=Math.max(0,Math.min(1,arrival)),radius=Math.max(.01,Math.hypot(x,z));
  const turn=Math.min(1,remaining/.22),blend=turn*turn*(3-2*turn),inward=Math.atan2(-x,-z);
  const angle=Math.atan2(Math.sin(inward-mooredHeading),Math.cos(inward-mooredHeading));
  return {x:x*(1+remaining*14/radius),z:z*(1+remaining*14/radius),heading:mooredHeading+angle*blend};
}
export function islandRadius(angle:number){return 5.74*(1+Math.sin(angle*3+.4)*.045+Math.cos(angle*7)*.025);}
export function groundObstacles(floors:number,trees:Obstacle[],motifs:readonly string[]=[]):Obstacle[]{
  const out:Obstacle[]=[{x:0,z:0,radius:3.65},...trees,{x:-1.84,z:3.75,radius:.5},{x:-4.25,z:-.5,radius:.86},{x:1.3,z:4.9,radius:.72}];
  if(floors>=2)out.push({x:-3.9,z:1.8,radius:.9*.8});
  if(floors>=5)out.push({x:2.3,z:-4.1,radius:.9*.72});
  if(floors>=9)out.push({x:-3.6,z:-2.5,radius:.9*.68});
  if(motifs.includes('forge')&&floors>=1)out.push({x:3.6,z:-1.7,radius:.9*.85});
  if(motifs.includes('garden'))for(let i=0;i<5;i++)out.push({x:-2.5+i*.5,z:-3.8,radius:.15*.75});
  return out;
}
export function growthFog(floors:number){return .0028+(1-Math.max(0,Math.min(1,floors/12)))*.006;}
export function groundHeight(x:number,z:number,obstacles:Obstacle[]){
  let relief=1;
  for(const o of obstacles){const t=Math.max(0,Math.min(1,(Math.hypot(x-o.x,z-o.z)-o.radius)/.5));relief=Math.min(relief,t*t*(3-2*t));}
  return 2.91+(Math.sin(x*1.7+z*.61)*.035+Math.sin(z*2.3-x*.43)*.022)*relief;
}
export const SWELLS=[
  {x:.82,z:.57,k:.43,a:.12,s:.87,phase:.2},
  {x:-.67,z:.74,k:.71,a:.085,s:1.13,phase:2.1},
  {x:.24,z:-.97,k:1.19,a:.052,s:1.49,phase:4.7},
  {x:.94,z:-.34,k:1.83,a:.027,s:1.86,phase:1.3},
  {x:-.91,z:-.41,k:2.71,a:.014,s:2.29,phase:3.8},
] as const;
// Travelling wave packets: each crossing swell has a slow amplitude envelope,
// rather than a single uniform sine ridge stretching across the whole lake.
function waterField(x:number,z:number,time:number){
  const warpPhase=x*.067+z*.039+time*.09,warp=Math.sin(warpPhase)*1.25,warpD=Math.cos(warpPhase)*1.25;
  let h=0,dx=0,dz=0;
  for(const w of SWELLS){
    const envelopePhase=(-x*w.z+z*w.x)*.11+time*.13+w.phase;
    const envelope=.76+.24*Math.sin(envelopePhase),ed=.24*Math.cos(envelopePhase);
    const phase=(x*w.x+z*w.z)*w.k+time*w.s+warp*w.s+w.phase;
    const sine=Math.sin(phase),cosine=Math.cos(phase);
    h+=sine*w.a*envelope;
    dx+=w.a*(cosine*envelope*(w.x*w.k+warpD*.067*w.s)-sine*ed*w.z*.11);
    dz+=w.a*(cosine*envelope*(w.z*w.k+warpD*.039*w.s)+sine*ed*w.x*.11);
  }
  const attenuation=1/(1+(x*x+z*z)*.00015);
  return {h:h*attenuation,dx:dx*attenuation-h*attenuation*attenuation*x*.0003,dz:dz*attenuation-h*attenuation*attenuation*z*.0003};
}
export function waterHeight(x:number,z:number,time:number,storm=0){return -.2+waterField(x,z,time).h*(1+storm*.85);}
export function waterSlope(x:number,z:number,time:number,storm=0){const sample=waterField(x,z,time);return {dx:sample.dx*(1+storm*.85),dz:sample.dz*(1+storm*.85)};}
// One analytic sample returns height AND slope. The fragment shader no longer
// evaluates four displaced neighbours, and boats use the same derivatives.
export const waterFieldGLSL=`
vec3 waterField(vec2 p,float footprint){
  float warpPhase=dot(p,vec2(.067,.039))+uTime*.09;
  float warp=sin(warpPhase)*1.25,warpD=cos(warpPhase)*1.25;
  vec3 field=vec3(0.);
  ${SWELLS.map(w=>`{
    vec2 direction=vec2(${w.x.toFixed(3)},${w.z.toFixed(3)}),crossing=vec2(-direction.y,direction.x)*.11;
    float ep=dot(p,crossing)+uTime*.13+${w.phase.toFixed(3)};
    float envelope=.76+.24*sin(ep),ed=.24*cos(ep);
    float phase=dot(p,direction)*${w.k.toFixed(3)}+uTime*${w.s.toFixed(3)}+warp*${w.s.toFixed(3)}+${w.phase.toFixed(3)};
    float band=exp(-footprint*footprint*${(w.k*w.k*.5).toFixed(6)});
    float sh=sin(phase)*${w.a.toFixed(3)}*band,dh=cos(phase)*${w.a.toFixed(3)}*band;
    field.x+=sh*envelope;
    field.yz+=dh*envelope*(direction*${w.k.toFixed(3)}+warpD*vec2(.067,.039)*${w.s.toFixed(3)})+sh*ed*crossing;
  }`).join('\n')}
  float attenuation=1./(1.+dot(p,p)*.00015);
  return vec3(field.x*attenuation,field.yz*attenuation-field.x*attenuation*attenuation*p*.0003);
}
vec3 waterField(vec2 p){return waterField(p,0.);}`;
export function isWalkable(p:Point2,obstacles:Obstacle[],margin=.2){return Math.hypot(p.x,p.z)<islandRadius(Math.atan2(p.z,p.x))-.35&&obstacles.every(o=>Math.hypot(p.x-o.x,p.z-o.z)>o.radius+margin);}
export function segmentClear(a:Point2,b:Point2,obstacles:Obstacle[],margin=.2){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.07));for(let i=0;i<=n;i++){const t=i/n;if(!isWalkable({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},obstacles,margin))return false;}return true;}
type WalkGraph={points:Point2[];edges:number[][];component:number[]};
const graphs=new WeakMap<Obstacle[],WalkGraph>();
function walkGraph(obstacles:Obstacle[]):WalkGraph{
  const cached=graphs.get(obstacles);if(cached)return cached;
  const step=.24,n=45,points:Point2[]=[],lookup=new Map<string,number>();
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const p={x:(x-22)*step,z:(z-22)*step};if(isWalkable(p,obstacles,.25)){lookup.set(`${x},${z}`,points.length);points.push(p);}}
  const edges=points.map(p=>{const x=Math.round(p.x/step)+22,z=Math.round(p.z/step)+22,out:number[]=[];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const j=lookup.get(`${x+dx},${z+dz}`);if(j!==undefined&&segmentClear(p,points[j],obstacles,.23))out.push(j);}return out;});
  const visited=new Set<number>();let component:number[]=[];
  for(let start=0;start<points.length;start++){if(visited.has(start))continue;const region=[start];visited.add(start);for(let i=0;i<region.length;i++)for(const j of edges[region[i]])if(!visited.has(j)){visited.add(j);region.push(j);}if(region.length>component.length)component=region;}
  const graph={points,edges,component};graphs.set(obstacles,graph);return graph;
}
export function makeWalkRoute(obstacles:Obstacle[],seed:number):Point2[]{
  const {points,edges,component}=walkGraph(obstacles);if(component.length<2)return [];
  // Use the main connected walking area, never an isolated pocket between props and the cliff.
  const start=component[(seed>>>0)%component.length],queue=[start],parents=new Map<number,number>([[start,-1]]);let far=start;
  for(let i=0;i<queue.length;i++){const node=queue[i];far=node;for(const j of edges[node])if(!parents.has(j)){parents.set(j,node);queue.push(j);}}
  const route:Point2[]=[];for(let i=far;i!==-1;i=parents.get(i)!){route.push(points[i]);}route.reverse();
  // Simplify only when the whole connecting segment remains clear.
  const result=[route[0]];let i=0;while(i<route.length-1){let next=i+1;for(let j=i+2;j<route.length;j++){if(!segmentClear(route[i],route[j],obstacles,.23))break;next=j;}result.push(route[next]);i=next;}return result;
}
export function pointOnRoute(route:Point2[],distance:number):Point2&{angle:number}{
  if(route.length<2)return {...(route[0]??{x:0,z:4}),angle:0};
  const lengths=route.slice(1).map((p,i)=>Math.hypot(p.x-route[i].x,p.z-route[i].z)),total=lengths.reduce((a,b)=>a+b,0);
  if(total<1e-8)return {...route[0],angle:0};
  const loop=((distance%(2*total))+2*total)%(2*total),back=loop>total;let d=back?2*total-loop:loop;
  for(let i=0;i<lengths.length;i++){if(lengths[i]<1e-8)continue;if(d<=lengths[i]||i===lengths.length-1){const a=route[i],b=route[i+1],t=d/lengths[i];return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:Math.atan2(b.x-a.x,b.z-a.z)+(back?Math.PI:0)};}d-=lengths[i];}return {...route[0],angle:0};
}
