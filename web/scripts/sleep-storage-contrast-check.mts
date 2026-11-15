import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';import {APPEARANCES} from '../components/sleep/sleep-themes';
const [base,fixtureDir,outDir]=process.argv.slice(2);assert(base&&fixtureDir&&outDir);assert.equal(new URL(base).hostname,'127.0.0.1');
const fixture=JSON.parse(await readFile(resolve(fixtureDir,'v5.json'),'utf8')),key='overman.sleep-tower.v1',checks=[];
const {chromium}=createRequire(import.meta.url)(process.env.ROOM_PLAYWRIGHT_PACKAGE||'playwright'),browser=await chromium.launch({channel:'msedge',headless:true});
const luminance=(color:string)=>{const c=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
try{for(const appearance of APPEARANCES)for(const hour of [12,23]){
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'UTC'}),page=await context.newPage(),errors:string[]=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));const initial={...fixture,appearance:appearance.id,appearanceMode:'auto'};
  await context.addInitScript({content:`if(localStorage.getItem('${key}')===null)localStorage.setItem('${key}',${JSON.stringify(JSON.stringify(initial))});`});await page.clock.install({time:`2026-11-13T${hour}:00:00Z`});await page.goto(base);
  await page.getByRole('navigation').getByRole('button',{name:'Профиль',exact:true}).click();
  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw:JSON.stringify({...initial,schedule:{...initial.schedule,bed:'22:50'}})});
  await page.getByRole('button',{name:'Темы оформления',exact:true}).click();await page.locator(`input[name=appearance][value=${appearance.id==='journal'?'morning':'journal'}]`).click();await page.getByRole('button',{name:'Готово',exact:true}).click();
  const alert=page.getByRole('alert').filter({hasText:'Записи изменились в другом окне'});await alert.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='alert');const box=await alert.boundingBox();if(!(box&&box.y>=0&&box.y+box.height<=844)){console.error(JSON.stringify({appearance:appearance.id,hour,box,active:await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,160))}));await page.screenshot({path:resolve(outDir,'focus-diagnostic.png')});}assert(box&&box.y>=0&&box.y+box.height<=844,'Failure message must be inside the viewport after dialog close');
  const colors=await alert.evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,link:getComputedStyle(el.querySelector('button')!).color}));
  const bg=luminance(colors.background),contrast=(c:string)=>{const fg=luminance(c);return(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);};
  const text=contrast(colors.text),link=contrast(colors.link);assert(text>=4.5&&link>=4.5,`${appearance.id}/${hour}: unreadable failure message ${text}/${link}`);assert.deepEqual(errors,[]);
  if(appearance.id==='night')await page.screenshot({path:resolve(outDir,`error-contrast-${hour}.png`)});
  checks.push({name:`${appearance.id}/${hour}: actual refused save message and original-download link visible`,status:'passed',textContrast:text,linkContrast:link,colors});
 }finally{await context.close();}
}}finally{await browser.close();}
await writeFile(resolve(outDir,'error-contrast.json'),JSON.stringify({requirementId:'01.09',result:'passed',verifiedAt:new Date().toISOString(),checks,limits:'Contrast of actual storage-failure banner/link only, not an accessibility certification of every screen.'},null,2));console.log(JSON.stringify({result:'passed',palettes:checks.length,minContrast:Math.min(...checks.map(c=>c.textContrast))}));
