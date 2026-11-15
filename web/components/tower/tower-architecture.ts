export function floorHeight(index:number){return index<6?2.05:1.55;}
export function towerHeight(floors:number){const n=Math.max(0,floors);return Math.min(n,6)*2.05+Math.max(0,n-6)*1.55;}
// Preserve the original lower floors, then taper gently toward a usable upper shaft.
export function floorRadius(index:number){return index<=24?2.48-index*.028:1.3+.508*Math.exp(-(index-24)*.025);}
export function towerWallRadius(floors:number,localHeight:number){
  const y=Math.max(0,localHeight-.35),index=y<towerHeight(6)?Math.floor(y/2.05):6+Math.floor((y-towerHeight(6))/1.55);
  const floor=Math.max(0,Math.min(floors-1,index)),fraction=Math.max(0,Math.min(1,(y-towerHeight(floor))/(floorHeight(floor)-.05)));
  return floorRadius(floor)+(floorRadius(floor+1)-floorRadius(floor))*fraction;
}

/** Side wings grow with the central tower but stop at different heights.
 * Their entire ground footprint fits inside the reserved foundation obstacle. */
export function towerWings(floors:number) {
  if(floors<6)return [];
  return [
    {x:-2.38,z:0,levels:Math.min(10,floors-2),angle:-Math.PI/2},
    {x:2.38,z:0,levels:Math.min(6,floors-4),angle:Math.PI/2},
  ];
}
