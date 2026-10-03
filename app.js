const $ = (id) => document.getElementById(id);
const STORAGE = { chats: 'kinstudy.chats.v2', active: 'kinstudy.active.v2', mode: 'kinstudy.mode.v2', models: 'kinstudy.models.v2', theme: 'kinstudy.theme.v2', key: 'kinstudy.geminiKey.v2', instructions: 'kinstudy.instructions.v2' };
const ONLINE_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' }
];
// IDs are checked against WebLLM's actual prebuilt model registry before being shown.
const OFFLINE_CANDIDATES = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B Instruct' },
  { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 Coder 1.5B' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 0.5B Instruct' }
];
const SYSTEM_BASE = `You are KinStudy Pro, a friendly, patient AI study and coding assistant. Respond naturally and remember the conversation using the supplied history. Explain school topics clearly with examples. When solving maths, show understandable steps and put equations in LaTeX delimiters such as \\(x^2\\) or \\[x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\]. When writing code, use fenced Markdown code blocks with a language label and explain what the code does. Do not put ordinary prose inside code fences. Never claim code was executed unless a real execution tool ran it. For projects with multiple files, clearly label each file. Be honest about limitations.`;
let chats = loadJSON(STORAGE.chats, []);
let activeId = localStorage.getItem(STORAGE.active) || null;
let engine = null, engineModelId = null, webllm = null, loading = false, generating = false, abortController = null;
let attachedFiles = [], studyEntries = [], availableOffline = [], cachedRuntime = false;

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Storage unavailable', e); } }
function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
function currentChat() { return chats.find(c => c.id === activeId); }
function ensureChat() { let chat = currentChat(); if (!chat) { chat = { id: uid(), title: 'New chat', messages: [], updatedAt: Date.now() }; chats.unshift(chat); activeId = chat.id; persistChats(); } return chat; }
function persistChats() { saveJSON(STORAGE.chats, chats); if (activeId) localStorage.setItem(STORAGE.active, activeId); renderChatList(); }
function activeMode() { return $('modeSelect').value; }
function selectedModel() { return $('modelSelect').value; }
function systemPrompt() { return `${SYSTEM_BASE}\n\nRelevant offline study reference (use only when relevant):\n${findStudyContext((currentChat()?.messages || []).slice(-1)[0]?.content || '')}\n\nUser's custom instructions:\n${localStorage.getItem(STORAGE.instructions) || 'None'}`; }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function simpleMath(s) {
  return String(s).replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) ÷ ($2)').replace(/\\sqrt\{([^{}]+)\}/g, '√($1)').replace(/\\times/g,'×').replace(/\\cdot/g,'·').replace(/\\div/g,'÷').replace(/\\pm/g,'±').replace(/\\pi/g,'π').replace(/\\theta/g,'θ').replace(/\\leq/g,'≤').replace(/\\geq/g,'≥').replace(/\\neq/g,'≠').replace(/\\rightarrow|\\to/g,'→').replace(/\\left|\\right/g,'').replace(/\\text\{([^{}]*)\}/g,'$1').replace(/\^\{([^{}]+)\}/g,'^($1)').replace(/_{([^{}]+)}/g,'_($1)').replace(/\\,/g,' ').replace(/\\;/g,' ').replace(/\\quad/g,'   ').replace(/\\/g,'');
}
function inlineFormat(raw) {
  let s = escapeHTML(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_,m) => `<div class="math-block">${escapeHTML(simpleMath(m))}</div>`);
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_,m) => `<div class="math-block">${escapeHTML(simpleMath(m))}</div>`);
  s = s.replace(/\\\((.+?)\\\)/g, (_,m) => `<span class="math-inline">${escapeHTML(simpleMath(m))}</span>`);
  s = s.replace(/\$([^$\n]+)\$/g, (_,m) => `<span class="math-inline">${escapeHTML(simpleMath(m))}</span>`);
  return s;
}
function renderMarkdown(text) {
  const blocks = []; let source = String(text ?? '').replace(/\r/g,'');
  source = source.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_,lang,code) => { const idx=blocks.length; blocks.push({lang:lang||'code',code}); return `@@CODEBLOCK${idx}@@`; });
  const lines = source.split('\n'), out=[]; let inList=false;
  for (const line of lines) {
    if (/^@@CODEBLOCK\d+@@$/.test(line.trim())) { if(inList){out.push('</ul>');inList=false;} out.push(line.trim()); continue; }
    if (/^\s*[-*]\s+/.test(line)) { if(!inList){out.push('<ul>');inList=true;} out.push(`<li>${inlineFormat(line.replace(/^\s*[-*]\s+/,''))}</li>`); continue; }
    if(inList){out.push('</ul>');inList=false;}
    if(/^###\s+/.test(line)) out.push(`<h3>${inlineFormat(line.replace(/^###\s+/,''))}</h3>`);
    else if(/^##\s+/.test(line)) out.push(`<h2>${inlineFormat(line.replace(/^##\s+/,''))}</h2>`);
    else if(/^#\s+/.test(line)) out.push(`<h1>${inlineFormat(line.replace(/^#\s+/,''))}</h1>`);
    else if(/^>\s?/.test(line)) out.push(`<blockquote>${inlineFormat(line.replace(/^>\s?/,''))}</blockquote>`);
    else if(line.trim()) out.push(`<p>${inlineFormat(line)}</p>`);
  }
  if(inList) out.push('</ul>');
  let html=out.join('');
  html=html.replace(/@@CODEBLOCK(\d+)@@/g,(_,n)=>{const b=blocks[Number(n)];return `<section class="code-block"><div class="code-toolbar"><span>${escapeHTML(b.lang)}</span><button type="button" class="copy-code" data-code-index="${n}">Copy code</button></div><pre><code>${escapeHTML(b.code)}</code></pre></section>`;});
  // Friendly fallback for common equations written without math delimiters.
  html=html.replace(/\b([A-Za-z])\^2\s*\+\s*([A-Za-z])\^2\s*=\s*([A-Za-z])\^2/g, '<span class="math-inline">$1² + $2² = $3²</span>');
  return {html, blocks};
}
function renderMessages() {
  const host=$('messages'); host.replaceChildren(); const chat=currentChat();
  if(!chat || !chat.messages.length){ const w=document.createElement('div');w.className='welcome';w.innerHTML='<h1>What are we learning today?</h1><p>Ask a question, solve a maths problem, or build something with code.</p>';host.append(w); $('tokenCount').textContent='Tokens: estimate unavailable';return; }
  let tokens=0;
  chat.messages.forEach((m,i)=>{ if(m.role==='system')return; tokens+=Math.ceil((m.content||'').length/4); const el=document.createElement('article');el.className=`message ${m.role==='user'?'user':'assistant'}`;const avatar=m.role==='user'?'Y':'K';const who=m.role==='user'?'You':'KinStudy';const parsed=m.role==='assistant'?renderMarkdown(m.content):null;
    el.innerHTML=`<div class="avatar">${avatar}</div><div class="message-body"><div class="message-head"><strong>${who}</strong><button type="button" class="copy-message" data-message-index="${i}">Copy</button></div><div class="message-content">${m.role==='user'?`<p>${escapeHTML(m.content).replace(/\n/g,'<br>')}</p>`:parsed.html}</div></div>`;host.append(el);
  });
  $('tokenCount').textContent=`~${tokens.toLocaleString()} tokens in chat (estimate)`;host.scrollTop=host.scrollHeight;
}
function renderChatList() {
 const host=$('chatList');if(!host)return;host.replaceChildren();chats.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
 chats.forEach(chat=>{const row=document.createElement('div');row.className='chat-item';const open=document.createElement('button');open.className='chat-open'+(chat.id===activeId?' active':'');open.textContent=chat.title||'New chat';open.title=chat.title||'New chat';open.onclick=()=>{activeId=chat.id;localStorage.setItem(STORAGE.active,activeId);renderChatList();renderMessages();updateTitle();};const del=document.createElement('button');del.className='delete-chat';del.textContent='×';del.title='Delete chat';del.onclick=()=>{chats=chats.filter(c=>c.id!==chat.id);if(activeId===chat.id)activeId=chats[0]?.id||null;persistChats();renderMessages();updateTitle();};row.append(open,del);host.append(row);});
}
function updateTitle(){const c=currentChat();$('currentTitle').textContent=c?.title||'New chat';$('modeStatus').textContent=activeMode()==='online'?'Online · Gemini':`Offline · ${engine?engineModelId:'model not loaded'}`;}
function fillModels() { const mode=activeMode(), select=$('modelSelect');select.replaceChildren();const list=mode==='online'?ONLINE_MODELS:availableOffline;list.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.label;select.append(o);});const saved=loadJSON(STORAGE.models,{});const wanted=saved[mode];if(wanted&&list.some(m=>m.id===wanted))select.value=wanted;if(mode==='offline'&&!list.length){const o=document.createElement('option');o.value='';o.textContent='No supported models found';select.append(o);} $('engineCard').hidden=mode==='online';$('engineTitle').textContent=mode==='online'?'Gemini online':'Offline engine';updateTitle();}
function setLoadStatus(text,progress=null){$('loadMessage').textContent=text;if(progress!==null)$('loadProgress').value=progress;}
async function initRuntimeRegistry(){try{const mod=await import('https://esm.run/@mlc-ai/web-llm');webllm=mod;const ids=new Set((mod.prebuiltAppConfig?.model_list||[]).map(x=>x.model_id));availableOffline=OFFLINE_CANDIDATES.filter(m=>ids.has(m.id));if(!availableOffline.length){ // Show only candidates that the registry actually exposes; no guessed IDs.
  availableOffline=(mod.prebuiltAppConfig?.model_list||[]).filter(x=>/Qwen2\.5.*(0\.5B|1\.5B).*Instruct.*q4f16_1-MLC/i.test(x.model_id)).map(x=>({id:x.model_id,label:x.model_id.replace(/-q4f16_1-MLC/,'')}));
 }
 cachedRuntime=true;fillModels();$('engineStatus').textContent=('gpu' in navigator)?'WebGPU may be available; check device support':'WebGPU API unavailable in this browser';$('storageNote').textContent='Model files are stored separately from the app shell; first download requires internet and enough storage.';
 }catch(e){webllm=null;availableOffline=[];fillModels();$('engineStatus').textContent='Offline runtime could not load. Connect once and reload.';setLoadStatus(`Runtime import failed: ${e.message}`);}}
async function checkGPU(){try{if(!navigator.gpu){$('engineStatus').textContent='WebGPU unavailable in this browser/device';return false;}const adapter=await navigator.gpu.requestAdapter();const ok=!!adapter;$('engineStatus').textContent=ok?'WebGPU adapter detected':'No WebGPU adapter found';return ok;}catch{$('engineStatus').textContent='WebGPU check failed';return false;}}
async function loadOfflineModel(){if(loading)return;if(!webllm){await initRuntimeRegistry();}const modelId=selectedModel();if(!modelId){setLoadStatus('No compatible WebLLM model was found in the loaded registry.');return;}if(!await checkGPU()){setLoadStatus('This browser/device does not currently expose WebGPU. Offline AI cannot run here.');return;}if(engine&&engineModelId===modelId){setLoadStatus(`Loaded: ${modelId}`,1);return;}if(engine){await freeEngine();}loading=true;$('loadBtn').disabled=true;$('loadProgress').value=0;setLoadStatus('Preparing model…',0);
 try{engine=await webllm.CreateMLCEngine(modelId,{initProgressCallback:(report)=>{const p=typeof report.progress==='number'?report.progress:0;setLoadStatus(report.text||'Loading model…',Math.max(0,Math.min(1,p)));}});engineModelId=modelId;setLoadStatus(`Loaded: ${modelId}`,1);$('engineStatus').textContent='Model ready';updateTitle();}
 catch(e){engine=null;engineModelId=null;setLoadStatus(`Model failed to load: ${e.message}. Check available memory/storage and confirm this model is supported by WebLLM.`,0);}
 finally{loading=false;$('loadBtn').disabled=false;}}
async function freeEngine(){if(generating){abortController?.abort();}try{if(engine){if(typeof engine.unload==='function')await engine.unload();else if(typeof engine.resetChat==='function')await engine.resetChat();}}catch(e){console.warn('Engine cleanup',e);}engine=null;engineModelId=null;setLoadStatus('Model unloaded from active memory. Cached download may remain on device.',0);$('engineStatus').textContent='Runtime ready';updateTitle();}
function findStudyContext(query){if(!studyEntries.length)return 'No local reference matched.';const words=String(query).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);const ranked=studyEntries.map(e=>({e,score:[e.subject,e.topic,...(e.keywords||[]),e.content].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(w=>words.includes(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);return ranked.length?ranked.map(x=>`${x.e.subject} — ${x.e.topic}: ${x.e.content}`).join('\n'):'No local reference matched.';}
async function loadStudyData(){try{const r=await fetch('./study-data.json');if(r.ok){const j=await r.json();studyEntries=j.entries||[];}}catch(e){console.warn('Study data not available offline',e);}}
function buildMessages(chat){const msgs=[{role:'system',content:systemPrompt()}];for(const m of chat.messages){if(m.role==='system')continue;msgs.push({role:m.role,content:m.content});}return msgs;}
async function geminiReply(chat,assistantMsg){const key=localStorage.getItem(STORAGE.key)||'';if(!key){throw new Error('Add your Gemini API key in Settings first. Use a Google AI Studio API key, not an OAuth access token.');}const model=selectedModel()||ONLINE_MODELS[0].id;const contents=[];for(const m of chat.messages){if(m.role==='system')continue;contents.push({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]});}const sys=systemPrompt();const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents,generationConfig:{maxOutputTokens:8192}})});
 if(!response.ok){let detail='';try{const j=await response.json();detail=j.error?.message||JSON.stringify(j.error||j);}catch{detail=await response.text().catch(()=> '');}if(response.status===401||response.status===403)throw new Error(`Gemini authentication failed (${response.status}). ${detail} Check that this is a Gemini API key from AI Studio, that it is enabled, and that API restrictions allow the Generative Language API.`);throw new Error(`Gemini API ${response.status}: ${detail}`);}
 const data=await response.json();const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');if(!text)throw new Error(data.promptFeedback?.blockReason?`Request blocked: ${data.promptFeedback.blockReason}`:'Gemini returned an empty response.');assistantMsg.content=text;
}
async function offlineReply(chat,assistantMsg){if(!engine||engineModelId!==selectedModel())throw new Error('Load the selected offline model before sending a message.');const messages=buildMessages(chat);let response=await engine.chat.completions.create({messages,temperature:0.6,max_tokens:4096,stream:true});let output='';for await(const part of response){if(abortController?.signal.aborted)break;const delta=part.choices?.[0]?.delta?.content;if(typeof delta==='string'){output+=delta;assistantMsg.content=output;renderMessages();}}if(!output&&!abortController?.signal.aborted)throw new Error('The offline model returned no text. Try a shorter prompt or reload the model.');}
function addMessage(role,content){const chat=ensureChat();const msg={role,content,createdAt:Date.now()};chat.messages.push(msg);chat.updatedAt=Date.now();if(role==='user'&&chat.title==='New chat'){chat.title=content.trim().slice(0,36)||'New chat';}persistChats();return msg;}
async function sendMessage(){if(generating)return;const input=$('messageInput');const text=input.value.trim();if(!text&&!attachedFiles.length)return;const fileContext=attachedFiles.map(f=>`[Attached file: ${f.name}]\n${f.text||f.note||''}`).join('\n\n');const userText=[text,fileContext].filter(Boolean).join('\n\n');input.value='';input.style.height='auto';const filesSnapshot=attachedFiles.slice();attachedFiles=[];renderAttachmentChip();const chat=ensureChat();addMessage('user',userText);const assistant=addMessage('assistant','');generating=true;abortController=new AbortController();$('sendBtn').textContent='Stop';$('sendBtn').classList.add('stop');$('sendBtn').disabled=false;
 try{if(activeMode()==='online')await geminiReply(chat,assistant);else await offlineReply(chat,assistant);chat.updatedAt=Date.now();persistChats();renderMessages();}
 catch(e){assistant.content=`Error: ${e?.message||String(e)}`;renderMessages();}
 finally{generating=false;abortController=null;$('sendBtn').textContent='Send';$('sendBtn').classList.remove('stop');persistChats();updateTitle();}
}
function renderAttachmentChip(){const host=$('attachmentChip');if(!attachedFiles.length){host.hidden=true;host.textContent='';return;}host.hidden=false;host.textContent=attachedFiles.map(f=>f.name).join(' · ')+'  — click × to remove';host.onclick=()=>{attachedFiles=[];renderAttachmentChip();};host.title='Click to remove attachments';}
async function readFile(file){const ext=file.name.split('.').pop().toLowerCase();if(file.size>12*1024*1024)throw new Error(`${file.name} is over 12 MB. Please choose a smaller file.`);if(ext==='pdf'){throw new Error('PDF text extraction is not included in this minimal six-file build. Upload a text/Markdown file or copy the relevant PDF text into chat.');}if(file.type.startsWith('image/'))return {name:file.name,note:'Image attached, but vision input is not enabled in this build. Please describe the image or use online model support that accepts image input.'};const text=await file.text();return {name:file.name,text:text.slice(0,80000)};}
async function handleFiles(files){for(const file of files){try{const f=await readFile(file);attachedFiles.push(f);}catch(e){addMessage('assistant',`File error: ${e.message}`);}}renderAttachmentChip();}
function saveSettings(){const key=$('apiKeyInput').value.trim();if(key)localStorage.setItem(STORAGE.key,key);else localStorage.removeItem(STORAGE.key);localStorage.setItem(STORAGE.instructions,$('instructionsInput').value.trim());$('settingsDialog').close();}
function setTheme(){const theme=localStorage.getItem(STORAGE.theme)==='light'?'light':'dark';document.documentElement.classList.toggle('light',theme==='light');$('themeBtn').textContent=theme==='light'?'☾ Dark theme':'☀ Light theme';}
function downloadText(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function wireEvents(){
 $('newChatBtn').onclick=()=>{activeId=null;ensureChat();renderChatList();renderMessages();updateTitle();$('sidebar').classList.remove('open');};
 $('themeBtn').onclick=()=>{localStorage.setItem(STORAGE.theme,document.documentElement.classList.contains('light')?'dark':'light');setTheme();};
 $('settingsBtn').onclick=()=>{$('apiKeyInput').value=localStorage.getItem(STORAGE.key)||'';$('instructionsInput').value=localStorage.getItem(STORAGE.instructions)||'';$('settingsDialog').showModal();};$('saveSettingsBtn').onclick=saveSettings;
 $('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');
 $('modeSelect').value=localStorage.getItem(STORAGE.mode)||'offline';$('modeSelect').onchange=()=>{localStorage.setItem(STORAGE.mode,activeMode());fillModels();};
 $('modelSelect').onchange=()=>{const saved=loadJSON(STORAGE.models,{});saved[activeMode()]=selectedModel();saveJSON(STORAGE.models,saved);updateTitle();};
 $('loadBtn').onclick=loadOfflineModel;$('freeBtn').onclick=freeEngine;
 $('sendBtn').onclick=()=>{if(generating){abortController?.abort();return;}sendMessage();};
 $('messageInput').addEventListener('input',()=>{const t=$('messageInput');t.style.height='auto';t.style.height=`${Math.min(t.scrollHeight,180)}px`;});$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
 $('attachBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=async e=>{await handleFiles([...e.target.files]);e.target.value='';};
 $('messages').addEventListener('click',async e=>{const codeBtn=e.target.closest('.copy-code');const msgBtn=e.target.closest('.copy-message');if(codeBtn){const article=codeBtn.closest('.code-block');const code=article?.querySelector('pre code')?.textContent||'';try{await navigator.clipboard.writeText(code);codeBtn.textContent='Copied!';setTimeout(()=>codeBtn.textContent='Copy code',1200);}catch{downloadText('code.txt',code);codeBtn.textContent='Downloaded';}return;}if(msgBtn){const index=Number(msgBtn.dataset.messageIndex);const m=currentChat()?.messages[index];if(m){try{await navigator.clipboard.writeText(m.content);msgBtn.textContent='Copied!';setTimeout(()=>msgBtn.textContent='Copy',1200);}catch{downloadText('message.txt',m.content);}}}});
}
async function registerSW(){if(!('serviceWorker'in navigator))return;try{await navigator.serviceWorker.register('./sw.js');}catch(e){console.warn('Service worker registration failed',e);$('storageNote').textContent='Offline shell caching unavailable: '+e.message;}}
async function init(){setTheme();wireEvents();if(!activeId||!chats.some(c=>c.id===activeId)){activeId=chats[0]?.id||null;}if(!activeId)ensureChat();renderChatList();renderMessages();updateTitle();await Promise.all([loadStudyData(),initRuntimeRegistry()]);fillModels();await checkGPU();await registerSW();}
init().catch(e=>{console.error(e);$('engineStatus').textContent='App initialization error';setLoadStatus(e.message);});
