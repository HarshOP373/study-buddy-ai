const SHELL_CACHE="kinstudy-shell-v6";
const RUNTIME_CACHE="kinstudy-runtime-v6";
const SHELL=["./","./index.html","./style.css?v=6","./app.js?v=6","./study-data.json","./manifest.json"];
const CDN_HOSTS=["esm.run","cdn.jsdelivr.net","huggingface.co","www.huggingface.co","raw.githubusercontent.com","cdn-lfs.huggingface.co"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(SHELL_CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![SHELL_CACHE,RUNTIME_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});
async function cacheFirst(request){const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok||response.type==="opaque"){const c=await caches.open(RUNTIME_CACHE);try{await c.put(request,response.clone())}catch{}}return response}
self.addEventListener("fetch",event=>{const req=event.request;if(req.method!=="GET")return;const url=new URL(req.url);if(url.origin===location.origin){event.respondWith((async()=>{const cached=await caches.match(req);if(cached)return cached;try{const res=await fetch(req);if(res.ok){const c=await caches.open(SHELL_CACHE);c.put(req,res.clone())}return res}catch{return caches.match("./index.html")}})());return}
if(CDN_HOSTS.includes(url.hostname)){event.respondWith(cacheFirst(req).catch(()=>new Response("Offline resource unavailable",{status:503})))}});
