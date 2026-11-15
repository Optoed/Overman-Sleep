/** Archived cabinet stays usable as a local demo. Hosted backend is disabled.
 * The new Go/PostgreSQL API is separate; SleepApp integration is still pending.
 */
export type User={id:string;email?:string};
type Result={error:Error|null;data:{session:{user:User}|null}};
type LegacyBackend={
  rpc:(name:string,args:Record<string,unknown>)=>Promise<{error:Error|null}>;
  auth:{
    onAuthStateChange:(callback:(event:string,session:{user:User}|null)=>void)=>{data:{subscription:{unsubscribe:()=>void}}};
    signOut:()=>Promise<{error:Error|null}>;
    signUp:(input:unknown)=>Promise<Result>;
    signInWithPassword:(input:unknown)=>Promise<Result>;
  };
};
function disabled():LegacyBackend|null{return null;}
export const legacyBackend=disabled();
export const isConfigured=false;
