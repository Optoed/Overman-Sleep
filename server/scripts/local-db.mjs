import{randomBytes}from'node:crypto';import{existsSync,mkdirSync,writeFileSync,readFileSync}from'node:fs';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=root+'.tools/',config=dir+'overman-postgres-dev.json',env=dir+'overman-postgres-dev.env';
const name='overman-postgres-dev',volume='overman-postgres-dev-data';
function docker(args,allowFailure=false){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});if(r.status!==0&&!allowFailure)throw Error('Docker operation failed: '+(r.stderr||'').slice(0,400));return r;}
const existing=docker(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],true).stdout?.trim();
if(existing){const label=docker(['inspect','--format','{{index .Config.Labels "app.overman.role"}}',name]).stdout.trim();
  if(label!=='dev-db'||!existsSync(config))throw Error('Existing container/config not owned by this setup');
  docker(['start',name]);
}else{
  if(existsSync(config)||existsSync(env))throw Error('Existing local credentials preserved; inspect setup state before creating a new database');
  const prior=docker(['volume','inspect',volume],true);if(prior.status===0)throw Error('Existing volume preserved; refusing to initialize over it');
  mkdirSync(dir,{recursive:true});const password=randomBytes(32).toString('base64url'),runtimePassword=randomBytes(32).toString('base64url');
  writeFileSync(config,JSON.stringify({host:'127.0.0.1',port:15436,database:'overman',user:'postgres',password,runtimeUser:'overman_runtime',runtimePassword},null,2),{flag:'wx',mode:0o600});
  writeFileSync(env,`POSTGRES_DB=overman\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_HOST_AUTH_METHOD=scram-sha-256\n`,{flag:'wx',mode:0o600});
  docker(['volume','create','--label','app.overman.role=dev-db',volume]);
  docker(['run','-d','--name',name,'--label','app.overman.role=dev-db','--restart','unless-stopped',
    '-p','127.0.0.1:15436:5432','--env-file',env,'--mount',`type=volume,source=${volume},target=/var/lib/postgresql`,
    'postgres@sha256:123b17998ccaf47e53b502e8c6a1e79afd8f579c6f3eec83c563da026f957395']);
}
for(let i=0;i<40;i++){if(docker(['exec',name,'pg_isready','-U','postgres','-d','overman'],true).status===0){console.log('Dedicated Overman PostgreSQL ready on loopback port 15436; persistent volume retained.');process.exit(0);}await new Promise(r=>setTimeout(r,500));}
throw Error('Database not ready; container and volume preserved for diagnosis');
