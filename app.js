import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.0";

env.allowLocalModels = false; // Force download from huggingface

/* --- GLOBAL APP STATE & MEMORY --- */
const AppState = {
  activeModelKey: 'online-gemini-3.0-flash',
  isOfflineMode: false,
  offlineEngineInstance: null, // Holds the WebLLM or Pipeline object
  currentAttachment: null,
  isProcessing: false,
  totalTokens: 0,
  chatHistory: [], // The human-like memory array
  chats: JSON.parse(localStorage.getItem('kinstudy_chats')) || {},
  currentChatId: null,
  settings: {
    geminiKey: localStorage.getItem('gemini_key') || '',
    customInstruction: localStorage.getItem('custom_instruction') || '',
    useCustomInstruction: localStorage.getItem('use_custom_instruction') === 'true'
  }
};

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
  
  textarea: document.getElementById('chat-textarea'),
  sendBtn: document.getElementById('send-btn'),
  messagesList: document.getElementById('messages-list'),
  
  themeBtn: document.getElementById('theme-toggle-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  
  chatList: document.getElementById('chat-history-list'),
  newChatBtn: document.getElementById('new-chat-btn')
};

/* --- 1. ENGINE LIFECYCLE MANAGEMENT (The RAM Protector) --- */

// Called when changing dropdown or clicking Free RAM
async function unloadCurrentEngine() {
  if (AppState.offlineEngineInstance) {
    UI.statusBadge.textContent = "Unloading RAM...";
    if (typeof AppState.offlineEngineInstance.unload === 'function') {
      await AppState.offlineEngineInstance.unload(); // Free WebLLM
    }
    if (typeof AppState.offlineEngineInstance.dispose === 'function') {
      await AppState.offlineEngineInstance.dispose(); // Free Transformers.js
    }
    AppState.offlineEngineInstance = null;
    console.log("GPU Memory Freed.");
  }
  UI.statusBadge.textContent = "Engine Unloaded";
}

// Called ONLY when tapping "⚡ Load Engine"
UI.loadBtn.addEventListener('click', async () => {
  await unloadCurrentEngine(); // Strictly enforce 1-model rule
  
  const modelKey = AppState.activeModelKey;
  if (!navigator.gpu) {
    alert("WebGPU is not enabled in Safari. Please enable it in Settings > Safari > Advanced.");
    return;
  }

  try {
    if (modelKey.includes('qwen') || modelKey.includes('llama')) {
      // It's a Text Model (WebLLM)
      let mlcModel = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
      if (modelKey.includes('1.5b')) mlcModel = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
      if (modelKey.includes('coder')) mlcModel = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
      
      AppState.offlineEngineInstance = await CreateMLCEngine(mlcModel, {
        initProgressCallback: (p) => { UI.statusBadge.textContent = `Loading ${Math.round(p.progress * 100)}%`; }
      });
      UI.statusBadge.textContent = "Qwen Loaded (GPU)";
      
    } else if (modelKey === 'offline-smolvlm') {
      // It's the Vision Model (Transformers.js)
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

/* --- 2. DYNAMIC INPUT BAR CONTROLS --- */
UI.modelSelect.addEventListener('change', (e) => {
  AppState.activeModelKey = e.target.value;
  AppState.isOfflineMode = AppState.activeModelKey.startsWith('offline');
  
  if (AppState.isOfflineMode) {
    UI.loadBtn.classList.remove('hidden');
    UI.freeBtn.classList.remove('hidden');
    UI.statusBadge.textContent = "Ready to Load";
  } else {
    UI.loadBtn.classList.add('hidden');
    UI.freeBtn.classList.add('hidden');
    unloadCurrentEngine(); // Free RAM if switching to Cloud
    UI.statusBadge.textContent = "Cloud Mode";
  }

  // Hide Image button if Qwen is selected (Text only)
  if (AppState.activeModelKey.includes('qwen')) {
    UI.imgUploadBtn.classList.add('hidden');
    UI.resSelect.classList.add('hidden');
  } else {
    UI.imgUploadBtn.classList.remove('hidden');
    UI.resSelect.classList.remove('hidden');
  }
});

/* --- 3. RENDERING & CHAT UI --- */
function configureMarkdown() {
  // Setup ChatGPT style code blocks
  marked.setOptions({
    highlight: function(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  });
}
configureMarkdown();

function appendMessageDOM(role, content) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  
  // Format content
  if (role === 'assistant') {
    // Custom renderer to add copy buttons to code blocks
    let html = marked.parse(content);
    html = html.replace(/<pre><code class="(.*?)">([\s\S]*?)<\/code><\/pre>/g, (match, lang, inner) => {
      const langName = lang.replace('language-', '') || 'code';
      return `<pre><div class="code-header"><span>${langName}</span><button class="copy-code-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(inner.replace(/<[^>]*>?/gm, ''))}'))">📋 Copy Code</button></div><code class="${lang}">${inner}</code></pre>`;
    });
    bubble.innerHTML = html;
  } else {
    bubble.textContent = content; // Keep user text safe
  }
  
  // Add universal copy button for entire message
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-copy-btn';
  copyBtn.innerHTML = '📋';
  copyBtn.title = "Copy message";
  copyBtn.onclick = () => navigator.clipboard.writeText(content);
  row.appendChild(copyBtn);
  
  row.appendChild(bubble);
  UI.messagesList.appendChild(row);
  document.getElementById('chat-scroller').scrollTop = UI.messagesList.scrollHeight;
  return bubble;
}

/* --- 4. STREAMING ENGINE EXECUTION --- */
async function generateResponse(userText) {
  UI.statusBadge.textContent = "Thinking...";
  const assistantBubble = appendMessageDOM('assistant', '...');
  let fullResponse = "";

  try {
    // Inject Custom Instructions if enabled
    let memoryArray = [...AppState.chatHistory];
    if (AppState.settings.useCustomInstruction && AppState.settings.customInstruction) {
       memoryArray.unshift({ role: 'system', content: AppState.settings.customInstruction });
    }
    memoryArray.push({ role: 'user', content: userText });

    // --- A. GEMINI 3.0 ONLINE ---
    if (!AppState.isOfflineMode) {
      if (!AppState.settings.geminiKey) throw new Error("Missing Gemini 3.0 API Key in Settings.");
      
      const modelId = AppState.activeModelKey.replace('online-', ''); 
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${AppState.settings.geminiKey}`;
      
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: memoryArray.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{text: m.content}] })) })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Basic parser for Gemini JSON streaming
        const matches = [...chunk.matchAll(/"text":\s*"(.*?)"/g)];
        matches.forEach(m => {
          let text = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          fullResponse += text;
          assistantBubble.innerHTML = marked.parse(fullResponse);
          document.getElementById('chat-scroller').scrollTop = UI.messagesList.scrollHeight;
          AppState.totalTokens += text.split(' ').length; // Rough visual token proxy
          UI.tokenCounter.textContent = `${AppState.totalTokens} Tokens`;
        });
      }
    } 
    // --- B. QWEN OFFLINE (WebLLM) ---
    else if (AppState.activeModelKey.includes('qwen')) {
      if (!AppState.offlineEngineInstance) throw new Error("Tap 'Load Engine' first.");
      
      const chunks = await AppState.offlineEngineInstance.chat.completions.create({
        messages: memoryArray, stream: true
      });
      
      for await (const chunk of chunks) {
        const text = chunk.choices[0]?.delta?.content || "";
        fullResponse += text;
        assistantBubble.innerHTML = marked.parse(fullResponse);
        document.getElementById('chat-scroller').scrollTop = UI.messagesList.scrollHeight;
        AppState.totalTokens += 1;
        UI.tokenCounter.textContent = `${AppState.totalTokens} Tokens`;
      }
    }
    // --- C. SMOLVLM OFFLINE (Transformers.js) ---
    else if (AppState.activeModelKey === 'offline-smolvlm') {
       if (!AppState.offlineEngineInstance) throw new Error("Tap 'Load Engine' first.");
       UI.statusBadge.textContent = "SmolVLM Reasoning...";
       
       // Transformers.js pipeline doesn't have an easy yield generator, we await full result for safety
       const out = await AppState.offlineEngineInstance(memoryArray, { max_new_tokens: 512, temperature: 0.1 });
       fullResponse = out[0].generated_text.at(-1).content;
       assistantBubble.innerHTML = marked.parse(fullResponse);
    }

    // Save to Human Memory
    AppState.chatHistory.push({ role: 'user', content: userText });
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
  if (!text || AppState.isProcessing) return;
  AppState.isProcessing = true;
  UI.textarea.value = "";
  
  appendMessageDOM('user', text);
  
  // Start the reading/streaming phase
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
    // Use first message as title
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

// Init
renderSidebar();

// PWA Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
