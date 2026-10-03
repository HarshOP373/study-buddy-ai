import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.0';
import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

env.allowLocalModels = false;

const state = {
  activeEngine: 'gemini', // 'qwen' | 'smol' | 'gemini'
  activeAttachment: null,
  activeQuality: '720p',
  isProcessing: false,
  pipelines: { qwen: null, smol: null }
};

const UI = {
  chat: document.getElementById('chat-scroller'),
  list: document.getElementById('messages-list'),
  input: document.getElementById('chat-textarea'),
  send: document.getElementById('send-btn'),
  status: document.getElementById('status-badge'),
  btns: {
    qwen: document.getElementById('engine-qwen'),
    smol: document.getElementById('engine-smol'),
    gemini: document.getElementById('engine-gemini')
  }
};

/* --- 1. Engine Switcher --- */
function setEngine(engineName) {
  state.activeEngine = engineName;
  Object.values(UI.btns).forEach(btn => btn.classList.remove('active'));
  UI.btns[engineName].classList.add('active');
  
  if (engineName === 'gemini') UI.status.textContent = 'Cloud Active';
  else UI.status.textContent = `${engineName.toUpperCase()} Selected (Offline)`;
}

UI.btns.qwen.onclick = () => setEngine('qwen');
UI.btns.smol.onclick = () => setEngine('smol');
UI.btns.gemini.onclick = () => setEngine('gemini');

/* --- 2. Offline Engine Loaders --- */
async function getSmolVLM(onProgress) {
  if (state.pipelines.smol) return state.pipelines.smol;
  if (!navigator.gpu) throw new Error("WebGPU disabled in Safari Settings.");
  
  onProgress("Loading SmolVLM (Vision)...");
  state.pipelines.smol = await pipeline('image-text-to-text', 'onnx-community/SmolVLM-Instruct', {
    device: 'webgpu', dtype: 'q4',
    progress_callback: p => { if (p.status === 'progress' && p.total) onProgress(`SmolVLM: ${Math.round(p.loaded/p.total*100)}%`); }
  });
  return state.pipelines.smol;
}

async function getQwen(onProgress) {
  if (state.pipelines.qwen) return state.pipelines.qwen;
  if (!navigator.gpu) throw new Error("WebGPU disabled in Safari Settings.");

  onProgress("Loading Qwen2.5 (Text)...");
  state.pipelines.qwen = await CreateMLCEngine("Qwen2.5-1.5B-Instruct-q4f16_1-MLC", {
    initProgressCallback: (p) => onProgress(`Qwen: ${Math.round(p.progress * 100)}%`)
  });
  return state.pipelines.qwen;
}

/* --- 3. Message Execution --- */
async function processMessage(text, attachment, statusCallback) {
  // A. Cloud Execution
  if (state.activeEngine === 'gemini') {
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) throw new Error("Add GEMINI_API_KEY to localStorage");
    const parts = attachment?.dataUrl ? [{ inline_data: { mime_type: 'image/jpeg', data: attachment.dataUrl.split(',')[1] } }] : [];
    parts.push({ text: attachment?.textContent ? `${attachment.textContent}\n${text}` : text });
    
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', body: JSON.stringify({ contents: [{ parts }] })
    });
    return (await res.json()).candidates[0].content.parts[0].text;
  }

  // B. Offline Vision (SmolVLM)
  if (state.activeEngine === 'smol') {
    const pipe = await getSmolVLM(statusCallback);
    statusCallback("Reasoning...");
    const promptText = attachment?.textContent ? `${attachment.textContent}\n${text}` : text;
    
    const messages = [{ role: 'user', content: [] }];
    if (attachment?.dataUrl) messages[0].content.push({ type: 'image', image: attachment.dataUrl });
    messages[0].content.push({ type: 'text', text: promptText || "Explain this." });
    
    const out = await pipe(messages, { max_new_tokens: 512 });
    return out[0].generated_text.at(-1).content;
  }

  // C. Offline Text/Code (Qwen)
  if (state.activeEngine === 'qwen') {
    if (attachment?.dataUrl) throw new Error("Qwen cannot see images. Switch to SmolVLM.");
    const engine = await getQwen(statusCallback);
    statusCallback("Generating...");
    
    const promptText = attachment?.textContent ? `${attachment.textContent}\n${text}` : text;
    const reply = await engine.chat.completions.create({ messages: [{ role: 'user', content: promptText }] });
    return reply.choices[0].message.content;
  }
}

/* --- 4. Chat UI Integration --- */
function appendMessage(sender, text, attachment = null) {
  const row = document.createElement('div'); row.className = `message-row ${sender}`;
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';

  if (attachment) {
    const pill = document.createElement('div'); pill.className = 'msg-attachment-pill';
    pill.onclick = () => window.openModal(attachment.name, attachment.size, attachment.type, attachment.quality, attachment.dataUrl, attachment.rawPreview);
    const icon = attachment.dataUrl || (attachment.type.includes('pdf') ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📄</text></svg>' : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📝</text></svg>');
    pill.innerHTML = `<img src="${icon}" class="pill-thumb"/><div class="pill-meta"><span class="pill-title">${attachment.name}</span><span class="pill-sub">Tap to view</span></div>`;
    bubble.appendChild(pill);
  }
  
  const textEl = document.createElement('div'); textEl.className = 'msg-body'; textEl.textContent = text;
  bubble.appendChild(textEl); row.appendChild(bubble); UI.list.appendChild(row);
  UI.chat.scrollTop = UI.chat.scrollHeight;
  return textEl;
}

UI.send.onclick = async () => {
  const text = UI.input.value.trim();
  const attachment = state.activeAttachment;
  if ((!text && !attachment) || state.isProcessing) return;

  state.isProcessing = true;
  UI.input.value = '';
  document.getElementById('staged-attachment-bar').classList.add('hidden');
  
  appendMessage('user', text, attachment);
  const statusEl = appendMessage('assistant', 'Thinking...');
  
  try {
    statusEl.textContent = await processMessage(text, attachment, (msg) => statusEl.textContent = `⏳ ${msg}`);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    state.isProcessing = false;
    state.activeAttachment = null;
  }
};

// Register the Service Worker for 100% Offline PWA Support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker registered. Ready for offline use.'))
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}
/* Keep your existing resizeImageToSafeResolution() and extractPDFText() handlers from previous code here for file inputs */
