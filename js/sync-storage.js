(function(){
  'use strict';
  const R=window.StepProgressSync, U=R.util, B=R.backupModel;
  function bridge(){if(!window.StepExamSyncBridge)throw new Error('Simulator backup bridge is not available. Reload the app.');return window.StepExamSyncBridge;}
  function parseMaybe(text,label){return text==null?null:U.parseJson(text,label);}
  function deriveModified(progress,suspended,rec){
    const v=[];try{v.push(progress?.bundle?.updatedAt,progress?.exportedAt,progress?.session?.updatedAt,progress?.session?.completedAt,progress?.updatedAt);(progress?.bundle?.attempts||[]).forEach(a=>v.push(a?.completedAt,a?.createdAt,a?.session?.updatedAt,a?.session?.completedAt));}catch(e){}
    try{v.push(suspended?.updatedAt,suspended?.resumeCapturedAt,rec?.updatedAt);}catch(e){}
    const ms=Math.max(0,...v.map(U.validDate));return ms?new Date(ms).toISOString():U.iso();
  }
  async function readLocal({flush=true}={}){
    const b=bridge();await b.ensureReady();if(flush)await b.flushActive();
    const cat=await b.catalog(), deviceId=await R.meta.deviceId(), forms={};
    for(const rec of (cat.forms||[])){
      const progress=parseMaybe(await b.readFormProgressText(rec.id),`${rec.id} progress`);
      const suspended=parseMaybe(await b.readFormSuspendedText(rec.id),`${rec.id} suspended progress`);
      const score=String(rec.threeDigitScore||'');
      if(progress||suspended||score){
        const key=B.entityKey(rec.id,rec.bankHash);
        forms[key]={key,kind:'form',formId:String(rec.id),bankHash:String(rec.bankHash||''),progress:progress||null,suspended:suspended||null,threeDigitScore:score,modifiedAt:deriveModified(progress,suspended,rec),deviceId};
      }
    }
    const qtxt=await b.readQbankText();let qbank=null;
    if(qtxt){const q=parseMaybe(qtxt,'Qbank progress');if(q){delete q.settings;delete q.lastSelectedFormIds;qbank={key:B.qbankKey,kind:'qbank',progress:q,modifiedAt:deriveModified(q,null,null),deviceId};}}
    return {forms,qbank,deviceId,catalog:cat,runtime:b.runtime(),capturedAt:U.iso()};
  }
  function payloadOf(entity){
    if(!entity)return null;
    if(entity.kind==='qbank')return {progress:entity.progress||null};
    return {progress:entity.progress||null,suspended:entity.suspended||null,threeDigitScore:String(entity.threeDigitScore||'')};
  }
  async function hashEntity(entity){return entity?await U.sha256Text(U.stable(payloadOf(entity))):'';}
  async function localIndex(opts={}){
    const local=await readLocal(opts), index={};
    for(const [key,e] of Object.entries(local.forms)){index[key]={...e,contentHash:await hashEntity(e)};}
    if(local.qbank)index[B.qbankKey]={...local.qbank,contentHash:await hashEntity(local.qbank)};
    return {...local,index};
  }
  function makeFormBackup(entity,meta){
    return {type:R.config.FORM_BACKUP_TYPE,schemaVersion:R.config.SCHEMA_VERSION,backupId:meta.backupId,revision:meta.revision,createdAt:meta.updatedAt,deviceId:meta.deviceId,build:R.config.BUILD,formId:entity.formId,bankHash:entity.bankHash,contentHash:meta.contentHash,payload:payloadOf(entity)};
  }
  function makeQbankBackup(entity,meta){
    return {type:R.config.QBANK_BACKUP_TYPE,schemaVersion:R.config.SCHEMA_VERSION,backupId:meta.backupId,revision:meta.revision,createdAt:meta.updatedAt,deviceId:meta.deviceId,build:R.config.BUILD,contentHash:meta.contentHash,payload:payloadOf(entity)};
  }
  function validateBackup(obj,entry){
    if(!obj||typeof obj!=='object')throw new Error('Cloud backup is invalid.');
    if(Number(obj.schemaVersion)!==R.config.SCHEMA_VERSION)throw new Error(`Unsupported cloud backup schema ${String(obj.schemaVersion)}.`);
    if(entry.kind==='form'){
      if(obj.type!==R.config.FORM_BACKUP_TYPE)throw new Error(`Cloud backup type is invalid for ${entry.formId}.`);
      if(String(obj.formId)!==String(entry.formId)||String(obj.bankHash)!==String(entry.bankHash))throw new Error(`Cloud backup identity mismatch for ${entry.formId}.`);
    }else if(obj.type!==R.config.QBANK_BACKUP_TYPE)throw new Error('Cloud Qbank backup type is invalid.');
    return obj;
  }
  async function checkpoint(){const local=await readLocal({flush:true});await R.meta.set('preBackupRecoverySnapshot',U.clone(local));await R.meta.set('preBackupRecoveryAt',U.iso());return local;}
  async function restoreCheckpoint(){
    const cp=await R.meta.get('preBackupRecoverySnapshot',null);if(!cp)throw new Error('No pre-backup recovery checkpoint is available.');
    const b=bridge();window.__STEP_SYNC_APPLYING_REMOTE=true;
    try{
      for(const rec of (cp.catalog?.forms||[])){
        const key=B.entityKey(rec.id,rec.bankHash),e=cp.forms?.[key];
        if(e){if(e.progress)await b.writeFormProgressText(rec.id,JSON.stringify(e.progress),rec.bankHash);else await b.deleteFormProgress(rec.id);await b.writeFormSuspendedText(rec.id,e.suspended?JSON.stringify(e.suspended):null,rec.bankHash);await b.setThreeDigitScore(rec.id,e.threeDigitScore||'');}
      }
      if(cp.qbank?.progress)await b.writeQbankText(JSON.stringify(cp.qbank.progress));else await b.writeQbankText(null);
      await b.refresh();
    }finally{window.__STEP_SYNC_APPLYING_REMOTE=false;}
    return true;
  }
  async function applyBackup(entry,backup){
    validateBackup(backup,entry);const b=bridge();window.__STEP_SYNC_APPLYING_REMOTE=true;
    try{
      if(entry.kind==='qbank'){await b.writeQbankText(JSON.stringify(backup.payload?.progress||{}));}
      else{
        const cat=await b.catalog(),rec=(cat.forms||[]).find(x=>String(x.id)===String(entry.formId));
        if(!rec)throw new Error(`${entry.formId} is not loaded locally. Import the matching form first.`);
        if(String(rec.bankHash||'')!==String(entry.bankHash||''))throw new Error(`Form version mismatch for ${entry.formId}; cloud backup was not applied.`);
        if(backup.payload?.progress)await b.writeFormProgressText(entry.formId,JSON.stringify(backup.payload.progress),entry.bankHash);else await b.deleteFormProgress(entry.formId);
        await b.writeFormSuspendedText(entry.formId,backup.payload?.suspended?JSON.stringify(backup.payload.suspended):null,entry.bankHash);
        await b.setThreeDigitScore(entry.formId,backup.payload?.threeDigitScore||'');
      }
      await b.refresh();
    }finally{window.__STEP_SYNC_APPLYING_REMOTE=false;}
  }
  function sessionsFromProgress(p){if(!p)return[];if(Array.isArray(p?.bundle?.attempts))return p.bundle.attempts.map(a=>a&&a.session).filter(Boolean);if(p.session)return[p.session];if(Array.isArray(p.blocks))return[p];return[];}
  function stats(local){let attempts=0,questions=0,answered=0,marked=0,stemHighlights=0,expHighlights=0,struck=0,notes=0;for(const e of Object.values(local.forms||{})){for(const s of sessionsFromProgress(e.progress)){attempts++;for(const bp of (s.blocks||[])){const n=Math.max(Number(bp?.total)||0,Array.isArray(bp?.answers)?bp.answers.length:0);questions+=n;if(Array.isArray(bp?.answers))answered+=bp.answers.filter(x=>x!==null&&x!==undefined).length;if(Array.isArray(bp?.flagged))marked+=bp.flagged.filter(Boolean).length;if(bp?.struck&&typeof bp.struck==='object')Object.values(bp.struck).forEach(a=>{if(Array.isArray(a))struck+=a.length;});if(bp?.stemHighlightAnchors&&typeof bp.stemHighlightAnchors==='object')Object.values(bp.stemHighlightAnchors).forEach(a=>{if(Array.isArray(a))stemHighlights+=a.length;});if(bp?.explanationHighlightAnchors&&typeof bp.explanationHighlightAnchors==='object')Object.values(bp.explanationHighlightAnchors).forEach(a=>{if(Array.isArray(a))expHighlights+=a.length;});if(String(bp?.notes||'').trim())notes++;}}const gs=e?.progress?.bundle?.explanationHighlightAnchorsByQuestionKey;if(gs&&typeof gs==='object')Object.values(gs).forEach(a=>{if(Array.isArray(a))expHighlights+=a.length;});}
    return {forms:Object.keys(local.forms||{}).length,attempts,questions,answered,marked,stemHighlights,expHighlights,struck,notes,qbankTests:Array.isArray(local.qbank?.progress?.sessions)?local.qbank.progress.sessions.length:0};
  }
  async function validateLocal(){const local=await localIndex({flush:true});for(const [key,e] of Object.entries(local.forms)){if(!e.formId||!e.bankHash)throw new Error(`Progress entity ${key} lacks a stable form ID or bank hash.`);const meta={backupId:'TEST',revision:1,updatedAt:U.iso(),deviceId:local.deviceId,contentHash:e.contentHash};const b=makeFormBackup(e,meta);validateBackup(JSON.parse(JSON.stringify(b)),{kind:'form',formId:e.formId,bankHash:e.bankHash});}return {ok:true,stats:stats(local),loadedForms:(local.catalog.forms||[]).length,deviceId:local.deviceId,entities:Object.keys(local.index).length,estimatedBytes:new Blob([U.stable(Object.values(local.index).map(payloadOf))]).size};}
  R.storage={readLocal,localIndex,payloadOf,hashEntity,makeFormBackup,makeQbankBackup,validateBackup,checkpoint,restoreCheckpoint,applyBackup,stats,validateLocal};
})();
