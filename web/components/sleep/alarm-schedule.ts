import type {DeviceStatus} from './sleep-device';
export function alarmPermissionIssue(device:DeviceStatus){
 if(!device.notifications)return 'Разреши уведомления Overman в Android. Они нужны для экрана и управления сигналом.';
 if(!device.exact)return 'Разреши точные будильники в Android, чтобы сигнал сработал в выбранное время.';
 return null;
}
export function alarmScheduleView(device:DeviceStatus,enabled:boolean,demo=false){
 if(demo)return{state:'demo',title:'Деморежим',detail:'Сигнал не запускается.'};
 if(!device.native)return{state:'web',title:enabled?'Будильник на открытой странице':'Будильник выключен',detail:'Для сигнала при закрытом приложении нужна Android-версия.'};
 if(device.alarmScheduleState==='off')return{state:'off',title:'Будильник выключен',detail:'Ближайшего сигнала нет.'};
 if(alarmPermissionIssue(device)||device.alarmScheduleState==='permission_required')return{state:'permission_required',title:'Будильник требует разрешения',detail:alarmPermissionIssue(device)||'Проверь разрешения будильника в Android.'};
 if(device.alarmScheduleState==='scheduled'&&Number.isFinite(device.nextAlarmAt)&&device.nextAlarmAt!>0&&!device.alarmScheduleError){
  try{const at=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:device.alarmTimeZone}).format(device.nextAlarmAt!);return{state:'scheduled',title:'Ближайший сигнал',detail:at,at:device.nextAlarmAt};}catch{}
 }
 if(device.alarmScheduleState===undefined)return{state:'checking',title:'Проверяем будильник',detail:'Ожидаем состояние Android.'};
 return{state:'not_scheduled',title:'Сигнал не поставлен',detail:device.alarmScheduleError||'Сохрани режим ещё раз и проверь разрешения Android.'};
}

export function reminderScheduleView(device:DeviceStatus,demo=false){
 if(demo)return{state:'demo',title:'Напоминание в деморежиме',detail:'Уведомление не отправляется.'};
 if(!device.native)return{state:'web',title:'Напоминание на открытой странице',detail:'Для уведомления при закрытом приложении нужна Android-версия.'};
 if(device.reminderScheduleState==='off')return{state:'off',title:'Напоминание выключено',detail:'Вечернего уведомления не будет.'};
 if(!device.notifications||device.reminderNotifications===false||device.reminderScheduleState==='permission_required')return{state:'permission_required',title:'Разреши вечерние уведомления',detail:'Проверь уведомления Overman и канал «Вечерние напоминания» в Android.'};
 if(device.reminderScheduleState==='scheduled'&&Number.isFinite(device.nextReminderAt)&&device.nextReminderAt!>0&&Number.isFinite(device.reminderBedtimeAt)&&device.reminderBedtimeAt!>device.nextReminderAt!&&!device.reminderScheduleError){
  try{return{state:'scheduled',title:'Ближайшее напоминание',detail:new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:device.reminderTimeZone}).format(device.nextReminderAt!),at:device.nextReminderAt};}catch{}
 }
 if(device.reminderScheduleState===undefined)return{state:'checking',title:'Проверяем напоминание',detail:'Ожидаем состояние Android.'};
 return{state:'not_scheduled',title:'Напоминание не поставлено',detail:device.reminderScheduleError||'Сохрани режим ещё раз и проверь уведомления Android.'};
}
