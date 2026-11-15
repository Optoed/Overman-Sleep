import {importHealthNight} from '../components/sleep/sleep-health-import';
/** Historical SQL fixtures predate source intervals. Never used by product storage/sync. */
export function importBeforeInterval(...args:Parameters<typeof importHealthNight>){
 const state=importHealthNight(...args);for(const night of state.nights)delete night.healthInterval;
 state.scoreVersion=state.nights.some(n=>n.healthOrigin)?'health-sources-v4':'health-snapshots-v3';return state;
}
