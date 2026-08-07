(function(){
  'use strict';
  const R=window.StepProgressSync, C=R.config, U=R.util, S=R.storage, M=R.merge, A=R.auth;
  let running=null, debounceTimer=null;
  let uiState={status:'Disconnected',detail:'Progress is stored locally in this isolated TEST build.',lastSync:'',lastError:'',account:''};
  const emit=()=>{ try{window.dispatchEvent(new CustomEvent('stepsync:state',{detail:{...uiState}}));}catch(e){} renderUi(); };
  function setStatus(status,detail='',extra={}){ uiState={...uiState,status,detail,...extra}; emit(); }
  async function markDirty(reason='local progress changed'){
    if(window.__STEP_SYNC_APPLYING_REMOTE) return;
    await R.meta.set('dirty',true); await R.meta.set('dirtyReason',reason);
    const enabled=await R.meta.get('syncEnabled',false);
    if(enabled) setStatus(navigator.onLine===false?'Offline — saved locally':'Local changes pending',reason);
  }
  function schedule(reason,delay=3000){ clearTimeout(debounceTimer); debounceTimer=setTimeout(()=>{ syncNow({reason,interactive:false}).catch(()=>{}); },delay); }
  async function recordProgressMutation(detail){
    if(window.__STEP_SYNC_APPLYING_REMOTE) return;
    const name=String(detail?.filename||''), op=String(detail?.operation||'write');
    const tombs=await R.meta.get('localTombstones',{forms:{},qbank:null}) || {forms:{},qbank:null}; if(!tombs.forms||typeof tombs.forms!=='object')tombs.forms={};
    const fm=name.match(/^(.+)_progress_save\.json$/i);
    if(fm){
      try{const cat=await window.StepExamSyncBridge.catalog(),rec=(cat.forms||[]).find(x=>x.id===fm[1]);if(rec){const key=M.entityKey(rec.id,rec.bankHash);if(op==='delete')tombs.forms[key]={deletedAt:U.iso(),deviceId:await R.meta.deviceId(),formId:rec.id,bankHash:rec.bankHash};else delete tombs.forms[key];}}
      catch(e){console.warn('Could not update explicit form tombstone',e);}
    }else if(/^QBANK_MODE_progress\.json$/i.test(name)){
      if(op==='delete')tombs.qbank={deletedAt:U.iso(),deviceId:await R.meta.deviceId()}; else tombs.qbank=null;
    }
    await R.meta.set('localTombstones',tombs);
  }
  function escapeQ(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
  async function listDriveFiles(){
    const q=`name = '${escapeQ(C.DRIVE_FILE)}' and trashed = false`;
    const params=new URLSearchParams({spaces:'appDataFolder',q,fields:'files(id,name,modifiedTime,size,md5Checksum)',orderBy:'modifiedTime desc',pageSize:'100'});
    const r=await A.driveFetch('https://www.googleapis.com/drive/v3/files?'+params.toString()); const d=await r.json(); return Array.isArray(d.files)?d.files:[];
  }
  async function downloadDriveFile(file){ const r=await A.driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`); const text=await r.text(); const obj=U.parseJson(text,`Google Drive ${C.DRIVE_FILE}`); return S.migrateCloud(obj); }
  async function createDriveFile(){
    const body={name:C.DRIVE_FILE,parents:['appDataFolder'],mimeType:'application/json'};
    const r=await A.driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,modifiedTime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return await r.json();
  }
  async function uploadDriveFile(id,snapshot){
    const r=await A.driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name,modifiedTime,size`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)}); return await r.json();
  }
  async function cleanupDuplicates(files,keepId){
    for(const f of files){ if(f.id===keepId) continue; try{await A.driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`,{method:'DELETE'});}catch(e){console.warn('Could not remove duplicate TEST sync file',e);} }
  }
  async function readRemote(){
    const files=await listDriveFiles(); if(!files.length) return {files,remote:null,canonical:null};
    let remote=null; for(const f of files){ const snap=await downloadDriveFile(f); remote=remote?M.combineRemote(remote,snap):snap; }
    return {files,remote,canonical:files[0]};
  }
  function makeDeviceBase(cloud,localState){
    const b=M.emptyCloud(localState.deviceId), loaded=new Set(localState.loadedKeys||[]); b.generatedAt=cloud.generatedAt;
    for(const k of loaded){ if(cloud.forms?.[k]) b.forms[k]=U.clone(cloud.forms[k]); if(cloud.tombstones?.forms?.[k]) b.tombstones.forms[k]=U.clone(cloud.tombstones.forms[k]); }
    b.qbank=cloud.qbank?U.clone(cloud.qbank):null; b.tombstones.qbank=cloud.tombstones?.qbank?U.clone(cloud.tombstones.qbank):null; return b;
  }
  async function handleError(e){
    console.error('Progress sync failed',e); await R.meta.set('dirty',true); await R.meta.set('lastError',{at:U.iso(),message:e.message||String(e),status:e.status||0,reason:e.reason||''});
    if(e && e.status===401){ setStatus('Reconnect Google','Google authorization expired. Local progress is safe.',{lastError:e.message||String(e)}); return; }
    const suffix=e&&e.status===403?` Google returned 403${e.reason?` (${e.reason})`:''}.`:'';
    setStatus('Sync failed — local progress is safe',(e.message||String(e))+suffix,{lastError:e.message||String(e)});
  }
  async function syncCore({reason='manual',interactive=false}={}){
    const enabled=await R.meta.get('syncEnabled',false);
    if(!enabled && !interactive){ setStatus('Disconnected','Progress is stored locally. Google sync is disabled on this device.'); return null; }
    if(navigator.onLine===false){ await R.meta.set('dirty',true); setStatus('Offline — saved locally','Network unavailable; pending progress remains local.'); return null; }
    if(!A.getState().authorized){
      if(!interactive){ setStatus('Reconnect Google','Google was connected previously, but this browser session needs authorization again.'); return null; }
      setStatus('Syncing…','Requesting Google authorization…'); const acct=await A.connect({forceConsent:false}); await R.meta.set('syncEnabled',true); uiState.account=acct.emailAddress||'';
    }
    setStatus('Syncing…',`Bidirectional merge: ${reason}`);
    const acct=await A.validate(); uiState.account=acct.emailAddress||''; await R.meta.set('googleAccount',{email:uiState.account,displayName:acct.displayName||'',validatedAt:U.iso()});
    const local=await S.buildLocalState({flush:true}); const validation=await S.validateLocal();
    const remoteInfo=await readRemote(); const remote=remoteInfo.remote||M.emptyCloud(''); const base=await R.meta.get('baseSnapshot',null);
    const merged=M.mergeCloud(base,local,remote,local.deviceId); merged.generatedAt=U.iso(); merged.build=C.BUILD; merged.deviceId=local.deviceId;
    const active=local.runtime?.examVisible && local.runtime?.hasActiveSession;
    if(!active){
      await S.checkpoint(local);
      try{ await S.applyCloud(merged); await S.verifyApplied(merged); }
      catch(e){ try{await S.restoreCheckpoint();}catch(rb){console.error('Automatic rollback also failed',rb);} throw new Error(`Local apply verification failed and the pre-sync checkpoint was restored: ${e.message}`); }
    }
    let canonical=remoteInfo.canonical; if(!canonical) canonical=await createDriveFile();
    const uploaded=await uploadDriveFile(canonical.id,merged); await cleanupDuplicates(remoteInfo.files||[],canonical.id);
    if(active){
      await R.meta.set('dirty',true); await R.meta.set('pendingRemoteReconcile',true);
      setStatus('Local changes pending','Cloud checkpoint updated, but local cloud reconciliation is deferred until you leave the active exam.',{lastSync:uploaded.modifiedTime||U.iso()});
      return {merged,validation,activeDeferred:true};
    }
    const after=await S.buildLocalState({flush:false}); await R.meta.set('baseSnapshot',makeDeviceBase(merged,after)); await R.meta.set('localTombstones',{forms:{},qbank:null}); await R.meta.set('dirty',false); await R.meta.set('pendingRemoteReconcile',false); await R.meta.set('lastSyncAt',uploaded.modifiedTime||U.iso()); await R.meta.set('lastError',null);
    setStatus('Synced',`TEST Drive file: ${C.DRIVE_FILE}`,{lastSync:uploaded.modifiedTime||U.iso(),lastError:''});
    return {merged,validation,uploaded};
  }
  async function syncNow(opts={}){ if(running) return running; running=syncCore(opts).catch(async e=>{await handleError(e);throw e;}).finally(()=>{running=null;}); return running; }
  async function connect(){ setStatus('Syncing…','Connecting Google account…'); try{ const acct=await A.connect({forceConsent:false}); await R.meta.set('syncEnabled',true); uiState.account=acct.emailAddress||''; await syncNow({reason:'successful Google connection',interactive:false}); }catch(e){await handleError(e);throw e;} }
  async function disconnect(){ A.disconnect(); await R.meta.set('syncEnabled',false); setStatus('Disconnected','Google sync is disabled on this browser. Local simulator progress and Drive data were not deleted.',{account:'',lastError:''}); }

  function installStyles(){ if(document.getElementById('stepProgressSyncTestStyle'))return; const st=document.createElement('style');st.id='stepProgressSyncTestStyle';st.textContent=`
    #stepProgressTestBadge{position:fixed;right:10px;bottom:10px;z-index:99999;background:#7f1d1d;color:#fff;border:1px solid #450a0a;border-radius:999px;padding:5px 9px;font:800 10px/1.2 Arial,sans-serif;pointer-events:none;opacity:.9;letter-spacing:.04em}
    #stepSyncLabCard .step-sync-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}#stepSyncLabCard .step-sync-wide{grid-column:1/-1}#stepSyncLabCard input{width:100%;box-sizing:border-box}#stepSyncLabCard .step-sync-status{border:1px solid #d7e5ee;border-radius:12px;padding:10px;background:#f8fbfd;line-height:1.4}#stepSyncLabCard .step-sync-buttons{display:flex;gap:8px;flex-wrap:wrap}#stepSyncLabCard .step-sync-metrics{font-size:12px;color:#4e687a;white-space:pre-wrap}#stepSyncLabCard .step-sync-warning{border:1px solid #e7b5b5;background:#fff4f4;color:#7f1d1d;border-radius:12px;padding:9px;font-size:12px;font-weight:700}@media(max-width:700px){#stepSyncLabCard .step-sync-grid{grid-template-columns:1fr}}
  `;document.head.appendChild(st); const badge=document.createElement('div');badge.id='stepProgressTestBadge';badge.textContent='SYNC TEST • step-simulator-progress';document.body.appendChild(badge); }
  async function ensureCard(){
    const panel=document.getElementById('settingsPanel'); if(!panel||document.getElementById('stepSyncLabCard')) return;
    const grid=panel.querySelector('.settings-grid')||panel; const card=document.createElement('section');card.id='stepSyncLabCard';card.className='settings-card wide';card.innerHTML=`
      <h3>Google Progress Sync — TEST LAB</h3><p>Isolated from <b>exam-simulator2</b>. It uses separate browser databases, cache keys, metadata, and <code>${C.DRIVE_FILE}</code>.</p>
      <div class="step-sync-warning">TEST BUILD. Do not use this as your production study simulator yet.</div>
      <div class="step-sync-grid">
        <div class="step-sync-wide"><label for="stepSyncClientId"><b>Google OAuth Web Client ID</b></label><input id="stepSyncClientId" type="text" placeholder="123...apps.googleusercontent.com" autocomplete="off"><small>Public client ID only. No client secret is used.</small></div>
        <div class="step-sync-wide step-sync-status"><b id="stepSyncStatusText">${uiState.status}</b><div id="stepSyncDetailText"></div><div id="stepSyncAccountText"></div><div id="stepSyncLastText"></div></div>
        <div class="step-sync-wide step-sync-buttons"><button type="button" class="secondary" data-step-sync-action="save-client">Save Client ID</button><button type="button" class="primary" data-step-sync-action="connect">Connect Google Account</button><button type="button" class="secondary" data-step-sync-action="sync">Sync Now</button><button type="button" class="secondary" data-step-sync-action="disconnect">Disconnect</button></div>
        <div class="step-sync-wide step-sync-buttons"><button type="button" class="secondary" data-step-sync-action="validate">Validate Local Progress</button><button type="button" class="secondary" data-step-sync-action="restore">Restore Last Pre-Sync Checkpoint</button></div>
        <div id="stepSyncMetrics" class="step-sync-wide step-sync-metrics">Diagnostics not run yet.</div>
        <div class="step-sync-wide"><a href="./privacy.html" target="_blank" rel="noopener">Privacy Policy</a> · Build <code>${C.BUILD}</code></div>
      </div>`; grid.appendChild(card); const id=await A.getClientId(); const inp=document.getElementById('stepSyncClientId'); if(inp)inp.value=id; renderUi();
  }
  async function renderUi(){
    const st=document.getElementById('stepSyncStatusText'),dt=document.getElementById('stepSyncDetailText'),ac=document.getElementById('stepSyncAccountText'),ls=document.getElementById('stepSyncLastText');
    if(st)st.textContent=uiState.status; if(dt)dt.textContent=uiState.detail||''; if(ac)ac.textContent=uiState.account?`Account: ${uiState.account}`:''; if(ls)ls.textContent=uiState.lastSync?`Last sync: ${new Date(uiState.lastSync).toLocaleString()}`:'';
  }
  async function runValidate(){ const r=await S.validateLocal(), m=document.getElementById('stepSyncMetrics'); if(m)m.textContent=`Loaded forms: ${r.loadedForms}\nProgress-bearing forms: ${r.stats.forms}\nAttempts: ${r.stats.attempts}\nQuestion states: ${r.stats.questions}\nAnswered: ${r.stats.answered}\nMarked: ${r.stats.marked}\nStem highlights: ${r.stats.stemHighlights}\nExplanation highlights: ${r.stats.expHighlights}\nStrikethrough entries: ${r.stats.struck}\nNotes blocks: ${r.stats.notes}\nQbank tests: ${r.stats.qbankTests}\nSnapshot size: ${(r.bytes/1024).toFixed(1)} KB\nRound-trip: PASS\nDevice ID: ${r.deviceId}`; return r; }
  async function restore(){ const rt=window.StepExamSyncBridge?.runtime?.(); if(rt?.examVisible) throw new Error('Leave the active exam before restoring a checkpoint.'); if(!confirm('Restore the last automatic pre-sync checkpoint? This changes TEST-build progress only.'))return; await S.restoreCheckpoint(); await markDirty('pre-sync checkpoint restored'); setStatus('Local changes pending','Checkpoint restored locally. Sync when ready.'); await runValidate(); }
  async function handleAction(action){
    if(action==='save-client'){ const inp=document.getElementById('stepSyncClientId'); await A.setClientId(inp?.value||''); setStatus('Disconnected','OAuth Client ID saved for this TEST build.'); return; }
    if(action==='connect') return await connect();
    if(action==='sync') return await syncNow({reason:'manual Sync Now',interactive:true});
    if(action==='disconnect') return await disconnect();
    if(action==='validate') return await runValidate();
    if(action==='restore') return await restore();
  }
  document.addEventListener('click',e=>{ const b=e.target?.closest?.('[data-step-sync-action]'); if(!b)return; e.preventDefault(); b.disabled=true; handleAction(b.dataset.stepSyncAction).catch(err=>alert(err.message||String(err))).finally(()=>{b.disabled=false;}); },true);
  window.addEventListener('stepsim:progress-write',e=>{ if(window.__STEP_SYNC_APPLYING_REMOTE)return; recordProgressMutation(e.detail).then(()=>markDirty(`${e.detail?.filename||'progress'} ${e.detail?.operation||'changed'}`)).then(()=>{if(e.detail?.operation==='delete')schedule('progress deletion',1800);}); });
  window.addEventListener('stepsim:catalog-write',()=>{ if(window.__STEP_SYNC_APPLYING_REMOTE)return; markDirty('catalog/result metadata changed'); });
  window.addEventListener('online',()=>{R.meta.get('dirty',false).then(d=>{if(d)schedule('network restored',1000);});});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')R.meta.get('dirty',false).then(d=>{if(d)schedule('returned to foreground',1200);});});
  document.addEventListener('click',e=>{
    const el=e.target?.closest?.('#finishBlock,#endBlockBtn,#backMenu,#reportSaveMenu,#menuNow,#libraryTab,#quickTab,#qbankTab,#qbankTestsTab,#settingsTab,[data-action="delete-progress"],[data-v9="delete-attempt"],[data-v9="qbank-delete"]');
    if(el) R.meta.get('dirty',false).then(d=>{if(d)schedule(`checkpoint: ${el.id||el.dataset?.v9||el.dataset?.action||'navigation'}`,2200);});
  },true);
  async function boot(){
    installStyles(); document.title='Step Simulator Progress — TEST';
    if('serviceWorker' in navigator){ try{await navigator.serviceWorker.register('./sw.js?v='+encodeURIComponent(C.BUILD),{scope:'./'});}catch(e){console.warn('TEST service worker registration failed',e);} }
    const mo=new MutationObserver(()=>ensureCard().catch(console.warn)); mo.observe(document.documentElement,{childList:true,subtree:true}); await ensureCard();
    const enabled=await R.meta.get('syncEnabled',false), acct=await R.meta.get('googleAccount',null), last=await R.meta.get('lastSyncAt',''); uiState.account=acct?.email||''; uiState.lastSync=last||'';
    if(enabled){ if(A.getState().authorized){ setStatus('Local changes pending','Checking Google Drive after reload…'); setTimeout(()=>syncNow({reason:'app startup/reload',interactive:false}).catch(()=>{}),1000); } else setStatus('Reconnect Google','Google sync is enabled, but authorization is not available in this browser session.'); }
    else setStatus('Disconnected','Progress is currently stored locally in this isolated TEST build.');
  }
  R.sync={syncNow,connect,disconnect,markDirty,getState:()=>({...uiState}),runValidate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
