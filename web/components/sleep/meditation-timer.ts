export type MeditationMinutes=5|10|12|15|20;
export type MeditationSession={started:number;minutes:MeditationMinutes};
/** The clock is wall time so throttled WebView intervals don't shorten a session. */
export function meditationRemaining(session:MeditationSession,now:number){
 if(!Number.isFinite(now)||!Number.isFinite(session.started)||now<session.started||![5,10,12,15,20].includes(session.minutes))throw Error('Время изменилось. Начни сеанс заново.');
 return Math.max(0,session.minutes*60000-(now-session.started));
}
export function meditationClock(ms:number){const seconds=Math.ceil(Math.max(0,ms)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
