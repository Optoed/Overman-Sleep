/** Genuine browser UI -> loopback Go -> isolated PostgreSQL18 QA only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {freshSleep,SLEEP_KEY} from '../../web/components/sleep/sleep-state';
import {importHealthNight} from '../../web/components/sleep/sleep-health-import';
import {readBackup} from '../../web/components/sleep/sleep-insights';
const {chromium}=createRequire(import.meta.url)('playwright');
const {Client}=createRequire(new URL('../package.json',import.meta.url))('pg');
const qa=resolve('.tools/pg-fractional-qa'),meta=JSON.parse(await readFile(resolve(qa,'test-metadata.json'),'utf8'));
assert.equal(meta.kind,'overman-isolated-postgres-qa');assert.equal(meta.port,55437);assert.match(meta.database,/^overman_fractional_qa_[a-f0-9]{12}$/);
const db=new Client({host:'127.0.0.1',port:55437,database:meta.database,user:'overman_qa_admin',password:'public-qa-placeholder-unused-with-trust',ssl:false});await db.connect();
assert.equal((await db.query('show data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase(),resolve(qa,'data').replaceAll('\\','/').toLowerCase());
const bed=Date.UTC(2026,0,2,23),wake=bed+510*60000+1;
const initial={...importHealthNight(freshSleep(),[{start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]}],0,{bed:0,wake:0},4,wake+60000),configured:true};
const login='ui_'+randomUUID().replaceAll('-','').slice(0,20),password=randomBytes(32).toString('base64url');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:430,height:930},timezoneId:'UTC',acceptDownloads:true});
const page=await context.newPage(),checks:{name:string;status:'passed'}[]=[],errors:string[]=[],requests:{method:string;path:string;status:number}[]=[];
const pass=(name:string)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
page.on('pageerror',(e:Error)=>errors.push(e.name));
page.on('response',(r:any)=>{const u=new URL(r.url());if(u.origin==='http://127.0.0.1:3902')requests.push({method:r.request().method(),path:u.pathname,status:r.status()});});
const panel=page.getByRole('region',{name:'Аккаунт и копия на сервере'});
async function approve(){await panel.getByLabel('Применить это сравнение').check();await panel.getByRole('button',{name:'Применить сравнение',exact:true}).click();await panel.getByRole('button',{name:'Применить сравнение',exact:true}).waitFor({state:'hidden'});}
async function archive(){return page.evaluate((key:string)=>JSON.parse(localStorage.getItem(key)!),SLEEP_KEY);}
async function rewards(){return (await db.query('select count(*)::int n from public.sleep_reward_dates where user_id=(select user_id from overman.credentials where login=$1)',[login])).rows[0].n;}
try{
 await page.goto('http://127.0.0.1:3001/');await page.evaluate(({key,raw}:{key:string;raw:string})=>localStorage.setItem(key,raw),{key:SLEEP_KEY,raw:JSON.stringify(initial)});await page.reload();
 await page.getByRole('button',{name:'Профиль',exact:true}).click();await panel.getByLabel('Адрес своего сервера').fill('http://127.0.0.1:3902');await panel.getByRole('button',{name:'Выбрать сервер',exact:true}).click();
 await panel.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await panel.getByLabel('Логин аккаунта').fill(login);await panel.getByLabel('Пароль аккаунта').fill(password);await panel.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
 await panel.getByText('Вход выполнен. Сначала сравни записи.',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Пароль аккаунта').count(),0);
 await panel.getByRole('button',{name:'Сравнить записи',exact:true}).click();await approve();await panel.getByText('Ожидают отправки: 1',{exact:true}).waitFor();assert.equal(await rewards(),0);
 pass('Actual isolated browser registers through Go and explicitly reviews one exact fractional Health Connect night before upload');
 const operationRequests=()=>requests.filter(r=>r.method==='POST'&&r.path==='/v1/diary/operations');
 const before=operationRequests().length;
 // Two synchronous DOM clicks exercise the real application's operation gate;
 // no HTTP response, storage bridge, account or server is mocked.
 await panel.getByRole('button',{name:/^Отправить следующую запись/}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
 await panel.getByRole('heading',{name:'Ответ после отправки',exact:true}).waitFor();assert.equal(operationRequests().length-before,1);assert.equal(operationRequests().at(-1)!.status,200);assert.equal(await rewards(),1);
 await panel.getByText('Ожидают отправки: 1',{exact:true}).waitFor();await approve();await panel.getByText('Ожидают отправки: 0',{exact:true}).waitFor();assert.equal((await archive()).nights[0].sleepMinutes,initial.nights[0].sleepMinutes);
 pass('Double DOM click sends one real operation; receipt stays pending until explicit approval and exactly one PostgreSQL reward remains');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать мои записи',exact:true}).click();const download=await downloaded,stream=await download.createReadStream(),chunks=[];
 for await(const chunk of stream)chunks.push(chunk);const backup=Buffer.concat(chunks),parsed=readBackup(backup.toString());assert.ok(!backup.includes(Buffer.from(password)));assert.ok(!backup.includes(Buffer.from('_sleepSync')));assert.deepEqual(parsed.credits,initial.credits);
 await page.getByLabel('Файл резервной копии',{exact:true}).setInputFiles({name:'synthetic-fractional-qa.json',mimeType:'application/json',buffer:backup});
 await panel.getByLabel('Заменить записи и остановить прежние отправки').check();await panel.getByRole('button',{name:'Начать восстановление копии',exact:true}).click();await panel.getByRole('heading',{name:'Сравнение восстановления',exact:true}).waitFor();await approve();
 await panel.getByText('Ожидают отправки: 0',{exact:true}).waitFor();assert.equal(await rewards(),1);assert.equal((await archive()).credits.length,1);assert.equal((await archive()).nights.length,1);
 pass('Browser downloads real secret-free backup and restores it through linked real-network import/review without duplicate reward');
 await page.reload();await page.getByRole('button',{name:'Профиль',exact:true}).click();await panel.getByRole('button',{name:'Выбрать сервер',exact:true}).click();await panel.getByLabel('Логин аккаунта').fill(login);await panel.getByLabel('Пароль аккаунта').fill(password);await panel.getByRole('button',{name:'Войти',exact:true}).click();await panel.getByText('Вход выполнен. Сначала сравни записи.',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Сравнить записи',exact:true}).click();await approve();await panel.getByText('Ожидают отправки: 0',{exact:true}).waitFor();assert.equal(await rewards(),1);
 const final=await archive();assert.equal(final.credits.length,1);assert.equal(final.nights[0].sleepMinutes,initial.nights[0].sleepMinutes);assert.ok(!JSON.stringify(final).includes(password));assert.equal(errors.length,0);assert.ok(requests.every(r=>r.status<400));
 await panel.scrollIntoViewIfNeeded();assert.equal(await page.locator('input[type=password]:visible').count(),0);await page.screenshot({path:'docs/product-evidence/05.02-real-browser-20261113.png',fullPage:false});
 pass('Cold page restart requires fresh login, retains exact duration/one earned date/empty queue and produces no page or API errors');
 await writeFile('docs/product-evidence/05.02-real-browser-20261113.json',JSON.stringify({requirementId:'05.02',result:'partial',verifiedAt:new Date().toISOString(),checks,apiRequests:requests,source:'current localhost3001 product UI with new isolated Go/PostgreSQL18.7 database',backupSha256:createHash('sha256').update(backup).digest('hex'),rewardDates:await rewards(),limitations:['Synthetic fixture; DOM double click explicitly simulated. Other interactions use Playwright browser UI.','Loopback HTTP permitted by desktop product policy; installed APK HTTPS and physical phone not covered.','No personal storage/browser profile, production endpoint, notifications or real sensor claims.']},null,2)+'\n');
}finally{await context.close();await browser.close();await db.end();}
