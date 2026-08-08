(function(){
  'use strict';
  const ROOT = window.StepProgressSync = window.StepProgressSync || {};

  /* Production migration should require changing only this block. */
  const CLOUD_CONFIG = Object.freeze({
    appId: 'step-simulator-progress',
    workerBaseUrl: 'https://study-tools-auth-worker.summerofdawn20.workers.dev',
    returnUrl: 'https://dawnsommer.github.io/step-simulator-progress/',
    driveFilePrefix: 'step-simulator-progress.TEST',
    callbackParam: 'cloud-auth'
  });

  const C = ROOT.config = Object.freeze({
    CLOUD: CLOUD_CONFIG,
    APP_NAME: CLOUD_CONFIG.appId,
    BUILD: 'STEP-PROGRESS-TEST-7',
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
    MANIFEST_FILE: `${CLOUD_CONFIG.driveFilePrefix}.manifest.json`,
    MANIFEST_TYPE: 'step-simulator-progress-test-manifest',
    FORM_BACKUP_TYPE: 'step-simulator-progress-test-form-backup',
    QBANK_BACKUP_TYPE: 'step-simulator-progress-test-qbank-backup',
    SCHEMA_VERSION: 1,
    LIBRARY_MANIFEST_FILE: `${CLOUD_CONFIG.driveFilePrefix}.library.manifest.json`,
    LIBRARY_MANIFEST_TYPE: 'step-simulator-progress-test-library-manifest',
    LIBRARY_SCHEMA_VERSION: 1,
    LIBRARY_TRANSFER_DB: 'StepSimulatorProgress_LIBRARY_TRANSFER_TEST_DB',
    LIBRARY_TRANSFER_STORE: 'chunks',
    LIBRARY_CHUNK_SIZE: 4 * 1024 * 1024,
    META_DB: 'StepSimulatorProgress_SYNC_META_TEST_DB',
    META_STORE: 'kv',
    WORKER_SESSION_META_KEY: 'cloudWorkerSession',
    ACCESS_TOKEN_SKEW_MS: 60 * 1000,
    CACHE_PREFIX: 'step-simulator-progress-',
    PROD_WARNING: 'TEST BUILD — isolated browser storage and isolated Google Drive appData backups.'
  });

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(C.META_DB,1);
      req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(C.META_STORE)) req.result.createObjectStore(C.META_STORE); };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error('Could not open sync metadata database.'));
    });
  }
  ROOT.meta={
    async get(key,fallback=null){const db=await openDb();try{return await new Promise((res,rej)=>{const tx=db.transaction(C.META_STORE,'readonly');const r=tx.objectStore(C.META_STORE).get(key);r.onsuccess=()=>res(r.result===undefined?fallback:r.result);r.onerror=()=>rej(r.error);});}finally{db.close();}},
    async set(key,val){const db=await openDb();try{await new Promise((res,rej)=>{const tx=db.transaction(C.META_STORE,'readwrite');tx.objectStore(C.META_STORE).put(val,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}finally{db.close();}return val;},
    async del(key){const db=await openDb();try{await new Promise((res,rej)=>{const tx=db.transaction(C.META_STORE,'readwrite');tx.objectStore(C.META_STORE).delete(key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async deviceId(){let id=await this.get('deviceId','');if(!id){id=(crypto.randomUUID?crypto.randomUUID():('dev_'+Date.now()+'_'+Math.random().toString(36).slice(2)));await this.set('deviceId',id);}return id;}
  };
  ROOT.util={
    clone(v){try{return structuredClone(v);}catch(e){try{return JSON.parse(JSON.stringify(v));}catch(_e){return v;}}},
    iso(){return new Date().toISOString();},
    parseJson(text,label='JSON'){try{return JSON.parse(text);}catch(e){throw new Error(`${label} is malformed JSON: ${e.message}`);}},
    async sha256Text(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');},
    stable(v){const seen=new WeakSet();const sort=x=>{if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object'){if(seen.has(x))return '[Circular]';seen.add(x);const o={};Object.keys(x).sort().forEach(k=>{if(x[k]!==undefined)o[k]=sort(x[k]);});return o;}return x;};return JSON.stringify(sort(v));},
    validDate(v){const n=Date.parse(v||'');return Number.isFinite(n)?n:0;},
    safeName(v){return String(v||'FORM').replace(/[^a-z0-9._-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,80)||'FORM';},
    uuid(){return crypto.randomUUID?crypto.randomUUID():('id_'+Date.now()+'_'+Math.random().toString(36).slice(2));}
  };
  window.STEP_SIMULATOR_PROGRESS_BUILD=C.BUILD;
})();
