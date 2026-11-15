import type {SleepState} from './sleep-state';
/** Opt-in rule. The earned ledger is never mutated by this projection. */
export const TOWER_CONDITION_VERSION='condition-v1' as const;
export type TowerConditionPolicy={version:typeof TOWER_CONDITION_VERSION;activatedDate:string};
type Outcome={date:string;success:boolean};
const calendarDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validTowerConditionPolicy(value:unknown):value is TowerConditionPolicy{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const p=value as TowerConditionPolicy;
 return Object.keys(p).length===2&&p.version===TOWER_CONDITION_VERSION&&typeof p.activatedDate==='string'&&calendarDate(p.activatedDate);
}
/** Start on the next wake date so an existing night is never penalized on activation. */
export function withTowerCondition(state:SleepState,enabled:boolean,today:string):SleepState{
 if(!calendarDate(today))throw Error('Invalid tower activation date');
 if(!enabled){const next={...state};delete next.towerCondition;return next;}
 if(state.towerCondition)return state;
 const activatedDate=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);
 return {...state,towerCondition:{version:TOWER_CONDITION_VERSION,activatedDate}};
}
export function towerCondition(outcomes:readonly Outcome[],earnedFloors:number,activatedDate:string,asOf:string){
 if(!Number.isInteger(earnedFloors)||earnedFloors<0||earnedFloors>100||!calendarDate(activatedDate)||!calendarDate(asOf)||asOf<activatedDate)throw Error('Invalid tower condition context');
 if(outcomes.length>2000||outcomes.some(n=>!calendarDate(n.date)||typeof n.success!=='boolean')||new Set(outcomes.map(n=>n.date)).size!==outcomes.length)throw Error('Invalid tower condition history');
 const rows=outcomes.filter(n=>n.date>=activatedDate&&n.date<=asOf).slice().sort((a,b)=>a.date.localeCompare(b.date));
 let integrity=100,freezes=1,freezesUsed=0,failureRun=0,successRun=0,previous='',repairing=false;
 for(const row of rows){
  if(previous&&Date.parse(row.date)-Date.parse(previous)!==86400000){failureRun=0;successRun=0;}
  previous=row.date;
  if(row.success){failureRun=0;successRun++;repairing=integrity<100;integrity=Math.min(100,integrity+25);if(successRun%7===0)freezes=Math.min(2,freezes+1);}
  else{successRun=0;repairing=false;if(freezes>0){freezes--;freezesUsed++;failureRun=0;}else{failureRun++;if(failureRun>=3)integrity=Math.min(integrity,Math.max(0,(7-failureRun)*20));}}
 }
 const visibleFloors=earnedFloors===0||integrity===0?0:Math.max(1,Math.ceil(earnedFloors*integrity/100));
 return {version:TOWER_CONDITION_VERSION,earnedFloors,visibleFloors,integrity,freezes,freezesUsed,failureRun,successRun,
  status:integrity===100?'intact' as const:integrity===0?'collapsed' as const:repairing?'repairing' as const:'damaged' as const};
}
