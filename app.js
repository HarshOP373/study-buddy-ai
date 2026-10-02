/**
 * KinStudy Pro - Ultra-Smooth iPad Dual Engine Architecture
 * Multi-Model Online & Multi-Model Offline Selector with Dynamic RAM Reporting
 */

// ============================================================================
// 1. Configuration & Constants
// ============================================================================

const DEFAULT_PERSONA = 
  "You are a warm, supportive, motivating older sibling and expert study buddy. " +
  "Help me master Maths, Science, and Logical Reasoning. " +
  "Explain step-by-step with clear calculations, intuitive everyday analogies, and light humor. " +
  "When referencing science laws or math formulas, naturally weave them into your answer. " +
  "Never judge mistakes and always finish your explanations completely.";

const STORAGE_KEYS = {
  CHATS: 'kinstudy_v3_chats',
  ACTIVE_ID: 'kinstudy_v3_active_id',
  API_KEY: 'kinstudy_v3_api_key',
  PERSONA: 'kinstudy_v3_persona',
  PERSONA_ENABLED: 'kinstudy_v3_persona_enabled',
  THEME: 'kinstudy_v3_theme',
  MODE: 'kinstudy_v3_mode',
  ONLINE_MODEL: 'kinstudy_v3_online_model',
  OFFLINE_MODEL: 'kinstudy_v3_offline_model'
};

const WEBLLM_FALLBACK_CDN = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.78/+esm";

// ============================================================================
// 2. Application State
// ============================================================================

const state = {
  chats: [],
  activeChatId: null,
  geminiApiKey: '',
  systemPersona: DEFAULT_PERSONA,
  personaEnabled: true,
  theme: 'dark',
  currentMode: 'online', // 'online' | 'offline'
  onlineModel: 'gemini-3.8-flash',
  offlineModel: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',

  // Engine state
  webllmEngine: null,
  loadedModelId: null, // Tracks currently active model in RAM
  isModelLoading: false,
  isModelReady: false,
  isGenerating: false,
  lastTokensGenerated: 0,

  // Knowledge base
  knowledgeBase: []
};

// ============================================================================
// 3. Persistent Storage Controller
// ============================================================================

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHATS);
    state.chats = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.chats = [];
  }

  state.activeChatId = localStorage.getItem(STORAGE_KEYS.ACTIVE_ID) || null;
  state.geminiApiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';

  const savedPersona = localStorage.getItem(STORAGE_KEYS.PERSONA);
  state.systemPersona = savedPersona !== null ? savedPersona : DEFAULT_PERSONA;

  const savedEnabled = localStorage.getItem(STORAGE_KEYS.PERSONA_ENABLED);
  state.personaEnabled = savedEnabled !== null ? savedEnabled === 'true' : true;

  state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  state.currentMode = localStorage.getItem(STORAGE_KEYS.MODE) || 'online';
  state.onlineModel = localStorage.getItem(STORAGE_KEYS.ONLINE_MODEL) || 'gemini-3.8-flash';
  state.offlineModel = localStorage.getItem(STORAGE_KEYS.OFFLINE_MODEL) || 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

  if (!state.chats.length) {
    const welcomeSession = {
      id: 'session_' + Date.now(),
      title: 'Welcome Study Session',
      createdAt: Date.now(),
      messages: [
        {
          role: 'assistant',
          content: "Hey! 👋 I'm your **study buddy and older sibling mentor**! What subject are we mastering today? Throw any Maths problem, Science question, or Logic puzzle at me!",
          timestamp: Date.now()
        }
      ]
    };
    state.chats = [welcomeSession];
    state.activeChatId = welcomeSession.id;
    saveChats();
  } else if (!state.activeChatId || !state.chats.some(c => c.id === state.activeChatId)) {
    state.activeChatId = state.chats[0].id;
  }
}

function saveChats() {
  localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(state.chats));
  localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, state.activeChatId || '');
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.API_KEY, state.geminiApiKey);
  localStorage.setItem(STORAGE_KEYS.PERSONA, state.systemPersona);
  localStorage.setItem(STORAGE_KEYS.PERSONA_ENABLED, String(state.personaEnabled));
  localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
  localStorage.setItem(STORAGE_KEYS.MODE, state.currentMode);
  localStorage.setItem(STORAGE_KEYS.ONLINE_MODEL, state.onlineModel);
  localStorage.setItem(STORAGE_KEYS.OFFLINE_MODEL, state.offlineModel);
}

// ============================================================================
// 4. Knowledge Base Loader & Natural Query Matcher
// ============================================================================

async function fetchKnowledgeBase() {
  try {
    const res = await fetch('./study-data.json');
    if (res.ok) {
      const data = await res.json();
      state.knowledgeBase = data.entries || [];
      console.log(`[KnowledgeBase] Loaded ${state.knowledgeBase.length} study reference entries.`);
    }
  } catch (err) {
    console.warn('[KnowledgeBase] Offline JSON not found; skipping lookup.');
  }
}

function findRelevantStudyContext(userQuery) {
  if (!state.knowledgeBase || !state.knowledgeBase.length) return null;
  const q = userQuery.toLowerCase().trim();

  for (const entry of state.knowledgeBase) {
    if (q.includes(entry.title.toLowerCase())) {
      return entry;
    }
    if (entry.keywords && entry.keywords.length) {
      for (const k of entry.keywords) {
        const regex = new RegExp(`\\b${k.toLowerCase()}\\b`, 'i');
        if (regex.test(q)) {
          return entry;
        }
      }
    }
  }
  return null;
}

// ============================================================================
// 5. Dual Engine Core: Streaming Gemini & WebLLM
// ============================================================================

async function callGeminiOnline(messages, systemInstruction, onChunk) {
  if (!state.geminiApiKey.trim()) throw new Error('MISSING_API_KEY');

  const modelsToTry = [
    state.onlineModel,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-2.5-flash'
  ].filter((v, i, a) => a.indexOf(v) === i);

  const cleanHistory = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents: cleanHistory,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4078
    }
  };

  if (systemInstruction && systemInstruction.trim().length > 0) {
    payload.system_instruction = {
      parts: [{ text: systemInstruction.trim() }]
    };
  }

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(state.geminiApiKey.trim())}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error?.message || `HTTP ${response.status}`;
        if (response.status === 400 && msg.toLowerCase().includes('api key')) throw new Error('INVALID_API_KEY');
        lastError = new Error(msg);
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const textPiece = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textPiece) {
                fullText += textPiece;
                onChunk(fullText);
              }
            } catch (e) {}
          }
        }
      }

      if (fullText.trim()) return fullText;
    } catch (err) {
      if (err.message === 'INVALID_API_KEY' || err.message === 'MISSING_API_KEY') throw err;
      lastError = err;
    }
  }

  throw lastError || new Error('Connection failed. Please check your network.');
}

async function loadOfflineModel(onProgress) {
  const targetModel = state.offlineModel;

  // If a different model is already loaded, cleanly unload it first
  if (state.webllmEngine && state.loadedModelId !== targetModel) {
    await unloadOfflineModel();
  }

  if (state.webllmEngine && state.isModelReady) {
    return state.webllmEngine;
  }

  if (!navigator.gpu) {
    throw new Error('WebGPU is not enabled. Open iPad Settings > Safari > Advanced > Feature Flags and turn ON WebGPU.');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error('iPad WebGPU context is temporarily busy. Please swipe-close the app from the iPad App Switcher and re-open.');
  }

  state.isModelLoading = true;
  updateOfflineBarUI();

  try {
    const webllm = window.webllm || await import(WEBLLM_FALLBACK_CDN);

    // Load using WebLLM's official internal registry to automatically resolve model_lib and WASM
    const engine = await webllm.CreateMLCEngine(targetModel, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      }
    });

    state.webllmEngine = engine;
    state.loadedModelId = targetModel;
    state.isModelReady = true;
    state.isModelLoading = false;
    updateOfflineBarUI();
    return engine;
  } catch (err) {
    state.webllmEngine = null;
    state.loadedModelId = null;
    state.isModelLoading = false;
    state.isModelReady = false;
    updateOfflineBarUI();
    throw err;
  }
}

async function unloadOfflineModel() {
  if (state.webllmEngine) {
    try {
      await state.webllmEngine.unload();
    } catch (e) {
      console.warn('Engine release:', e);
    }
    state.webllmEngine = null;
    state.loadedModelId = null;
    state.isModelReady = false;
    state.isModelLoading = false;
    state.lastTokensGenerated = 0;
    updateOfflineBarUI();
  }
}

async function callWebLLMOffline(messages, systemInstruction, onChunk) {
  if (!state.webllmEngine || !state.isModelReady) {
    throw new Error('OFFLINE_NOT_LOADED');
  }

  const formatted = [];

  if (systemInstruction && systemInstruction.trim().length > 0) {
    formatted.push({ role: 'system', content: systemInstruction.trim() });
  }

  // Keep last 2 turns to prevent context exhaustion in WebGPU RAM
  const recentTurns = messages.slice(-2);
  for (const m of recentTurns) {
    formatted.push({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content || '')
    });
  }

  const asyncChunkGenerator = await state.webllmEngine.chat.completions.create({
    messages: formatted,
    temperature: 0.6,
    max_tokens: 2048,
    stream: true
  });

  let fullReply = '';
  let tokenCount = 0;

  for await (const chunk of asyncChunkGenerator) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullReply += delta;
      tokenCount++;
      onChunk(fullReply);
    }
  }

  state.lastTokensGenerated = tokenCount;
  updateOfflineBarUI();

  return fullReply || 'Could not generate a response. Please try again.';
}

// ============================================================================
// 6. UI Renderers & Touch Controls
// ============================================================================

function applyTheme(themeName) {
  state.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.innerHTML = themeName === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
  saveSettings();
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function renderChatList() {
  const container = document.getElementById('chat-list');
  if (!container) return;

  container.innerHTML = '';
  state.chats.forEach(chat => {
    const isActive = chat.id === state.activeChatId;
    const item = document.createElement('div');
    item.className = `chat-item ${isActive ? 'active' : ''}`;
    item.onclick = () => selectChat(chat.id);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'chat-item-title';
    titleSpan.textContent = chat.title || 'Untitled Session';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-chat';
    delBtn.title = 'Delete chat';
    delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    };

    item.appendChild(titleSpan);
    item.appendChild(delBtn);
    container.appendChild(item);
  });
}

function renderMessages() {
  const scrollArea = document.getElementById('messages-scroll-area');
  const chat = getActiveChat();
  const titleEl = document.getElementById('chat-header-title');

  if (!scrollArea) return;
  if (titleEl) titleEl.textContent = chat ? chat.title : 'Study Buddy';

  if (!chat || !chat.messages.length) {
    scrollArea.innerHTML = `
      <div class="welcome-hero">
        <div class="welcome-avatar">⚡</div>
        <h2>KinStudy Assistant</h2>
        <p>Your instant offline & online study mentor. Ask any question in Maths, Science, or Logic!</p>
        <div class="quick-prompts-grid">
          <div class="prompt-card" onclick="window.sendPrompt('Explain the quadratic formula with pizza slices!')">
            <span class="prompt-tag">🍕 Algebra</span>
            <span class="prompt-desc">Explain quadratic formula with simple analogies</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('What is Ohm\\'s Law and how do volts, amps, and ohms work together?')">
            <span class="prompt-tag">⚡ Physics</span>
            <span class="prompt-desc">Ohm's Law explained through a water hose analogy</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('What is the formula for photosynthesis?')">
            <span class="prompt-tag">🌱 Biology</span>
            <span class="prompt-desc">Photosynthesis chemical equation breakdown</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('Explain Pythagorean theorem with step-by-step calculations.')">
            <span class="prompt-tag">📐 Geometry</span>
            <span class="prompt-desc">Calculate right triangle hypotenuse easily</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  scrollArea.innerHTML = '';
  chat.messages.forEach(msg => {
    const isUser = msg.role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user' : 'assistant'}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = isUser ? '👤' : '⚡';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const sender = document.createElement('span');
    sender.className = 'sender-name';
    sender.textContent = isUser ? 'You' : (state.currentMode === 'online' ? 'Gemini' : 'WebLLM Qwen');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy-bubble';
    copyBtn.innerHTML = '📋 Copy';
    copyBtn.onclick = () => copyText(msg.content, copyBtn);

    meta.appendChild(sender);
    meta.appendChild(copyBtn);

    const body = document.createElement('div');
    body.className = 'message-body';
    body.innerHTML = formatMarkdown(msg.content);

    wrapper.appendChild(meta);
    wrapper.appendChild(body);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    scrollArea.appendChild(row);
  });

  scrollArea.scrollTop = scrollArea.scrollHeight;
}

function updateStreamingBubble(text) {
  const scrollArea = document.getElementById('messages-scroll-area');
  const bodies = scrollArea.querySelectorAll('.message-row.assistant .message-body');
  if (bodies.length) {
    const lastBody = bodies[bodies.length - 1];
    lastBody.innerHTML = formatMarkdown(text);
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }
}

function formatMarkdown(text) {
  if (!text) return '<span class="typing-dot">Thinking...</span>';
  let escape = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  escape = escape.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  escape = escape.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escape = escape.replace(/\*(.*?)\*/g, '<em>$1</em>');
  const paras = escape.split(/\n\n+/);
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied';
    setTimeout(() => btn.textContent = '📋 Copy', 1500);
  });
}

function updateOfflineBarUI() {
  const bar = document.getElementById('offline-status-bar');
  const ramBadge = document.getElementById('ram-badge');
  const btnLoad = document.getElementById('btn-load-model');
  const btnUnload = document.getElementById('btn-unload-model');
  const statusMsg = document.getElementById('status-msg');
  const progressWrap = document.getElementById('load-progress-bar');
  const footerMode = document.getElementById('footer-mode-label');
  const onlineSelect = document.getElementById('online-model-select');
  const offlineSelect = document.getElementById('offline-model-select');
  const modelTag = document.getElementById('current-model-tag');

  if (!bar) return;

  if (state.currentMode === 'offline') {
    bar.classList.add('active');
    if (onlineSelect) onlineSelect.style.display = 'none';
    if (offlineSelect) offlineSelect.style.display = 'block';
    if (footerMode) footerMode.innerHTML = '<span class="dot offline"></span> Offline WebGPU';

    const shortOfflineName = state.offlineModel.includes("1.5B") ? "Qwen2.5-1.5B (Deep)" : "Qwen2.5-0.5B (Light)";
    if (modelTag) modelTag.textContent = shortOfflineName;

    if (state.isModelReady) {
      const approxRAM = state.loadedModelId?.includes("1.5B") ? "~1150 MB" : "~380 MB";
      ramBadge.textContent = `${approxRAM} in RAM`;
      ramBadge.className = 'ram-badge ready';

      const tokenInfo = state.lastTokensGenerated ? ` (${state.lastTokensGenerated} tokens generated)` : '';
      statusMsg.textContent = `${shortOfflineName} ready for offline reasoning${tokenInfo}.`;
      btnLoad.style.display = 'none';
      btnUnload.style.display = 'block';
      progressWrap.style.display = 'none';
    } else if (state.isModelLoading) {
      ramBadge.textContent = 'Compiling...';
      ramBadge.className = 'ram-badge';
      btnLoad.style.display = 'none';
      btnUnload.style.display = 'none';
      progressWrap.style.display = 'block';
    } else {
      ramBadge.textContent = 'RAM Inactive';
      ramBadge.className = 'ram-badge';
      statusMsg.textContent = `Zero background memory used. Tap to load ${shortOfflineName}.`;
      btnLoad.style.display = 'block';
      btnUnload.style.display = 'none';
      progressWrap.style.display = 'none';
    }
  } else {
    bar.classList.remove('active');
    if (onlineSelect) onlineSelect.style.display = 'block';
    if (offlineSelect) offlineSelect.style.display = 'none';
    if (footerMode) footerMode.innerHTML = '<span class="dot online"></span> Online Mode';
    if (modelTag) modelTag.textContent = state.onlineModel;
  }
}

// ============================================================================
// 7. Message Dispatcher & Natural Knowledge Synthesis
// ============================================================================

window.sendPrompt = function(promptText) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = promptText;
    handleSendMessage();
  }
};

async function handleSendMessage() {
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  const text = inputEl.value.trim();

  if (!text || state.isGenerating) return;

  const chat = getActiveChat();
  if (!chat) return;

  state.isGenerating = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;

  chat.messages.push({ role: 'user', content: text, timestamp: Date.now() });
  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = text.length > 26 ? text.slice(0, 26) + '...' : text;
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';
  saveChats();
  renderChatList();
  renderMessages();

  const assistantMsg = { role: 'assistant', content: '', timestamp: Date.now() };
  chat.messages.push(assistantMsg);
  renderMessages();

  try {
    let finalInstruction = '';
    if (state.personaEnabled && state.systemPersona && state.systemPersona.trim().length > 0) {
      finalInstruction = state.systemPersona.trim();
    }

    const matchedStudyData = findRelevantStudyContext(text);
    if (matchedStudyData) {
      const knowledgeContext = 
        `\n\n[RELEVANT STUDY REFERENCE]:\n` +
        `- Subject: ${matchedStudyData.title} (${matchedStudyData.category})\n` +
        `- Formula/Equation: ${matchedStudyData.formula}\n` +
        `- Key Fact: ${matchedStudyData.explanation}\n` +
        `- Guidance: Blend this reference naturally into your response so the explanation is clear and accurate. Do not dump raw JSON.`;

      finalInstruction += knowledgeContext;
    }

    if (state.currentMode === 'online') {
      const history = chat.messages.slice(0, -1);
      const reply = await callGeminiOnline(history, finalInstruction, (streamingText) => {
        assistantMsg.content = streamingText;
        updateStreamingBubble(streamingText);
      });
      assistantMsg.content = reply;
    } else {
      const history = chat.messages.slice(0, -1);
      const reply = await callWebLLMOffline(history, finalInstruction, (streamingText) => {
        assistantMsg.content = streamingText;
        updateStreamingBubble(streamingText);
      });
      assistantMsg.content = reply;
    }
  } catch (err) {
    if (err.message === 'MISSING_API_KEY') {
      assistantMsg.content = '🔑 **Gemini API Key Required**\n\nPlease open **Settings** (⚙️) and paste your free Gemini API key to use Online mode, or switch to **Offline Mode** in the top bar.';
      openModal(true);
    } else if (err.message === 'OFFLINE_NOT_LOADED') {
      assistantMsg.content = '⚠️ **Offline Model Not Ready**\n\nPlease tap **"⚡ Load Engine"** in the top bar to initialize WebGPU shaders.';
    } else {
      assistantMsg.content = `⚠️ **Error:** ${err.message || err}`;
    }
    updateStreamingBubble(assistantMsg.content);
  } finally {
    state.isGenerating = false;
    sendBtn.disabled = false;
    inputEl.disabled = false;
    saveChats();
    renderMessages();
    setTimeout(() => inputEl.focus(), 60);
  }
}

function createNewChat() {
  const newChat = {
    id: 'session_' + Date.now(),
    title: 'New Study Session',
    createdAt: Date.now(),
    messages: []
  };
  state.chats.unshift(newChat);
  state.activeChatId = newChat.id;
  saveChats();
  renderChatList();
  renderMessages();
  toggleSidebar(false);
}

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  if (!state.chats.length) createNewChat();
  else {
    saveChats();
    renderChatList();
    renderMessages();
  }
}

function selectChat(id) {
  state.activeChatId = id;
  saveChats();
  renderChatList();
  renderMessages();
  toggleSidebar(false);
}

async function setEngineMode(mode) {
  if (mode === state.currentMode) return;
  state.currentMode = mode;
  saveSettings();

  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) modeSelect.value = mode;

  if (mode === 'online' && state.webllmEngine) {
    await unloadOfflineModel();
  }

  updateOfflineBarUI();
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isOpen = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
  } else {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }
}

function openModal(isOpen) {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  if (isOpen) {
    document.getElementById('input-api-key').value = state.geminiApiKey;
    document.getElementById('input-persona').value = state.systemPersona;
    document.getElementById('check-enable-persona').checked = state.personaEnabled;
    modal.classList.add('active');
  } else {
    modal.classList.remove('active');
  }
}

function exportCurrentChatToFiles() {
  const chat = getActiveChat();
  if (!chat || !chat.messages.length) {
    alert('This session has no messages yet!');
    return;
  }

  let text = `==================================================\n`;
  text += `📚 KinStudy Assistant - Revision Notes\n`;
  text += `Session: ${chat.title || 'Study Session'}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n`;
  text += `==================================================\n\n`;

  chat.messages.forEach((m, idx) => {
    const sender = m.role === 'assistant' ? 'STUDY BUDDY' : 'YOU';
    text += `[Turn ${idx + 1}] ${sender}\n----------------------------------------\n${m.content}\n\n`;
  });

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (chat.title || 'study-session').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// 8. Bootstrap & Event Listeners
// ============================================================================

window.addEventListener('DOMContentLoaded', async () => {
  loadPersistedState();
  applyTheme(state.theme);
  await fetchKnowledgeBase();

  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) {
    modeSelect.value = state.currentMode;
    modeSelect.onchange = (e) => setEngineMode(e.target.value);
  }

  const onlineModelSelect = document.getElementById('online-model-select');
  if (onlineModelSelect) {
    onlineModelSelect.value = state.onlineModel;
    onlineModelSelect.onchange = (e) => {
      state.onlineModel = e.target.value;
      saveSettings();
      updateOfflineBarUI();
    };
  }

  const offlineModelSelect = document.getElementById('offline-model-select');
  if (offlineModelSelect) {
    offlineModelSelect.value = state.offlineModel;
    offlineModelSelect.onchange = async (e) => {
      state.offlineModel = e.target.value;
      saveSettings();
      // If a model is currently active, prompt clean switch
      if (state.webllmEngine && state.loadedModelId !== state.offlineModel) {
        await unloadOfflineModel();
      }
      updateOfflineBarUI();
    };
  }

  const btnLoad = document.getElementById('btn-load-model');
  const fillBar = document.getElementById('load-progress-fill');
  const statusMsg = document.getElementById('status-msg');

  if (btnLoad) {
    btnLoad.onclick = async () => {
      try {
        await loadOfflineModel((report) => {
          const pct = Math.round(report.progress * 100);
          if (fillBar) fillBar.style.width = `${pct}%`;
          if (statusMsg) statusMsg.textContent = report.text || 'Loading weights...';
        });
      } catch (err) {
        alert(err.message || 'Failed loading offline model.');
      }
    };
  }

  const btnUnload = document.getElementById('btn-unload-model');
  if (btnUnload) {
    btnUnload.onclick = async () => {
      await unloadOfflineModel();
    };
  }

  const inputEl = document.getElementById('chat-input');
  if (inputEl) {
    inputEl.oninput = () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 160)}px`;
    };

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    };
  }

  const sendBtn = document.getElementById('btn-send');
  if (sendBtn) sendBtn.onclick = handleSendMessage;

  const newChatBtn = document.getElementById('btn-new-chat');
  if (newChatBtn) newChatBtn.onclick = createNewChat;

  const menuToggle = document.getElementById('btn-menu-toggle');
  if (menuToggle) menuToggle.onclick = () => toggleSidebar(true);

  const sidebarClose = document.getElementById('btn-sidebar-close');
  if (sidebarClose) sidebarClose.onclick = () => toggleSidebar(false);

  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.onclick = () => toggleSidebar(false);

  const themeToggle = document.getElementById('btn-theme-toggle');
  if (themeToggle) {
    themeToggle.onclick = () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    };
  }

  document.getElementById('btn-export-notes')?.addEventListener('click', exportCurrentChatToFiles);
  document.getElementById('btn-top-export')?.addEventListener('click', exportCurrentChatToFiles);
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openModal(true));
  document.getElementById('btn-top-settings')?.addEventListener('click', () => openModal(true));
  document.getElementById('btn-modal-close')?.addEventListener('click', () => openModal(false));

  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.onclick = () => {
      state.geminiApiKey = document.getElementById('input-api-key').value.trim();
      state.personaEnabled = document.getElementById('check-enable-persona').checked;
      state.systemPersona = document.getElementById('input-persona').value.trim();
      saveSettings();
      openModal(false);
    };
  }

  const btnResetPersona = document.getElementById('btn-reset-persona');
  if (btnResetPersona) {
    btnResetPersona.onclick = () => {
      document.getElementById('input-persona').value = DEFAULT_PERSONA;
      document.getElementById('check-enable-persona').checked = true;
    };
  }

  const btnClearAll = document.getElementById('btn-clear-storage');
  if (btnClearAll) {
    btnClearAll.onclick = async () => {
      if (confirm('Clear all chats and saved settings?')) {
        await unloadOfflineModel();
        localStorage.clear();
        state.chats = [];
        state.geminiApiKey = '';
        state.systemPersona = DEFAULT_PERSONA;
        createNewChat();
        openModal(false);
      }
    };
  }

  renderChatList();
  renderMessages();
  updateOfflineBarUI();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
