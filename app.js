import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = id => document.getElementById(id);
const ids = ["sidebar","closeSidebarBtn","newChatBtn","chatList","themeBtn","settingsBtn","menuBtn","chatTitle","connectionText","modeSelect","modelSelect","offlinePanel","webgpuStatus","loadModelBtn","freeModelBtn","modelProgress","modelProgressText","messages","welcome","fileInput","attachBtn","promptInput","stopBtn","sendBtn","tokenEstimate","attachmentCard","attachmentName","attachmentStatus","clearAttachmentBtn","settingsModal","closeSettingsBtn","apiKeyInput","instructionsInput","thinkingSelect","exportBtn","saveSettingsBtn","toast"];
const els = Object.fromEntries(ids.map(id => [id, $(id)]));

const ONLINE_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" }
];

// These are resolved against WebLLM's actual prebuilt catalog at runtime.
const OFFLINE_TEXT_WANTED = [
  { key: "smol360", name: "SmolLM2 360M", match: ["smollm2-360m-instruct-q4f16_1-mlc"] },
  { key: "qwen05", name: "Qwen 2.5 0.5B", match: ["qwen2.5-0.5b-instruct-q4f16_1-mlc"] },
  { key: "qwen15", name: "Qwen 2.5 1.5B Instruct", match: ["qwen2.5-1.5b-instruct-q4f16_1-mlc"] },
  { key: "coder15", name: "Qwen 2.5 Coder 1.5B", match: ["qwen2.5-coder-1.5b-instruct-q4f16_1-mlc"] }
];

// Vision is deliberately separate from WebLLM. This is the only VLM in KinStudy.
const VISION_MODEL = {
  key: "smolvlm500",
  id: "HuggingFaceTB/SmolVLM-500M-Instruct",
  name: "SmolVLM 500M",
  task: "image-text-to-text"
};

const DEFAULT_INSTRUCTIONS = "You are KinStudy Pro, a helpful study and coding assistant. Explain accurately, show steps when useful, do not invent facts, and distinguish uncertainty. Use verified study context only when relevant.";

let state = {
  chats: [], currentId: null,
  theme: localStorage.getItem("ks_theme") || "dark",
  mode: localStorage.getItem("ks_mode") || "online",
  onlineModel: localStorage.getItem("ks_online_model") || ONLINE_MODELS[0].id,
  offlineKey: localStorage.getItem("ks_offline_key") || "smol360",
  apiKey: localStorage.getItem("ks_api_key") || "",
  instructions: localStorage.getItem("ks_instructions") || DEFAULT_INSTRUCTIONS,
  thinking: localStorage.getItem("ks_thinking") || "medium",
  attachment: null,
  studyData: [],
  engine: null,
  loadedModelId: null,
  generating: false,
  aborter: null,
  webgpu: false,
  offlineCatalog: [],
  visionPipe: null,
  visionLoaded: false
};

function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}
function saveChats(){localStorage.setItem("ks_chats_v4",JSON.stringify(state.chats))}
function loadChats(){try{state.chats=JSON.parse(localStorage.getItem("ks_chats_v4")||"[]")}catch{state.chats=[]} if(!state.chats.length)newChat(false); else state.currentId=localStorage.getItem("ks_current_chat")||state.chats[0].id}
function currentChat(){return state.chats.find(c=>c.id===state.currentId)}
function toast(msg,ms=2800){els.toast.textContent=msg;els.toast.classList.remove("hidden");clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.add("hidden"),ms)}
function setTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;localStorage.setItem("ks_theme",theme);const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==="light"?"#f7f8fb":"#0b0d12"}
function escapeHtml(s=""){return String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function renderMarkdown(text){if(window.marked&&window.DOMPurify){marked.setOptions({gfm:true,breaks:true});return DOMPurify.sanitize(marked.parse(text||""),{ADD_ATTR:["target"]})}return `<p>${escapeHtml(text).replace(/\n/g,"<br>")}</p>`}
function estimateTokens(text=""){return Math.max(0,Math.ceil(String(text).length/4))}
function updateTokenEstimate(){let n=estimateTokens(els.promptInput.value);if(state.attachment?.text)n+=estimateTokens(state.attachment.text);els.tokenEstimate.textContent=`~${n.toLocaleString()} tokens`}
function autoGrow(){els.promptInput.style.height="auto";els.promptInput.style.height=Math.min(180,els.promptInput.scrollHeight)+"px"}
function setConnection(msg){els.connectionText.textContent=msg}

function newChat(save=true){const chat={id:uid(),title:"New chat",messages:[]};state.chats.unshift(chat);state.currentId=chat.id;if(save)saveChats();localStorage.setItem("ks_current_chat",state.currentId);renderChatList();renderMessages();if(innerWidth<=820)els.sidebar.classList.remove("open")}
function renderChatList(){els.chatList.innerHTML=state.chats.map(c=>`<div class="chat-item ${c.id===state.currentId?"active":""}"><button class="chat-open" data-chat="${c.id}">${escapeHtml(c.title||"New chat")}</button><button class="chat-delete" data-delete="${c.id}" aria-label="Delete chat">×</button></div>`).join("");els.chatList.querySelectorAll("[data-chat]").forEach(b=>b.onclick=()=>{state.currentId=b.dataset.chat;localStorage.setItem("ks_current_chat",state.currentId);renderChatList();renderMessages();});els.chatList.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{const id=b.dataset.delete;state.chats=state.chats.filter(c=>c.id!==id);if(!state.chats.length)newChat(false);else if(state.currentId===id)state.currentId=state.chats[0].id;saveChats();localStorage.setItem("ks_current_chat",state.currentId);renderChatList();renderMessages()})}
function renderMessages(){const c=currentChat();els.chatTitle.textContent=c?.title||"New chat";if(!c?.messages?.length){els.welcome.classList.remove("hidden");els.messages.querySelectorAll(".message").forEach(x=>x.remove());return}els.welcome.classList.add("hidden");els.messages.querySelectorAll(".message").forEach(x=>x.remove());for(const m of c.messages)appendMessage(m);scrollBottom()}
function appendMessage(m){const wrap=document.createElement("article");wrap.className=`message ${m.role}`;wrap.dataset.messageId=m.id;wrap.innerHTML=`<div class="avatar">${m.role==="user"?"Y":"K"}</div><div class="message-body"><div class="message-head">${m.role==="user"?"You":"KinStudy"}</div><div class="message-content">${renderMarkdown(m.content||"")}</div>${m.attachmentName?`<div class="attachment-inline">📎 ${escapeHtml(m.attachmentName)}</div>`:""}</div>`;els.messages.appendChild(wrap);wrap.querySelectorAll("pre").forEach(pre=>{const btn=document.createElement("button");btn.className="copy-code";btn.textContent="Copy code";btn.onclick=async()=>{await navigator.clipboard?.writeText(pre.querySelector("code")?.innerText||pre.innerText);btn.textContent="Copied";setTimeout(()=>btn.textContent="Copy code",1200)};pre.appendChild(btn)});return wrap}
function updateMessage(m){const el=els.messages.querySelector(`[data-message-id="${CSS.escape(m.id)}"]`);if(!el)return;el.querySelector(".message-content").innerHTML=renderMarkdown(m.content||"");el.querySelectorAll("pre").forEach(pre=>{if(pre.querySelector(".copy-code"))return;const btn=document.createElement("button");btn.className="copy-code";btn.textContent="Copy code";btn.onclick=async()=>{await navigator.clipboard?.writeText(pre.querySelector("code")?.innerText||pre.innerText);btn.textContent="Copied";setTimeout(()=>btn.textContent="Copy code",1200)};pre.appendChild(btn)});scrollBottom()}
function scrollBottom(){requestAnimationFrame(()=>els.messages.scrollTop=els.messages.scrollHeight)}

function resolveOfflineCatalog(){
  const list=webllm.prebuiltAppConfig?.model_list||[];
  state.offlineCatalog=OFFLINE_TEXT_WANTED.map(w=>{const found=list.find(m=>w.match.some(x=>String(m.model_id||m.model||"").toLowerCase()===x.toLowerCase()));return found?{...w,model:found}:null}).filter(Boolean);
}
function populateModels(){
  els.modelSelect.innerHTML="";
  if(state.mode==="online"){
    for(const m of ONLINE_MODELS){const o=document.createElement("option");o.value=m.id;o.textContent=m.name;els.modelSelect.appendChild(o)}
    els.modelSelect.value=ONLINE_MODELS.some(m=>m.id===state.onlineModel)?state.onlineModel:ONLINE_MODELS[0].id;
    els.offlinePanel.classList.add("hidden");
  }else{
    for(const m of state.offlineCatalog){const o=document.createElement("option");o.value=m.key;o.textContent=`🧠 ${m.name}`;els.modelSelect.appendChild(o)}
    const v=document.createElement("option");v.value=VISION_MODEL.key;v.textContent="👁️ SmolVLM 500M • Vision";els.modelSelect.appendChild(v);
    els.modelSelect.value=[...state.offlineCatalog.map(x=>x.key),VISION_MODEL.key].includes(state.offlineKey)?state.offlineKey:(state.offlineCatalog[0]?.key||VISION_MODEL.key);
    state.offlineKey=els.modelSelect.value;
    els.offlinePanel.classList.remove("hidden");
    updateOfflinePanel();
  }
}
function selectedOffline(){if(state.offlineKey===VISION_MODEL.key)return VISION_MODEL;return state.offlineCatalog.find(x=>x.key===state.offlineKey)?.model||null}
function updateOfflinePanel(){const vision=state.offlineKey===VISION_MODEL.key;els.freeModelBtn.disabled=vision?!state.visionLoaded:!state.engine;if(vision){els.webgpuStatus.textContent=state.webgpu?"WebGPU detected • vision runtime":"WebGPU unavailable • fallback may be slower";els.modelProgressText.textContent=state.visionLoaded?"SmolVLM 500M is loaded.":"Load SmolVLM 500M for offline image/video understanding."}else{els.webgpuStatus.textContent=state.webgpu?"WebGPU detected":"WebGPU unavailable";els.modelProgressText.textContent=state.loadedModelId?`Loaded: ${state.loadedModelId}`:"Text engine is not loaded."}}

async function checkWebGPU(){state.webgpu=!!navigator.gpu;els.webgpuStatus.textContent=state.webgpu?"WebGPU API detected":"WebGPU not detected — offline may not work on this browser"}
async function loadOfflineModel(){
  if(state.offlineKey===VISION_MODEL.key)return loadVision();
  const entry=state.offlineCatalog.find(x=>x.key===state.offlineKey);if(!entry)throw toast("This text model is not in the current WebLLM catalog.");
  if(!state.webgpu){toast("Safari did not expose WebGPU. Offline WebLLM cannot be loaded here.",4200);return}
  if(state.loadedModelId===entry.model.model_id){toast("That model is already loaded.");return}
  if(state.engine)await freeOfflineModel();
  els.loadModelBtn.disabled=true;els.modelProgress.style.width="0%";els.modelProgressText.textContent=`Loading ${entry.name}…`;
  try{state.engine=await webllm.CreateMLCEngine(entry.model.model_id,{appConfig:webllm.prebuiltAppConfig,initProgressCallback:p=>{const pct=Math.round((p.progress||0)*100);els.modelProgress.style.width=`${pct}%`;els.modelProgressText.textContent=p.text||`Loading… ${pct}%`}});state.loadedModelId=entry.model.model_id;toast(`${entry.name} loaded`)}catch(e){state.engine=null;state.loadedModelId=null;toast(`Could not load ${entry.name}: ${friendlyError(e)}`,6000);console.error(e)}finally{els.loadModelBtn.disabled=false;updateOfflinePanel();setConnection("Offline • "+entry.name)}}
async function freeOfflineModel(){try{state.engine?.unload?.();state.engine?.terminate?.();}catch{}state.engine=null;state.loadedModelId=null;try{state.visionPipe=null;state.visionLoaded=false}catch{}els.modelProgress.style.width="0%";els.modelProgressText.textContent="Engine freed. Choose another model and Load Engine.";updateOfflinePanel();setConnection("Offline • engine not loaded");toast("Engine freed")}

async function loadVision(){
  if(state.visionLoaded){toast("SmolVLM 500M is already loaded.");return}
  if(state.engine)await freeOfflineModel();
  els.loadModelBtn.disabled=true;els.modelProgress.style.width="5%";els.modelProgressText.textContent="Loading SmolVLM 500M… first load downloads model files.";
  try{
    state.visionPipe=await pipeline("image-text-to-text",VISION_MODEL.id,{device:state.webgpu?"webgpu":"wasm",dtype:"q4",progress_callback:p=>{const total=p.total||0;const loaded=p.loaded||0;const pct=total?Math.min(99,Math.round(loaded/total*100)):5;els.modelProgress.style.width=`${pct}%`;els.modelProgressText.textContent=p.status?`${p.status} ${pct}%`:`Loading SmolVLM 500M… ${pct}%`}});
    state.visionLoaded=true;els.modelProgress.style.width="100%";els.modelProgressText.textContent="SmolVLM 500M is loaded.";toast("SmolVLM 500M loaded")
  }catch(e){state.visionPipe=null;state.visionLoaded=false;toast(`SmolVLM failed to load: ${friendlyError(e)}`,6500);console.error(e)}finally{els.loadModelBtn.disabled=false;updateOfflinePanel();setConnection("Offline • SmolVLM 500M")}}

async function loadStudyData(){try{const r=await fetch("./study-data.json",{cache:"no-store"});if(r.ok){const j=await r.json();state.studyData=j.entries||[]}}catch(e){console.warn("study-data.json unavailable",e)}}
function relevantStudy(text){const q=text.toLowerCase();return state.studyData.filter(e=>{const hay=[e.title,e.subject,e.topic,e.keywords?.join(" "),e.content].join(" ").toLowerCase();return q.split(/\W+/).filter(x=>x.length>3).some(w=>hay.includes(w))}).slice(0,4)}
function buildSystem(userText){const relevant=relevantStudy(userText);let s=state.instructions||DEFAULT_INSTRUCTIONS;if(relevant.length)s+=`\n\nVerified study context. Use only if relevant:\n${relevant.map(x=>`- ${x.title}: ${x.content}`).join("\n")}`;return s}

async function parseFile(file){
  if(!file)return null;
  const type=file.type||"";const name=file.name||"file";els.attachmentCard.classList.remove("hidden");els.attachmentName.textContent=name;els.attachmentStatus.textContent="Reading…";
  if(type.startsWith("image/")){const url=URL.createObjectURL(file);return {name,type,kind:"image",file,url,text:""}}
  if(type.startsWith("video/")){const url=URL.createObjectURL(file);return {name,type,kind:"video",file,url,text:""}}
  if(type==="application/pdf"||name.toLowerCase().endsWith(".pdf")){try{const pdfjs=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs";const buf=await file.arrayBuffer();const pdf=await pdfjs.getDocument({data:buf}).promise;let text="";for(let i=1;i<=pdf.numPages;i++){els.attachmentStatus.textContent=`Reading PDF: Page ${i} of ${pdf.numPages}…`;const page=await pdf.getPage(i);const content=await page.getTextContent();text+=`\n[Page ${i}]\n`+content.items.map(x=>x.str).join(" ")}return {name,type,kind:"pdf",file,text:text.trim()}}catch(e){throw new Error("PDF reading failed: "+e.message)}}
  const text=await file.text();return {name,type,kind:"text",file,text:text.slice(0,120000)}
}
async function handleFile(file){try{state.attachment=await parseFile(file);els.attachmentStatus.textContent=state.attachment.kind==="pdf"?"PDF text extracted":"Ready";updateTokenEstimate();toast(`${file.name} attached`)}catch(e){clearAttachment();toast(e.message,5000)}}
function clearAttachment(){if(state.attachment?.url)URL.revokeObjectURL(state.attachment.url);state.attachment=null;els.fileInput.value="";els.attachmentCard.classList.add("hidden");els.attachmentName.textContent="";els.attachmentStatus.textContent="";updateTokenEstimate()}

async function saveFileLocally(){if(!state.attachment?.file){toast("Attach a file first.");return}try{const db=await openFileDB();await new Promise((res,rej)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put({id:uid(),name:state.attachment.name,type:state.attachment.type,blob:state.attachment.file,created:Date.now()});tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});toast("File saved in KinStudy local storage")}catch(e){toast("Browser local file storage is unavailable on this device.")}}
function openFileDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open("kinstudy-files",1);r.onupgradeneeded=()=>r.result.createObjectStore("files",{keyPath:"id"});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}

async function imageToDataURL(file){return new Promise((resolve,reject)=>{const img=new Image();const u=URL.createObjectURL(file);img.onload=()=>{const max=1280,scale=Math.min(1,max/img.width,max/img.height),c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);resolve(c.toDataURL("image/jpeg",.86))};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error("Image could not be decoded."))};img.src=u})}
async function videoFrames(file,count=4){const url=URL.createObjectURL(file);const v=document.createElement("video");v.src=url;v.muted=true;v.playsInline=true;await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=()=>rej(new Error("Video could not be opened."))});const out=[];const duration=v.duration||0;for(let i=0;i<count;i++){const t=duration*(i+1)/(count+1);await new Promise((res,rej)=>{v.currentTime=t;v.onseeked=res;v.onerror=()=>rej(new Error("Could not seek video."))});const c=document.createElement("canvas");const scale=Math.min(1,1280/v.videoWidth,1280/v.videoHeight);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext("2d").drawImage(v,0,0,c.width,c.height);out.push(c.toDataURL("image/jpeg",.82))}URL.revokeObjectURL(url);return out}

async function generateVision(prompt,attachment){
  if(!state.visionLoaded)await loadVision();if(!state.visionPipe)throw new Error("SmolVLM 500M is not loaded.");
  const images=[];if(attachment.kind==="image")images.push(await imageToDataURL(attachment.file));else if(attachment.kind==="video")images.push(...await videoFrames(attachment.file,4));else throw new Error("SmolVLM needs an image or video attachment.");
  const question=prompt||"Describe and analyze the provided visual for a student. Extract useful details and explain uncertainty.";
  let combined="";for(let i=0;i<images.length;i++){els.modelProgressText.textContent=`Analyzing frame ${i+1} of ${images.length}…`;const result=await state.visionPipe([{role:"user",content:[{type:"image",url:images[i]},{type:"text",text:question}]}],{max_new_tokens:350});combined+=`${images.length>1?`Frame ${i+1}: `:""}${extractPipelineText(result)}\n\n`}return combined.trim()
}
function extractPipelineText(r){if(typeof r==="string")return r;if(Array.isArray(r)){const x=r[r.length-1];return x?.generated_text||x?.text||JSON.stringify(x)}return r?.generated_text||r?.text||JSON.stringify(r)}

async function generateOnline(prompt,msg,attachment){
  if(!state.apiKey)throw new Error("Add your Gemini API key in Settings first.");
  const contents=[{role:"user",parts:[{text:prompt}]}];if(attachment?.text)contents[0].parts.push({text:`\n\nAttached file (${attachment.name}):\n${attachment.text}`});
  const body={system_instruction:{parts:[{text:buildSystem(prompt)}]},contents,generationConfig:{thinkingConfig:{thinkingLevel:state.thinking}}};
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.onlineModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(state.apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:state.aborter.signal});
  if(!r.ok)throw new Error(`Gemini API ${r.status}: ${(await r.text()).slice(0,500)}`);const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="";
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n");buffer=lines.pop()||"";for(const line of lines){if(!line.startsWith("data:"))continue;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")continue;try{const j=JSON.parse(raw);const parts=j.candidates?.[0]?.content?.parts||[];for(const p of parts){if(p.text){msg.content+=p.text;updateMessage(msg)}}}catch{}}}}

async function generateOffline(prompt,msg,attachment){
  if(state.offlineKey===VISION_MODEL.key){if(!attachment||!['image','video'].includes(attachment.kind))throw new Error("Select an image or video for SmolVLM 500M.");msg.content=await generateVision(prompt,attachment);updateMessage(msg);return}
  if(!state.engine)throw new Error("Load an offline text model first.");const messages=[{role:"system",content:buildSystem(prompt)}];let user=prompt;if(attachment?.text)user+=`\n\nAttached file (${attachment.name}):\n${attachment.text}`;messages.push({role:"user",content:user});
  const stream=await state.engine.chat.completions.create({messages,temperature:.4,max_tokens:900,stream:true});for await(const chunk of stream){if(state.aborter.signal.aborted)break;const piece=chunk.choices?.[0]?.delta?.content||"";if(piece){msg.content+=piece;updateMessage(msg)}}
}

async function sendMessage(prefill=null){if(state.generating)return;const text=(prefill??els.promptInput.value).trim();if(!text&&!state.attachment)return;const attachment=state.attachment;const c=currentChat();if(c.messages.length===0)c.title=(text||attachment?.name||"New chat").slice(0,42);const user={id:uid(),role:"user",content:text||"Analyze this file.",attachmentName:attachment?.name||null};c.messages.push(user);appendMessage(user);const msg={id:uid(),role:"assistant",content:""};c.messages.push(msg);appendMessage(msg);saveChats();renderChatList();els.promptInput.value="";autoGrow();updateTokenEstimate();state.generating=true;state.aborter=new AbortController();els.sendBtn.disabled=true;els.stopBtn.classList.remove("hidden");setConnection("Generating…");try{if(state.mode==="online")await generateOnline(text,msg,attachment);else await generateOffline(text,msg,attachment);if(!msg.content)msg.content="No text response was returned."}catch(e){if(e.name==="AbortError")msg.content+="\n\n_Generation stopped._";else msg.content+=(msg.content?"\n\n":"")+`**Error:** ${friendlyError(e)}`;console.error(e)}finally{state.generating=false;state.aborter=null;els.sendBtn.disabled=false;els.stopBtn.classList.add("hidden");updateMessage(msg);saveChats();clearAttachment();updateOfflinePanel();setConnection(state.mode==="online"?"Online • Gemini":"Offline • "+(state.offlineKey===VISION_MODEL.key?"SmolVLM 500M":(state.loadedModelId?"engine ready":"engine not loaded")))}}
function stopGeneration(){state.aborter?.abort();try{state.engine?.interruptGenerate?.()}catch{}state.generating=false}
function friendlyError(e){const s=String(e?.message||e||"Unknown error");if(/out of memory|device lost|buffer|allocation/i.test(s))return `${s} Try Free RAM and a smaller model.`;if(/failed to fetch|network/i.test(s))return `${s} Check internet access and the first-time model download.`;return s}

function openSettings(){els.apiKeyInput.value=state.apiKey;els.instructionsInput.value=state.instructions;els.thinkingSelect.value=state.thinking;els.settingsModal.classList.remove("hidden")}
function saveSettings(){state.apiKey=els.apiKeyInput.value.trim();state.instructions=els.instructionsInput.value.trim()||DEFAULT_INSTRUCTIONS;state.thinking=els.thinkingSelect.value;localStorage.setItem("ks_api_key",state.apiKey);localStorage.setItem("ks_instructions",state.instructions);localStorage.setItem("ks_thinking",state.thinking);els.settingsModal.classList.add("hidden");toast("Settings saved")}
function exportChat(){const c=currentChat();const md=`# ${c.title}\n\n`+(c.messages||[]).map(m=>`## ${m.role==="user"?"You":"KinStudy"}\n\n${m.content}`).join("\n\n");const blob=new Blob([md],{type:"text/markdown"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${c.title.replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"")||"kinstudy-chat"}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

function bind(){
  els.newChatBtn.onclick=()=>newChat();els.menuBtn.onclick=()=>els.sidebar.classList.add("open");els.closeSidebarBtn.onclick=()=>els.sidebar.classList.remove("open");els.themeBtn.onclick=()=>setTheme(state.theme==="dark"?"light":"dark");els.settingsBtn.onclick=openSettings;els.closeSettingsBtn.onclick=()=>els.settingsModal.classList.add("hidden");els.saveSettingsBtn.onclick=saveSettings;els.exportBtn.onclick=exportChat;els.settingsModal.onclick=e=>{if(e.target===els.settingsModal)els.settingsModal.classList.add("hidden")};els.attachBtn.onclick=()=>els.fileInput.click();els.fileInput.onchange=()=>handleFile(els.fileInput.files[0]);els.clearAttachmentBtn.onclick=clearAttachment;els.sendBtn.onclick=()=>sendMessage();els.stopBtn.onclick=stopGeneration;els.promptInput.oninput=()=>{autoGrow();updateTokenEstimate()};els.promptInput.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}};document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>sendMessage(b.dataset.prompt));
  els.modeSelect.onchange=()=>{if(state.engine||state.visionLoaded)freeOfflineModel();state.mode=els.modeSelect.value;localStorage.setItem("ks_mode",state.mode);populateModels();setConnection(state.mode==="online"?"Online • Gemini":"Offline • engine not loaded")};
  els.modelSelect.onchange=()=>{if(state.mode==="online"){state.onlineModel=els.modelSelect.value;localStorage.setItem("ks_online_model",state.onlineModel)}else{if(state.engine||state.visionLoaded)freeOfflineModel();state.offlineKey=els.modelSelect.value;localStorage.setItem("ks_offline_key",state.offlineKey);updateOfflinePanel()}};
  els.loadModelBtn.onclick=()=>loadOfflineModel();els.freeModelBtn.onclick=()=>freeOfflineModel();
}
async function registerSW(){if("serviceWorker" in navigator&&location.protocol.startsWith("http")){try{await navigator.serviceWorker.register("./sw.js",{scope:"./"});console.log("KinStudy service worker registered")}catch(e){console.warn("SW registration failed",e)}}}
async function init(){setTheme(state.theme);resolveOfflineCatalog();loadChats();bind();renderChatList();renderMessages();els.modeSelect.value=state.mode;populateModels();await Promise.all([checkWebGPU(),loadStudyData(),registerSW()]);setConnection(state.mode==="online"?"Online • Gemini":"Offline • engine not loaded")}
init();
