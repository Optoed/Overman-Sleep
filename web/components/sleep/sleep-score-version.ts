/** Archive-wide score policy. Missing legacy metadata means the original, unchanged v1. */
export const DIARY_SCORE_VERSION='diary-v1' as const;
export const RECORD_SCORE_VERSION='per-night-v2' as const;
export const HEALTH_SCORE_VERSION='health-snapshots-v3' as const;
export const HEALTH_ORIGIN_VERSION='health-sources-v4' as const;
export const HEALTH_INTERVAL_VERSION='health-intervals-v5' as const;
export type DiaryScoreVersion=typeof DIARY_SCORE_VERSION|typeof RECORD_SCORE_VERSION|typeof HEALTH_SCORE_VERSION|typeof HEALTH_ORIGIN_VERSION|typeof HEALTH_INTERVAL_VERSION;
export function archiveScoreVersion(state:{scoreVersion?:DiaryScoreVersion;nights:{scoreModel?:string;healthScore?:unknown;healthOrigin?:unknown;healthInterval?:unknown}[]}):DiaryScoreVersion{resolveDiaryScoreVersion(state.scoreVersion);if(state.scoreVersion===HEALTH_INTERVAL_VERSION||state.nights.some(n=>n.healthInterval!==undefined))return HEALTH_INTERVAL_VERSION;if(state.scoreVersion===HEALTH_ORIGIN_VERSION||state.nights.some(n=>n.healthOrigin!==undefined))return HEALTH_ORIGIN_VERSION;if(state.scoreVersion===HEALTH_SCORE_VERSION||state.nights.some(n=>n.healthScore!==undefined))return HEALTH_SCORE_VERSION;return state.nights.some(n=>n.scoreModel!==undefined)?RECORD_SCORE_VERSION:resolveDiaryScoreVersion(state.scoreVersion);}
export class UnsupportedDiaryScoreVersion extends Error {
  constructor(){super('Версия расчёта в этом дневнике пока не поддерживается. Обнови приложение. Исходные записи не изменены; их можно скачать.');}
}
/** Reject unknown policies rather than silently using today's formula on future archives. */
export function resolveDiaryScoreVersion(value:unknown):DiaryScoreVersion {
  if(value===undefined||value===DIARY_SCORE_VERSION)return DIARY_SCORE_VERSION;
  if(value===RECORD_SCORE_VERSION)return RECORD_SCORE_VERSION;
  if(value===HEALTH_SCORE_VERSION)return HEALTH_SCORE_VERSION;
  if(value===HEALTH_ORIGIN_VERSION)return HEALTH_ORIGIN_VERSION;
  if(value===HEALTH_INTERVAL_VERSION)return HEALTH_INTERVAL_VERSION;
  throw new UnsupportedDiaryScoreVersion();
}
