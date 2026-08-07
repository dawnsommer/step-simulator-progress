(function(){
  'use strict';
  const R=window.StepProgressSync, U=R.util;
  const MISSING=Symbol('missing');
  const eq=(a,b)=> a===MISSING&&b===MISSING ? true : (a===MISSING||b===MISSING ? false : U.stable(a)===U.stable(b));
  const canon=v=>U.stable(v);

  function conflictPick(local,remote,ctx){
    const lt=Number(ctx.localModified)||0, rt=Number(ctx.remoteModified)||0;
    if(lt!==rt) return lt>rt ? U.clone(local) : U.clone(remote);
    const ld=String(ctx.localDevice||''), rd=String(ctx.remoteDevice||'');
    return ld>=rd ? U.clone(local) : U.clone(remote);
  }
  function isSetArray(path){
    const p=path.join('.');
    return /HighlightAnchors/i.test(p) || /\.struck(?:\.|$)/.test(p) || /\.qbankKeysSet(?:\.|$)/.test(p);
  }
  function isUnionLog(path){ return /(?:^|\.)(answerChangeLog)$/.test(path.join('.')); }
  function keyedArrayKey(path,arr){
    const last=String(path[path.length-1]||'');
    if(last==='attempts' && arr.some(x=>x&&typeof x==='object')) return x=>String(x&&x.attemptId||'');
    if(last==='sessions' && arr.some(x=>x&&typeof x==='object'&&(x.qbankTestId||x.attemptId))) return x=>String(x&&(x.qbankTestId||x.attemptId)||'');
    return null;
  }
  function mergeSet(base,local,remote){
    const b=new Map((base===MISSING?[]:base||[]).map(v=>[canon(v),v]));
    const l=new Map((local===MISSING?[]:local||[]).map(v=>[canon(v),v]));
    const r=new Map((remote===MISSING?[]:remote||[]).map(v=>[canon(v),v]));
    const keys=new Set([...b.keys(),...l.keys(),...r.keys()]); const out=[];
    [...keys].sort().forEach(k=>{
      const bm=b.has(k), lm=l.has(k), rm=r.has(k); let keep;
      if(lm===rm) keep=lm;
      else if(lm===bm) keep=rm;
      else if(rm===bm) keep=lm;
      else keep=lm||rm;
      if(keep) out.push((l.get(k)??r.get(k)??b.get(k)));
    });
    return U.clone(out);
  }
  function mergeUnion(local,remote){
    const out=[],seen=new Set();
    for(const v of [...(Array.isArray(local)?local:[]),...(Array.isArray(remote)?remote:[])]){ const k=canon(v); if(!seen.has(k)){seen.add(k);out.push(U.clone(v));} }
    return out;
  }
  function mergeKeyedArray(base,local,remote,ctx,path,keyFn){
    const ba=base===MISSING?[]:base||[], la=local===MISSING?[]:local||[], ra=remote===MISSING?[]:remote||[];
    const bm=new Map(ba.map(x=>[keyFn(x),x]).filter(x=>x[0])), lm=new Map(la.map(x=>[keyFn(x),x]).filter(x=>x[0])), rm=new Map(ra.map(x=>[keyFn(x),x]).filter(x=>x[0]));
    const order=[]; for(const a of [ba,la,ra]) for(const x of a){const k=keyFn(x);if(k&&!order.includes(k))order.push(k);}
    const out=[];
    for(const k of order){ const v=deepMerge(bm.has(k)?bm.get(k):MISSING,lm.has(k)?lm.get(k):MISSING,rm.has(k)?rm.get(k):MISSING,ctx,path.concat(k)); if(v!==MISSING) out.push(v); }
    return out;
  }
  function deepMerge(base,local,remote,ctx,path=[]){
    if(eq(local,remote)) return local===MISSING?MISSING:U.clone(local);
    if(eq(local,base)) return remote===MISSING?MISSING:U.clone(remote);
    if(eq(remote,base)) return local===MISSING?MISSING:U.clone(local);
    if(local===MISSING || remote===MISSING){
      if(base===MISSING) return local===MISSING?U.clone(remote):U.clone(local);
      return conflictPick(local,remote,ctx);
    }
    if(Array.isArray(local)&&Array.isArray(remote)&&(base===MISSING||Array.isArray(base))){
      if(isUnionLog(path)) return mergeUnion(local,remote);
      if(isSetArray(path)) return mergeSet(base,local,remote);
      const keyFn=keyedArrayKey(path,[...local,...remote]);
      if(keyFn) return mergeKeyedArray(base,local,remote,ctx,path,keyFn);
      const b=base===MISSING?[]:base, n=Math.max(b.length,local.length,remote.length), out=[];
      for(let i=0;i<n;i++){ const v=deepMerge(i<b.length?b[i]:MISSING,i<local.length?local[i]:MISSING,i<remote.length?remote[i]:MISSING,ctx,path.concat(i)); if(v!==MISSING) out[i]=v; }
      while(out.length && out[out.length-1]===undefined) out.pop(); return out;
    }
    if(U.isObj(local)&&U.isObj(remote)&&(base===MISSING||U.isObj(base))){
      const b=base===MISSING?{}:base, out={}, keys=new Set([...Object.keys(b),...Object.keys(local),...Object.keys(remote)]);
      for(const k of [...keys].sort()){
        const v=deepMerge(Object.prototype.hasOwnProperty.call(b,k)?b[k]:MISSING,Object.prototype.hasOwnProperty.call(local,k)?local[k]:MISSING,Object.prototype.hasOwnProperty.call(remote,k)?remote[k]:MISSING,ctx,path.concat(k));
        if(v!==MISSING) out[k]=v;
      }
      return out;
    }
    return conflictPick(local,remote,ctx);
  }

  function emptyCloud(deviceId=''){
    return {type:R.config.CLOUD_TYPE,schemaVersion:R.config.SCHEMA_VERSION,generatedAt:U.iso(),deviceId,build:R.config.BUILD,forms:{},qbank:null,tombstones:{forms:{},qbank:null},syncMetadata:{}};
  }
  function validateCloud(s){
    if(!s || typeof s!=='object') throw new Error('Remote sync snapshot is not an object.');
    if(s.type!==R.config.CLOUD_TYPE) throw new Error(`Remote sync type is invalid (${String(s.type||'missing')}).`);
    if(Number(s.schemaVersion)!==R.config.SCHEMA_VERSION) throw new Error(`Unsupported sync schemaVersion ${String(s.schemaVersion)}.`);
    if(!U.isObj(s.forms)) s.forms={};
    if(!U.isObj(s.tombstones)) s.tombstones={forms:{},qbank:null};
    if(!U.isObj(s.tombstones.forms)) s.tombstones.forms={};
    return s;
  }
  function stateFor(cloud,key){
    if(cloud?.tombstones?.forms && cloud.tombstones.forms[key]) return {deleted:true,meta:cloud.tombstones.forms[key]};
    if(cloud?.forms && cloud.forms[key]) return {deleted:false,value:cloud.forms[key]};
    return MISSING;
  }
  function stateModified(state){
    if(state===MISSING) return 0;
    return U.validDate(state.deleted?state.meta?.deletedAt:state.value?.modifiedAt);
  }
  function stateDevice(state,cloud){
    if(state===MISSING) return '';
    return String(state.deleted?state.meta?.deviceId:(state.value?.deviceId||cloud?.deviceId||''));
  }
  function mergeState(baseState,localState,remoteState,baseCloud,localDevice,remoteCloud){
    const ctx={localModified:stateModified(localState),remoteModified:stateModified(remoteState),localDevice:stateDevice(localState,{deviceId:localDevice}),remoteDevice:stateDevice(remoteState,remoteCloud)};
    const content=st=>{
      if(st===MISSING || st.deleted) return MISSING;
      const v=U.clone(st.value); if(v&&typeof v==='object'){delete v.modifiedAt;delete v.deviceId;} return v;
    };
    if(localState!==MISSING && localState.deleted && remoteState!==MISSING && !remoteState.deleted && baseState!==MISSING && !baseState.deleted){
      if(eq(content(remoteState),content(baseState))) return localState;
      return stateModified(localState)>=stateModified(remoteState)?localState:remoteState;
    }
    if(remoteState!==MISSING && remoteState.deleted && localState!==MISSING && !localState.deleted && baseState!==MISSING && !baseState.deleted){
      if(eq(content(localState),content(baseState))) return remoteState;
      return stateModified(remoteState)>=stateModified(localState)?remoteState:localState;
    }
    if((localState===MISSING||!localState.deleted) && (remoteState===MISSING||!remoteState.deleted) && (baseState===MISSING||!baseState.deleted)){
      const merged=deepMerge(content(baseState),content(localState),content(remoteState),ctx,[]);
      if(merged===MISSING) return MISSING;
      const lt=stateModified(localState),rt=stateModified(remoteState); merged.modifiedAt=new Date(Math.max(lt,rt,Date.now()*(lt===0&&rt===0))).toISOString();
      merged.deviceId = lt>rt ? stateDevice(localState,{deviceId:localDevice}) : (rt>lt ? stateDevice(remoteState,remoteCloud) : (String(stateDevice(localState,{deviceId:localDevice}))>=String(stateDevice(remoteState,remoteCloud))?stateDevice(localState,{deviceId:localDevice}):stateDevice(remoteState,remoteCloud)));
      return {deleted:false,value:merged};
    }
    const b=baseState===MISSING?MISSING:(baseState.deleted?{__deleted:true,...baseState.meta}:baseState.value);
    const l=localState===MISSING?MISSING:(localState.deleted?{__deleted:true,...localState.meta}:localState.value);
    const r=remoteState===MISSING?MISSING:(remoteState.deleted?{__deleted:true,...remoteState.meta}:remoteState.value);
    const merged=deepMerge(b,l,r,ctx,[]);
    if(merged===MISSING) return MISSING;
    if(merged && merged.__deleted){ const m=U.clone(merged); delete m.__deleted; return {deleted:true,meta:m}; }
    return {deleted:false,value:merged};
  }

  function mergeCloud(baseCloud,localState,remoteCloud,deviceId){
    baseCloud=baseCloud?validateCloud(U.clone(baseCloud)):emptyCloud('');
    remoteCloud=remoteCloud?validateCloud(U.clone(remoteCloud)):emptyCloud('');
    const out=emptyCloud(deviceId); out.generatedAt=U.iso();
    const localForms=localState.forms||{}, localTombs=(localState.tombstones&&localState.tombstones.forms)||{}, loaded=new Set(localState.loadedKeys||[]);
    const keys=new Set([...Object.keys(baseCloud.forms||{}),...Object.keys(baseCloud.tombstones?.forms||{}),...Object.keys(remoteCloud.forms||{}),...Object.keys(remoteCloud.tombstones?.forms||{}),...Object.keys(localForms)]);
    for(const key of [...keys].sort()){
      const b=stateFor(baseCloud,key), r=stateFor(remoteCloud,key);
      let l;
      if(Object.prototype.hasOwnProperty.call(localForms,key)) l={deleted:false,value:localForms[key]};
      else if(Object.prototype.hasOwnProperty.call(localTombs,key)) l={deleted:true,meta:localTombs[key]};
      else l=b; // Missing progress is not inferred as deletion; only an explicit local tombstone can delete cloud progress.
      const m=mergeState(b,l,r,baseCloud,deviceId,remoteCloud);
      if(m===MISSING) continue;
      if(m.deleted) out.tombstones.forms[key]=m.meta; else out.forms[key]=m.value;
    }
    // Qbank uses the same three-way logic, but it is always locally addressable.
    const bq=baseCloud.tombstones?.qbank?{deleted:true,meta:baseCloud.tombstones.qbank}:(baseCloud.qbank?{deleted:false,value:baseCloud.qbank}:MISSING);
    const rq=remoteCloud.tombstones?.qbank?{deleted:true,meta:remoteCloud.tombstones.qbank}:(remoteCloud.qbank?{deleted:false,value:remoteCloud.qbank}:MISSING);
    let lq;
    if(localState.qbank) lq={deleted:false,value:localState.qbank};
    else if(localState.tombstones?.qbank) lq={deleted:true,meta:localState.tombstones.qbank}; else lq=bq;
    const mq=mergeState(bq,lq,rq,baseCloud,deviceId,remoteCloud);
    if(mq!==MISSING){ if(mq.deleted) out.tombstones.qbank=mq.meta; else out.qbank=mq.value; }
    out.syncMetadata={lastMergeAt:out.generatedAt,sourceBuild:R.config.BUILD};
    return out;
  }

  function combineRemote(a,b){
    if(!a) return validateCloud(U.clone(b)); if(!b) return validateCloud(U.clone(a));
    a=validateCloud(U.clone(a)); b=validateCloud(U.clone(b)); const out=emptyCloud(String(b.deviceId||a.deviceId||''));
    const keys=new Set([...Object.keys(a.forms||{}),...Object.keys(a.tombstones?.forms||{}),...Object.keys(b.forms||{}),...Object.keys(b.tombstones?.forms||{})]);
    for(const key of [...keys].sort()){
      const sa=stateFor(a,key), sb=stateFor(b,key); let pick;
      if(sa===MISSING) pick=sb; else if(sb===MISSING) pick=sa;
      else if(sa.deleted||sb.deleted){
        if(sa.deleted&&sb.deleted) pick=stateModified(sa)>=stateModified(sb)?sa:sb;
        else pick=stateModified(sa)>=stateModified(sb)?sa:sb;
      }else{
        const ctx={localModified:stateModified(sa),remoteModified:stateModified(sb),localDevice:stateDevice(sa,a),remoteDevice:stateDevice(sb,b)};
        pick={deleted:false,value:deepMerge(MISSING,sa.value,sb.value,ctx,[])};
      }
      if(pick!==MISSING){ if(pick.deleted) out.tombstones.forms[key]=U.clone(pick.meta); else out.forms[key]=U.clone(pick.value); }
    }
    const aq=a.tombstones?.qbank?{deleted:true,meta:a.tombstones.qbank}:(a.qbank?{deleted:false,value:a.qbank}:MISSING);
    const bq=b.tombstones?.qbank?{deleted:true,meta:b.tombstones.qbank}:(b.qbank?{deleted:false,value:b.qbank}:MISSING);
    if(aq===MISSING) { if(bq!==MISSING){if(bq.deleted)out.tombstones.qbank=U.clone(bq.meta);else out.qbank=U.clone(bq.value);} }
    else if(bq===MISSING){if(aq.deleted)out.tombstones.qbank=U.clone(aq.meta);else out.qbank=U.clone(aq.value);}
    else if(aq.deleted||bq.deleted){const q=stateModified(aq)>=stateModified(bq)?aq:bq;if(q.deleted)out.tombstones.qbank=U.clone(q.meta);else out.qbank=U.clone(q.value);}
    else {const ctx={localModified:stateModified(aq),remoteModified:stateModified(bq),localDevice:stateDevice(aq,a),remoteDevice:stateDevice(bq,b)};out.qbank=deepMerge(MISSING,aq.value,bq.value,ctx,[]);}
    out.generatedAt=U.validDate(a.generatedAt)>=U.validDate(b.generatedAt)?a.generatedAt:b.generatedAt; out.syncMetadata={combinedDuplicateSnapshots:true,combinedAt:U.iso()}; return out;
  }

  R.merge={MISSING,deepMerge,emptyCloud,validateCloud,mergeCloud,combineRemote,entityKey:(id,hash)=>`${String(id)}@@${String(hash||'NOHASH')}`};
})();
