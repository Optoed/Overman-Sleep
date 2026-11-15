import {floorsOf,MAX_FLOORS,FLOOR_COST,localDate} from '../tower/world-state';
import {GROWTH_RULES,sleepWorld,type SleepState} from './sleep-state';
import {towerCondition} from './sleep-tower-condition';
/** Damage changes the scene, never earned XP, credits, garden or historical scores. */
export function towerPresentation(state:SleepState,now=Date.now()){
 const world=sleepWorld(state,now),policy=state.towerCondition,today=localDate(new Date(now));
 if(!policy)return {world,condition:null};
 const pending=today<policy.activatedDate;
 const condition=towerCondition(pending?[]:state.nights,floorsOf(world),policy.activatedDate,pending?policy.activatedDate:today);
 return {condition,world:condition.integrity===100?world:{...world,
  xp:condition.visibleFloors===0?0:condition.visibleFloors*FLOOR_COST+world.xp%FLOOR_COST,
  strength:18+.72*condition.integrity}};
}
/** View only: the dated reward ledger keeps growing after construction ends. */
export function towerProgress(state:SleepState){
  const floors=floorsOf(sleepWorld(state)),complete=floors>=MAX_FLOORS;
  const nights=complete?GROWTH_RULES.nightsPerFloor:state.credits.length%GROWTH_RULES.nightsPerFloor;
  return {floors,limit:MAX_FLOORS,complete,nights,remaining:complete?0:GROWTH_RULES.nightsPerFloor-nights,total:state.credits.length};
}
