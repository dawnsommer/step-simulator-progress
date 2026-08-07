(function(){
  'use strict';
  const R=window.StepProgressSync, C=R.config, U=R.util;
  let gisPromise=null, tokenClient=null, tokenClientId='';
  class DriveHttpError extends Error{ constructor(status,message,body){super(message);this.name='DriveHttpError';this.status=status;this.body=body||null;this.reason=body?.error?.errors?.[0]?.reason||body?.error?.status||'';} }
  function emit(){ try{window.dispatchEvent(new CustomEvent('stepsync:auth-change',{detail:getState()}));}catch(e){} }
  function loadSession(){ try{const x=JSON.parse(sessionStorage.getItem(C.TOKEN_SESSION_KEY)||'null');if(x&&x.access_token&&Number(x.expiresAt)>Date.now()+30000)return x;}catch(e){} return null; }
  function saveSession(resp){ const expiresAt=Date.now()+Math.max(0,(Number(resp.expires_in)||3600)*1000-10000); const x={access_token:resp.access_token,scope:resp.scope||'',token_type:resp.token_type||'Bearer',expiresAt}; sessionStorage.setItem(C.TOKEN_SESSION_KEY,JSON.stringify(x)); emit(); return x; }
  function clearToken(){ try{sessionStorage.removeItem(C.TOKEN_SESSION_KEY);}catch(e){} emit(); }
  function getState(){ const t=loadSession(); return {authorized:!!t,expiresAt:t?.expiresAt||0}; }
  async function loadGis(){
    if(window.google?.accounts?.oauth2) return window.google;
    if(gisPromise) return gisPromise;
    gisPromise=new Promise((resolve,reject)=>{ const old=document.querySelector('script[data-step-sync-gis]'); if(old){old.addEventListener('load',()=>resolve(window.google),{once:true});old.addEventListener('error',()=>reject(new Error('Google Identity Services failed to load.')),{once:true});return;} const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;s.dataset.stepSyncGis='1';s.onload=()=>resolve(window.google);s.onerror=()=>reject(new Error('Google Identity Services failed to load.'));document.head.appendChild(s); });
    return gisPromise;
  }
  async function getClientId(){ return String(await R.meta.get('googleClientId','')||'').trim(); }
  async function setClientId(id){ id=String(id||'').trim(); if(id && !/\.apps\.googleusercontent\.com$/i.test(id)) throw new Error('This does not look like a Google OAuth Web Client ID.'); await R.meta.set('googleClientId',id); tokenClient=null; tokenClientId=''; return id; }
  async function ensureClient(){
    const id=await getClientId(); if(!id) throw new Error('Add your Google OAuth Web Client ID in Sync Lab settings first.');
    await loadGis();
    if(tokenClient && tokenClientId===id) return tokenClient;
    tokenClientId=id;
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:C.DRIVE_SCOPE,include_granted_scopes:true,callback:()=>{},error_callback:()=>{}});
    return tokenClient;
  }
  async function requestToken({forceConsent=false}={}){
    const client=await ensureClient();
    return await new Promise((resolve,reject)=>{
      let settled=false;
      client.callback=(resp)=>{ if(settled)return; settled=true; if(resp?.error)return reject(new Error(resp.error_description||resp.error)); if(!resp?.access_token)return reject(new Error('Google did not return an access token.')); try{ if(window.google?.accounts?.oauth2?.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp,C.DRIVE_SCOPE)) return reject(new Error('Google Drive app-data permission was not granted.')); }catch(e){} resolve(saveSession(resp)); };
      client.error_callback=(err)=>{ if(settled)return; settled=true; reject(new Error(err?.message||err?.type||'Google authorization window was closed or blocked.')); };
      try{ client.requestAccessToken({prompt:forceConsent?'consent':''}); }catch(e){settled=true;reject(e);}
    });
  }
  async function driveFetch(url,opts={}){
    const token=loadSession(); if(!token) throw new DriveHttpError(401,'Google authorization is unavailable. Reconnect Google.',null);
    const headers=new Headers(opts.headers||{}); headers.set('Authorization','Bearer '+token.access_token);
    const resp=await fetch(url,{...opts,headers});
    if(resp.ok) return resp;
    let body=null,text=''; try{text=await resp.text();body=text?JSON.parse(text):null;}catch(e){}
    const msg=body?.error?.message || text || `Google Drive HTTP ${resp.status}`;
    if(resp.status===401) clearToken();
    throw new DriveHttpError(resp.status,msg,body);
  }
  async function validate(){
    const resp=await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)');
    const data=await resp.json(); const account=data?.user||{}; await R.meta.set('googleAccount',{email:account.emailAddress||'',displayName:account.displayName||'',permissionId:account.permissionId||'',validatedAt:U.iso()}); emit(); return account;
  }
  async function connect(opts={}){ await requestToken({forceConsent:!!opts.forceConsent}); return await validate(); }
  function disconnect(){ clearToken(); }
  R.auth={DriveHttpError,getState,getClientId,setClientId,requestToken,validate,connect,disconnect,driveFetch,loadGis};
})();
