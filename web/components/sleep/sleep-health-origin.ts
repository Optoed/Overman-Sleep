/** Source assertions supplied by Health Connect, never a sensor/accuracy certificate. */
export type HealthRecordingMethod='unknown'|'active'|'automatic'|'manual';
export type HealthOrigin={version:'health-connect-origin-v1';packageName:string|null;recordingMethod:HealthRecordingMethod};
export function validHealthOrigin(value:unknown):value is HealthOrigin{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='packageName,recordingMethod,version'&&v.version==='health-connect-origin-v1'&&
  (v.packageName===null||typeof v.packageName==='string'&&v.packageName.length<=255&&/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v.packageName))&&
  ['unknown','active','automatic','manual'].includes(v.recordingMethod as string);
}
export function healthOriginLabel(origin?:HealthOrigin){
 if(!origin)return 'Происхождение этой записи не сохранено';
 if(!validHealthOrigin(origin))throw Error('Некорректные данные об источнике сна.');
 return origin.recordingMethod==='manual'?'Ручной ввод во внешнем приложении':
  origin.recordingMethod==='automatic'?'Автоматическая запись · по отметке источника':
  origin.recordingMethod==='active'?'Запись запущена пользователем · по отметке источника':'Способ записи не указан источником';
}
