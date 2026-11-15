/** Non-blocking GPU timer. Unavailable/disjoint measurements are never reported
 * as zero. Polling only reads completed queries; it never waits for the GPU. */
export function frameTiming(context:WebGL2RenderingContext|WebGLRenderingContext,reflections=true){
  const gl='beginQuery' in context?context:null;
  const extension=(gl?.getExtension('EXT_disjoint_timer_query_webgl2')??null) as {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null;
  type Scope='frame'|'reflection'|'bloom'|'shadows';
  let pending:WebGLQuery|null=null,recording:Scope|null=null,pendingScope:Scope='frame',nextScope:Scope='frame',ticks=0,nextAt=0,samples=0;
  const last:Record<Scope,number|null>={frame:null,reflection:null,bloom:null,shadows:null};
  const history:Record<Scope,number[]>={frame:[],reflection:[],bloom:[],shadows:[]};
  return {
    begin(scope:Scope='frame'){
      if(!extension||!gl)return;
      if(scope==='frame')ticks++;
      if(scope==='frame'&&nextScope!=='frame'&&ticks>nextAt+16)nextScope='frame';
      if(recording)return;
      if(pending&&gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE)){
        last[pendingScope]=gl.getParameter(extension.GPU_DISJOINT_EXT)?null:gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6;
        const value=last[pendingScope];
        if(value!==null&&Number.isFinite(value)&&value>=0){const values=history[pendingScope];values.push(value);if(values.length>16)values.shift();}
        gl.deleteQuery(pending);pending=null;
      }
      if(!pending&&scope===nextScope&&ticks>=nextAt){pending=gl.createQuery();if(pending){gl.beginQuery(extension.TIME_ELAPSED_EXT,pending);recording=scope;pendingScope=scope;nextScope=reflections?(scope==='frame'?'reflection':scope==='reflection'?'bloom':scope==='bloom'?'shadows':'frame'):'frame';nextAt=ticks+7+(samples++%3);}}
    },
    end(scope:Scope='frame'){if(recording===scope&&extension&&gl){gl.endQuery(extension.TIME_ELAPSED_EXT);recording=null;}},
    milliseconds(scope:Scope='frame'){return last[scope];},
    summary(scope:Scope='frame'){
      const values=history[scope];
      return values.length?{samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values)}:null;
    },
    dispose(){if(pending)gl?.deleteQuery(pending);pending=null;},
  };
}
