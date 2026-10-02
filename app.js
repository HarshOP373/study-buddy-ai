/**
 * KinStudy - iPad Dual Online/Offline Study Buddy AI
 * Modular Vanilla ES6 Architecture
 */

// ============================================================================
// 1. Constants & Default Settings
// ============================================================================

const DEFAULT_PERSONA = 
  "You are a warm, supportive, motivating, and funny older sibling/family member and study buddy. " +
  "Help me master Maths, Science, and Logical Reasoning. " +
  "Explain step-by-step with simple analogies, jokes, and clear calculations. " +
  "Keep responses encouraging and easy to follow.";

const STORAGE_KEYS = {
  CHATS: 'kinstudy_chats_v2',
  ACTIVE_ID: 'kinstudy_active_id_v2',
  API_KEY: 'kinstudy_gemini_api_key_v2',
  PERSONA: 'kinstudy_persona_v2',
  THEME: 'kinstudy_theme_v2',
  MODE: 'kinstudy_mode_v2'
};

const OFFLINE_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
// Pinned stable WebLLM build for WebGPU on Safari / iPadOS
const WEBLLM_CDN_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.78/+esm";

// ============================================================================
// 2. Application State
// ============================================================================

const state = {
  chats: [],
  activeChatId: null,
  geminiApiKey: '',
  systemPersona: DEFAULT_PERSONA,
  theme: 'dark',
  currentMode: 'online', // 'online' | 'offline'
  
  // Offline Engine State
  webllmEngine: null,
  isModelLoading: false,
  isModelReady: false,
  isGenerating: false, // Prevents concurrency disposal errors
  
  // Knowledge Base Cache
  knowledgeBase: []
};

// ============================================================================
// 3. Storage Layer
// ============================================================================

function loadPersistedState() {
  try {
    const rawChats = localStorage.getItem(STORAGE_KEYS.CHATS);
    state.chats = rawChats ? JSON.parse(rawChats) : [];
  } catch (e) {
    console.warn('Failed parsing saved chats:', e);
    state.chats = [];
  }

  state.activeChatId = localStorage.getItem(STORAGE_KEYS.ACTIVE_ID) || null;
  state.geminiApiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  state.systemPersona = localStorage.getItem(STORAGE_KEYS.PERSONA) || DEFAULT_PERSONA;
  state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  state.currentMode = localStorage.getItem(STORAGE_KEYS.MODE) || 'online';

  if (!state.chats.length) {
    const initialSession = {
      id: 'session_' + Date.now(),
      title: 'Welcome Study Session',
      createdAt: Date.now(),
      messages: [
        {
          role: 'assistant',
          content: "Hey! 👋 I'm your **study buddy and older sibling mentor**! What subject are we tackling today? Ask me any question in Maths, Science, or Logic, and I'll break it down with simple steps, analogies, and quick humor!",
          timestamp: Date.now()
        }
      ]
    };
    state.chats = [initialSession];
    state.activeChatId = initialSession.id;
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
  localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
  localStorage.setItem(STORAGE_KEYS.MODE, state.currentMode);
}

// ============================================================================
// 4. Instant Offline Knowledge Base Lookup
// ============================================================================

async function fetchKnowledgeBase() {
  try {
    const res = await fetch('./study-data.json');
    if (res.ok) {
      const data = await res.json();
      state.knowledgeBase = data.entries || [];
      console.log(`[KnowledgeBase] Loaded ${state.knowledgeBase.length} instant offline entries.`);
    }
  } catch (err) {
    console.warn('[KnowledgeBase] Offline JSON lookup load error:', err);
  }
}

function findInstantFormulaMatch(userQuery) {
  if (!state.knowledgeBase || !state.knowledgeBase.length) return null;
  const q = userQuery.toLowerCase().trim();

  for (const entry of state.knowledgeBase) {
    const matchKeyword = entry.keywords.some(k => q.includes(k.toLowerCase()));
    const matchTitle = q.includes(entry.title.toLowerCase());
    
    if (matchKeyword || matchTitle) {
      return entry;
    }
  }
  return null;
}

function formatFormulaAnswer(entry) {
  let answer = `### 📐 ${entry.title} (${entry.category})\n\n`;
  answer += `**Formula:**\n\`\`\`text\n${entry.formula}\n\`\`\`\n\n`;
  answer += `**Why it works:**\n${entry.explanation}\n\n`;
  
  if (entry.analogy) {
    answer += `💡 **Analogy:** ${entry.analogy}\n\n`;
  }

  if (entry.stepByStep && entry.stepByStep.length) {
    answer += `**Step-by-step how to solve:**\n`;
    entry.stepByStep.forEach(step => {
      answer += `- ${step}\n`;
    });
    answer += `\n`;
  }

  if (entry.example) {
    answer += `🎯 **Quick Example:**\n${entry.example}`;
  }

  return answer;
}

// ============================================================================
// 5. Dual Engine Controller (Gemini API vs WebLLM)
// ============================================================================

async function callGeminiOnline(messages, systemPrompt, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('MISSING_API_KEY');
  }

  const cleanKey = apiKey.trim();
  const models = ['gemini-1.5-flash', 'gemini-2.0-flash'];

  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  if (systemPrompt && systemPrompt.trim()) {
    payload.system_instruction = {
      parts: [{ text: systemPrompt.trim() }]
    };
  }

  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        const msg = data.error?.message || `HTTP ${response.status}`;
        if (response.status === 400 && msg.toLowerCase().includes('api key')) {
          throw new Error('INVALID_API_KEY: ' + msg);
        }
        if (response.status === 404 || response.status === 503 || msg.includes('not found')) {
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty reply received from Gemini.');
      return text;
    } catch (err) {
      lastError = err;
      if (err.message && (err.message.includes('INVALID_API_KEY') || err.message === 'MISSING_API_KEY')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Could not connect to Gemini API. Check your internet connection.');
}

async function loadOfflineModel(onProgress) {
  if (state.webllmEngine) {
    return state.webllmEngine;
  }

  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is not enabled in this browser. On iPadOS Safari, open Settings > Safari > Advanced > Feature Flags > WebGPU.');
  }

  state.isModelLoading = true;
  updateOfflineBarUI();

  try {
    const { CreateMLCEngine } = await import(WEBLLM_CDN_URL);

    const engine = await CreateMLCEngine(OFFLINE_MODEL_ID, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      }
    });

    state.webllmEngine = engine;
    state.isModelReady = true;
    state.isModelLoading = false;
    updateOfflineBarUI();
    return engine;
  } catch (err) {
    state.isModelLoading = false;
    state.isModelReady = false;
    updateOfflineBarUI();
    throw err;
  }
}

async function unloadOfflineModel() {
  if (state.webllmEngine) {
    console.log('[WebLLM] Unloading Qwen2.5-1.5B to free iPad RAM...');
    try {
      await state.webllmEngine.unload();
    } catch (e) {
      console.warn('Error unloading engine:', e);
    }
    state.webllmEngine = null;
    state.isModelReady = false;
    state.isModelLoading = false;
    updateOfflineBarUI();
  }
}

async function callWebLLMOffline(messages, systemPrompt) {
  if (!state.webllmEngine) {
    throw new Error('OFFLINE_NOT_LOADED');
  }

  const formatted = [];
  if (systemPrompt && systemPrompt.trim()) {
    formatted.push({ role: 'system', content: systemPrompt.trim() });
  }

  // Trim to recent 4 turns to avoid WebGPU buffer overflow
  const recentTurns = messages.slice(-4);
  for (const m of recentTurns) {
    formatted.push({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content || '')
    });
  }

  const completion = await state.webllmEngine.chat.completions.create({
    messages: formatted,
    temperature: 0.6,
    max_tokens: 350,
    stream: false // Disables streaming to avoid disposed tensor context bug
  });

  return completion.choices?.[0]?.message?.content || 'No response generated.';
}

// ============================================================================
// 6. UI Rendering & Event Handling
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
    delBtn.innerHTML = '🗑️';
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

  if (titleEl) {
    titleEl.textContent = chat ? chat.title : 'Study Buddy';
  }

  if (!chat || !chat.messages.length) {
    scrollArea.innerHTML = `
      <div class="welcome-hero">
        <div class="welcome-avatar">🎓</div>
        <h2>KinStudy Assistant</h2>
        <p>Your encouraging older sibling & study companion. Ask any question in Maths, Science, or Logic!</p>
        <div class="quick-prompts-grid">
          <div class="prompt-card" onclick="window.sendPrompt('Explain the quadratic formula with pizza slices!')">
            <span class="prompt-tag">🍕 Algebra</span>
            <span class="prompt-desc">Explain quadratic formula with simple analogies</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('What is Ohm\\'s Law and how do volts, amps, and ohms work together?')">
            <span class="prompt-tag">⚡ Physics</span>
            <span class="prompt-desc">What is Ohm's Law and water hose analogy?</span>
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

  chat.messages.forEach((msg) => {
    const isUser = msg.role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user' : 'assistant'}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = isUser ? '👤' : '🤖';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const sender = document.createElement('span');
    sender.className = 'sender-name';
    sender.textContent = isUser ? 'You' : 'Study Buddy';

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

function formatMarkdown(text) {
  if (!text) return '';
  let escape = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  escape = escape.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  escape = escape.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escape = escape.replace(/\*(.*?)\*/g, '<em>$1</em>');
  const paras = escape.split(/\n\n+/);
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function copyText(text, buttonElement) {
  navigator.clipboard.writeText(text).then(() => {
    buttonElement.textContent = '✅ Copied!';
    buttonElement.classList.add('copied');
    setTimeout(() => {
      buttonElement.textContent = '📋 Copy';
      buttonElement.classList.remove('copied');
    }, 1800);
  }).catch(() => {
    buttonElement.textContent = 'Error';
  });
}

function updateOfflineBarUI() {
  const bar = document.getElementById('offline-status-bar');
  const ramBadge = document.getElementById('ram-badge');
  const btnLoad = document.getElementById('btn-load-model');
  const btnUnload = document.getElementById('btn-unload-model');
  const statusMsg = document.getElementById('status-msg');
  const progressWrap = document.getElementById('load-progress-bar');
  const footerModeLabel = document.getElementById('footer-mode-label');

  if (!bar) return;

  if (state.currentMode === 'offline') {
    bar.classList.add('active');
    if (footerModeLabel) {
      footerModeLabel.innerHTML = '<span class="dot offline"></span> Offline Mode';
    }

    if (state.isModelReady) {
      ramBadge.textContent = 'Model in RAM';
      ramBadge.className = 'ram-badge ready';
      statusMsg.textContent = 'Qwen2.5-1.5B is ready for offline reasoning.';
      btnLoad.style.display = 'none';
      btnUnload.style.display = 'block';
      progressWrap.style.display = 'none';
    } else if (state.isModelLoading) {
      ramBadge.textContent = 'Loading...';
      ramBadge.className = 'ram-badge';
      btnLoad.style.display = 'none';
      btnUnload.style.display = 'none';
      progressWrap.style.display = 'block';
    } else {
      ramBadge.textContent = '0 MB in RAM';
      ramBadge.className = 'ram-badge';
      statusMsg.textContent = 'Zero background RAM used. Tap to initialize Qwen2.5-1.5B.';
      btnLoad.style.display = 'block';
      btnUnload.style.display = 'none';
      progressWrap.style.display = 'none';
    }
  } else {
    bar.classList.remove('active');
    if (footerModeLabel) {
      footerModeLabel.innerHTML = '<span class="dot online"></span> Online Gemini';
    }
  }
}

// ============================================================================
// 7. User Actions & Controller Flow
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

  // Guard against blank input or concurrent generation
  if (!text || state.isGenerating) return;

  const chat = getActiveChat();
  if (!chat) return;

  state.isGenerating = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;

  // Append user message
  const userMsg = { role: 'user', content: text, timestamp: Date.now() };
  chat.messages.push(userMsg);

  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = text.length > 28 ? text.slice(0, 28) + '...' : text;
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';
  saveChats();
  renderChatList();
  renderMessages();

  // Add temporary assistant thinking bubble
  const tempMsg = { role: 'assistant', content: 'Thinking...', timestamp: Date.now() };
  chat.messages.push(tempMsg);
  renderMessages();

  try {
    const formulaMatch = findInstantFormulaMatch(text);
    if (formulaMatch) {
      const answer = `<span class="instant-badge">⚡ Instant Offline Formula Match</span>\n\n` + formatFormulaAnswer(formulaMatch);
      chat.messages[chat.messages.length - 1].content = answer;
    } else if (state.currentMode === 'online') {
      const history = chat.messages.slice(0, -1);
      const reply = await callGeminiOnline(history, state.systemPersona, state.geminiApiKey);
      chat.messages[chat.messages.length - 1].content = reply;
    } else {
      const history = chat.messages.slice(0, -1);
      const reply = await callWebLLMOffline(history, state.systemPersona);
      chat.messages[chat.messages.length - 1].content = reply;
    }
  } catch (err) {
    if (err.message === 'MISSING_API_KEY') {
      chat.messages[chat.messages.length - 1].content = 
        '🔑 **Gemini API Key Required**\n\nPlease open **Settings** (⚙️ in the sidebar or top bar) and enter your Gemini API Key to use Online Mode.\n\n*Or switch to **Offline Mode** in the top bar dropdown!*';
      openModal(true);
    } else if (err.message === 'OFFLINE_NOT_LOADED') {
      chat.messages[chat.messages.length - 1].content = 
        '⚠️ **Offline Model Not Ready**\n\nPlease tap **"Load Offline Model"** in the amber bar above to compile shaders and initialize Qwen2.5-1.5B into your iPad WebGPU RAM.';
    } else {
      chat.messages[chat.messages.length - 1].content = `⚠️ **Error:** ${err.message || err}`;
    }
  } finally {
    state.isGenerating = false;
    sendBtn.disabled = false;
    inputEl.disabled = false;
    saveChats();
    renderMessages();
    setTimeout(() => inputEl.focus(), 50);
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
  if (state.activeChatId === id) {
    state.activeChatId = state.chats[0]?.id || null;
  }
  if (!state.chats.length) {
    createNewChat();
  } else {
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
    modal.classList.add('active');
  } else {
    modal.classList.remove('active');
  }
}

function exportCurrentChatToFiles() {
  const chat = getActiveChat();
  if (!chat || !chat.messages.length) {
    alert('This study session has no notes yet!');
    return;
  }

  let text = `==================================================\n`;
  text += `📚 KinStudy Assistant - Revision Notes\n`;
  text += `Session: ${chat.title || 'Study Session'}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n`;
  text += `==================================================\n\n`;

  chat.messages.forEach((m, idx) => {
    const sender = m.role === 'assistant' ? '🤖 STUDY BUDDY' : '👤 YOU';
    text += `[Turn ${idx + 1}] ${sender}\n----------------------------------------\n${m.content}\n\n`;
  });

  text += `==================================================\n`;
  text += `Saved from KinStudy iPad Assistant\n`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = (chat.title || 'study-session').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.txt';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// 8. Initialization & Event Listeners
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
  if (sendBtn) {
    sendBtn.onclick = handleSendMessage;
  }

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
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
    };
  }

  const exportBtn = document.getElementById('btn-export-notes');
  if (exportBtn) exportBtn.onclick = exportCurrentChatToFiles;

  const topExportBtn = document.getElementById('btn-top-export');
  if (topExportBtn) topExportBtn.onclick = exportCurrentChatToFiles;

  const settingsBtn = document.getElementById('btn-open-settings');
  if (settingsBtn) settingsBtn.onclick = () => openModal(true);

  const topSettingsBtn = document.getElementById('btn-top-settings');
  if (topSettingsBtn) topSettingsBtn.onclick = () => openModal(true);

  const modalClose = document.getElementById('btn-modal-close');
  if (modalClose) modalClose.onclick = () => openModal(false);

  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.onclick = () => {
      state.geminiApiKey = document.getElementById('input-api-key').value.trim();
      state.systemPersona = document.getElementById('input-persona').value.trim() || DEFAULT_PERSONA;
      saveSettings();
      openModal(false);
    };
  }

  const btnResetPersona = document.getElementById('btn-reset-persona');
  if (btnResetPersona) {
    btnResetPersona.onclick = () => {
      document.getElementById('input-persona').value = DEFAULT_PERSONA;
    };
  }

  const btnClearAll = document.getElementById('btn-clear-storage');
  if (btnClearAll) {
    btnClearAll.onclick = async () => {
      if (confirm('Clear all chats and saved settings from iPad local storage?')) {
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
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[KinStudy SW] Registered with scope:', reg.scope))
      .catch(err => console.warn('[KinStudy SW] Registration failed:', err));
  }
});
