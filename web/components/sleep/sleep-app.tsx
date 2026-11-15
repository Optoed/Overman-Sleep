'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Moon, Sun, AlarmClock, ChevronRight, ChevronLeft, Settings2, BarChart3, BookOpen, Layers3, UserRound, ArrowUp, ArrowDown, Expand, RotateCcw, Plus, Minus, Download, Upload, Leaf, Check, X, Sparkles, Volume2, Info, Bell, Play, Square, ShieldCheck, Wind } from 'lucide-react';
import LivingScene from '../tower/living-scene';
import {towerProgress,towerPresentation} from './sleep-growth';
import {withTowerCondition} from './sleep-tower-condition';
import {TowerConditionSettings,TowerConditionStatus} from './tower-condition-panel';
import type { WorldRenderer } from '../tower/world-renderer';
import { floorsOf, localDate, parseWorld, STORAGE_KEY, WEATHER } from '../tower/world-state';
import { GROWTH_RULES, REWARD_RULES, defaultAlarm, rewardRuleFor, nightChecks, sessionId, beginNight, captureWake, nightPhase, demoSleep, freshSleep, clockMinutes, localInput, parseSleep, recordNight, editNight, deleteNight, discardDuplicateMorning, sleepWorld, streaks, validSchedule, SLEEP_KEY, type SleepState, type Schedule, type Night } from './sleep-state';
import { resolveDiaryScoreVersion, type DiaryScoreVersion } from './sleep-score-version';
import HealthScoreCard from './health-score-card';
import { backupText, clockLabel, dateRange, debt, inBed, minuteLabel, minutesLabel, morningDefaults, nextClock, nightScore, readBackup, reminderTime, scoreColor, shiftDate, summarize } from './sleep-insights';
import { deviceStatus, isAndroid, nativeCall, playTone, primeAudio, stopTone, stopPreview, syncDevice, type DeviceStatus } from './sleep-device';
import { Analytics, Metric, Score } from './sleep-charts';
import { analyticsPeriod, shiftAnalyticsPeriod, periodDateLabel, periodRangeLabel } from './sleep-period';
import styles from './sleep-app.module.css';
import HoldToWake from './hold-to-wake';
import ThemePicker from './theme-picker';
import TimePicker from './time-picker';
import HealthConnectPanel from './health-connect-panel';
import MeditationPanel from './meditation-panel';
import HelpHint from './help-hint';
import {importHealthNight} from './sleep-health-import';
import type {HealthSleepSession} from './sleep-health-session';
import SleepDial from './sleep-dial';
import {resolvedAppearance} from './sleep-appearance-cycle';
import {assessSleep} from './sleep-assessment';
import {appearanceOf,appearanceStyle,withAppearance} from './sleep-themes';
import SleepSyncPanel from './sleep-sync-panel';
import {inspectSleepSyncArchive} from '../../lib/sleep-sync-archive';
import {createSleepImportDevice} from './sleep-import-device';
import { acceptsDeviceStatus, matchingNativeWake, recordedNativeWake } from './native-session';
import { inputAt, dateAt, offsetAt, offsetLabel, parseTimeInput, historyOffsets, timeReview, timeCandidates, historyTimeContext, type TimeOffsets } from './sleep-time';
import { alarmPermissionIssue, alarmScheduleView, reminderScheduleView } from './alarm-schedule';
import { alarmAudioIssue } from './alarm-audio';
import { createActionGate } from './sleep-actions';
import { createSleepStorage, acquireSleepWriter } from './sleep-storage';
import { readSleepProductState, persistSleepProductState, assertSleepLocalRestoreAllowed, restoreSleepProductState } from './sleep-product-storage';
import { readWakeReceipt, writeWakeReceipt, clearWakeReceipt, recoverWake, wakeStorageError, type WakeReceipt } from './sleep-wake-recovery';
import { initialMorningFields, matchingMorningDraft, validMorningDraft, readMorningDrafts, writeMorningDraftPrimary, writeMorningDraftBackup, clearMorningDraft, type MorningFields, type MorningDraft } from './sleep-morning-draft';

import { journalWeekEnd, journalWeekStart, previousJournalDay, nextJournalDay, validCalendarDate, readNotificationTarget, type NotificationTarget } from './sleep-calendar';
import { emptyFormDrafts, formDraftId, putFormDraft, removeFormDrafts, readFormDrafts, writeFormDrafts, type FormDraft, type FormDraftBook } from './sleep-form-draft';
import { morningDuration, type DurationField, type DurationErrors } from './sleep-duration';

type Operation='start'|'wake'|'save-night'|'save-settings'|'cancel'|'restore'|'export'|'retry-wake'|'skip-alarm'|'delete-night'|'discard-duplicate'|'sync';
const operationLabel:Record<Operation,string>={sync:'Обмениваемся записями…',start:'Начинаем ночь…',wake:'Сохраняем подъём…','save-night':'Сохраняем ночь…','save-settings':'Сохраняем режим…',cancel:'Отменяем начало ночи…',restore:'Восстанавливаем записи…',export:'Подготавливаем копию…','retry-wake':'Сохраняем время подъёма…','skip-alarm':'Обновляем ближайший сигнал…','delete-night':'Удаляем запись…','discard-duplicate':'Завершаем повторный сеанс…'};
type Tab='sleep'|'stats'|'tower'|'meditation'|'profile';
type Panel='schedule'|'morning'|'score'|'stages'|'restore'|'demo'|'delete'|'discard'|'appearance'|null;
const dateLabel=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const plural=(n:number)=>n%100>=11&&n%100<=14?'этажей':n%10===1?'этаж':n%10>=2&&n%10<=4?'этажа':'этажей';
const emptyDevice:DeviceStatus={native:false,exact:false,notifications:false,microphone:false};
const moods=['Разбит','Устал','Нормально','Хорошо','Отлично'];

export default function SleepApp(){
  const [actionGate]=useState(createActionGate),[busy,setBusy]=useState<Operation|null>(null);
  const nativeRevision=useRef(-1),pendingStart=useRef<SleepState['active']>(null);
  const ringingRef=useRef(false),wakeHandled=useRef(false),appliedDeviceConfig=useRef<string|null>(null);
  const [state,setState]=useState(()=>freshSleep()),[loaded,setLoaded]=useState(false),[demo,setDemo]=useState(false),[tab,setTab]=useState<Tab>('sleep');
  const [timeEditor,setTimeEditor]=useState<string|null>(null);
  const [panel,setPanel]=useState<Panel>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
  const [schedule,setSchedule]=useState(state.schedule),[alarmDraft,setAlarmDraft]=useState(defaultAlarm),[scheduleTab,setScheduleTab]=useState<'bed'|'alarm'>('bed');
  const [statsTab,setStatsTab]=useState<'journal'|'statistics'>('journal'),[period,setPeriod]=useState<'week'|'month'>('week'),[end,setEnd]=useState(localDate()),[selected,setSelected]=useState(localDate());
  const [notificationTarget,setNotificationTarget]=useState<NotificationTarget|null>(null);
  const [quality,setQuality]=useState<'high'|'low'>('low'),[reduced,setReduced]=useState(false),[device,setDevice]=useState(emptyDevice),[ringing,setRingingState]=useState(false);
  const [draft,setDraft]=useState<MorningFields>({bed:'',wake:'',sleep:'8',latency:'',awake:'',rested:0,note:''}),[editing,setEditing]=useState<string|null>(null);
  const [durationAttempted,setDurationAttempted]=useState(false);
  const [manualMorning,setManualMorning]=useState(false);
  const formDrafts=useRef<FormDraftBook>(emptyFormDrafts()),formMemory=useRef(new Map<string,FormDraft>()),formUnsaved=useRef(new Set<string>()),formDraftReadable=useRef(true);
  const formScope=useRef<{mode:FormDraft['mode'];date:string;base:string|null;defaults:MorningFields;offsets:TimeOffsets}|null>(null),formStale=useRef<FormDraft|null>(null);
  const [staleForm,setStaleForm]=useState<FormDraft|null>(null);
  const editingOriginal=useRef<Night|null>(null);
  const [deleting,setDeleting]=useState<Night|null>(null);
  const [duplicateReview,setDuplicateReview]=useState<{active:NonNullable<SleepState['active']>;existing:Night}|null>(null);
  const draftFields=useRef(draft),draftCandidates=useRef<MorningDraft[]>([]),draftScope=useRef<{id?:string;started:number;wokeAt:number}|null>(null),draftQueue=useRef<Promise<void>>(Promise.resolve()),draftGeneration=useRef(0);
  const [draftOffsets,setDraftOffsetsState]=useState<TimeOffsets>({}),draftOffsetsRef=useRef<TimeOffsets>({});
  const clockAnchor=useRef({wall:Date.now(),mono:performance.now()});
  const [draftSave,setDraftSave]=useState<'saving'|'saved'|'error'|''>(''),[draftError,setDraftError]=useState('');
  const draftReadFailed=useRef(false);
  const [restore,setRestore]=useState<SleepState|null>(null),[restoreAgree,setRestoreAgree]=useState(false);
  const [wakePending,setWakePending]=useState(false),pendingWake=useRef<WakeReceipt|null>(null);
  const current=useRef(state),storage=useRef<Storage|null>(null),key=useRef(SLEEP_KEY),blocked=useRef(false),writerAllowed=useRef(true),rawForExport=useRef<string|null>(null),api=useRef<WorldRenderer|null>(null),file=useRef<HTMLInputElement>(null),restoreRaw=useRef<string|null>(null);
  const linkedImport=useRef<((file:File)=>Promise<void>)|null>(null);
  const errorRef=useRef<HTMLDivElement>(null),dialogErrorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!error||busy!==null)return;const target=panel?dialogErrorRef.current:errorRef.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',behavior:'instant'});},[error,panel,busy]);
  const alarmDue=useRef<number|null>(null),reminderDue=useRef<number|null>(null);
  const alarm={...(state.alarm??defaultAlarm),noise:false,smart:false},alarmKey=JSON.stringify(alarm),presentation=useMemo(()=>towerPresentation(state,now),[state,now]),world=presentation.world,floors=floorsOf(world),growth=towerProgress(state),today=localDate(new Date(now));
  const journalEnd=journalWeekEnd(selected),journalStart=journalWeekStart(selected);
  const scoreVersion=resolveDiaryScoreVersion(state.scoreVersion);
  const selectedAppearance=appearanceOf(state),appearance=resolvedAppearance(state,now,ringing),themeStyle=appearanceStyle(appearance);
  const chooseAppearance=(id:Parameters<typeof withAppearance>[1])=>commit(withAppearance(current.current,id));
  const night=state.nights.find(n=>n.date===selected),week=summarize(state.nights,today,7,scoreVersion),streak=streaks(state.nights,today).current;
  const statsPeriod=analyticsPeriod(period,end,today);

  useEffect(()=>{
    let cancelled=false,releaseWriter:(()=>void)|null=null;
    const params=new URLSearchParams(location.search),isDemo=params.get('demo')==='1';setDemo(isDemo);key.current=isDemo?`${SLEEP_KEY}.demo`:SLEEP_KEY;
    const load=async()=>{let archiveExists=false;
    // React may synchronously dispose a development mount before replaying it.
    // Do not let that disposed mount reserve the only writer for the live page.
    await Promise.resolve();if(cancelled)return;
    try{
      const bridge=window.OvermanAndroid;
      storage.current=isDemo?sessionStorage:createSleepStorage(localStorage,bridge?.readSleepArchive&&bridge.writeSleepArchive?{readSleepArchive:k=>bridge.readSleepArchive!(k),writeSleepArchive:(k,b,r)=>bridge.writeSleepArchive!(k,b,r)}:undefined);
      if(!isDemo&&!isAndroid()){
        try{releaseWriter=await acquireSleepWriter(navigator.locks);if(cancelled){releaseWriter?.();return;}writerAllowed.current=releaseWriter!==null;if(!releaseWriter){blocked.current=true;setError('Дневник открыт в другой вкладке. Здесь можно смотреть и скачивать записи. Для изменений закрой другую вкладку и обнови эту.');}}
        catch(e){writerAllowed.current=false;blocked.current=true;setError(message(e));}
      }
      const rawSleep=storage.current.getItem(key.current);rawForExport.current=rawSleep;const saved=readSleepProductState(rawSleep,key.current);let initial=saved;
      archiveExists=saved!==null;
      const n=Number(params.get('floors'));if(isDemo&&params.has('floors')&&Number.isInteger(n)&&n>=0&&n<=100)initial={...demoSleep(n),revision:saved?.revision??0};
      if(!initial){const raw=isDemo?null:localStorage.getItem(STORAGE_KEY);if(raw!==null)rawForExport.current=raw;const old=parseWorld(raw);if(raw!==null&&!old)throw Error('Прежний остров не удалось прочитать. Его сохранение не изменено.');initial=isDemo?demoSleep():freshSleep(old??undefined);}
      current.current=initial;setState(initial);if(validCalendarDate(params.get('day'))){setSelected(params.get('day')!);setTab('stats');setStatsTab('journal');}else if(isDemo&&initial.nights.length&&validCalendarDate(initial.nights[0].date))setSelected(initial.nights[0].date);
    }catch(e){blocked.current=true;setError(message(e));}
    try{
      const receipt=await readWakeReceipt(key.current);
      if(cancelled)return;
      if(receipt){const next=recoverWake(current.current,receipt,archiveExists);if(next.active?.started===receipt.started&&next.active.wokeAt!==undefined){
        if(!commit(next)){current.current=next;setState(next);setWakePending(true);setError(wakeStorageError(blocked.current?'Основное сохранение недоступно и не изменено.':'Проверь свободное место на устройстве.'));}
        else void clearWakeReceipt(key.current).catch(()=>{});
      }else void clearWakeReceipt(key.current).catch(()=>{});}
    }catch(e){if(!cancelled&&blocked.current)setError(message(e)+' Основное сохранение недоступно и не изменено.');}
    const candidates:MorningDraft[]=[];
    try{candidates.push(...await readMorningDrafts(storage.current,key.current));}
    catch(e){if(!cancelled){draftReadFailed.current=true;setDraftSave('error');setDraftError(`Не удалось прочитать утренний черновик. ${message(e)} Подтверждённый подъём не изменён.`);}}
    if(cancelled)return;
    if(!isDemo&&isAndroid())try{const raw=window.OvermanAndroid?.readMorningDraft?.();if(raw){const d=JSON.parse(raw);if(validMorningDraft(d))candidates.push(d);}}catch{}
    draftCandidates.current=candidates;
    try{formDrafts.current=readFormDrafts(storage.current,key.current);}catch{formDraftReadable.current=false;}
    if(!cancelled)setLoaded(true);};void load();
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);
    let refreshingDevice=false;
    const refreshDevice=(periodic=false)=>{
      // A timed-out start retains its UUID for deliberate retry. Background reads
      // must not turn that unacknowledged command into an implicit UI commit.
      const pendingAction=()=>actionGate.busy||pendingStart.current!==null;
      if(refreshingDevice||periodic&&pendingAction())return;
      refreshingDevice=true;
      void deviceStatus().then(next=>{if(!cancelled&&(!periodic||!pendingAction()))applyDevice(next);})
        .catch(e=>{if(!cancelled&&(!periodic||!pendingAction()))setError(message(e));})
        .finally(()=>{refreshingDevice=false;});
    };
    const resumeDevice=()=>refreshDevice();refreshDevice();addEventListener('overman:resume',resumeDevice);
    const devicePoll=setInterval(()=>{if(!isDemo&&isAndroid()&&document.visibilityState==='visible')refreshDevice(true);},15000);
    const tick=setInterval(()=>setNow(Date.now()),1000),conflict=(e:StorageEvent)=>{if(e.storageArea===(isDemo?sessionStorage:localStorage)&&(e.key===key.current||e.key===null)){blocked.current=true;setError('Записи изменились в другой вкладке. Обнови страницу перед сохранением.');}};
    addEventListener('storage',conflict);return()=>{cancelled=true;releaseWriter?.();clearInterval(devicePoll);clearInterval(tick);removeEventListener('storage',conflict);removeEventListener('overman:resume',resumeDevice);stopTone();};
  },[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(t);},[notice]);
  useEffect(()=>{if(panel)setNotice('');},[panel]);
  useEffect(()=>{
    if(!loaded||demo||blocked.current)return;
    if(isAndroid()){const desired=JSON.stringify({schedule:state.schedule,alarm});if(appliedDeviceConfig.current!==desired)void configureDevice(state.schedule,alarm).catch(e=>setError(message(e)));return;}
    alarmDue.current=alarm.enabled?nextClock(state.schedule.wake):null;
    reminderDue.current=alarm.reminder?reminderTime(state.schedule,alarm.reminderMinutes):null;
    // The web timer is deliberately limited to the visible, running page.
    const timer=setInterval(()=>{const t=Date.now();if(document.visibilityState!=='visible')return;
      if(alarmDue.current&&t>=alarmDue.current){if(t-alarmDue.current<90000){setRinging(true);void playTone(alarm).catch(()=>setError('Браузер заблокировал звук. Нажми «Проверить мелодию» в настройках.'));}alarmDue.current=nextClock(state.schedule.wake,t);}
      if(reminderDue.current&&t>=reminderDue.current){if(t-reminderDue.current<90000)setNotice('Скоро пора ложиться спать.');reminderDue.current=reminderTime(state.schedule,alarm.reminderMinutes,t);}
    },1000);return()=>clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loaded,demo,state.schedule.bed,state.schedule.wake,alarmKey]);

  useEffect(()=>{
    if(!loaded||demo||actionGate.busy)return;
    if(!acceptsDeviceStatus(current.current.active,device,nativeRevision.current))return;
    if(device.native)setRinging(!!device.ringing);
    if(!current.current.active&&device.activeNight?.id&&!device.wokeAt&&!recordedNativeWake(current.current,device)){
      const next={...current.current,configured:true,active:device.activeNight};
      if(!commit(next)){current.current=next;setState(next);setError('Android сохранил начало ночи. Дневник пока недоступен; не начинай другую ночь.');}
      return;
    }
    if(!matchingNativeWake(current.current,device))return;
    if(!device.ringing&&(recordedNativeWake(current.current,device)||(!blocked.current&&!current.current.active&&!device.wakeNight?.id))){void releaseCompletedNative(device).catch(e=>setError(message(e)));return;}
    const active=current.current.active;
    if(!active||active.wokeAt===undefined){
      try{const receipt:WakeReceipt={version:1,...device.wakeNight!,wokeAt:device.wokeAt!,wakeOffset:device.wakeOffset,timeReview:device.clockChanged||device.wakeNight?.timeReview};
        const next=recoverWake(current.current,receipt,!!active);
        const saved=commit(next);
        if(!saved){current.current=next;setState(next);setWakePending(true);setError(wakeStorageError('Android сохранил подъём до выключения сигнала.'));}
        if(saved)void acknowledgeNative(device).catch(e=>setError(message(e)));
        morningAt(device.wokeAt!);
      }catch(e){setError(message(e));}
    }else if(active.wokeAt===device.wokeAt&&!wakePending)void acknowledgeNative(device).catch(e=>setError(message(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loaded,demo,device,busy,wakePending]);
  useEffect(()=>{
    if(!loaded||demo)return;
    const read=()=>setNotificationTarget(readNotificationTarget(window.OvermanAndroid?.readLaunchTarget?.()));
    read();addEventListener('overman:resume',read);return()=>removeEventListener('overman:resume',read);
  },[loaded,demo]);
  useEffect(()=>{
    if(!notificationTarget||!loaded||busy||panel||!device.native)return;
    // Notification navigation never saves/discards a draft or acknowledges a wake.
    // A ringing alarm always remains on its wake screen until a real full hold.
    setTab('sleep');window.scrollTo({top:0,behavior:'instant'});
    if(notificationTarget.target==='morning'&&!device.ringing&&current.current.active?.wokeAt!==undefined)morning();
    window.OvermanAndroid?.clearLaunchTarget?.(notificationTarget.id);setNotificationTarget(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[notificationTarget,loaded,busy,panel,device,state.active]);
  useEffect(()=>{
    if(!loaded)return;
    const url=new URL(location.href);
    if(tab==='stats'&&statsTab==='journal')url.searchParams.set('day',selected);else url.searchParams.delete('day');
    history.replaceState(null,'',url);
  },[loaded,tab,statsTab,selected]);
  function applyDevice(next:DeviceStatus){if(!acceptsDeviceStatus(current.current.active,next,nativeRevision.current))return;if(next.protocolVersion===2)nativeRevision.current=next.revision!;setDevice(next);}
  async function acknowledgeNative(status:DeviceStatus){const event=status.wakeEvent;if(!event||!isAndroid()||demo)return;const result=await nativeCall('ackWake',{sessionId:event.sessionId,eventId:event.id});applyDevice(result);}
  async function releaseCompletedNative(status:DeviceStatus){await acknowledgeNative(status);if(!current.current.active&&status.protocolVersion===2)applyDevice(await nativeCall('stop',{sessionId:status.sessionId}));}
  function setRinging(value:boolean){if(value&&!ringingRef.current)wakeHandled.current=false;ringingRef.current=value;setRingingState(value);}
  async function perform(operation:Operation,action:()=>void|Promise<void>){
    return actionGate.run(async()=>{setBusy(operation);setNotice('');try{await action();}catch(e){setError(message(e));}finally{setBusy(null);}});
  }
  async function configureDevice(target:typeof schedule,settings:typeof alarmDraft){
    const result=await syncDevice(target,settings,current.current.active?sessionId(current.current.active):'');
    appliedDeviceConfig.current=JSON.stringify({schedule:target,alarm:settings});if(result)applyDevice(result);return result;
  }
  function commit(next:SleepState,fromAction=false){if(actionGate.busy&&!fromAction)return false;if(blocked.current||!storage.current)return false;try{const saved=persistSleepProductState(storage.current,key.current,current.current,next);current.current=saved;setState(saved);setError('');if(wakePending&&next.active?.wokeAt!==undefined)setWakePending(false);return true;}catch(e){setError(e instanceof Error&&/Записи изменились|другой вкладке|другом окне/.test(e.message)?'Не удалось сохранить данные. Записи изменились в другом окне. Обнови приложение перед сохранением.':'Не удалось сохранить данные. Проверь свободное место на устройстве и повтори.');return false;}}
  async function retryWake(){return perform('retry-wake',async()=>{if(!current.current.active?.wokeAt)return;if(commit(current.current,true)){setWakePending(false);await clearWakeReceipt(key.current).catch(()=>{});if(isAndroid()&&!demo)await acknowledgeNative(await deviceStatus());setNotice('Время подъёма записано в дневник.');}else setError(wakeStorageError(blocked.current?'Обнови страницу, чтобы повторить чтение сохранения.':'Проверь свободное место на устройстве.'));});}
  function openSchedule(which:'bed'|'alarm'='bed'){if(actionGate.busy)return;setTimeEditor(null);setSchedule(current.current.schedule);setAlarmDraft({...current.current.alarm??defaultAlarm,noise:false,smart:false});setScheduleTab(which);setPanel('schedule');}
  function switchTab(next:Tab){if(actionGate.busy)return;setTab(next);window.scrollTo({top:0,behavior:'instant'});}
  function openDay(date:string){if(actionGate.busy||!validCalendarDate(date))return;window.scrollTo({top:0,behavior:'instant'});setSelected(date);setStatsTab('journal');setTab('stats');}
  async function startNight(){return perform('start',async()=>{
    if(blocked.current||current.current.active)return;
    if(ringingRef.current||device.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды.');
    if(!current.current.configured){openScheduleForAction();return;}
    const audioIssue=alarmAudioIssue(current.current.alarm??defaultAlarm,device);if(audioIssue)throw Error(audioIssue);
    await primeAudio();
    if(current.current.active)return;
    if(ringingRef.current)throw Error('Сначала удерживай «Проснуться» 3 секунды.');
    const next=pendingStart.current?{...current.current,active:pendingStart.current}:beginNight(current.current);pendingStart.current=next.active;
    const status=isAndroid()&&!demo?await deviceStatus():null;
    const native=isAndroid()&&!demo?await nativeCall('start',{active:next.active,previousSessionId:status?.sessionId??''}):null;
    if(!commit(next,true)){if(isAndroid()&&!demo)await nativeCall('stop',{sessionId:sessionId(next.active!)});pendingStart.current=null;}
    else{pendingStart.current=null;wakeHandled.current=false;if(native)applyDevice(native);}
  });}
  function openScheduleForAction(){setTimeEditor(null);setSchedule(current.current.schedule);setAlarmDraft({...current.current.alarm??defaultAlarm,noise:false,smart:false});setScheduleTab('bed');setPanel('schedule');}
  function showDraft(fields:MorningFields){draftFields.current={...fields};setDraft({...fields});}
  function persistMorningFields(fields:MorningFields){
    const active=current.current.active,scope=draftScope.current;
    if(!active||active.wokeAt===undefined||!scope||scope.started!==active.started||scope.wokeAt!==active.wokeAt)return;
    const previous=matchingMorningDraft(draftCandidates.current,active),entry:MorningDraft={version:1,...(active.id?{id:active.id}:{}),started:active.started,wokeAt:active.wokeAt,sequence:(previous?.sequence??-1)+1,timeReview:active.timeReview,offsets:{...draftOffsetsRef.current},fields:{...fields}};
    draftCandidates.current=[entry];if(!writerAllowed.current){setDraftSave('error');setDraftError('Эта вкладка открыта только для просмотра. Ввод сохранён в её памяти. Скопируй заметку перед обновлением или выходом.');return;}const generation=++draftGeneration.current;let primary=false,native=false;
    try{writeMorningDraftPrimary(storage.current,key.current,entry);primary=true;}catch{}
    if(isAndroid()&&!demo)try{native=window.OvermanAndroid?.saveMorningDraft?.(JSON.stringify(entry))===true;}catch{}
    setDraftSave(native?'saved':'saving');setDraftError('');
    const draftKey=key.current;
    const queued=draftQueue.current.catch(()=>{}).then(()=>writeMorningDraftBackup(draftKey,entry));draftQueue.current=queued;
    void queued.then(()=>{if(generation===draftGeneration.current){setDraftSave('saved');setDraftError('');}}).catch(e=>{if(generation===draftGeneration.current){if(primary||native){setDraftSave('saved');setDraftError('');}else{setDraftSave('error');setDraftError(`Черновик не сохранён. ${message(e)} Не закрывай приложение, пока не удастся повторить сохранение.`);}}});
  }
  function persistPrivateFields(fields:MorningFields){
    const scope=formScope.current;if(!scope||formStale.current)return;
    const entry:FormDraft={mode:scope.mode,date:scope.date,base:scope.base,fields:{...fields},offsets:{...draftOffsetsRef.current}};
    formMemory.current.set(formDraftId(entry),entry);formUnsaved.current.add(formDraftId(entry));
    try{if(!formDraftReadable.current||blocked.current||!writerAllowed.current)throw Error();const next=putFormDraft(formDrafts.current,entry);formDrafts.current=next;writeFormDrafts(storage.current,key.current,next);formUnsaved.current.delete(formDraftId(entry));setDraftSave('saved');setDraftError('');}
    catch{setDraftSave('error');setDraftError('Черновик пока сохранён только в открытом приложении. Закрытие формы его не удалит. Не закрывай приложение; скопируй заметку или повтори сохранение.');}
  }
  function persistDraftFields(fields:MorningFields){if(formScope.current)persistPrivateFields(fields);else persistMorningFields(fields);}
  function clearPrivateDraft(date?:string){
    const scope=formScope.current;if(!scope&&!date)return true;
    const matches=(d:FormDraft)=>date?d.date===date:!!scope&&formDraftId(d)===formDraftId(scope);
    for(const [id,d] of formMemory.current)if(matches(d)){formMemory.current.delete(id);formUnsaved.current.delete(id);}
    if(!formDrafts.current.entries.some(matches))return true;
    try{if(!formDraftReadable.current)throw Error();const next=removeFormDrafts(formDrafts.current,matches);writeFormDrafts(storage.current,key.current,next);formDrafts.current=next;return true;}catch{return false;}
  }
  function resolveStaleForm(restore:boolean){
    const saved=formStale.current,scope=formScope.current;if(!saved||!scope)return;
    formStale.current=null;setStaleForm(null);const fields=restore?saved.fields:scope.defaults;setDraftOffsets(restore?saved.offsets:scope.offsets);showDraft(fields);persistPrivateFields(fields);
  }
  function setDraftOffsets(offsets:TimeOffsets,persist=false){draftOffsetsRef.current=offsets;setDraftOffsetsState(offsets);if(persist)persistDraftFields(draftFields.current);}
  function updateDraft(patch:Partial<MorningFields>){const next={...draftFields.current,...patch};showDraft(next);persistDraftFields(next);}
  function morning(n?:Night,date=today){if(actionGate.busy)return;setDurationAttempted(false);setManualMorning(!n);setError('');editingOriginal.current=n?structuredClone(n):null;
    draftScope.current=null;setDraftSave('');setDraftError('');setDraftOffsets(n?historyOffsets(n):{});
    const defaults=morningDefaults(state.schedule,date),end=n?.wake??Math.min(+new Date(defaults.wake),Date.now());
    const fields:MorningFields={bed:n?inputAt(n.bed,historyOffsets(n).bed):defaults.bed,wake:n?inputAt(end,historyOffsets(n).wake):localInput(end),sleep:String(n?n.sleepMinutes/60:Math.min(state.schedule.hours,Math.max(0,(end-+new Date(defaults.bed))/3600000)).toFixed(2)),latency:n?.latencyMinutes===undefined?'':String(n.latencyMinutes),awake:n?.awakeMinutes===undefined?'':String(n.awakeMinutes),rested:n?.rested??0,note:n?.note??''};
    const scope={mode:n?'edit' as const:'manual' as const,date:n?.date??date,base:n?JSON.stringify(n):null,defaults:fields,offsets:n?historyOffsets(n):{}};formScope.current=scope;
    const saved=formMemory.current.get(formDraftId(scope))??formDrafts.current.entries.find(d=>formDraftId(d)===formDraftId(scope));
    const stale=saved&&saved.base!==scope.base?saved:null;formStale.current=stale;setStaleForm(stale);
    if(saved&&!stale){setDraftOffsets(saved.offsets);showDraft(saved.fields);setDraftSave(formDraftReadable.current&&!formUnsaved.current.has(formDraftId(scope))?'saved':'error');if(formUnsaved.current.has(formDraftId(scope)))setDraftError('Черновик пока только в открытом приложении. Не закрывай приложение; повтори сохранение или скопируй заметку.');}else showDraft(fields);
    if(!formDraftReadable.current)setDraftError('Сохранённые личные черновики недоступны и не изменены. Новый ввод останется в открытом приложении; скопируй заметку перед выходом.');
    setEditing(n?.date??null);setPanel('morning');
  }
  async function finishWake(){await perform('wake',async()=>{
    const before=current.current.active;
    if(before?.wokeAt!==undefined&&!ringingRef.current&&!device.ringing){morningAt(before.wokeAt);return;}
    if(!before&&wakeHandled.current)return;
    const expectedStarted=before?.started;
    const beforeNative=isAndroid()&&!demo?await deviceStatus():null;
    const expectedId=before?sessionId(before):beforeNative?.sessionId;
    const native=isAndroid()&&!demo?await nativeCall('wake',{sessionId:expectedId,alarmOccurrence:beforeNative?.alarmOccurrence}):null;
    if(before&&(!current.current.active||sessionId(current.current.active)!==sessionId(before)))throw Error('Эта ночь уже изменилась. Запоздалый ответ не применён.');
    if(native?.protocolVersion===2&&native.sessionId!==expectedId)throw Error('Ответ Android относится к другой ночи.');
    const active:NonNullable<SleepState['active']>=current.current.active??native?.wakeNight??{started:+new Date(morningDefaults(current.current.schedule,today).bed),target:{...current.current.schedule}};
    const clockChanged=!native&&Math.abs((Date.now()-clockAnchor.current.wall)-(performance.now()-clockAnchor.current.mono))>120000;
    let receipt:WakeReceipt={version:1,...(active.id?{id:active.id}:{}),bedOffset:active.bedOffset,wakeOffset:native?.wakeOffset??active.wakeOffset??offsetAt(Date.now()),timeReview:active.timeReview||native?.clockChanged||clockChanged,started:active.started,target:{...active.target},wokeAt:active.wokeAt??native?.wokeAt??(pendingWake.current?.started===active.started?pendingWake.current.wokeAt:Date.now())};
    pendingWake.current=receipt;let journalSaved=false;
    try{receipt=await writeWakeReceipt(key.current,receipt);journalSaved=true;}catch{}
    const next=recoverWake({...current.current,active},receipt,true);
    const saved=commit(next,true);
    if(!saved){
      if(!native&&!journalSaved)throw Error('Не удалось сохранить время подъёма ни в дневник, ни в резервную запись. Сигнал продолжает звучать. Освободи место и повтори удержание.');
      current.current=next;setState(next);setWakePending(true);setError(wakeStorageError(native?'Android сохранил подъём до выключения сигнала.':'Резервная запись доступна после перезапуска.'));
    }else{setWakePending(false);await clearWakeReceipt(key.current).catch(()=>{});}
    stopTone();setRinging(false);if(native){applyDevice(native);if(saved||journalSaved)await acknowledgeNative(native).catch(e=>setError(message(e)));}
    pendingWake.current=null;wakeHandled.current=true;morningAt(receipt.wokeAt);
  });}
  function morningAt(wokeAt:number){
    formScope.current=null;formStale.current=null;setStaleForm(null);editingOriginal.current=null;setManualMorning(false);setDurationAttempted(false);
    const active=current.current.active;if(!active||active.wokeAt!==wokeAt)return;
    draftScope.current={...(active.id?{id:active.id}:{}),started:active.started,wokeAt};const saved=matchingMorningDraft(draftCandidates.current,active),fields=saved?.fields??initialMorningFields(active);
    setDraftOffsets(saved?.offsets??{bed:active.bedOffset,wake:active.wakeOffset});showDraft(fields);if(saved||!draftReadFailed.current)persistMorningFields(fields);setEditing(null);setPanel('morning');
  }
  async function saveNight(e:React.FormEvent){e.preventDefault();if(actionGate.busy||formStale.current)return;
    const duration=morningDuration(draftFields.current,draftOffsetsRef.current,Date.now(),manualMorning?0:60000);setDurationAttempted(true);
    const invalid=Object.keys(duration.errors)[0] as DurationField|undefined;
    if(invalid){requestAnimationFrame(()=>{const field=document.getElementById(`morning-${invalid}`);if(!field)return;for(let details=field.closest('details');details;details=details.parentElement?.closest('details')??null)details.open=true;field.focus({preventScroll:true});field.scrollIntoView({block:'nearest',behavior:'instant'});});return;}
    return perform('save-night',async()=>{
    if(ringingRef.current||device.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды.');
    if(isAndroid()&&!demo){const status=await deviceStatus();if(status.ringing){applyDevice(status);throw Error('Сначала удерживай «Проснуться» 3 секунды.');}}
    if(!draft.rested)throw Error('Выбери самочувствие от 1 до 5.');
    const wake=duration.wake!,bed=duration.bed!;if(editing&&dateAt(wake,draftOffsetsRef.current.wake)!==editing)throw Error('При исправлении сохрани дату пробуждения.');
    if(!editing&&current.current.nights.some(n=>n.date===dateAt(wake,draftOffsetsRef.current.wake)))throw Error('В v1 одна основная ночь на дату пробуждения. Открой существующую запись; дневной сон отдельно пока не поддерживается.');
      const completion=draftScope.current??undefined,finishing=completion!==undefined;
    const original=editingOriginal.current,previousCredits=current.current.credits.length;
      if(editing&&!original)throw Error('Открой запись заново перед исправлением.');
    const input={bed,wake,bedOffset:draftOffsetsRef.current.bed,wakeOffset:draftOffsetsRef.current.wake,sleepMinutes:duration.sleepMinutes!,rested:draft.rested,latencyMinutes:duration.latencyMinutes,awakeMinutes:duration.awakeMinutes,noiseDbfs:original?.noiseDbfs,note:draft.note};
      const next=editing&&original?editNight(current.current,original,input):recordNight(current.current,input,Date.now(),completion);
    if(commit(next,true)){const formCleared=clearPrivateDraft();formScope.current=null;if(finishing){setWakePending(false);draftScope.current=null;++draftGeneration.current;await draftQueue.current.catch(()=>{});await clearMorningDraft(storage.current,key.current).catch(()=>{});if(isAndroid()&&!demo)try{window.OvermanAndroid?.clearMorningDraft?.(completion?.id??`legacy-${completion!.started}`);}catch{}draftCandidates.current=[];setDraftSave('');setDraftError('');await clearWakeReceipt(key.current).catch(()=>{});if(isAndroid()&&!demo)applyDevice(await nativeCall('stop',{sessionId:completion?.id??`legacy-${completion!.started}`}));}setSelected(dateAt(wake,draftOffsetsRef.current.wake));setStatsTab('journal');setTab('stats');setPanel(null);setNotice((next.credits.length>previousCredits?'Ночь сохранена. Прогресс башни обновлён.':'Запись сна сохранена.')+(formCleared?'':' Не удалось удалить прежний локальный черновик; запись уже сохранена.'));}
  });}
  async function confirmDiscardDuplicate(){return perform('discard-duplicate',async()=>{
    if(!duplicateReview)throw Error('Сначала проверь существующую ночь.');
    const {active,existing}=duplicateReview,next=discardDuplicateMorning(current.current,active,existing),id=sessionId(active);
    if(ringingRef.current||device.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды.');
    ++draftGeneration.current;await draftQueue.current.catch(()=>{});
    let stopped:DeviceStatus|null=null;
    if(isAndroid()&&!demo){const status=await deviceStatus();if(status.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды.');if(window.OvermanAndroid?.clearMorningDraft?.(id)===false)throw Error('Не удалось убрать черновик на устройстве. Повтори действие.');stopped=await nativeCall('stop',{sessionId:id});}
    // Native stop is idempotent. If the archive write fails, the durable pending
    // morning stays intact and the same explicit action can be retried safely.
    if(commit(next,true)){draftScope.current=null;draftCandidates.current=[];setWakePending(false);await clearMorningDraft(storage.current,key.current).catch(()=>{});await clearWakeReceipt(key.current).catch(()=>{});setDraftSave('');setDraftError('');if(stopped)applyDevice(stopped);setSelected(existing.date);setStatsTab('journal');setTab('stats');setPanel(null);setDuplicateReview(null);setNotice('Повторный сеанс завершён без записи. Основная ночь сохранена без изменений.');}
  });}
  async function confirmDelete(){return perform('delete-night',async()=>{
    if(!deleting)throw Error('Сначала выбери запись.');
    if(ringingRef.current||device.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды.');
    const next=deleteNight(current.current,deleting);
    if(commit(next,true)){const formCleared=clearPrivateDraft(deleting.date);formScope.current=null;setSelected(deleting.date);setStatsTab('journal');setTab('stats');setPanel(null);setDeleting(null);setEditing(null);editingOriginal.current=null;setNotice('Запись удалена. Статистика обновлена; прогресс башни сохранён.'+(formCleared?'':' Не удалось очистить локальный черновик.'));}
  });}
  async function saveSettings(e:React.FormEvent){e.preventDefault();if(timeEditor!==null)return;return perform('save-settings',async()=>{
    if(ringingRef.current||device.ringing)throw Error('Сначала удерживай «Проснуться» 3 секунды. Параметры можно изменить после выключения сигнала.');
    const target={...schedule},settings={...alarmDraft};
    const audioIssue=alarmAudioIssue(settings,device);if(audioIssue)throw Error(audioIssue);
    if(!validSchedule(target))throw Error('Между временем сна и подъёмом должно хватать времени для твоей цели.');
    const previous=current.current;
    if(isAndroid()&&!demo)await configureDevice(target,settings);
    else if(settings.enabled)await primeAudio();
    if(ringingRef.current)throw Error('Сигнал уже звучит. Удерживай «Проснуться» 3 секунды.');
    if(commit({...current.current,schedule:target,alarm:settings,configured:true},true)){stopPreview();setPanel(null);setNotice('Режим сна сохранён.');}
    else if(isAndroid()&&!demo)await configureDevice(previous.schedule,{...previous.alarm??defaultAlarm,noise:false,smart:false});
  });}
  async function shiftDialSchedule(target:Schedule,base:Schedule){return perform('save-settings',async()=>{
    const previous=current.current;
    if(previous.active||ringingRef.current||device.ringing||panel!==null)throw Error('Заверши текущее действие перед изменением режима.');
    if(JSON.stringify(previous.schedule)!==JSON.stringify(base))throw Error('Режим изменился. Повтори сдвиг дуги.');
    if(!validSchedule(target))throw Error('Проверь режим сна.');
    const settings={...previous.alarm??defaultAlarm,noise:false,smart:false};
    const issue=alarmAudioIssue(settings,device);if(issue)throw Error(issue);
    if(isAndroid()&&!demo)await configureDevice(target,settings);else if(settings.enabled)await primeAudio();
    if(ringingRef.current)throw Error('Сигнал уже звучит. Удерживай «Проснуться» 3 секунды.');
    if(commit({...current.current,schedule:target,configured:true},true))setNotice(`Режим: ${target.bed} → ${target.wake}`);
    else if(isAndroid()&&!demo)await configureDevice(previous.schedule,settings);
  });}
  async function changeAlarmSkip(restore:boolean){return perform('skip-alarm',async()=>{
    if(!device.native||demo)return;
    try{applyDevice(await nativeCall('skipAlarm',{restore,expectedAt:restore?device.skippedAlarmAt:device.nextAlarmAt}));setNotice(restore?'Пропуск отменён. Проверь ближайший сигнал.':'Один сигнал пропущен. Ежедневное повторение сохранено.');}
    catch(e){await deviceStatus().then(applyDevice).catch(()=>{});throw e;}
  });}
  async function cancelNight(){return perform('cancel',async()=>{
    if(ringingRef.current||device.ringing||!current.current.active||current.current.active.wokeAt!==undefined)return;
    try{const cancelled=current.current.active,stopped=isAndroid()&&!demo?await nativeCall('stop',{sessionId:sessionId(cancelled)}):null;if(ringingRef.current)throw Error('Сигнал уже звучит. Удерживай «Проснуться» 3 секунды.');if(commit({...current.current,active:null},true)){if(stopped)applyDevice(stopped);setNotice('Начало ночи отменено. Прогресс сохранён.');}}
    catch(e){void deviceStatus().then(applyDevice).catch(()=>{});throw e;}
  });}
  async function download(){return perform('export',async()=>{let raw:string;if(blocked.current&&isAndroid()&&!demo&&window.OvermanAndroid?.readSleepArchive){try{const archive=JSON.parse(window.OvermanAndroid.readSleepArchive(key.current));if(archive.error||archive.raw!==null){await nativeCall('exportOriginal',{key:key.current});return;}}catch(e){throw Error(message(e));}}if(blocked.current){let original=rawForExport.current;try{original=storage.current?.getItem(key.current)??original;}catch{}if(original===null)throw Error('Исходные данные пока недоступны для чтения. Экспорт пустой копии отменён. Верни доступ к хранилищу и повтори.');raw=original;}else raw=backupText(current.current);if(isAndroid()){await nativeCall('export',{text:raw});return;}const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`overman-sleep-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  function importDevice(){return createSleepImportDevice({native:isAndroid()&&!demo,assertWritable:()=>{if(blocked.current||!storage.current||!writerAllowed.current||current.current.active||ringingRef.current||wakePending||pendingWake.current||panel!==null)throw Error('Сначала заверши текущую ночь или открытое действие.');},status:async()=>{const status=await deviceStatus();applyDevice(status);return status;},stop:async id=>{const status=await nativeCall('stop',{sessionId:id});applyDevice(status);return status;},configure:next=>configureDevice(next.schedule,{...next.alarm??defaultAlarm,enabled:false,reminder:false,noise:false,smart:false})});}
  async function selectBackup(f:File){if(actionGate.busy)return;try{if(!demo&&storage.current&&inspectSleepSyncArchive(storage.current)){if(!linkedImport.current)throw Error('Открой профиль и войди в аккаунт дневника.');await linkedImport.current(f);return;}if(f.size>3500000)throw Error('Файл больше 3,5 МБ.');const s=readBackup(await f.text());if(actionGate.busy)return;restoreRaw.current=storage.current?.getItem(key.current)??null;setRestore(s);setRestoreAgree(false);setPanel('restore');}catch(e){setError(message(e));}}
  async function importBackup(){return perform('restore',async()=>{if(!restore||!storage.current||!restoreAgree)return;
    if(!writerAllowed.current)throw Error('Дневник открыт в другой вкладке. Закрой её и обнови эту перед восстановлением.');
    if(current.current.active||ringingRef.current||device.ringing)throw Error('Сначала заверши текущую ночь: удерживай «Проснуться» 3 секунды и сохрани утреннюю оценку. Затем восстанови копию.');
    if(storage.current.getItem(key.current)!==restoreRaw.current)throw Error('Сохранение изменилось после выбора файла. Выбери файл ещё раз.');
    if(!demo)assertSleepLocalRestoreAllowed(restoreRaw.current);
    if(restoreRaw.current)storage.current.setItem(`${key.current}.before-import`,restoreRaw.current);
    // A restored file must not arm an alarm or resume an old recording silently.
    const next={...restore,revision:current.current.revision+1,active:null,alarm:{...(restore.alarm??defaultAlarm),enabled:false,reminder:false}};
    if(isAndroid()&&!demo){const status=await deviceStatus();if(status.wakeEvent)throw Error('Сначала сохрани подтверждённый подъём на устройстве.');await nativeCall('stop',{sessionId:status.sessionId??''});}if(!demo)await configureDevice(next.schedule,next.alarm);
    if(ringingRef.current)throw Error('Сигнал уже звучит. Удерживай «Проснуться» 3 секунды.');
    parseSleep(JSON.stringify(next));const saved=restoreSleepProductState(storage.current,key.current,restoreRaw.current,next);blocked.current=false;current.current=saved;setState(saved);setError('');setPanel(null);setRestore(null);setSelected(validCalendarDate(next.nights[0]?.date)?next.nights[0].date:today);setNotice('Записи и башня восстановлены. Предыдущая копия сохранена на устройстве.');
  });}
  function shiftPeriod(direction:-1|1){setEnd(shiftAnalyticsPeriod(period,end,today,direction));}
  const titles={appearance:'Оформление',discard:'Закончить без второй записи?',delete:'Удалить запись?',schedule:scheduleTab==='bed'?'Режим сна':'Будильник',morning:editing?'Исправить ночь':manualMorning?'Добавить ночь':'Как прошла ночь?',score:'Из чего складывается оценка',stages:'Что происходит, пока ты спишь',restore:'Восстановить записи',demo:'Заглянуть в будущее'};
  const duration=morningDuration(draft,draftOffsets,Date.now(),manualMorning?0:60000);
  const durationErrors=durationAttempted?duration.errors:{};
  const dateConflict=panel==='morning'&&!editing&&duration.wake!==undefined?state.nights.find(n=>n.date===dateAt(duration.wake!,draftOffsets.wake)):undefined;
  const quickMorning=panel==='morning'&&!!state.active?.wokeAt&&!editing&&!manualMorning;
  const windowMinutes=(clockMinutes(state.schedule.wake)-clockMinutes(state.schedule.bed)+1440)%1440;

  return <main className={styles.app} style={themeStyle} data-appearance={appearance.id} data-theme={appearance.mode} data-night-phase={nightPhase(state)} data-operation={busy??undefined} aria-busy={busy!==null}>
    <div className={styles.shell} inert={busy!==null}>
      <header className={styles.header}><a href="/" className={styles.brand}><span className={styles.brandMark}><Moon size={19}/></span><span>Overman</span></a><button aria-label="Настройки сна" className={styles.iconButton} onClick={()=>openSchedule()}><Settings2 size={20}/></button></header>
      {demo&&<div className={styles.demoBanner}><Sparkles size={14}/><span>Демо · вымышленные ночи</span><a href="/">Мой сон ↗</a></div>}
      {error&&<div ref={errorRef} tabIndex={-1} className={styles.error} role="alert">{error}<div>{wakePending&&<button disabled={busy!==null} onClick={()=>void retryWake()}>Повторить сохранение</button>}<button onClick={()=>void download()}>Скачать данные</button><button onClick={()=>setError('')} aria-label="Скрыть сообщение"><X size={16}/></button></div></div>}
      {!loaded?<div className={styles.loading}>Загрузка…</div>:<>
      {tab==='sleep'&&<>
        {!demo&&alarm.enabled&&<AlarmScreenAccess compact device={device} onRequest={()=>void nativeCall('fullScreenPermission').then(applyDevice).catch(e=>setError(message(e)))}/>}
        {state.active?<section className={styles.nightScreen}>
          <div className={styles.nightOrb}><Moon size={55} strokeWidth={1}/><i/><i/></div><span className={styles.eyebrow}>НОЧНОЙ РЕЖИМ</span><h1>{state.active.wokeAt?'Доброе утро':'Спокойной ночи'}</h1><p>{state.active.wokeAt?(wakePending?'Подъём сохранён отдельно. Запись в дневник пока не завершена.':'Время подъёма сохранено. Осталось оценить сон. Анкета не отключает ежедневный будильник; новую ночь можно начать после её сохранения.'):'Отложи телефон и постарайся больше не отвлекаться.'}</p><span className={styles.nightElapsed}>{timeReview({...state.active,timeReview:state.active.timeReview||(!state.active.wokeAt&&(device.clockChanged||((!isAndroid()||demo)&&Math.abs((Date.now()-clockAnchor.current.wall)-(performance.now()-clockAnchor.current.mono))>120000)))},now)||`В кровати ${minutesLabel(Math.max(0,((state.active.wokeAt??now)-state.active.started)/60000))}`}</span>
          <AlarmSchedule device={device} enabled={alarm.enabled} demo={demo} disabled={busy!==null||!!device.ringing} onSkip={changeAlarmSkip}/>{!demo&&device.native&&alarm.enabled&&device.alarmSystemVolume===0&&<p className={styles.capabilityNote}>Громкость будильника Android выключена.{alarm.vibration&&device.vibrationAvailable!==false?' Работает только вибрация.':' Открой настройки будильника и увеличь громкость.'}</p>}
          {state.active.wokeAt?<button className={styles.primary} onClick={()=>morningAt(state.active!.wokeAt!)}>Оценить сон <ChevronRight size={18}/></button>:<HoldToWake onWake={finishWake} disabled={busy!==null}/>}<p className={styles.fine}>{state.active.wokeAt?'':'Сигнал выключится после удержания кнопки.'}</p>{!state.active.wokeAt&&!ringing&&!device.ringing&&<button className={styles.textButton} onClick={()=>void cancelNight()}>Нажал случайно · отменить</button>}
        </section>:<>
          <div className={styles.pageHeading}><h1>Сон</h1></div>
          <AlarmSchedule device={device} enabled={alarm.enabled} demo={demo} disabled={busy!==null||!!device.ringing} onSkip={changeAlarmSkip}/>{!demo&&device.native&&alarm.enabled&&device.alarmSystemVolume===0&&<p className={styles.capabilityNote}>Громкость будильника Android выключена.{alarm.vibration&&device.vibrationAvailable!==false?' Работает только вибрация.':' Открой настройки будильника и увеличь громкость.'}</p>}
          <div className={styles.trackerLayout}>
          <section className={styles.dialPanel} aria-label="Режим сна"><SleepDial schedule={state.schedule} onEdit={()=>openSchedule()} onShift={shiftDialSchedule} disabled={blocked.current||busy!==null||ringing||!!state.active}/><div className={styles.dialLegend}><span>Цель {minutesLabel(state.schedule.hours*60)}</span></div></section>
          <div className={styles.trackerControls}>
            <section className={styles.timeCard}><button onClick={()=>openSchedule('bed')}><span className={styles.timeIcon}><Moon size={21}/></span><span><small>ЛОЖУСЬ</small><strong>{state.schedule.bed}</strong></span><span className={styles.timeHint}>{alarm.reminder?`Напомнить за ${alarm.reminderMinutes} мин`:'Вечер'}</span><ChevronRight size={17}/></button><div className={styles.timeDivider}/><button onClick={()=>openSchedule('alarm')}><span className={styles.timeIconWarm}><Sun size={21}/></span><span><small>ПРОСЫПАЮСЬ</small><strong>{state.schedule.wake}</strong></span><span className={styles.timeHint}>{alarm.enabled?'Будильник включён':'Без будильника'}</span><ChevronRight size={17}/></button></section>
            <button className={styles.primary} aria-label={state.configured?'Ложусь спать':'Настроить мой режим'} onClick={()=>void startNight()} disabled={blocked.current||busy!==null}><Moon size={21}/>{state.configured?'Ложусь спать':'Настроить мой режим'}</button>
            <button className={styles.textButton} onClick={()=>morning()}><Plus size={15}/> Записать прошедшую ночь</button>
            {!device.native&&alarm.enabled&&<p className={styles.capabilityNote}><Info size={15}/> В браузере будильник работает только при открытой активной странице. Для сна используй также системный будильник телефона.</p>}
            <button className={styles.rewardCard} onClick={()=>switchTab('tower')}><span className={styles.miniTower}><Layers3 size={30}/></span><span><small>ПРОГРЕСС БАШНИ</small><strong>{growth.complete?'100 этажей построено':`${growth.remaining} ночей до нового этажа`}</strong><span className={styles.sevenStones}>{Array.from({length:GROWTH_RULES.nightsPerFloor},(_,i)=><i key={i} data-done={i<growth.nights}/>)}</span></span><ChevronRight size={18}/></button>
            <GrowthRules target={state.schedule} active={false} collapsible/>
          </div></div>
          <div className={styles.sectionHead}><h2>Последние семь ночей</h2><button onClick={()=>switchTab('stats')}>Смотреть всё <ChevronRight size={15}/></button></div>
          <WeekStrip version={scoreVersion} nights={state.nights} end={today} selected={selected} onSelect={openDay}/>
          <div className={styles.metricGrid}><Metric label="Средний сон" value={minutesLabel(week.duration)}/><Metric label="Серия успешных ночей" value={`${streak} ночей подряд`} detail="Один пропуск не стирает прогресс"/></div>
        </>}
      </>}
      {tab==='stats'&&<>
        <div className={styles.pageHeading}><span className={styles.eyebrow}>ЗАПИСИ И ПОКАЗАТЕЛИ</span><h1>История сна</h1></div>
        <div className={styles.segment}><button aria-pressed={statsTab==='journal'} onClick={()=>setStatsTab('journal')}><BookOpen size={16}/>Журнал</button><button aria-pressed={statsTab==='statistics'} onClick={()=>setStatsTab('statistics')}><BarChart3 size={16}/>Статистика</button></div>
        {statsTab==='journal'?<>
          <div className={styles.periodNav}><button aria-label="Предыдущая неделя журнала" disabled={selected==='0001-01-01'} onClick={()=>{setSelected(previousJournalDay(selected));}}><ChevronLeft size={20}/></button><span>{dateLabel(journalStart)} — {dateLabel(journalEnd)}</span><button aria-label="Следующая неделя журнала" disabled={journalEnd>=today} onClick={()=>{setSelected(nextJournalDay(selected,today));}}><ChevronRight size={20}/></button><label className={styles.datePick}>Дата<input type="date" aria-label="Выбрать дату" value={selected} onChange={e=>{if(validCalendarDate(e.target.value)){setSelected(e.target.value);}}}/></label><button className={styles.textButton} onClick={()=>openDay(today)}>Сегодня</button></div>
          <WeekStrip version={scoreVersion} start={journalStart} nights={state.nights} end={journalEnd} selected={selected} onSelect={setSelected}/>
          <div className={styles.sectionHead}><h2 data-journal-date={selected} aria-live="polite">{new Date(selected+'T12:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}</h2>{night&&<button onClick={()=>morning(night)}>Исправить <ArrowUp size={14}/></button>}</div>
          {night?<>
            <div className={styles.nightTimes}><span><Moon size={17}/>{night.bedClock}</span><i/><span><Sun size={17}/>{night.wakeClock}</span><small>Время по записи</small></div>
            <HistoricalTime night={night}/>{night.source&&<p className={styles.fine} data-night-source={night.source}>{night.source==='manual'?'Ручная запись · по твоим оценкам, без датчиков':night.source==='health-connect'?'Источник · Health Connect, запись можно уточнить':'Запись по таймеру · длительность по твоей оценке'}</p>}
            <HealthScoreCard night={night}/>
            {night.healthScore&&<p className={styles.fine}>Дневниковые баллы ниже учитывают исправления и соблюдение режима. Это отдельный показатель.</p>}
            <Score version={scoreVersion} night={night} onInfo={()=>setPanel('score')}/>
            <div className={styles.metricGrid}><Metric label="В кровати" value={minutesLabel(inBed(night))}/><Metric label="Спал · твоя оценка" value={minutesLabel(night.sleepMinutes)}/><Metric label="Засыпание" value={minuteLabel(night.latencyMinutes??null)}/><Metric label="Бодрствование" value={minuteLabel(night.awakeMinutes??null)}/><Metric label="Самочувствие" source="self-report" detail="Твоя оценка · 1–5" value={`${night.rested} / 5 · ${moods[night.rested-1]}`}/><Metric label="Долг этой ночи" value={minutesLabel(debt(night))}/></div>
            <HistoricalGoal night={night} credited={state.credits.includes(night.date)}/>
            {night.note&&<section className={styles.card}><span className={styles.eyebrow}>ЗАМЕТКА О НОЧИ</span><p className={styles.note}>{night.note}</p></section>}
          </>:<section className={styles.empty}><Moon size={35} strokeWidth={1}/><h2>Нет записи за эту ночь</h2><p>{selected>today?'Эта дата ещё не наступила. Запись можно добавить после пробуждения.':'Отсутствие записи не означает плохой сон.'}</p>{selected<=today&&<button className={styles.secondary} onClick={()=>morning(undefined,selected)}><Plus size={16}/> Добавить ночь</button>}</section>}
        </>:<>
          <div className={styles.chips}><button aria-pressed={period==='week'} onClick={()=>setPeriod('week')}>Неделя</button><button aria-pressed={period==='month'} onClick={()=>setPeriod('month')}>Месяц</button></div>
          <div className={styles.periodNav} role="group" aria-label="Период статистики" data-period-kind={period} data-period-start={statsPeriod.current.start} data-period-end={statsPeriod.current.end} data-period-through={statsPeriod.through}><button aria-label="Предыдущий период" disabled={!statsPeriod.previous} onClick={()=>shiftPeriod(-1)}><ChevronLeft size={21}/></button><span>{periodRangeLabel(statsPeriod.current)}</span><button aria-label="Следующий период" disabled={!statsPeriod.canNext} onClick={()=>shiftPeriod(1)}><ChevronRight size={21}/></button><button className={styles.textButton} onClick={()=>setEnd(today)}>Сегодня</button></div>
          <p className={styles.fine} data-period-observed={statsPeriod.through}>{statsPeriod.partial?`Период ещё не завершён. Учтены даты по ${periodDateLabel(statsPeriod.through)}: ${statsPeriod.shownDays} из ${statsPeriod.current.days} календарных дней. Предыдущий период для сравнения показан целиком.`:'Завершённый календарный период.'}</p>
          <Analytics version={scoreVersion} nights={state.nights} range={statsPeriod} onSelect={openDay} onInfo={()=>setPanel('score')}/>
        </>}
      </>}
      {loaded&&<MeditationPanel hidden={tab!=='meditation'} demo={demo}/>}
      {tab==='tower'&&<>
        <div className={styles.pageHeading}><h1>Твоя башня <HelpHint label="Как растёт башня" text={`${GROWTH_RULES.nightsPerFloor} успешных ночей — новый этаж. Повреждения включаются отдельно в профиле; заработанные этажи сохраняются.`}/></h1></div>
        <section className={styles.world}><div className={styles.scene}>{!state.active?<LivingScene world={world} api={api} reduced={reduced} quality={quality} speed={1} damage={presentation.condition?{...presentation.condition,scope:state.towerCondition!.activatedDate}:null}/>:<div className={styles.empty}><Moon size={45}/><p>Строители тоже отдыхают. До утра.</p></div>}<div className={styles.sceneLabel}><small>ТВОЙ ОСТРОВ</small><strong>Башня · {floors} {plural(floors)}</strong></div><div className={styles.sceneActions}><button aria-label="Показать всю башню" onClick={()=>api.current?.camera('overview')}><Expand size={19}/></button><button aria-label="Подняться к вершине" onClick={()=>api.current?.camera('top')}><ArrowUp size={19}/></button><button aria-label="Спуститься к острову" onClick={()=>api.current?.camera('home')}><ArrowDown size={19}/></button><button aria-label="Сбросить камеру" onClick={()=>api.current?.camera('reset')}><RotateCcw size={19}/></button></div><div className={styles.orbit}><button aria-label="Повернуть влево" onClick={()=>api.current?.camera('left')}><ChevronLeft size={20}/></button><span>В СТОРОНЫ — ПОВЕРНУТЬ</span><button aria-label="Повернуть вправо" onClick={()=>api.current?.camera('right')}><ChevronRight size={20}/></button><button aria-label="Отдалить" onClick={()=>api.current?.camera('out')}><Minus size={18}/></button><button aria-label="Приблизить" onClick={()=>api.current?.camera('in')}><Plus size={18}/></button></div></div><div className={styles.buildProgress} data-tower-floors={growth.floors} data-tower-complete={growth.complete}><h2>{growth.complete?'100 этажей построено':`${growth.remaining} ночей до следующего этажа`}</h2><div className={styles.sevenStones} role="progressbar" aria-label={growth.complete?'Этажи башни':'Ночи до следующего этажа'} aria-valuemin={0} aria-valuemax={growth.complete?growth.limit:GROWTH_RULES.nightsPerFloor} aria-valuenow={growth.complete?growth.floors:growth.nights} aria-valuetext={growth.complete?'Построены все 100 этажей':`${growth.nights} из ${GROWTH_RULES.nightsPerFloor} ночей; построено ${growth.floors} из ${growth.limit} этажей`}>{Array.from({length:GROWTH_RULES.nightsPerFloor},(_,i)=><i key={i} data-done={i<growth.nights}/>)}</div><HelpHint label="О прогрессе строительства" text={growth.complete?'Башня достигла предела роста. Записи, успешные ночи и серия продолжают сохраняться.':`${GROWTH_RULES.nightsPerFloor} успешных ночей суммарно — этаж. Заработанные этажи сохраняются.`}/></div></section>
        {presentation.condition&&<TowerConditionStatus condition={presentation.condition}/>}
        <section className={styles.garden}><Leaf size={31}/><div><span className={styles.eyebrow}>{state.garden?'ТВОЁ ОТКРЫТИЕ':'СЛЕДУЮЩАЯ НАГРАДА'}</span><h2>Сад среди облаков</h2><p>{state.garden?`${GROWTH_RULES.gardenStreak} успешных ночей подряд подарили башне сад. Он останется с тобой.`:`${Math.min(GROWTH_RULES.gardenStreak,streak)} из ${GROWTH_RULES.gardenStreak} успешных ночей подряд. Немного постоянства — и здесь появится зелень.`}</p></div></section>
        <GrowthRules target={state.active?.target??state.schedule} active={!!state.active}/>
        <button className={styles.secondary} onClick={()=>setPanel('demo')}><Sparkles size={18}/>Посмотреть развитие башни<ChevronRight size={18}/></button>
      </>}
      {tab==='profile'&&<>
        <div className={styles.pageHeading}><span className={styles.eyebrow}>ПРИЛОЖЕНИЕ И ДАННЫЕ</span><h1>Профиль</h1></div>
        <section className={styles.profileCard}><div className={styles.avatar}><Moon size={30}/></div><h2>Твой прогресс</h2><p>{state.nights.length} записей · {growth.floors} {plural(growth.floors)} заработано · {state.credits.length} успешных ночей</p></section>
        <TowerConditionSettings policy={state.towerCondition} disabled={blocked.current||busy!==null} onChange={enabled=>{if(commit(withTowerCondition(current.current,enabled,localDate()))){setNotice(enabled?'Правила башни включены с завтрашней даты.':'Полный вид башни восстановлен.');}}}/>
        <section className={styles.card}><div className={styles.sectionHead}><h2>Твой режим</h2><button onClick={()=>openSchedule()}>Изменить <ChevronRight size={16}/></button></div><div className={styles.metricGrid}><Metric label="Вечер → утро" value={`${state.schedule.bed} → ${state.schedule.wake}`}/><Metric label="Личная цель" value={minutesLabel(state.schedule.hours*60)}/></div><p className={styles.fine}>{alarm.reminder?`Напоминание за ${alarm.reminderMinutes} минут до сна.`:'Напоминания выключены.'} {alarm.enabled?'Будильник включён.':'Будильник выключен.'}</p>{alarm.reminder&&<ReminderSchedule device={device} demo={demo} onPermission={()=>void nativeCall('reminderPermission').then(applyDevice).catch(e=>setError(message(e)))}/>}</section>
        <section className={styles.card}><div className={styles.sectionHead}><h2>Резервная копия</h2><ShieldCheck size={20}/></div><p className={styles.fine}>Записи хранятся на этом устройстве. Скачай копию, чтобы перенести их или восстановить после очистки браузера.</p><button className={styles.secondary} onClick={()=>void download()}><Download size={18}/>Скачать мои записи</button><button className={styles.secondary} onClick={()=>file.current?.click()}><Upload size={18}/>Восстановить из файла</button><input ref={file} className={styles.srOnly} type="file" accept=".json,application/json" aria-label="Файл резервной копии" onChange={e=>{const f=e.target.files?.[0];if(f)void selectBackup(f);e.target.value='';}}/></section>
        <HealthConnectPanel state={state} available={device.native&&!demo} disabled={blocked.current||busy!==null} onImport={(sessions,index,offsets,rested,sourcePackage)=>{if(actionGate.busy||blocked.current||ringingRef.current||device.ringing)return false;try{const next=importHealthNight(current.current,sessions,index,offsets,rested,Date.now(),sourcePackage);if(!commit(next))return false;setNotice('Запись Health Connect сохранена в дневник.');return true;}catch(e){setError(message(e));return false;}}}/><section className={styles.card}><h2>Оформление</h2><button className={styles.secondary} onClick={()=>setPanel('appearance')}>Темы оформления <ChevronRight size={16}/></button><p className={styles.fine}>{appearance.name}</p><Toggle label="Уменьшить движение" checked={reduced} onChange={setReduced}/><Toggle label="Детальная графика башни" checked={quality==='high'} onChange={v=>setQuality(v?'high':'low')}/><p className={styles.fine}>Язык: русский. Без рекламы. Личные заметки не передаются друзьям. Видимость времени сна и прогресса — по твоему согласию.</p></section>
        <section className={styles.card}><h2>Будильник на этом устройстве</h2>{device.native&&device.alarmSystemVolume===0&&<p className={styles.fine}>Громкость будильника Android выключена.</p>}<p className={styles.fine}>{device.native?(alarmPermissionIssue(device)||'Уведомления и точные будильники разрешены. Проверь громкость и ограничения батареи на своём телефоне.'):'Открыта веб-версия. Для будильника с выключенным экраном нужна Android-версия. Таймер страницы не заменяет системный будильник.'}</p>{device.native&&<button className={styles.secondary} onClick={()=>void nativeCall('permissions').then(applyDevice).catch(e=>setError(message(e)))}>Разрешения Android <ChevronRight size={16}/></button>}<AlarmScreenAccess device={device} onRequest={()=>void nativeCall('fullScreenPermission').then(applyDevice).catch(e=>setError(message(e)))}/><button className={styles.textButton} onClick={()=>openSchedule('alarm')}>Настройки будильника</button>{device.native&&<p className={styles.fine} data-alarm-force-stop>После принудительной остановки через настройки Android будильник не работает до открытия Overman. Снова открой приложение и проверь ближайший сигнал.</p>}</section>
        <p className={styles.footerNote}>Overman · версия 0.4.45</p>
      </>}
      </>}
    </div>
    {loaded&&!demo&&!blocked.current&&storage.current&&<SleepSyncPanel hidden={tab!=='profile'} disabled={busy!==null||!writerAllowed.current||!!state.active||ringing||!!device.ringing||wakePending} getStorage={()=>{if(!storage.current)throw Error('Хранилище пока недоступно.');return storage.current;}} getState={()=>current.current} assertWritable={()=>{if(blocked.current||!storage.current||!writerAllowed.current)throw Error('Дневник открыт только для чтения.');if(current.current.active||ringingRef.current||device.ringing||wakePending||pendingWake.current||panel!==null)throw Error('Сначала заверши текущую ночь или открытое действие.');}} registerImport={handler=>{linkedImport.current=handler;}} guardImport={()=>importDevice().guard()} prepareImportCommit={next=>importDevice().prepare(next)} restoreImportDevice={async previous=>{await importDevice().guard();await configureDevice(previous.schedule,{...defaultAlarm,...previous.alarm,noise:false,smart:false});await importDevice().guard();}} onSaved={saved=>{current.current=saved;setState(saved);setError('');}} runAction={action=>perform('sync',action)}/>}
    <nav inert={busy!==null} className={styles.bottomNav} aria-label="Основные разделы">{([['sleep','Сон',Moon],['stats','Статистика',BarChart3],['tower','Башня',Layers3],['meditation','Медитация',Wind],['profile','Профиль',UserRound]] as const).map(([id,label,Icon])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>switchTab(id)}><Icon size={22} strokeWidth={tab===id?2:1.5}/><span>{label}</span>{tab===id&&<i/>}</button>)}</nav>
    {busy&&<div className={styles.operationStatus} role="status" aria-live="polite"><span aria-hidden="true"/>{operationLabel[busy]}</div>}
    {notice&&<div className={styles.toast} role="status"><Check size={17}/>{notice}</div>}
    <Dialog.Root open={panel!==null} onOpenChange={v=>{if(!v&&!actionGate.busy){setPanel(null);stopPreview();}}}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content onCloseAutoFocus={event=>{if(error){event.preventDefault();errorRef.current?.focus({preventScroll:true});errorRef.current?.scrollIntoView({block:'nearest',behavior:'instant'});}}} onEscapeKeyDown={e=>{if(panel==='schedule'&&timeEditor!==null){e.preventDefault();setTimeEditor(null);}}} inert={busy!==null} style={themeStyle} data-appearance={appearance.id} className={`${styles.sheet} ${styles.themedSheet} ${quickMorning?styles.quickMorning:''}`} data-morning-mode={quickMorning?'quick':undefined}><div className={styles.sheetHandle}/><Dialog.Close className={styles.close} aria-label="Закрыть"><X size={21}/></Dialog.Close>{!quickMorning&&<span className={styles.eyebrow}>OVERMAN</span>}<Dialog.Title className={styles.sheetTitle}>{panel?titles[panel]:''}</Dialog.Title><Dialog.Description className={styles.sheetDescription}>{panel==='morning'?(quickMorning?'Выбери самочувствие. Время можно уточнить.':manualMorning?'Внеси пропущенную ночь по своим воспоминаниям.':'Укажи длительность сна и самочувствие от 1 до 5.'):panel==='appearance'?'Выбор сохраняется на этом устройстве.':panel==='schedule'?'Время сна, подъёма и параметры сигнала.':panel==='discard'?'Основная ночь останется без изменений.':panel==='delete'?'Проверь дату и последствия удаления.':panel==='restore'?'Сначала проверь содержимое. Текущая история будет заменена.':'Подробнее о показателях приложения.'}</Dialog.Description>
      {error&&<div ref={dialogErrorRef} tabIndex={-1} className={styles.error} role="alert">{error}{wakePending&&<button type="button" disabled={busy!==null} onClick={()=>void retryWake()}>Повторить сохранение</button>}</div>}
      {panel==='appearance'&&<><Toggle label="Днём светлая, ночью тёмная" checked={state.appearanceMode!=='fixed'} disabled={busy!==null||blocked.current} onChange={auto=>commit({...current.current,appearanceMode:auto?'auto':'fixed'})}/><details className={styles.inlineHelp}><summary>Когда меняется тема?</summary><p>С 07:00 до 20:00 — дневная палитра выбранного оформления. Ночью и во время сна — тёмная. Время берётся с устройства. Выключи переключатель для постоянной темы.</p></details><ThemePicker value={selectedAppearance.id} onChange={chooseAppearance} disabled={busy!==null||blocked.current}/><button className={styles.primary} onClick={()=>setPanel(null)}>Готово</button></>}
      {panel==='schedule'&&<form className={styles.form} onSubmit={saveSettings}>
        <button type="button" className={styles.secondary} onClick={()=>setPanel('appearance')}>Темы оформления <ChevronRight size={16}/></button>
        <div className={styles.segment}><button type="button" aria-pressed={scheduleTab==='bed'} onClick={()=>setScheduleTab('bed')}><Moon size={17}/>Вечер</button><button type="button" aria-pressed={scheduleTab==='alarm'} onClick={()=>setScheduleTab('alarm')}><AlarmClock size={17}/>Будильник</button></div>
        <div className={styles.timeInputs}><TimePicker open={timeEditor==='bed'} onOpenChange={v=>setTimeEditor(v?'bed':null)} label="Ложусь в" value={schedule.bed} onChange={bed=>setSchedule({...schedule,bed})} presets={['22:00','22:30','23:00','23:30']}/><TimePicker open={timeEditor==='wake'} onOpenChange={v=>setTimeEditor(v?'wake':null)} label="Встаю в" value={schedule.wake} onChange={wake=>setSchedule({...schedule,wake})} presets={['06:30','07:00','07:30','08:00']}/></div>
        <p className={styles.sleepWindow}>Время в кровати <strong>{minutesLabel((clockMinutes(schedule.wake)-clockMinutes(schedule.bed)+1440)%1440)}</strong></p>
        {scheduleTab==='bed'?<><div className={styles.fields}><TimePicker open={timeEditor==='goal'} onOpenChange={v=>setTimeEditor(v?'goal':null)} label="Цель сна" duration min={240} max={720} value={clockLabel(schedule.hours*60)} onChange={value=>setSchedule({...schedule,hours:clockMinutes(value)/60})} presets={['07:00','07:30','08:00','08:30']}/><label>Допустимое отклонение<select value={schedule.tolerance} onChange={e=>setSchedule({...schedule,tolerance:Number(e.target.value)})}>{[30,45,60].map(n=><option key={n} value={n}>±{n} минут</option>)}</select></label></div><Toggle label="Напомнить отправиться ко сну" checked={alarmDraft.reminder} onChange={reminder=>setAlarmDraft({...alarmDraft,reminder})}/>{alarmDraft.reminder&&<label>За сколько напомнить<select value={alarmDraft.reminderMinutes} onChange={e=>setAlarmDraft({...alarmDraft,reminderMinutes:Number(e.target.value)})}>{[5,10,15,20,30,45,60,90,120].map(n=><option key={n} value={n}>{n} минут</option>)}</select></label>}{(alarmDraft.reminder||alarm.reminder)&&<><ReminderSchedule device={device} demo={demo} onPermission={()=>void nativeCall('reminderPermission').then(applyDevice).catch(e=>setError(message(e)))}/><p className={styles.fine}>Сохрани режим, чтобы применить изменения. Это обычное уведомление: Android может доставить его позже выбранного времени. Если ты уже начал ночь, напоминание не приходит.</p></>}</>:<>
          <Toggle label="Будильник" checked={alarmDraft.enabled} onChange={enabled=>setAlarmDraft({...alarmDraft,enabled})}/>
          <label>Мелодия<select value={alarmDraft.ringtone} onChange={e=>{stopPreview();setAlarmDraft({...alarmDraft,ringtone:e.target.value as typeof alarmDraft.ringtone});}}><option value="dawn">Первый свет</option><option value="bell">Тихие колокольчики</option><option value="birds">Утренние переливы</option></select></label>
          <label>Громкость · {Math.round(alarmDraft.volume*100)}%<input aria-label="Громкость будильника" type="range" min="0" max="1" step="0.05" value={alarmDraft.volume} onChange={e=>{stopPreview();setAlarmDraft({...alarmDraft,volume:Number(e.target.value)});}}/></label><div className={styles.previewActions}><button type="button" className={styles.secondary} onClick={()=>void playTone(alarmDraft,true).catch(e=>setError(message(e)))}><Play size={16}/>Проверить мелодию</button><button type="button" className={styles.iconButton} aria-label="Остановить мелодию" onClick={stopPreview}><Square size={16}/></button></div>
          <AlarmSchedule device={device} enabled={alarm.enabled} demo={demo} disabled={busy!==null||!!device.ringing} onSkip={changeAlarmSkip}/>
          <Toggle label="Вибрация" checked={alarmDraft.vibration} onChange={vibration=>{stopPreview();setAlarmDraft({...alarmDraft,vibration});}}/>
          {device.native&&<div className={styles.fine} data-alarm-volume><p>{device.alarmSystemVolume===0?'Громкость будильника Android выключена.':device.alarmSystemVolume!==undefined?`Громкость будильника Android: ${device.alarmSystemVolume} из ${device.alarmSystemVolumeMax}.`:'Громкость Android задаётся отдельно от громкости в приложении.'}</p><button type="button" className={styles.secondary} onClick={()=>{stopPreview();void nativeCall('alarmVolume').then(applyDevice).catch(e=>setError(message(e)));}}>Настроить громкость Android <ChevronRight size={16}/></button>{device.vibrationAvailable===false&&<p>На этом устройстве нет вибрации.</p>}</div>}
          {(alarmDraft.volume===0||(device.native&&device.alarmSystemVolume===0))&&<p className={styles.capabilityNote}>{alarmDraft.vibration&&device.vibrationAvailable!==false?'Только вибрация: звук выключен.':'Будильник будет бесшумным. Увеличь громкость или включи вибрацию перед сохранением.'}</p>}
          {alarmDraft.enabled&&<AlarmScreenAccess device={device} onRequest={()=>void nativeCall('fullScreenPermission').then(applyDevice).catch(e=>setError(message(e)))}/>}<p className={styles.capabilityNote}><Info size={17}/>{demo?'Деморежим: сигнал и напоминания не запускаются.':device.native?(alarmPermissionIssue(device)||'Сигнал работает с выключенным экраном. Для остановки удерживай «Проснуться» 3 секунды.'):'Веб-версия: сигнал работает только на открытой активной странице. Для ночного будильника нужна Android-версия.'}</p>
          {device.native&&(!device.exact||!device.notifications)&&<button type="button" className={styles.secondary} onClick={()=>void nativeCall('permissions').then(applyDevice).catch(e=>setError(message(e)))}>Разрешить будильники в Android <ChevronRight size={18}/></button>}
        </>}
        <button className={styles.primary} type="submit" disabled={timeEditor!==null}>Сохранить режим <Check size={18}/></button>
      </form>}
      {panel==='discard'&&duplicateReview&&<div className={styles.form} data-duplicate-discard>
        <p>За {dateLabel(duplicateReview.existing.date)} уже есть основная ночь: {duplicateReview.existing.bedClock} → {duplicateReview.existing.wakeClock}.</p>
        <p>Оценка и черновик второго сеанса будут убраны. Основная запись, её заметка, статистика и награды не изменятся. Это не удаление основной ночи.</p>
        <button className={styles.secondary} onClick={()=>setPanel('morning')}>Вернуться к оценке</button>
        <button className={`${styles.secondary} ${styles.destructive}`} onClick={()=>void confirmDiscardDuplicate()}>Закончить без записи</button>
      </div>}
      {panel==='delete'&&deleting&&<div className={styles.form} data-delete-confirm>
        <p><strong>{dateLabel(deleting.date)} · {deleting.bedClock} → {deleting.wakeClock}</strong><br/>Сон: {minutesLabel(deleting.sleepMinutes)} · самочувствие {deleting.rested} / 5</p>
        <p>Запись и заметка исчезнут из истории. Средние значения, долг сна и серия будут пересчитаны без этой ночи.</p>
        <p>Уже заработанный прогресс башни и сад сохранятся. Дата полученной награды останется, чтобы повторное добавление не начисляло её ещё раз.</p>
        <button className={styles.secondary} onClick={()=>setPanel('morning')}>Отмена · оставить запись</button>
        <button className={`${styles.secondary} ${styles.destructive}`} onClick={()=>void confirmDelete()}>Удалить запись навсегда</button>
      </div>}
      {panel==='morning'&&<form noValidate className={`${styles.form} ${quickMorning?styles.morningForm:''}`} onSubmit={saveNight}>
        <div className={styles.morningBody}>
        {dateConflict&&<section className={styles.dateCollision} role="alert" data-date-collision={dateConflict.date}><p>За {dateLabel(dateConflict.date)} уже есть основная ночь. В v1 одна ночь на дату пробуждения; дневной сон отдельно пока не поддерживается.</p><button type="button" className={styles.secondary} onClick={()=>morning(dateConflict)}>Открыть существующую ночь</button>{draftScope.current&&state.active?.wokeAt!==undefined&&dateAt(state.active.wokeAt,state.active.wakeOffset)===dateConflict.date&&<button type="button" className={styles.textButton} onClick={()=>{setDuplicateReview({active:structuredClone(state.active!),existing:structuredClone(dateConflict)});setError('');setPanel('discard');}}>Не сохранять повторный сеанс</button>}</section>}

        {editing&&<p className={styles.fine} data-edit-target>Прежняя цель: {editingOriginal.current?.target.bed} → {editingOriginal.current?.target.wake}, {minutesLabel((editingOriginal.current?.target.hours??0)*60)}. Допуск ±{editingOriginal.current?.target.tolerance} мин и правило награды сохранятся. Дату подъёма менять нельзя.</p>}
        {staleForm&&<section className={styles.dateCollision} data-stale-note-draft role="alert"><p>Запись изменилась после начала черновика. Сохранённый ввод не применён автоматически.</p><label>Сохранённая заметка<textarea aria-label="Сохранённая заметка" readOnly value={staleForm.fields.note}/></label><button type="button" className={styles.secondary} onClick={()=>resolveStaleForm(true)}>Восстановить сохранённый ввод</button><button type="button" className={styles.textButton} onClick={()=>resolveStaleForm(false)}>Оставить текущую запись</button></section>}
        {manualMorning&&<p className={styles.fine} data-manual-entry>Ручная запись: время и длительность указываешь ты. Датчики не использовались. Заметку можно не заполнять.</p>}
        {durationAttempted&&Object.keys(durationErrors).length>0&&<p className={styles.fieldErrorSummary} role="alert">Проверь выделенные поля. Запись ещё не сохранена.</p>}
        {(draftScope.current||formScope.current)&&draftError&&<div className={styles.error} role="alert">{draftError}<button type="button" onClick={()=>persistDraftFields(draftFields.current)}>Повторить сохранение черновика</button></div>}
        {state.active?.wokeAt&&!editing&&!manualMorning&&<div className={styles.morningSummary}><span>{draft.bed.slice(11)} → {draft.wake.slice(11)}</span><strong>{draft.sleep===''?'Укажи длительность сна ниже':`Сон: примерно ${minutesLabel(Math.round(Number(draft.sleep)*60))}`}</strong><small>Оценка по времени в кровати.</small></div>}
        <fieldset className={styles.moods}><legend>Насколько хорошо ты выспался?</legend>{moods.map((label,i)=><button type="button" key={label} aria-pressed={draft.rested===i+1} onClick={()=>updateDraft({rested:i+1})}><strong>{i+1}</strong><small>{label}</small></button>)}</fieldset>
        {state.active?.wokeAt&&!editing&&timeReview(state.active)&&<p className={styles.error}>{timeReview(state.active)}</p>}
        <details className={styles.details} open={state.active?.wokeAt&&!editing&&!manualMorning&&!timeReview(state.active)?undefined:true}><summary>Уточнить время и длительность сна</summary>
          <div className={styles.fields}><label>Лёг в кровать<input required type="datetime-local" id="morning-bed" aria-label="Лёг в кровать" aria-invalid={!!durationErrors.bed} aria-describedby={durationErrors.bed?'morning-bed-error':undefined} value={draft.bed} onChange={e=>updateDraft({bed:e.target.value})}/><MorningFieldError field="bed" errors={durationErrors}/></label><label>Проснулся<input required type="datetime-local" id="morning-wake" aria-label="Проснулся" aria-invalid={!!durationErrors.wake} aria-describedby={durationErrors.wake?'morning-wake-error':undefined} value={draft.wake} onChange={e=>updateDraft({wake:e.target.value})}/><MorningFieldError field="wake" errors={durationErrors}/></label></div>
          <TimeOffsetChoice label="Отход ко сну" text={draft.bed} offset={draftOffsets.bed} onChange={bed=>setDraftOffsets({...draftOffsetsRef.current,bed},true)}/><TimeOffsetChoice label="Подъём" text={draft.wake} offset={draftOffsets.wake} onChange={wake=>setDraftOffsets({...draftOffsetsRef.current,wake},true)}/><p className={styles.fine}>Время записи: {draftOffsets.bed===undefined?'местное время устройства':offsetLabel(draftOffsets.bed)} → {draftOffsets.wake===undefined?'местное время устройства':offsetLabel(draftOffsets.wake)}. Даты истории сохраняют исходное время.</p>
          <label>Сколько примерно спал, часов<input required type="number" min="0" max="24" step="0.01" id="morning-sleep" aria-label="Сколько примерно спал, часов" aria-invalid={!!durationErrors.sleep} aria-describedby={durationErrors.sleep?'morning-sleep-error':undefined} value={draft.sleep} onChange={e=>updateDraft({sleep:e.target.value})}/><MorningFieldError field="sleep" errors={durationErrors}/></label>
          <p className={styles.fine}>Сон и указанные паузы должны укладываться во время в кровати. Если обе паузы известны, сумма должна совпадать с ним (с округлением до минуты).</p>
          <details className={styles.details}><summary>Засыпание и пробуждения · необязательно</summary><div className={styles.fields}><label>Заснул через, минут<input type="number" min="0" max="1440" id="morning-latency" aria-label="Заснул через, минут" aria-invalid={!!durationErrors.latency} aria-describedby={durationErrors.latency?'morning-latency-error':undefined} value={draft.latency} placeholder="Не помню" onChange={e=>updateDraft({latency:e.target.value})}/><MorningFieldError field="latency" errors={durationErrors}/></label><label>Бодрствовал ночью, минут<input type="number" min="0" max="1440" id="morning-awake" aria-label="Бодрствовал ночью, минут" aria-invalid={!!durationErrors.awake} aria-describedby={durationErrors.awake?'morning-awake-error':undefined} value={draft.awake} placeholder="Не помню" onChange={e=>updateDraft({awake:e.target.value})}/><MorningFieldError field="awake" errors={durationErrors}/></label></div><p className={styles.fine}>Это твои приблизительные оценки.</p></details>
          {duration.calculatedHours!==undefined&&<button type="button" className={styles.secondary} onClick={()=>updateDraft({sleep:duration.calculatedHours!})}>Рассчитать сон: {minutesLabel(duration.calculatedMinutes!)}</button>}
          <label>Что повлияло на ночь?<textarea id="sleep-note" aria-describedby="sleep-note-help" aria-label="Что повлияло на ночь?" value={draft.note} maxLength={2000} rows={2} placeholder="Заметка — необязательно" onChange={e=>updateDraft({note:e.target.value})}/><small id="sleep-note-help" className={styles.fine}>Личная заметка · {draft.note.length}/2000. Не публикуется и не попадает в уведомления.</small></label>
        </details>
        {(draftScope.current||formScope.current)&&<p className={`${styles.fine} ${quickMorning?styles.morningDraftStatus:''}`} aria-live="polite">{draftSave==='saving'?'Сохраняем черновик…':draftSave==='saved'?'Черновик сохранён на устройстве. Можно заполнить позже.':''}</p>}
        </div>
        <div className={styles.morningActions}>
        <button className={styles.primary} type="submit" disabled={!draft.rested||busy!==null||!!dateConflict||!!staleForm}>Сохранить ночь <Check size={18}/></button>
        {editing&&<button type="button" className={`${styles.textButton} ${styles.destructive}`} onClick={()=>{setDeleting(editingOriginal.current);setError('');setPanel('delete');}}>Удалить ночь</button>}
        </div>
      </form>}
      {panel==='score'&&<div className={styles.form} data-score-version={night?.scoreModel??'diary-v1'}>
        <p>Баллы сравнивают длительность и режим. Это дневниковая оценка, а не измерение качества сна датчиками.</p>
        {night?.scoreModel==='diary-v2'?<><div className={styles.scoreFormula}>{Object.entries(assessSleep(night).points).map(([key,value])=><span key={key}><strong>{Math.round(value)}</strong>{key==='duration'?'Длительность · /60':key==='efficiency'?'Доля сна · /20':'Режим · /20'}</span>)}</div><p className={styles.fine}>{assessSleep(night).pausesKnown?'Паузы уточнены тобой.':'Засыпание и ночные пробуждения не уточнены.'} {night?.source==='health-connect'?'Изначально данные получены из Health Connect и могли быть уточнены. Точность зависит от источника.':'Время таймера — время в кровати; минуты сна подтверждаются утром.'}</p><details className={styles.inlineHelp}><summary>Формула v2</summary><p>Доля цели D = минуты сна / цель этой ночи, максимум 1. Доля сна E = минуты сна / время в кровати. Режим R — среднее соблюдения отбоя и подъёма: полный балл в пределах допуска, затем плавное снижение до нуля за 2 часа. Итог = 60 × D² + 20 × D × E + 20 × D × R, округлённый до целого. Нулевой сон даёт 0. Долгая ночь не компенсирует короткие ночи. Это наша формула, она не проходила клиническую валидацию.</p></details></>:<p className={styles.fine}>Эта запись использует прежнюю формулу v1. Её балл сохранён.</p>}
        <details className={styles.inlineHelp}><summary>Что влияет на точность?</summary><p>Длительность, засыпание и бодрствование уточняются в записи. Самочувствие хранится отдельно и не повышает балл. Телефон на тумбочке не измеряет движения тела, пульс или фазы сна. Шум помещения не доказывает пробуждение и не снижает балл. Записи Health Connect можно подключить с твоего разрешения. Отдельный сохранённый индекс показывается только после импорта полной записи; он не меняет дневниковые баллы.</p></details>
        <details className={styles.inlineHelp}><summary>История и версии расчёта</summary><p>Новые записи используют v2. Прежние записи и их исправления сохраняют v1, цели и награды. Если период содержит разные версии, прямое сравнение периодов отключается.</p><p>Формула v1: D × (60 + 20 × E + 10 × R отбоя + 10 × R подъёма). Неизвестная версия сохраняется без пересчёта.</p></details>
      </div>}
      {panel==='stages'&&<div className={styles.form}><p>В течение ночи чередуются REM и стадии сна без быстрых движений глаз. Короткие пробуждения тоже могут быть частью ночи.</p>{[['Лёгкий сон','Переход от бодрствования к более устойчивому сну.'],['Глубокий сон','Стадия медленноволнового сна.'],['REM','Стадия с быстрыми движениями глаз; часто связана со сновидениями.']].map(([title,text])=><section key={title} className={styles.education}><h3>{title}</h3><p>{text}</p></section>)}<p className={styles.fine}>Приложение пока не измеряет эти стадии. Диаграмма твоего сна появится только при подключении подходящего источника данных; часы и записи звуков не входят в текущую версию.</p></div>}
      {panel==='restore'&&restore&&<div className={styles.form}><div className={styles.metricGrid}><Metric label="Ночей в копии" value={String(restore.nights.length)}/><Metric label="Этажей" value={String(floorsOf(sleepWorld(restore)))}/></div><p className={styles.fine}>Будут восстановлены записи, режим и башня. Будильник, напоминания и незавершённая ночь из файла не запускаются. Предыдущая история останется в локальной страховочной копии.</p><Toggle label="Заменить текущую историю этой копией" checked={restoreAgree} onChange={setRestoreAgree}/><button className={styles.primary} disabled={!restoreAgree||busy!==null} onClick={()=>void importBackup()}>Восстановить записи <Upload size={18}/></button></div>}
      {panel==='demo'&&<div className={styles.form}>{demo?<div className={styles.demoStages}>{[0,1,4,12,24,100].map(n=><button className={styles.secondary} key={n} onClick={()=>{if(commit(demoSleep(n))){history.replaceState(null,'',`/?demo=1&floors=${n}`);setPanel(null);}}}>{n===0?'Начало':`${n} ${plural(n)}`}</button>)}</div>:<a className={styles.primary} href="/?demo=1">Открыть отдельное демо <Sparkles size={18}/></a>}<p className={styles.fine}>Демо использует отдельное сохранение и не меняет твою историю.</p></div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={ringing}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content inert={busy!==null} className={styles.sheet} onEscapeKeyDown={e=>e.preventDefault()} onPointerDownOutside={e=>e.preventDefault()} onInteractOutside={e=>e.preventDefault()}><Dialog.Title className={styles.sheetTitle}>Пора вставать</Dialog.Title><Dialog.Description className={styles.sheetDescription}>Удерживай кнопку 3 секунды, чтобы выключить сигнал.</Dialog.Description><HoldToWake onWake={finishWake} disabled={busy!==null}/></Dialog.Content></Dialog.Portal></Dialog.Root>
  </main>;
}

function message(e:unknown){return e instanceof Error?e.message:'Не удалось выполнить действие. Попробуй ещё раз.';}
function Toggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(v:boolean)=>unknown;disabled?:boolean}){return <label className={styles.toggle}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><i aria-hidden="true"/></label>;}
function WeekStrip({nights,end,start,selected,onSelect,version}:{version:DiaryScoreVersion;nights:Night[];end:string;start?:string;selected:string;onSelect:(date:string)=>void}){return <div className={styles.weekStrip}>{dateRange(end,7).filter(date=>!start||date>=start).map(date=>{const n=nights.find(v=>v.date===date),score=n?nightScore(n,version):0;return <button key={date} aria-label={`${date}: ${n?`${score} баллов`:'нет записи'}`} aria-pressed={date===selected} onClick={()=>onSelect(date)}><small>{new Date(`${date}T12:00`).toLocaleDateString('ru-RU',{weekday:'short'})}</small><span><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" opacity=".1" strokeWidth="2"/><circle cx="24" cy="24" r="20" fill="none" stroke={n?scoreColor(score):'transparent'} strokeWidth="2" strokeDasharray={`${score/100*126} 126`} transform="rotate(-90 24 24)" strokeLinecap="round"/></svg><strong>{Number(date.slice(-2))}</strong></span><i data-done={!!n}/><small data-day-score={date}>{n?`${score} б.`:'—'}</small></button>;})}</div>;}

function TimeOffsetChoice({label,text,offset,onChange}:{label:string;text:string;offset?:number;onChange:(value:number|undefined)=>void}){const candidates=timeCandidates(text),choices=[...new Set([...candidates.map(c=>c.offset),...(offset===undefined?[]:[offset])])];if(candidates.length<=1&&(offset===undefined||candidates.some(c=>c.offset===offset)))return null;return <label>{label} · смещение UTC<select aria-label={`${label} · смещение UTC`} value={offset??'auto'} onChange={e=>onChange(e.target.value==='auto'?undefined:Number(e.target.value))}><option value="auto">Местное время устройства</option>{choices.map(v=><option value={v} key={v}>{offsetLabel(v)}</option>)}</select></label>;}

function AlarmSchedule({device,enabled,demo,disabled,onSkip}:{device:DeviceStatus;enabled:boolean;demo:boolean;disabled:boolean;onSkip:(restore:boolean)=>Promise<unknown>}){
  const view=alarmScheduleView(device,enabled,demo),daily=device.native&&!demo&&device.alarmRepeatsDaily&&view.state==='scheduled';
  return <aside className={styles.alarmSchedule} data-alarm-schedule={view.state} aria-live="polite"><AlarmClock size={17}/><div><strong>{view.title}</strong>{view.at?<time dateTime={new Date(view.at).toISOString()}>{view.detail}</time>:view.state==='off'?null:<span>{view.detail}</span>}
    {daily&&<><span data-alarm-repeat>Каждый день · {device.tomorrowAlarmEnabled===true?`Завтра по расписанию: ${device.alarmClock}`:device.tomorrowAlarmEnabled===false?'Завтрашний сигнал пропущен':'Проверяем завтрашний сигнал'}</span>
      {device.skippedAlarmAt?<><span data-alarm-skip>Пропущен один сигнал: {new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:device.alarmTimeZone}).format(device.skippedAlarmAt)}</span><button disabled={disabled} onClick={()=>void onSkip(true)}>Отменить пропуск</button></>:<button disabled={disabled} onClick={()=>void onSkip(false)}>Пропустить ближайший сигнал</button>}
    </>}
  </div></aside>;
}

function AlarmScreenAccess({device,onRequest,compact=false}:{device:DeviceStatus;onRequest:()=>void;compact?:boolean}){
  if(!device.native||device.fullScreen!==false)return null;
  return <aside className={styles.alarmScreenAccess} data-alarm-screen="notification"><strong>Полноэкранный показ выключен</strong><p>{compact?'Нажми уведомление «Пора вставать» и удерживай «Проснуться» 3 секунды.':'Нажми «Открыть будильник» в уведомлении «Пора вставать», затем удерживай «Проснуться» 3 секунды. Чтобы экран появлялся поверх блокировки, разреши полноэкранный показ в Android.'}</p><button type="button" className={styles.secondary} onClick={onRequest}>{compact?'Настроить показ':'Настроить полноэкранный показ'} <ChevronRight size={16}/></button></aside>;
}


function ReminderSchedule({device,demo,onPermission}:{device:DeviceStatus;demo:boolean;onPermission:()=>void}){
 const view=reminderScheduleView(device,demo);return <aside className={styles.alarmSchedule} data-reminder-schedule={view.state} aria-live="polite"><Bell size={17}/><div><strong>{view.title}</strong>{view.at?<><time dateTime={new Date(view.at).toISOString()}>{view.detail}</time><span>Примерное время. Уведомление не включает будильник.</span></>:<span>{view.detail}</span>}{view.state==='permission_required'&&<button type="button" onClick={onPermission}>Разрешить напоминания</button>}</div></aside>;
}

function MorningFieldError({field,errors}:{field:DurationField;errors:DurationErrors}){return errors[field]?<span id={`morning-${field}-error`} className={styles.fieldError}>{errors[field]}</span>:null;}

function HistoricalTime({night}:{night:Night}){const t=historyTimeContext(night);return <details className={styles.historyContext} data-history-time><summary>Время и часовой пояс</summary><p>Лёг: <time>{t.bed}</time></p><p>Проснулся: <time>{t.wake}</time></p><p>Дата в журнале — дата подъёма в указанном смещении UTC. {t.inferred?'В старой записи смещения восстановлены из сохранённых дат и времени.':'Показано исходное время, независимо от сегодняшнего часового пояса.'}</p></details>;}
function GrowthRules({target,active,collapsible=false}:{target:Schedule;active:boolean;collapsible?:boolean}){
  const rule=REWARD_RULES.v1,content=<>
    <p className={styles.fine} data-growth-source={active?'active':'schedule'}>{active?'Цель начатой ночи':'Текущий режим'}. Для записанных ночей действуют сохранённые цели.</p>
    <dl className={styles.durationValues}><div><dt>Отбой</dt><dd data-growth-value="bed">{target.bed}</dd></div><div><dt>Подъём</dt><dd data-growth-value="wake">{target.wake}</dd></div><div><dt>Допуск к обоим часам</dt><dd data-growth-value="tolerance">±{target.tolerance} мин</dd></div><div><dt>Минимум сна</dt><dd data-growth-value="minimum">{minutesLabel(target.hours*60-rule.durationGraceMinutes)}</dd></div></dl>
    <p data-growth-conditions>Успешная ночь выполняет все три условия: отбой и подъём отклоняются от цели не больше чем на {target.tolerance} мин каждый; указанный сон не меньше {minutesLabel(target.hours*60-rule.durationGraceMinutes)}. Порог сна — цель минус {rule.durationGraceMinutes} мин. Граница допуска и ровно минимальная длительность засчитываются.</p>
    <p data-growth-floor>{GROWTH_RULES.nightsPerFloor} успешных ночей суммарно дают этаж. Подряд не обязательно.</p>
    <p data-growth-garden>{GROWTH_RULES.gardenStreak} успешных ночей подряд по календарным датам открывают сад. Пропуск прерывает серию, но не отнимает заработанные этажи и открытый сад.</p>
    <p className={styles.fine} data-growth-mood>Самочувствие 1–5 не влияет на успешность ночи, этажи или сад.</p>
  </>;
  return collapsible?<details className={styles.card} data-growth-rules="sleep"><summary>Как заработать этаж и сад</summary>{content}</details>:<section className={styles.card} aria-label="Правила роста башни" data-growth-rules="tower"><h2>Как растёт башня</h2>{content}</section>;
}

function HistoricalGoal({night,credited}:{night:Night;credited:boolean}){const rule=rewardRuleFor(night),checks=nightChecks(night);return <details className={styles.card} data-historical-goal data-reward-rule={night.rewardRule??'legacy-v1'}><summary>Цель и награда этой ночи</summary><div className={styles.metricGrid}><Metric label="Отбой → подъём" value={`${night.target.bed} → ${night.target.wake}`}/><Metric label="Цель сна этой ночи" value={minutesLabel(night.target.hours*60)}/><Metric label="Допуск по времени" value={`±${night.target.tolerance} мин`}/><Metric label="Сон для награды" value={`от ${minutesLabel(night.target.hours*60-rule.durationGraceMinutes)}`}/></div><p className={styles.fine}>Для успешной ночи нужны все три условия: отбой и подъём в пределах допуска, сон не короче указанного порога. {rule.nightsPerFloor} успешных ночей — этаж; одна дата учитывается один раз.</p><ul className={styles.historyChecks}><li>Отбой: {checks.bed?'в пределах допуска':'за пределами допуска'}</li><li>Подъём: {checks.wake?'в пределах допуска':'за пределами допуска'}</li><li>Длительность: {checks.duration?'достаточно':'меньше порога'}</li></ul><p className={styles.fine}>{credited?'Награда за эту дату уже учтена. Исправление записи не отнимает построенное и не даёт повторную награду.':'Награда за эту дату не начислена.'} Смена сегодняшнего режима не меняет эту цель.{night.rewardRule===undefined?' Для старой записи действует исходное правило награды.':''}</p></details>;}
