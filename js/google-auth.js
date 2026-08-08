(function(){
  'use strict';
  const R=window.StepProgressSync, C=R.config, U=R.util, CLOUD=C.CLOUD;

  let initPromise=null;
  let workerSessionPresent=false;
  let accountCache=null;
  let accessCache=null; // Google access token: memory only.
  let pendingCallbackSession='';

  class DriveHttpError extends Error{
    constructor(status,message,body){super(message);this.name='DriveHttpError';this.status=status;this.body=body||null;this.reason=body?.error?.errors?.[0]?.reason||body?.error?.status||'';}
  }
  class WorkerAuthError extends Error{
    constructor(status,message,body){super(message);this.name='WorkerAuthError';this.status=status;this.body=body||null;this.reason=body?.error||body?.reason||'';}
  }

  function emit(){try{window.dispatchEvent(new CustomEvent('stepsync:auth-change',{detail:getState()}));}catch(_e){}}
  function clearAccessToken(){accessCache=null;emit();}
  function getState(){
    const valid=!!(accessCache?.accessToken && Number(accessCache.expiresAt)>Date.now()+C.ACCESS_TOKEN_SKEW_MS);
    return {authorized:workerSessionPresent,workerSession:workerSessionPresent,accessTokenCached:valid,expiresAt:valid?accessCache.expiresAt:0,accountEmail:accountCache?.email||''};
  }

  /* Capture the opaque Worker session immediately and remove it from the visible URL.
     The fragment is never logged and is not sent in network requests. */
  (function captureCallbackFragment(){
    try{
      const raw=String(location.hash||'').replace(/^#/,'');
      if(!raw)return;
      const params=new URLSearchParams(raw);
      const token=params.get(CLOUD.callbackParam);
      if(!token)return;
      pendingCallbackSession=token;
      params.delete(CLOUD.callbackParam);
      const next=params.toString();
      history.replaceState(history.state,'',location.pathname+location.search+(next?'#'+next:''));
    }catch(_e){}
  })();

  async function initialize(){
    if(initPromise)return initPromise;
    try{sessionStorage.removeItem('StepSimulatorProgress_TEST_GoogleToken');}catch(_e){}
    initPromise=(async()=>{
      if(pendingCallbackSession){
        await R.meta.set(C.WORKER_SESSION_META_KEY,pendingCallbackSession);
        await R.meta.set('syncEnabled',true);
        await R.meta.set('cloudAuthCallbackAt',U.iso());
        pendingCallbackSession='';
      }
      const sess=await R.meta.get(C.WORKER_SESSION_META_KEY,'');
      workerSessionPresent=!!sess;
      accountCache=await R.meta.get('googleAccount',null);
      emit();
      return {workerSessionPresent,callbackCaptured:!!(await R.meta.get('cloudAuthCallbackAt','')),account:accountCache};
    })();
    return initPromise;
  }

  async function getWorkerSession(){
    await initialize();
    const session=await R.meta.get(C.WORKER_SESSION_META_KEY,'');
    workerSessionPresent=!!session;
    return session;
  }

  async function clearWorkerSession({clearAccount=true}={}){
    await R.meta.del(C.WORKER_SESSION_META_KEY);
    workerSessionPresent=false;
    clearAccessToken();
    if(clearAccount){accountCache=null;await R.meta.del('googleAccount');}
    emit();
  }

  async function parseResponseBody(resp){
    let text='';try{text=await resp.text();}catch(_e){}
    if(!text)return {text:'',body:null};
    try{return {text,body:JSON.parse(text)};}catch(_e){return {text,body:null};}
  }

  async function requestWorkerAccessToken(){
    const session=await getWorkerSession();
    if(!session)throw new WorkerAuthError(401,'Cloud authentication session is unavailable. Reconnect Google.',null);
    let resp;
    try{
      resp=await fetch(CLOUD.workerBaseUrl+'/token',{
        method:'POST',
        headers:{'Authorization':'Bearer '+session,'Accept':'application/json'},
        cache:'no-store',
        credentials:'omit'
      });
    }catch(e){throw new WorkerAuthError(0,'Authentication service is unreachable. Local progress is safe.',null);}
    const {text,body}=await parseResponseBody(resp);
    if(!resp.ok){
      const msg=body?.error_description||body?.message||body?.error||text||`Authentication service HTTP ${resp.status}`;
      if(resp.status===401)await clearWorkerSession({clearAccount:true});
      throw new WorkerAuthError(resp.status,msg,body);
    }
    const accessToken=body?.accessToken||body?.access_token||'';
    const expiresIn=Number(body?.expiresIn??body?.expires_in??3600);
    const tokenType=body?.tokenType||body?.token_type||'Bearer';
    const appId=body?.appId||body?.app_id||'';
    if(!accessToken)throw new WorkerAuthError(502,'Authentication service did not return a Google Drive access token.',body);
    if(appId && appId!==CLOUD.appId)throw new WorkerAuthError(403,'Authentication session belongs to a different application.',body);
    accessCache={accessToken,tokenType,expiresAt:Date.now()+Math.max(0,expiresIn*1000)};
    const email=String(body?.email||'');
    if(email){
      accountCache={...(accountCache||{}),email,emailAddress:email,validatedAt:U.iso(),source:'oauth-worker'};
      await R.meta.set('googleAccount',accountCache);
    }
    workerSessionPresent=true;
    emit();
    return accessCache;
  }

  async function getValidDriveAccessToken(){
    await initialize();
    if(accessCache?.accessToken && Number(accessCache.expiresAt)>Date.now()+C.ACCESS_TOKEN_SKEW_MS)return accessCache.accessToken;
    const fresh=await requestWorkerAccessToken();
    return fresh.accessToken;
  }

  async function connect(){
    await initialize();
    const deviceId=await R.meta.deviceId();
    await R.meta.set('syncEnabled',true);
    await R.meta.set('cloudConnectStartedAt',U.iso());
    const qs=new URLSearchParams({app_id:CLOUD.appId,return_url:CLOUD.returnUrl,device_id:deviceId});
    location.assign(CLOUD.workerBaseUrl+'/oauth/start?'+qs.toString());
  }

  async function disconnect(){
    await initialize();
    const session=await getWorkerSession();
    let warning='';
    if(session){
      try{
        const resp=await fetch(CLOUD.workerBaseUrl+'/disconnect',{
          method:'POST',headers:{'Authorization':'Bearer '+session,'Accept':'application/json'},cache:'no-store',credentials:'omit'
        });
        if(!resp.ok && resp.status!==401){const p=await parseResponseBody(resp);warning=p.body?.message||p.body?.error||p.text||`Authentication service HTTP ${resp.status}`;}
      }catch(_e){warning='The remote device session could not be invalidated because the authentication service was unreachable.';}
    }
    await clearWorkerSession({clearAccount:true});
    return {warning};
  }

  async function driveFetch(url,opts={}){
    const {acceptStatuses=[], ...fetchOpts}=opts||{};
    for(let attempt=0;attempt<2;attempt++){
      const token=await getValidDriveAccessToken();
      const headers=new Headers(fetchOpts.headers||{});headers.set('Authorization','Bearer '+token);
      let resp;
      try{resp=await fetch(url,{...fetchOpts,headers,cache:fetchOpts.cache||'no-store'});}catch(e){throw new DriveHttpError(0,'Google Drive is unreachable. Local progress is safe.',null);}
      if(resp.ok||acceptStatuses.includes(resp.status))return resp;
      if(resp.status===401 && attempt===0){clearAccessToken();continue;}
      const {text,body}=await parseResponseBody(resp);
      const msg=body?.error?.message||text||`Google Drive HTTP ${resp.status}`;
      throw new DriveHttpError(resp.status,msg,body);
    }
    throw new DriveHttpError(401,'Google Drive authorization could not be refreshed.',null);
  }

  async function validate(){
    const resp=await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)');
    const data=await resp.json();const user=data?.user||{};
    const email=user.emailAddress||accountCache?.email||'';
    accountCache={email,emailAddress:email,displayName:user.displayName||accountCache?.displayName||'',permissionId:user.permissionId||'',validatedAt:U.iso(),source:'drive-about'};
    await R.meta.set('googleAccount',accountCache);emit();return user.emailAddress?user:accountCache;
  }

  R.auth={DriveHttpError,WorkerAuthError,initialize,getState,getValidDriveAccessToken,validate,connect,disconnect,driveFetch,clearAccessToken};
})();
