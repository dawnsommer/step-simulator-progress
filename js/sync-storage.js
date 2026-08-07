(function(){
  'use strict';
  const R=window.StepProgressSync, U=R.util, MG=R.merge;
  function bridge(){ if(!window.StepExamSyncBridge) throw new Error('Simulator sync bridge is not available. Reload the app.'); return window.StepExamSyncBridge; }
  function maxDate(values){ return new Date(Math.max(0,...values.map(U.validDate))).toISOString(); }
  function deriveModified(progress,suspended,rec){
    const v=[];
    try{ v.push(progress?.bundle?.updatedAt,progress?.exportedAt,progress?.session?.updatedAt,progress?.session?.completedAt,progress?.updatedAt); (progress?.bundle?.attempts||[]).forEach(a=>v.push(a?.completedAt,a?.createdAt,a?.session?.updatedAt,a?.session?.completedAt)); }catch(e){}
    try{ v.push(suspended?.updatedAt,suspended?.resumeCapturedAt,rec?.updatedAt); }catch(e){}
    const ms=Math.max(0,...v.map(U.validDate)); return ms?new Date(ms).toISOString():U.iso();
  }
  function parseMaybe(text,label){ return text==null?null:U.parseJson(text,label); }
  function cloudQbankObject(obj,deviceId){
    if(!obj) return null; const c=U.clone(obj); delete c.settings; delete c.lastSelectedFormIds;
    return {progress:c,modifiedAt:deriveModified(c,null,null),deviceId};
  }
  async function buildLocalState(opts={}){
    const b=bridge(); await b.ensureReady(); if(opts.flush!==false) await b.flushActive();
    const cat=await b.catalog(), deviceId=await R.meta.deviceId(); const forms={},loadedKeys=[];
    for(const rec of (cat.forms||[])){
      const key=MG.entityKey(rec.id,rec.bankHash); loadedKeys.push(key);
      const ptxt=await b.readFormProgressText(rec.id), stxt=await b.readFormSuspendedText(rec.id);
      const progress=parseMaybe(ptxt,`${rec.id} progress`), suspended=parseMaybe(stxt,`${rec.id} suspended progress`), score=String(rec.threeDigitScore||'');
      if(progress || suspended || score){
        forms[key]={formId:rec.id,bankHash:String(rec.bankHash||''),progress:progress||null,suspended:suspended||null,threeDigitScore:score,modifiedAt:deriveModified(progress,suspended,rec),deviceId};
      }
    }
    const qtxt=await b.readQbankText(), qobj=parseMaybe(qtxt,'Qbank progress');
    const tombstones=await R.meta.get('localTombstones',{forms:{},qbank:null}) || {forms:{},qbank:null};
    if(!tombstones.forms || typeof tombstones.forms!=='object') tombstones.forms={};
    return {forms,loadedKeys,qbank:cloudQbankObject(qobj,deviceId),tombstones,capturedAt:U.iso(),deviceId,runtime:b.runtime(),catalogCount:(cat.forms||[]).length};
  }
  function migrateCloud(snapshot){
    if(!snapshot || typeof snapshot!=='object') throw new Error('Remote progress snapshot is invalid.');
    if(snapshot.type!==R.config.CLOUD_TYPE) throw new Error('Remote file is not a step-simulator-progress TEST sync snapshot.');
    const ver=Number(snapshot.schemaVersion||0);
    if(ver===1) return MG.validateCloud(U.clone(snapshot));
    if(ver>R.config.SCHEMA_VERSION) throw new Error(`Remote snapshot schema ${ver} is newer than this build supports.`);
    throw new Error(`Remote snapshot schema ${ver||'missing'} is unsupported.`);
  }
  function localAsCloud(local){
    const c=MG.emptyCloud(local.deviceId); c.generatedAt=local.capturedAt||U.iso(); c.forms=U.clone(local.forms||{}); c.qbank=U.clone(local.qbank||null); return c;
  }
  function sessionsFromProgress(p){
    if(!p) return []; if(Array.isArray(p?.bundle?.attempts)) return p.bundle.attempts.map(a=>a&&a.session).filter(Boolean); if(p.session) return [p.session]; if(Array.isArray(p.blocks)) return [p]; return [];
  }
  function stats(localOrCloud){
    const forms=localOrCloud.forms||{}; let attempts=0,questions=0,answered=0,marked=0,stemHighlights=0,expHighlights=0,struck=0,notes=0;
    for(const e of Object.values(forms)){
      for(const s of sessionsFromProgress(e?.progress)){
        attempts++;
        for(const bp of (s.blocks||[])){
          const n=Math.max(Number(bp?.total)||0,Array.isArray(bp?.answers)?bp.answers.length:0); questions+=n;
          if(Array.isArray(bp?.answers)) answered+=bp.answers.filter(x=>x!==null&&x!==undefined).length;
          if(Array.isArray(bp?.flagged)) marked+=bp.flagged.filter(Boolean).length;
          if(bp?.struck&&typeof bp.struck==='object') Object.values(bp.struck).forEach(a=>{if(Array.isArray(a))struck+=a.length;});
          if(bp?.stemHighlightAnchors&&typeof bp.stemHighlightAnchors==='object') Object.values(bp.stemHighlightAnchors).forEach(a=>{if(Array.isArray(a))stemHighlights+=a.length;});
          if(bp?.explanationHighlightAnchors&&typeof bp.explanationHighlightAnchors==='object') Object.values(bp.explanationHighlightAnchors).forEach(a=>{if(Array.isArray(a))expHighlights+=a.length;});
          if(String(bp?.notes||'').trim()) notes++;
        }
      }
      const gs=e?.progress?.bundle?.explanationHighlightAnchorsByQuestionKey; if(gs&&typeof gs==='object') Object.values(gs).forEach(a=>{if(Array.isArray(a))expHighlights+=a.length;});
    }
    return {forms:Object.keys(forms).length,attempts,questions,answered,marked,stemHighlights,expHighlights,struck,notes,qbankTests:Array.isArray(localOrCloud.qbank?.progress?.sessions)?localOrCloud.qbank.progress.sessions.length:0};
  }
  async function validateLocal(){
    const local=await buildLocalState({flush:true}), cloud=localAsCloud(local); MG.validateCloud(cloud);
    const encoded=JSON.stringify(cloud), decoded=migrateCloud(JSON.parse(encoded));
    const exact=U.stable(cloud)===U.stable(decoded); if(!exact) throw new Error('Local progress failed in-memory round-trip validation.');
    for(const [key,e] of Object.entries(local.forms)){ if(!e.formId || !e.bankHash) throw new Error(`Progress entity ${key} lacks a stable form ID or bank hash.`); }
    return {ok:true,bytes:new Blob([encoded]).size,stats:stats(local),loadedForms:local.catalogCount,deviceId:local.deviceId};
  }
  async function checkpoint(local){ await R.meta.set('preSyncRecoverySnapshot',U.clone(local)); await R.meta.set('preSyncRecoveryAt',U.iso()); }
  async function applyCloud(cloud,opts={}){
    cloud=migrateCloud(cloud); const b=bridge(), cat=await b.catalog(), skip=new Set(opts.skipFormKeys||[]); window.__STEP_SYNC_APPLYING_REMOTE=true;
    try{
      for(const rec of (cat.forms||[])){
        const key=MG.entityKey(rec.id,rec.bankHash); if(skip.has(key)) continue;
        const tomb=cloud.tombstones?.forms?.[key], ent=cloud.forms?.[key];
        if(tomb){ await b.deleteFormProgress(rec.id); continue; }
        if(!ent) continue;
        if(ent.bankHash!==rec.bankHash) continue;
        if(ent.progress) await b.writeFormProgressText(rec.id,JSON.stringify(ent.progress),ent.bankHash); else await b.deleteFormProgress(rec.id);
        await b.writeFormSuspendedText(rec.id,ent.suspended?JSON.stringify(ent.suspended):null,ent.bankHash);
        await b.setThreeDigitScore(rec.id,ent.threeDigitScore||'');
      }
      if(!opts.skipQbank){ if(cloud.tombstones?.qbank) await b.writeQbankText(null); else if(cloud.qbank?.progress) await b.writeQbankText(JSON.stringify(cloud.qbank.progress)); }
      await b.refresh();
    } finally { window.__STEP_SYNC_APPLYING_REMOTE=false; }
  }
  async function restoreCheckpoint(){
    const cp=await R.meta.get('preSyncRecoverySnapshot',null); if(!cp) throw new Error('No pre-sync recovery checkpoint is available.');
    const b=bridge(), cat=await b.catalog(), have=new Set(Object.keys(cp.forms||{})); window.__STEP_SYNC_APPLYING_REMOTE=true;
    try{
      for(const rec of (cat.forms||[])){
        const key=MG.entityKey(rec.id,rec.bankHash), ent=cp.forms?.[key];
        if(ent){ if(ent.progress) await b.writeFormProgressText(rec.id,JSON.stringify(ent.progress),rec.bankHash); else await b.deleteFormProgress(rec.id); await b.writeFormSuspendedText(rec.id,ent.suspended?JSON.stringify(ent.suspended):null,rec.bankHash); await b.setThreeDigitScore(rec.id,ent.threeDigitScore||''); }
        else if((cp.loadedKeys||[]).includes(key)){ await b.deleteFormProgress(rec.id); await b.setThreeDigitScore(rec.id,''); }
      }
      if(cp.qbank?.progress) await b.writeQbankText(JSON.stringify(cp.qbank.progress)); else await b.writeQbankText(null);
      await b.refresh();
    } finally { window.__STEP_SYNC_APPLYING_REMOTE=false; }
    return true;
  }
  async function verifyApplied(cloud,opts={}){
    const local=await buildLocalState({flush:false}), skip=new Set(opts.skipFormKeys||[]);
    for(const key of local.loadedKeys){
      if(skip.has(key)) continue;
      const expected=cloud.tombstones?.forms?.[key]?null:(cloud.forms?.[key]||null), actual=local.forms?.[key]||null;
      const durable=e=>e?{formId:e.formId,bankHash:e.bankHash,progress:e.progress||null,suspended:e.suspended||null,threeDigitScore:String(e.threeDigitScore||'')}:null;
      if(U.stable(durable(expected))!==U.stable(durable(actual))) throw new Error(`Post-merge verification failed for ${key.split('@@')[0]}.`);
    }
    if(!opts.skipQbank){ const expected=cloud.tombstones?.qbank?null:(cloud.qbank||null); if(U.stable(expected?.progress||null)!==U.stable(local.qbank?.progress||null)) throw new Error('Post-merge verification failed for Qbank progress.'); }
    return true;
  }
  R.storage={buildLocalState,migrateCloud,localAsCloud,stats,validateLocal,checkpoint,applyCloud,restoreCheckpoint,verifyApplied};
})();
