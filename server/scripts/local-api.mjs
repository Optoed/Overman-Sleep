import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Local development only. Credentials are never printed or passed on a command line.
const root=fileURLToPath(new URL('../../',import.meta.url));
const name='overman-api-dev', db='overman-postgres-dev', network='overman-dev-net';
function docker(args, optional=false){
  const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});
  if(r.status!==0&&!optional)throw Error('Local Docker operation failed; existing data preserved');
  return r.stdout?.trim();
}
function label(kind, target){return docker([kind,'inspect','--format','{{index .Labels "app.overman.role"}}',target],true);}
if(docker(['inspect','--format','{{index .Config.Labels "app.overman.role"}}',db])!=='dev-db')throw Error('Expected dedicated Overman database');
if(docker(['network','ls','--filter','name=^'+network+'$','--format','{{.Name}}'])){
  if(label('network',network)!=='dev-network')throw Error('Refusing foreign network');
}else docker(['network','create','--label','app.overman.role=dev-network',network]);
const networks=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Networks}}',db]));
if(!networks[network])docker(['network','connect',network,db]);
const c=JSON.parse(readFileSync(root+'.tools/overman-postgres-dev.json','utf8'));
const config=root+'.tools/overman-api-docker.json';
writeFileSync(config,JSON.stringify({host:db,port:5432,database:c.database,runtimeUser:c.runtimeUser,runtimePassword:c.runtimePassword}),{mode:0o600});
if(docker(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],true)){
  if(docker(['inspect','--format','{{index .Config.Labels "app.overman.role"}}',name])!=='dev-api')throw Error('Refusing foreign container');
  const actual=docker(['inspect','--format','{{.Image}}',name]);
  if(actual!==docker(['image','inspect','--format','{{.Id}}','overman-api:dev']))throw Error('API image changed; existing container preserved for explicit replacement');
  docker(['start',name]);
}else docker(['run','-d','--name',name,'--label','app.overman.role=dev-api','--network',network,
  '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--restart','unless-stopped',
  '-p','127.0.0.1:3902:8080','--mount',`type=bind,source=${config},target=/run/config.json,readonly`,
  'overman-api:dev','-config','/run/config.json','-listen','0.0.0.0:8080']);
for(let i=0;i<40;i++){
  try{if((await fetch('http://127.0.0.1:3902/health')).ok){console.log('Overman Go API ready on loopback port 3902; own PostgreSQL network, non-root read-only container.');process.exit(0);}}catch{}
  await new Promise(r=>setTimeout(r,250));
}
throw Error('API not ready; containers and database volume preserved');
