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
    // Recovery invariant: once the user explicitly Disconnects Google Sync, the Drive
    // snapshot becomes an independent backup. Local deletes/resets performed during
    // that disconnected period MUST NOT create cloud tombstones on a later reconnect.
    // (A device that is merely offline still has syncEnabled=true, so intentional
    // deletes made while offline continue to propagate when connectivity returns.)
    const enabled=await R.meta.get('syncEnabled',false);
    if(!enabled) return;
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
  async function connect(){
    setStatus('Syncing…','Connecting Google account…');
    try{
      // If this browser was explicitly disconnected, discard any stale local deletion
      // intent (including tombstones produced by older TEST builds). Positive local
      // progress still participates in the normal bidirectional three-way merge, but
      // absence of a local progress file is treated as recoverable from Drive.
      const wasEnabled=await R.meta.get('syncEnabled',false);
      if(!wasEnabled){
        await R.meta.set('localTombstones',{forms:{},qbank:null});
        await R.meta.set('reconnectRecoveryMode',true);
      }
      const acct=await A.connect({forceConsent:false});
      await R.meta.set('syncEnabled',true);
      uiState.account=acct.emailAddress||'';
      await syncNow({reason:wasEnabled?'successful Google connection':'reconnect recovery + bidirectional merge',interactive:false});
      await R.meta.set('reconnectRecoveryMode',false);
    }catch(e){await handleError(e);throw e;}
  }
  async function disconnect(){
    A.disconnect();
    await R.meta.set('syncEnabled',false);
    // Explicit Disconnect freezes the Drive snapshot as a backup. Any unsynchronized
    // deletion tombstones are dropped so deleting/resetting progress while disconnected
    // cannot erase the cloud copy when the user later reconnects.
    await R.meta.set('localTombstones',{forms:{},qbank:null});
    await R.meta.set('disconnectedAt',U.iso());
    setStatus('Disconnected','Google sync is disabled on this browser. Drive remains an independent recovery copy; local deletes made while disconnected will be restored on reconnect.',{account:'',lastError:''});
  }

  function installStyles(){
    if(document.getElementById('stepProgressSyncTestStyle')) return;
    const st=document.createElement('style'); st.id='stepProgressSyncTestStyle'; st.textContent=`
      #stepProgressTestBadge{position:fixed;right:10px;bottom:10px;z-index:99999;background:#7f1d1d;color:#fff;border:1px solid #450a0a;border-radius:999px;padding:5px 9px;font:800 10px/1.2 Arial,sans-serif;pointer-events:none;opacity:.88;letter-spacing:.04em}
      #progressSyncTab{position:relative}#progressSyncTab .sync-tab-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:7px;background:#7d92a2;box-shadow:0 0 0 3px rgba(125,146,162,.14)}#progressSyncTab.sync-connected .sync-tab-dot{background:#34c78b;box-shadow:0 0 0 3px rgba(52,199,139,.16)}#progressSyncTab.sync-attention .sync-tab-dot{background:#f0ad45;box-shadow:0 0 0 3px rgba(240,173,69,.16)}
      #progressSyncPanel{--sync-ink:#0b1f2d;--sync-muted:#637888;--sync-line:#dbe6ed;--sync-soft:#f5f9fb;--sync-blue:#1976d2;--sync-green:#159468;--sync-warn:#b87312;--sync-red:#a83b3b}
      #progressSyncPanel .sync-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 24px;margin-bottom:18px}
      #progressSyncPanel .sync-hero h2{margin:2px 0 5px;color:var(--sync-ink);font-size:25px}#progressSyncPanel .sync-hero p{margin:0;color:var(--sync-muted);font-size:13px;max-width:720px;line-height:1.55}
      #progressSyncPanel .sync-status-pill{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;border:1px solid var(--sync-line);background:#fff;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;color:var(--sync-ink)}#progressSyncPanel .sync-status-pill i{width:9px;height:9px;border-radius:50%;background:#899ba8;display:block}#progressSyncPanel .sync-status-pill.good i{background:var(--sync-green)}#progressSyncPanel .sync-status-pill.busy i{background:var(--sync-blue);animation:stepSyncPulse 1s infinite alternate}#progressSyncPanel .sync-status-pill.warn i{background:#e2a032}#progressSyncPanel .sync-status-pill.bad i{background:var(--sync-red)}
      @keyframes stepSyncPulse{from{opacity:.35}to{opacity:1}}
      #progressSyncPanel .sync-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:18px}
      #progressSyncPanel .sync-card{background:#fff;border:1px solid var(--sync-line);border-radius:22px;padding:20px;box-shadow:0 12px 30px rgba(24,54,84,.07)}#progressSyncPanel .sync-card h3{margin:0 0 5px;color:var(--sync-ink);font-size:16px}#progressSyncPanel .sync-card>p{margin:0;color:var(--sync-muted);font-size:12px;line-height:1.5}
      #progressSyncPanel .sync-account{display:flex;align-items:center;gap:14px;margin-top:18px;padding:15px;border:1px solid #d7ebe3;background:#f5fbf8;border-radius:18px}#progressSyncPanel .sync-avatar{width:42px;height:42px;flex:0 0 42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#153b54;color:#fff;font-size:16px;font-weight:950;text-transform:uppercase}#progressSyncPanel .sync-account-copy{min-width:0;flex:1}#progressSyncPanel .sync-account-label{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--sync-green)}#progressSyncPanel .sync-account-email{font-size:14px;font-weight:900;color:var(--sync-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}#progressSyncPanel .sync-account-sub{font-size:11px;color:var(--sync-muted);margin-top:3px}
      #progressSyncPanel .sync-disconnected{margin-top:18px;padding:18px;border:1px dashed #cbdbe5;background:var(--sync-soft);border-radius:18px}#progressSyncPanel .sync-disconnected b{display:block;color:var(--sync-ink);margin-bottom:4px}#progressSyncPanel .sync-disconnected span{font-size:12px;color:var(--sync-muted);line-height:1.5}
      #progressSyncPanel .sync-detail{margin-top:13px;border-radius:14px;padding:11px 13px;background:var(--sync-soft);color:#425c6d;font-size:12px;line-height:1.5;min-height:18px}#progressSyncPanel .sync-detail.bad{background:#fff5f5;color:#883838;border:1px solid #f0d4d4}#progressSyncPanel .sync-detail.warn{background:#fff9ed;color:#7f5a16;border:1px solid #f0dfb8}
      #progressSyncPanel .sync-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}#progressSyncPanel .sync-actions button{min-width:120px}
      #progressSyncPanel .sync-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}#progressSyncPanel .sync-meta{background:var(--sync-soft);border:1px solid #e3edf2;border-radius:14px;padding:11px}#progressSyncPanel .sync-meta span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.055em;font-weight:900;color:#79909f}#progressSyncPanel .sync-meta b{display:block;margin-top:4px;font-size:12px;color:var(--sync-ink);word-break:break-word}
      #progressSyncPanel .sync-protection-list{display:flex;flex-direction:column;gap:10px;margin-top:17px}#progressSyncPanel .sync-protection{display:grid;grid-template-columns:31px 1fr;gap:10px;align-items:start;padding:11px;border:1px solid #e2ebf0;border-radius:15px;background:#fbfdfe}#progressSyncPanel .sync-protection-icon{width:31px;height:31px;border-radius:10px;background:#eaf3f8;color:#1f607e;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:950}#progressSyncPanel .sync-protection b{display:block;font-size:12px;color:var(--sync-ink)}#progressSyncPanel .sync-protection span{display:block;font-size:11px;color:var(--sync-muted);margin-top:2px;line-height:1.4}
      #progressSyncPanel .sync-diagnostics{grid-column:1/-1}#progressSyncPanel .sync-diagnostics-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}#progressSyncPanel .sync-diagnostics-actions{display:flex;gap:8px;flex-wrap:wrap}#stepSyncMetrics{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px}#stepSyncMetrics .sync-metric{background:var(--sync-soft);border:1px solid #e0ebf1;border-radius:14px;padding:11px}#stepSyncMetrics .sync-metric span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#78909e;font-weight:850}#stepSyncMetrics .sync-metric b{display:block;margin-top:4px;font-size:18px;color:var(--sync-ink)}#stepSyncMetrics .sync-metric.pass b{color:var(--sync-green);font-size:13px;margin-top:7px}
      #progressSyncPanel .sync-footer{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:14px;color:#728797;font-size:11px;flex-wrap:wrap}#progressSyncPanel .sync-footer a{font-weight:850;color:#315f7d;text-decoration:none}#progressSyncPanel .sync-test-note{color:#8a3e3e;font-weight:850}
      @media(max-width:900px){#progressSyncPanel .sync-layout{grid-template-columns:1fr}#progressSyncPanel .sync-hero{flex-direction:column}#progressSyncPanel .sync-status-pill{align-self:flex-start}}@media(max-width:600px){#progressSyncPanel .sync-hero,#progressSyncPanel .sync-card{padding:16px}#progressSyncPanel .sync-meta-grid{grid-template-columns:1fr}#progressSyncPanel .sync-actions button{flex:1 1 140px}}
    `; document.head.appendChild(st);
    if(!document.getElementById('stepProgressTestBadge')){ const badge=document.createElement('div'); badge.id='stepProgressTestBadge'; badge.textContent='SYNC TEST • step-simulator-progress'; document.body.appendChild(badge); }
  }
  function statusTone(){
    if(uiState.status==='Synced') return 'good';
    if(uiState.status==='Syncing…') return 'busy';
    if(uiState.status==='Reconnect Google'||uiState.status==='Local changes pending'||uiState.status==='Offline — saved locally') return 'warn';
    if(String(uiState.status).startsWith('Sync failed')) return 'bad';
    return '';
  }
  function isConnectedView(){ return !!uiState.account && uiState.status!=='Reconnect Google' && uiState.status!=='Disconnected'; }
  function controlHtml(){
    if(uiState.status==='Syncing…') return `<button type="button" class="primary" disabled>Syncing…</button>`;
    if(uiState.status==='Reconnect Google') return `<button type="button" class="primary" data-step-sync-action="sync">Reconnect Google</button><button type="button" class="secondary" data-step-sync-action="disconnect">Disconnect</button>`;
    if(isConnectedView()) return `<button type="button" class="primary" data-step-sync-action="sync">Sync Now</button><button type="button" class="secondary" data-step-sync-action="disconnect">Disconnect</button>`;
    return `<button type="button" class="primary" data-step-sync-action="connect">Connect Google Account</button>`;
  }
  function accountHtml(){
    if(!isConnectedView()) return `<div class="sync-disconnected"><b>Progress is stored locally on this device.</b><span>Connect Google to add optional hidden cross-device progress synchronization and recovery. The simulator continues to use its normal local storage first.</span></div>`;
    const email=uiState.account||'Google account'; const initial=(email.trim()[0]||'G').toUpperCase();
    return `<div class="sync-account"><div class="sync-avatar">${initial}</div><div class="sync-account-copy"><div class="sync-account-label">Connected account</div><div class="sync-account-email">${email.replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}</div><div class="sync-account-sub">Google Drive appDataFolder • hidden progress file</div></div></div>`;
  }
  function ensureSyncSurface(){
    const side=document.querySelector('.modern-sidebar'), settingsTab=document.getElementById('settingsTab');
    if(side && !document.getElementById('progressSyncTab')){
      const btn=document.createElement('button'); btn.id='progressSyncTab'; btn.className='menu-tab'; btn.type='button'; btn.innerHTML='Progress Sync <span class="sync-tab-dot" aria-hidden="true"></span>';
      if(settingsTab) side.insertBefore(btn,settingsTab); else side.appendChild(btn);
    }
    const main=document.querySelector('.modern-main'), settingsPanel=document.getElementById('settingsPanel');
    if(main && !document.getElementById('progressSyncPanel')){
      const panel=document.createElement('section'); panel.id='progressSyncPanel'; panel.className='mode-panel';
      panel.innerHTML=`
        <div class="sync-hero glass-panel">
          <div><div class="panel-kicker">Cloud recovery • isolated test</div><h2>Google Progress Sync</h2><p>Local simulator storage stays primary. Google Drive adds an optional hidden synchronization layer for your form progress, attempts, highlights, review state, and Qbank progress.</p></div>
          <div id="stepSyncStatusPill" class="sync-status-pill"><i></i><span id="stepSyncStatusText">Disconnected</span></div>
        </div>
        <div class="sync-layout">
          <section class="sync-card">
            <h3>Connection</h3><p>One Google account can stay connected on Mac, iPad, and iPhone at the same time.</p>
            <div id="stepSyncAccountArea"></div>
            <div id="stepSyncDetailText" class="sync-detail"></div>
            <div id="stepSyncActions" class="sync-actions"></div>
            <div class="sync-meta-grid"><div class="sync-meta"><span>Last successful sync</span><b id="stepSyncLastText">Never</b></div><div class="sync-meta"><span>Drive file</span><b>${C.DRIVE_FILE}</b></div></div>
          </section>
          <section class="sync-card">
            <h3>Protection layers</h3><p>This TEST repository remains isolated from your production simulator.</p>
            <div class="sync-protection-list">
              <div class="sync-protection"><div class="sync-protection-icon">L</div><div><b>Local-first</b><span>Answers and highlights save locally before any Drive operation.</span></div></div>
              <div class="sync-protection"><div class="sync-protection-icon">↔</div><div><b>Bidirectional merge</b><span>Independent form/question changes are merged instead of blindly overwritten.</span></div></div>
              <div class="sync-protection"><div class="sync-protection-icon">↶</div><div><b>Pre-sync recovery point</b><span>A local checkpoint is made before applying incoming cloud progress.</span></div></div>
              <div class="sync-protection"><div class="sync-protection-icon">#</div><div><b>Form version guard</b><span>Progress is matched using form identity plus bank hash.</span></div></div>
              <div class="sync-protection"><div class="sync-protection-icon">B</div><div><b>Disconnect freezes backup</b><span>Delete/reset actions made after explicit Disconnect stay local; reconnect can restore the Drive copy.</span></div></div>
            </div>
          </section>
          <section class="sync-card sync-diagnostics">
            <div class="sync-diagnostics-head"><div><h3>Progress diagnostics</h3><p>Validate that answers, attempts, highlights, notes, and Qbank state can be represented by the sync snapshot.</p></div><div class="sync-diagnostics-actions"><button type="button" class="secondary" data-step-sync-action="validate">Validate Local Progress</button><button type="button" class="secondary" data-step-sync-action="restore">Restore Pre-Sync Checkpoint</button></div></div>
            <div id="stepSyncMetrics"><div class="sync-metric"><span>Status</span><b>Not run</b></div></div>
            <div class="sync-footer"><span class="sync-test-note">TEST BUILD — production exam-simulator2 remains separate.</span><span><a href="./privacy.html" target="_blank" rel="noopener">Privacy Policy</a> · Build ${C.BUILD}</span></div>
          </section>
        </div>`;
      if(settingsPanel?.parentNode) settingsPanel.parentNode.insertBefore(panel,settingsPanel.nextSibling); else main.appendChild(panel);
    }
    renderUi();
  }
  function activateSyncTab(){
    ensureSyncSurface();
    document.querySelectorAll('.mode-panel.active').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.menu-tab.active').forEach(x=>x.classList.remove('active'));
    document.getElementById('progressSyncPanel')?.classList.add('active');
    document.getElementById('progressSyncTab')?.classList.add('active');
  }
  function renderUi(){
    const pill=document.getElementById('stepSyncStatusPill'), st=document.getElementById('stepSyncStatusText'), dt=document.getElementById('stepSyncDetailText'), aa=document.getElementById('stepSyncAccountArea'), acts=document.getElementById('stepSyncActions'), ls=document.getElementById('stepSyncLastText'), tab=document.getElementById('progressSyncTab');
    if(pill){pill.className='sync-status-pill '+statusTone();}
    if(st) st.textContent=uiState.status;
    if(dt){dt.textContent=uiState.detail||'';dt.className='sync-detail '+(statusTone()==='bad'?'bad':statusTone()==='warn'?'warn':'');}
    if(aa) aa.innerHTML=accountHtml();
    if(acts) acts.innerHTML=controlHtml();
    if(ls) ls.textContent=uiState.lastSync?new Date(uiState.lastSync).toLocaleString():'Never';
    if(tab){tab.classList.toggle('sync-connected',isConnectedView());tab.classList.toggle('sync-attention',statusTone()==='warn'||statusTone()==='bad');}
  }
  async function runValidate(){
    const r=await S.validateLocal(), m=document.getElementById('stepSyncMetrics');
    if(m){ const items=[['Loaded forms',r.loadedForms],['Progress forms',r.stats.forms],['Attempts',r.stats.attempts],['Question states',r.stats.questions],['Answered',r.stats.answered],['Marked',r.stats.marked],['Stem highlights',r.stats.stemHighlights],['Explanation highlights',r.stats.expHighlights],['Strikethroughs',r.stats.struck],['Notes blocks',r.stats.notes],['Qbank tests',r.stats.qbankTests],['Snapshot',(r.bytes/1024).toFixed(1)+' KB']]; m.innerHTML=items.map(([a,b])=>`<div class="sync-metric"><span>${a}</span><b>${b}</b></div>`).join('')+`<div class="sync-metric pass"><span>Round-trip</span><b>PASS</b></div>`; }
    return r;
  }
  async function restore(){ const rt=window.StepExamSyncBridge?.runtime?.(); if(rt?.examVisible) throw new Error('Leave the active exam before restoring a checkpoint.'); if(!confirm('Restore the last automatic pre-sync checkpoint? This changes TEST-build progress only.'))return; await S.restoreCheckpoint(); await markDirty('pre-sync checkpoint restored'); setStatus('Local changes pending','Checkpoint restored locally. Sync when ready.'); await runValidate(); }
  async function handleAction(action){
    if(action==='connect') return await connect();
    if(action==='sync') return await syncNow({reason:'manual Sync Now',interactive:true});
    if(action==='disconnect') return await disconnect();
    if(action==='validate') return await runValidate();
    if(action==='restore') return await restore();
  }
  document.addEventListener('click',e=>{
    const syncTab=e.target?.closest?.('#progressSyncTab'); if(syncTab){e.preventDefault();activateSyncTab();return;}
    const other=e.target?.closest?.('.menu-tab:not(#progressSyncTab)'); if(other) document.getElementById('progressSyncPanel')?.classList.remove('active');
    const b=e.target?.closest?.('[data-step-sync-action]'); if(!b)return; e.preventDefault(); b.disabled=true; handleAction(b.dataset.stepSyncAction).catch(err=>alert(err.message||String(err))).finally(()=>{b.disabled=false;});
  },true);
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
    const mo=new MutationObserver(()=>{ if(!document.getElementById('progressSyncTab') || !document.getElementById('progressSyncPanel')) ensureSyncSurface(); }); mo.observe(document.documentElement,{childList:true,subtree:true}); ensureSyncSurface();
    const enabled=await R.meta.get('syncEnabled',false), acct=await R.meta.get('googleAccount',null), last=await R.meta.get('lastSyncAt',''); uiState.account=acct?.email||''; uiState.lastSync=last||'';
    if(enabled){ if(A.getState().authorized){ setStatus('Local changes pending','Checking Google Drive after reload…'); setTimeout(()=>syncNow({reason:'app startup/reload',interactive:false}).catch(()=>{}),1000); } else setStatus('Reconnect Google','Google sync is enabled, but authorization is not available in this browser session.'); }
    else setStatus('Disconnected','Progress is currently stored locally in this isolated TEST build.');
  }
  R.sync={syncNow,connect,disconnect,markDirty,getState:()=>({...uiState}),runValidate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
