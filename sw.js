const BUILD = 'STEP-PROGRESS-TEST-3';
const CACHE_PREFIX = 'step-simulator-progress-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD}`;
const INDEX_KEY = `./index.html?v=${BUILD}`;
const APP_SHELL = [
  './', INDEX_KEY, './offline.html', './privacy.html', './manifest.webmanifest', './jszip.min.js',
  './js/sync-config.js?v='+BUILD, './js/sync-merge.js?v='+BUILD, './js/sync-storage.js?v='+BUILD,
  './js/google-auth.js?v='+BUILD, './js/progress-sync.js?v='+BUILD,
  './icons/icon-192.png', './icons/icon-512.png',
  './ui_icons/prev.png', './ui_icons/next.png', './ui_icons/lab.png', './ui_icons/notes.png',
  './ui_icons/calculator.png', './ui_icons/settings.png', './ui_icons/lock.png', './ui_icons/endblock.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const req=event.request, url=new URL(req.url);
  const isNav=req.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  const isCritical=url.origin===location.origin && (url.pathname.includes('/js/') || url.pathname.endsWith('/manifest.webmanifest'));
  if(isNav || isCritical){
    event.respondWith(fetch(req,{cache:'no-store'}).then(resp=>{
      if(resp.ok){const copy=resp.clone();caches.open(CACHE_NAME).then(c=>c.put(isNav?INDEX_KEY:req,copy)).catch(()=>{});} return resp;
    }).catch(()=>caches.match(isNav?INDEX_KEY:req).then(hit=>hit||caches.match('./offline.html'))));
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(resp=>{
    if(resp.ok && url.origin===location.origin){const copy=resp.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy)).catch(()=>{});} return resp;
  }).catch(()=>caches.match('./offline.html'))));
});
