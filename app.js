import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.0";

env.allowLocalModels = false; 

/* --- GLOBAL APP STATE & MEMORY --- */
const AppState = {
  activeModelKey: 'online-gemini-3.0-flash',
  isOfflineMode: false,
  offlineEngineInstance: null, 
  activeAttachment: null,
  activeQuality: '720p',
  isProcessing: false,
  totalTokens: 0,
  chatHistory: [], 
  chats: JSON.parse(localStorage.getItem('kinstudy_chats')) || {},
  currentChatId: null,
  settings: {
    geminiKey: localStorage.getItem('gemini_key') || '',
    customInstruction: localStorage.getItem('custom_instruction') || '',
    useCustomInstruction: localStorage.getItem('use_custom_instruction') === 'true'
  }
};

const RESOLUTION_BOUNDS = { '480p': 512, '720p': 768, '1080p': 1024 };

/* --- DOM ELEMENTS --- */
const UI = {
  modelSelect: document.getElementById('model-select'),
  loadBtn: document.getElementById('load-engine-btn'),
  freeBtn: document.getElementById('free-ram-btn'),
  statusBadge: document.getElementById('status-badge'),
  tokenCounter: document.getElementById('token-counter'),
  
  imgUploadBtn: document.getElementById('btn-image-upload'),
  fileUploadBtn: document.getElementById('btn-file-upload'),
  imgInput: document.getElementById('image-upload-input'),
  fileInput: document.getElementById('file-upload-input'),
  resSelect: document.getElementById('resolution-select'),
  
  stagedBar: document.getElementById('staged-attachment-bar'),
  stagedFilename: document.getElementById('staged-filename'),
  stagedRemoveBtn: document.getElementById('staged-remove-btn'),
  
  textarea: document.getElementById('chat-textarea'),
  sendBtn: document.getElementById('send-btn'),
  messagesList: document.getElementById('messages-list'),
  chatScroller: document.getElementById('chat-scroller'),
  
  themeBtn: document.getElementById('theme-toggle-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  
  chatList: document.getElementById('chat-history-list'),
  newChatBtn: document.getElementById('new-chat-btn')
};

/* --- 1. FILE UPLOAD & PROCESSING --- */
async function resizeImageToSafeResolution(fileOrBlob, maxDimension = 768) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let width = img.width, height = img.height;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) { height = Math.round((height * maxDimension) / width); width = maxDimension; } 
        else { width = Math.round((width * maxDimension) / height); height = maxDimension; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = reject; reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
}

async function extractPDFText(file) {
  if (!window.pdfjsLib) return `[PDF upload: ${file.name}]`;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = `[Textbook File: ${file.name}]\n\n`;
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += `--- Page ${i} ---\n${content.items.map(item => item.str).join(' ')}\n\n`;
  }
  return fullText;
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  UI.stagedFilename.textContent = "Loading file...";
  UI.stagedBar.classList.remove('hidden');

  const maxBound = RESOLUTION_BOUNDS[UI.resSelect.value] || 768;

  if (file.type.startsWith('image/')) {
    resizeImageToSafeResolution(file, maxBound).then(resized => {
      AppState.activeAttachment = { name: file.name, type: file.type, dataUrl: resized.dataUrl };
      UI.stagedFilename.textContent = `🖼️ ${file.name}`;
    });
  } else if (file.type === 'application/pdf') {
    extractPDFText(file).then(text => {
      AppState.activeAttachment = { name: file.name, type: file.type, textContent: text };
      UI.stagedFilename.textContent = `📄 ${file.name}`;
    });
  } else {
    file.text().then(text => {
      AppState.activeAttachment = { name: file.name, type: 'text/plain', textContent: `[File Content]\n${text}` };
      UI.stagedFilename.textContent = `📝 ${file.name}`;
    });
  }
}

UI.imgInput.addEventListener('change', handleFileSelect);
UI.fileInput.addEventListener('change', handleFileSelect);
UI.stagedRemoveBtn.addEventListener('click', () => {
  AppState.activeAttachment = null;
  UI.imgInput.value = ''; UI.fileInput.value = '';
  UI.stagedBar.classList.add('hidden');
});

/* --- 2. ENGINE LIFECYCLE MANAGEMENT --- */
async function unloadCurrentEngine() {
  if (AppState.offlineEngineInstance) {
    UI.statusBadge.textContent = "Unloading RAM...";
    if (typeof AppState.offlineEngineInstance.unload === 'function') await AppState.offlineEngineInstance.unload(); 
    if (typeof AppState.offlineEngineInstance.dispose === 'function') await AppState.offlineEngineInstance.dispose(); 
    AppState.offlineEngineInstance = null;
  }
  UI.statusBadge.textContent = "Engine Unloaded";
}

UI.loadBtn.addEventListener('click', async () => {
  await unloadCurrentEngine(); 
  const modelKey = AppState.activeModelKey;
  if (!navigator.gpu) { alert("WebGPU is not enabled in Safari."); return; }

  try {
    if (modelKey.includes('qwen')) {
      let mlcModel = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
      if (modelKey.includes('1.5b')) mlcModel = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
      if (modelKey.includes('coder')) mlcModel = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
      
      AppState.offlineEngineInstance = await CreateMLCEngine(mlcModel, {
        initProgressCallback: (p) => { UI.statusBadge.textContent = `Loading ${Math.round(p.progress * 100)}%`; }
      });
      UI.statusBadge.textContent = "Qwen Loaded (GPU)";
      
    } else if (modelKey === 'offline-smolvlm') {
      AppState.offlineEngineInstance = await pipeline('image-text-to-text', 'onnx-community/SmolVLM-Instruct', {
        device: 'webgpu', dtype: 'q4',
        progress_callback: (p) => { 
          if (p.status === 'progress' && p.total) UI.statusBadge.textContent = `SmolVLM Brain: ${Math.round((p.loaded/p.total)*100)}%`;
        }
      });
      UI.statusBadge.textContent = "SmolVLM Loaded (GPU)";
    }
  } catch (err) {
    UI.statusBadge.textContent = "Error Loading Engine";
    console.error(err);
  }
});

UI.freeBtn.addEventListener('click', unloadCurrentEngine);

UI.modelSelect.addEventListener('change', (e) => {
  AppState.activeModelKey = e.target.value;
  AppState.isOfflineMode = AppState.activeModelKey.startsWith('offline');
  
  if (AppState.isOfflineMode) {
    UI.loadBtn.classList.remove('hidden'); UI.freeBtn.classList.remove('hidden');
    UI.statusBadge.textContent = "Ready to Load";
  } else {
    UI.loadBtn.classList.add('hidden'); UI.freeBtn.classList.add('hidden');
    unloadCurrentEngine(); 
    UI.statusBadge.textContent = "Cloud Mode";
  }

  if (AppState.activeModelKey.includes('qwen')) {
    UI.imgUploadBtn.classList.add('hidden'); UI.resSelect.classList.add('hidden');
  } else {
    UI.imgUploadBtn.classList.remove('hidden'); UI.resSelect.classList.remove('hidden');
  }
});

/* --- 3. RENDERING & CHAT UI --- */
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
});

function appendMessageDOM(role, content, attachmentName = null) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  
  let innerContent = "";
  if (attachmentName && role === 'user') {
    innerContent += `<div style="font-size:0.8rem; background:rgba(0,0,0,0.1); padding:4px 8px; border-radius:4px; margin-bottom:6px;">📎 ${attachmentName}</div>`;
  }

  if (role === 'assistant') {
    let html = marked.parse(content);
    html = html.replace(/<pre><code class="(.*?)">([\s\S]*?)<\/code><\/pre>/g, (match, lang, inner) => {
      const langName = lang.replace('language-', '') || 'code';
      return `<pre><div class="code-header"><span>${langName}</span><button class="copy-code-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(inner.replace(/<[^>]*>?/gm, ''))}'))">📋 Copy Code</button></div><code class="${lang}">${inner}</code></pre>`;
    });
    innerContent += html;
  } else {
    innerContent += content; 
  }
  bubble.innerHTML = innerContent;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-copy-btn'; copyBtn.innerHTML = '📋'; copyBtn.title = "Copy message";
  copyBtn.onclick = () => navigator.clipboard.writeText(content);
  row.appendChild(copyBtn);
  
  row.appendChild(bubble);
  UI.messagesList.appendChild(row);
  UI.chatScroller.scrollTop = UI.messagesList.scrollHeight;
  return bubble;
}

/* --- 4. STREAMING ENGINE EXECUTION --- */
async function generateResponse(userText) {
  UI.statusBadge.textContent = "Thinking...";
  const attachment = AppState.activeAttachment;
  const assistantBubble = appendMessageDOM('assistant', '...');
  let fullResponse = "";

  try {
    let memoryArray = [...AppState.chatHistory];
    
    // Inject Custom Instructions if enabled
    if (AppState.settings.useCustomInstruction && AppState.settings.customInstruction) {
       memoryArray.unshift({ role: 'system', content: AppState.settings.customInstruction });
    }
    
    // Add file text content to prompt if PDF/Text was uploaded
    let finalPrompt = userText;
    if (attachment && attachment.textContent) {
      finalPrompt = `${attachment.textContent}\n\n${userText}`;
    }
    memoryArray.push({ role: 'user', content: finalPrompt });

    // --- A. GEMINI 3.0 ONLINE ---
    if (!AppState.isOfflineMode) {
      if (!AppState.settings.geminiKey) throw new Error("Missing Gemini 3.0 API Key in Settings.");
      const modelId = AppState.activeModelKey.replace('online-', ''); 
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${AppState.settings.geminiKey}`;
      
      const parts = [{ text: finalPrompt }];
      if (attachment && attachment.dataUrl) {
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: attachment.dataUrl.split(',')[1] } });
      }

      // Map history for Gemini API format
      const geminiContents = memoryArray.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      geminiContents.push({ role: 'user', parts }); // Current message

      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiContents })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const matches = [...chunk.matchAll(/"text":\s*"(.*?)"/g)];
        matches.forEach(m => {
          let text = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          fullResponse += text;
          assistantBubble.innerHTML = marked.parse(fullResponse);
          UI.chatScroller.scrollTop = UI.messagesList.scrollHeight;
          AppState.totalTokens += text.split(' ').length; 
          UI.tokenCounter.textContent = `${AppState.totalTokens} Tokens`;
        });
      }
    } 
    // --- B. QWEN OFFLINE (WebLLM) ---
    else if (AppState.activeModelKey.includes('qwen')) {
      if (!AppState.offlineEngineInstance) throw new Error("Tap 'Load Engine' first.");
      if (attachment && attachment.dataUrl) throw new Error("Qwen cannot process images. Switch to SmolVLM.");
      
      const chunks = await AppState.offlineEngineInstance.chat.completions.create({
        messages: memoryArray, stream: true
      });
      for await (const chunk of chunks) {
        const text = chunk.choices[0]?.delta?.content || "";
        fullResponse += text;
        assistantBubble.innerHTML = marked.parse(fullResponse);
        UI.chatScroller.scrollTop = UI.messagesList.scrollHeight;
        AppState.totalTokens += 1;
        UI.tokenCounter.textContent = `${AppState.totalTokens} Tokens`;
      }
    }
    // --- C. SMOLVLM OFFLINE (Transformers.js) ---
    else if (AppState.activeModelKey === 'offline-smolvlm') {
       if (!AppState.offlineEngineInstance) throw new Error("Tap 'Load Engine' first.");
       UI.statusBadge.textContent = "SmolVLM Reasoning...";
       
       let smolMessages = [{ role: 'user', content: [] }];
       if (attachment && attachment.dataUrl) smolMessages[0].content.push({ type: 'image', image: attachment.dataUrl });
       smolMessages[0].content.push({ type: 'text', text: finalPrompt || "Analyze this." });

       const out = await AppState.offlineEngineInstance(smolMessages, { max_new_tokens: 512, temperature: 0.1 });
       fullResponse = out[0].generated_text.at(-1).content;
       assistantBubble.innerHTML = marked.parse(fullResponse);
    }

    // Save to Human Memory
    AppState.chatHistory.push({ role: 'user', content: finalPrompt });
    AppState.chatHistory.push({ role: 'assistant', content: fullResponse });
    saveChatToStorage();
    UI.statusBadge.textContent = "Ready";

  } catch (err) {
    console.error(err);
    assistantBubble.innerHTML = `<span style="color:red">Error: ${err.message}</span>`;
    UI.statusBadge.textContent = "Error";
  }
}

UI.sendBtn.addEventListener('click', () => {
  const text = UI.textarea.value.trim();
  const attachment = AppState.activeAttachment;
  if ((!text && !attachment) || AppState.isProcessing) return;
  
  AppState.isProcessing = true;
  UI.textarea.value = "";
  
  appendMessageDOM('user', text, attachment?.name);
  
  // Clear staging bar immediately
  AppState.activeAttachment = null;
  UI.imgInput.value = ''; UI.fileInput.value = '';
  UI.stagedBar.classList.add('hidden');
  
  // Generate
  generateResponse(text).finally(() => { AppState.isProcessing = false; });
});

/* --- 5. CHAT HISTORY & SIDEBAR MANAGER --- */
function saveChatToStorage() {
  if (!AppState.currentChatId) AppState.currentChatId = Date.now().toString();
  AppState.chats[AppState.currentChatId] = AppState.chatHistory;
  localStorage.setItem('kinstudy_chats', JSON.stringify(AppState.chats));
  renderSidebar();
}

function loadChat(id) {
  AppState.currentChatId = id;
  AppState.chatHistory = AppState.chats[id] || [];
  UI.messagesList.innerHTML = "";
  AppState.chatHistory.forEach(msg => appendMessageDOM(msg.role, msg.content));
  renderSidebar();
}

function renderSidebar() {
  UI.chatList.innerHTML = "";
  Object.keys(AppState.chats).forEach(id => {
    const btn = document.createElement('button');
    btn.className = `chat-history-item ${id === AppState.currentChatId ? 'active' : ''}`;
    btn.textContent = AppState.chats[id][0]?.content.substring(0, 20) || "Empty Chat";
    btn.onclick = () => loadChat(id);
    UI.chatList.appendChild(btn);
  });
}

UI.newChatBtn.addEventListener('click', () => {
  AppState.currentChatId = Date.now().toString();
  AppState.chatHistory = [];
  UI.messagesList.innerHTML = "";
  renderSidebar();
});

/* --- 6. SETTINGS & THEME --- */
UI.themeBtn.addEventListener('click', () => {
  const body = document.body;
  const current = body.getAttribute('data-theme');
  body.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});

UI.settingsBtn.addEventListener('click', () => {
  document.getElementById('gemini-key-input').value = AppState.settings.geminiKey;
  document.getElementById('custom-instruction-input').value = AppState.settings.customInstruction;
  document.getElementById('custom-instruction-toggle').checked = AppState.settings.useCustomInstruction;
  UI.settingsModal.classList.remove('hidden');
});

UI.saveSettingsBtn.addEventListener('click', () => {
  AppState.settings.geminiKey = document.getElementById('gemini-key-input').value;
  AppState.settings.customInstruction = document.getElementById('custom-instruction-input').value;
  AppState.settings.useCustomInstruction = document.getElementById('custom-instruction-toggle').checked;
  localStorage.setItem('gemini_key', AppState.settings.geminiKey);
  localStorage.setItem('custom_instruction', AppState.settings.customInstruction);
  localStorage.setItem('use_custom_instruction', AppState.settings.useCustomInstruction);
  UI.settingsModal.classList.add('hidden');
});

UI.closeSettingsBtn.addEventListener('click', () => UI.settingsModal.classList.add('hidden'));

// Initialize App
renderSidebar();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
