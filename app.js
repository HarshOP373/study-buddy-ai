/**
 * KinStudy Pro - 100% Offline iPad AI Assistant
 * Zero External Gemini Dependencies, Standalone WebLLM Bundle,
 * Rolling Summary Memory, 2048 Tokens, NDArray Safe Flush & Code Windows
 */

// ============================================================================
// 1. Configuration & Constants
// ============================================================================

const DEFAULT_PERSONA = 
  "You are a friendly, natural older sibling and smart study buddy. " +
  "Talk like a normal helpful human in casual conversation. " +
  "DO NOT summarize or repeat the previous chat history before answering. " +
  "Answer questions directly, concisely, and supportively. " +
  "When providing code, ALWAYS wrap it inside Markdown code blocks with the exact language (e.g. ```html, ```python). " +
  "When providing math equations or formulas, wrap standalone formulas in double dollar signs ($$formula$$) or code blocks so they render cleanly.";

const STORAGE_KEYS = {
  CHATS: 'kinstudy_v4_chats',
  ACTIVE_ID: 'kinstudy_v4_active_id',
  PERSONA: 'kinstudy_v4_persona',
  PERSONA_ENABLED: 'kinstudy_v4_persona_enabled',
  THEME: 'kinstudy_v4_theme',
  OFFLINE_MODEL: 'kinstudy_v4_offline_model'
};

// Standalone, self-contained single bundle with NO external sub-chunks
const WEBLLM_BUNDLE_URL = "https://esm.sh/@mlc-ai/web-llm@0.2.78?bundle";

// ============================================================================
// 2. Application State
// ============================================================================

const state = {
  chats: [],
  activeChatId: null,
  systemPersona: DEFAULT_PERSONA,
  personaEnabled: true,
  theme: 'dark',
  offlineModel: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',

  // Engine state
  webllmEngine: null,
  webllmModule: null,
  loadedModelId: null,
  isModelLoading: false,
  isModelReady: false,
  isGenerating: false,
  abortController: null,
  lastTokensGenerated: 0,

  // Knowledge base
  knowledgeBase: []
};

const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 16));

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

  const savedPersona = localStorage.getItem(STORAGE_KEYS.PERSONA);
  state.systemPersona = savedPersona !== null ? savedPersona : DEFAULT_PERSONA;

  const savedEnabled = localStorage.getItem(STORAGE_KEYS.PERSONA_ENABLED);
  state.personaEnabled = savedEnabled !== null ? savedEnabled === 'true' : true;

  state.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  state.offlineModel = localStorage.getItem(STORAGE_KEYS.OFFLINE_MODEL) || 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';

  if (!state.chats.length) {
    const welcomeSession = {
      id: 'session_' + Date.now(),
      title: 'Welcome Study Session',
      createdAt: Date.now(),
      summary: '',
      messages: [
        {
          role: 'assistant',
          content: "Hey! 👋 I'm your **offline study buddy and coding mentor**! What are we building or studying today? Ask any Maths, Science, or Code question (HTML, Python, Games, JS)!",
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
  localStorage.setItem(STORAGE_KEYS.PERSONA, state.systemPersona);
  localStorage.setItem(STORAGE_KEYS.PERSONA_ENABLED, String(state.personaEnabled));
  localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
  localStorage.setItem(STORAGE_KEYS.OFFLINE_MODEL, state.offlineModel);
}

// ============================================================================
// 4. Safe Knowledge Base Loader & Context Matcher
// ============================================================================

async function fetchKnowledgeBase() {
  try {
    const res = await fetch('./study-data.json');
    if (res.ok) {
      const data = await res.json();
      state.knowledgeBase = Array.isArray(data?.entries) ? data.entries : [];
    } else {
      state.knowledgeBase = [];
    }
  } catch (err) {
    state.knowledgeBase = [];
  }
}

function findRelevantStudyContext(userQuery) {
  if (!state.knowledgeBase || !Array.isArray(state.knowledgeBase) || !state.knowledgeBase.length) return null;
  const q = String(userQuery || '').toLowerCase().trim();
  if (!q) return null;

  for (const entry of state.knowledgeBase) {
    if (!entry || typeof entry !== 'object') continue;

    if (entry.title && typeof entry.title === 'string' && q.includes(entry.title.toLowerCase())) {
      return entry;
    }

    if (Array.isArray(entry.keywords)) {
      for (const k of entry.keywords) {
        if (!k || typeof k !== 'string') continue;
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
// 5. Automatic Rolling Memory Summary
// ============================================================================

function updateChatSummary(chat) {
  if (!chat || !chat.messages || chat.messages.length <= 4) return;

  const olderMessages = chat.messages.slice(0, -4);
  const memoryPoints = [];

  for (let i = 0; i < olderMessages.length; i += 2) {
    const userMsg = olderMessages[i];
    const aiMsg = olderMessages[i + 1];

    if (userMsg && userMsg.content) {
      const userText = userMsg.content.slice(0, 90).replace(/\n/g, ' ');
      let outcome = '';
      if (aiMsg && aiMsg.content) {
        if (aiMsg.content.includes('```')) {
          outcome = ' (Provided code/solution)';
        } else {
          outcome = ` (AI discussed: ${aiMsg.content.slice(0, 70).replace(/\n/g, ' ')}...)`;
        }
      }
      memoryPoints.push(`- Previous Topic: "${userText}"${outcome}`);
    }
  }

  chat.summary = memoryPoints.slice(-6).join('\n');
}

// ============================================================================
// 6. WebLLM Offline Engine (Resilient WebGPU Execution)
// ============================================================================

async function getWebLLMModule() {
  if (state.webllmModule) return state.webllmModule;
  if (window.webllm) {
    state.webllmModule = window.webllm;
    return state.webllmModule;
  }
  try {
    const mod = await import(WEBLLM_BUNDLE_URL);
    state.webllmModule = mod.default || mod;
    return state.webllmModule;
  } catch (err) {
    console.error('[WebLLM Load Error]:', err);
    throw new Error('Could not load WebLLM engine bundle. Please make sure you opened KinStudy on Wi-Fi once to complete initial caching!');
  }
}

async function loadOfflineModel(onProgress) {
  const targetModel = state.offlineModel;

  if (state.webllmEngine && state.loadedModelId !== targetModel) {
    await unloadOfflineModel();
  }

  if (state.webllmEngine && state.isModelReady) {
    return state.webllmEngine;
  }

  if (!navigator.gpu) {
    throw new Error('WebGPU is not enabled. In iPad Settings > Safari > Advanced > Feature Flags, turn ON WebGPU.');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error('iPad WebGPU is busy. Swipe-close the app from App Switcher and re-open.');
  }

  state.isModelLoading = true;
  updateOfflineBarUI();
  await yieldToMainThread();

  try {
    const webllm = await getWebLLMModule();

    let lastRenderUpdate = 0;
    const engine = await webllm.CreateMLCEngine(targetModel, {
      initProgressCallback: (report) => {
        const now = performance.now();
        if (now - lastRenderUpdate > 80 || report.progress === 1) {
          lastRenderUpdate = now;
          if (onProgress) onProgress(report);
        }
      }
    });

    state.webllmEngine = engine;
    state.loadedModelId = targetModel;
    state.isModelReady = true;
    state.isModelLoading = false;
    
    await yieldToMainThread();
    updateOfflineBarUI();
    return engine;
  } catch (err) {
    state.webllmEngine = null;
    state.loadedModelId = null;
    state.isModelLoading = false;
    state.isModelReady = false;
    await yieldToMainThread();
    updateOfflineBarUI();
    throw err;
  }
}

async function unloadOfflineModel() {
  if (state.webllmEngine) {
    try {
      await state.webllmEngine.unload();
    } catch (e) {
      console.warn('Engine release notice:', e);
    }
    state.webllmEngine = null;
    state.loadedModelId = null;
    state.isModelReady = false;
    state.isModelLoading = false;
    state.lastTokensGenerated = 0;
    await yieldToMainThread();
    updateOfflineBarUI();
  }
}

async function callWebLLMOffline(messages, systemInstruction, onChunk, signal) {
  if (!state.webllmEngine || !state.isModelReady) {
    throw new Error('OFFLINE_NOT_LOADED');
  }

  // Clear temporary tensors to prevent "NDArray has already been disposed"
  try {
    await state.webllmEngine.resetChat(false);
  } catch (e) {
    console.warn('[WebLLM] Cache reset notice:', e);
  }

  const formatted = [];

  if (systemInstruction && systemInstruction.trim().length > 0) {
    formatted.push({ role: 'system', content: systemInstruction.trim() });
  }

  // Keep the last 4-6 messages for active conversation context
  const recentTurns = messages.slice(-6);
  for (const m of recentTurns) {
    formatted.push({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content || '')
    });
  }

  let fullReply = '';
  let tokenCount = 0;

  try {
    const asyncChunkGenerator = await state.webllmEngine.chat.completions.create({
      messages: formatted,
      temperature: 0.6,
      max_tokens: 2048, // 2048 token generation limit
      stream: true
    });

    for await (const chunk of asyncChunkGenerator) {
      if (signal && signal.aborted) {
        break;
      }
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullReply += delta;
        tokenCount++;
        onChunk(fullReply);
        if (tokenCount % 4 === 0) {
          await yieldToMainThread();
        }
      }
    }

    state.lastTokensGenerated = tokenCount;
    updateOfflineBarUI();
    return fullReply || '(Stopped)';
  } catch (err) {
    const errMsg = String(err.message || err);
    if (errMsg.includes('disposed') || errMsg.includes('NDArray') || errMsg.includes('device')) {
      console.warn('[WebLLM] Auto-recovering disposed WebGPU context...');
      state.webllmEngine = null;
      state.isModelReady = false;
      await loadOfflineModel();
      throw new Error('VRAM context refreshed cleanly. Please tap Send once more!');
    }
    throw err;
  }
}

// ============================================================================
// 7. UI Renderers, Math Containers & Code Blocks
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

function formatMarkdown(text) {
  if (!text) return '<span class="typing-dot">Thinking...</span>';

  // 1. Code blocks ```language ... ```
  let formatted = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const displayLang = lang.trim() || 'code';
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `
      <div class="code-block-container">
        <div class="code-block-header">
          <span class="code-lang-label">${displayLang}</span>
          <button class="btn-copy-code" onclick="window.copyCodeFromBlock(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy code</span>
          </button>
        </div>
        <pre><code class="language-${displayLang}">${escapedCode}</code></pre>
      </div>
    `;
  });

  // 2. Math Formula Containers $$ ... $$
  formatted = formatted.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
    const escapedFormula = formula.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `
      <div class="code-block-container math-container">
        <div class="code-block-header">
          <span class="code-lang-label">📐 Formula</span>
          <button class="btn-copy-code" onclick="window.copyCodeFromBlock(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy formula</span>
          </button>
        </div>
        <pre><code class="math-code">${escapedFormula}</code></pre>
      </div>
    `;
  });

  // 3. Inline Code `...`
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // 4. Bold & Italics
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 5. Paragraphs
  const parts = formatted.split(/\n\n+/);
  return parts.map(p => {
    if (p.includes('<div class="code-block-container')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

window.copyCodeFromBlock = function(btn) {
  const container = btn.closest('.code-block-container');
  const codeEl = container.querySelector('code');
  if (!codeEl) return;

  navigator.clipboard.writeText(codeEl.innerText).then(() => {
    const span = btn.querySelector('span');
    const originalText = span.textContent;
    span.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      span.textContent = originalText;
      btn.classList.remove('copied');
    }, 1800);
  });
};

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
        <h2>KinStudy Offline Assistant</h2>
        <p>Your private, local WebGPU coding and study companion. Completely offline!</p>
        <div class="quick-prompts-grid">
          <div class="prompt-card" onclick="window.sendPrompt('Write simple HTML code displaying Harsh in bold letters.')">
            <span class="prompt-tag">💻 HTML Code</span>
            <span class="prompt-desc">HTML text showing Harsh in bold letters</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('Create a playable Flappy Bird game in a single HTML file with CSS and JavaScript.')">
            <span class="prompt-tag">🎮 Game Dev</span>
            <span class="prompt-desc">Playable Flappy Bird single file game</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('What is the formula of Pythagorean theorem and how does it calculate the hypotenuse?')">
            <span class="prompt-tag">📐 Maths</span>
            <span class="prompt-desc">Pythagorean theorem formula and resolution</span>
          </div>
          <div class="prompt-card" onclick="window.sendPrompt('Explain Newton\\'s second law of motion with a real life example.')">
            <span class="prompt-tag">🌱 Physics</span>
            <span class="prompt-desc">F = m × a explained with a shopping cart</span>
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

    let senderLabel = 'You';
    if (!isUser) {
      senderLabel = state.offlineModel.includes("Coder") ? "Qwen Coder" : "WebLLM Qwen";
    }

    const sender = document.createElement('span');
    sender.className = 'sender-name';
    sender.textContent = senderLabel;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy-bubble';
    copyBtn.innerHTML = '📋 Copy Message';
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

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied';
    setTimeout(() => btn.textContent = '📋 Copy Message', 1500);
  });
}

function updateOfflineBarUI() {
  const bar = document.getElementById('offline-status-bar');
  const ramBadge = document.getElementById('ram-badge');
  const btnLoad = document.getElementById('btn-load-model');
  const btnUnload = document.getElementById('btn-unload-model');
  const statusMsg = document.getElementById('status-msg');
  const progressWrap = document.getElementById('load-progress-bar');
  const offlineSelect = document.getElementById('offline-model-select');
  const modelTag = document.getElementById('current-model-tag');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');

  if (!bar) return;

  if (offlineSelect) {
    offlineSelect.value = state.offlineModel;
  }

  let shortOfflineName = "Qwen2.5-Coder (Code)";
  let approxRAM = "~980 MB";

  if (state.offlineModel.includes("0.5B")) {
    shortOfflineName = "Qwen2.5-0.5B (Light)";
    approxRAM = "~380 MB";
  } else if (state.offlineModel.includes("1.5B-Instruct")) {
    shortOfflineName = "Qwen2.5-1.5B (Deep)";
    approxRAM = "~1150 MB";
  }

  if (modelTag) modelTag.textContent = shortOfflineName;

  if (state.isModelReady) {
    ramBadge.textContent = `${approxRAM} in RAM`;
    ramBadge.className = 'ram-badge ready';

    const tokenInfo = state.lastTokensGenerated ? ` (${state.lastTokensGenerated} tokens generated)` : '';
    statusMsg.textContent = `${shortOfflineName} ready for offline reasoning${tokenInfo}.`;
    btnLoad.style.display = 'none';
    btnUnload.style.display = 'block';
    progressWrap.style.display = 'none';

    if (!state.isGenerating) {
      if (chatInput) chatInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }
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
}

// ============================================================================
// 8. Message Dispatcher
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
  const stopContainer = document.getElementById('stop-generation-container');
  const text = inputEl.value.trim();

  if (!text || state.isGenerating) return;

  const chat = getActiveChat();
  if (!chat) return;

  state.isGenerating = true;
  state.abortController = new AbortController();

  sendBtn.disabled = true;
  inputEl.disabled = true;
  if (stopContainer) stopContainer.style.display = 'flex';

  chat.messages.push({ role: 'user', content: text, timestamp: Date.now() });
  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = text.length > 26 ? text.slice(0, 26) + '...' : text;
  }

  updateChatSummary(chat);

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

    if (chat.summary) {
      finalInstruction += 
        `\n\n[CONVERSATION CONTEXT & TOPICS DISCUSSED SO FAR]:\n` +
        chat.summary +
        `\n(Note: The user can ask about these previous topics or code anytime. Reply naturally.)`;
    }

    const matchedStudyData = findRelevantStudyContext(text);
    if (matchedStudyData) {
      finalInstruction += 
        `\n\n[RELEVANT STUDY REFERENCE]:\n` +
        `- Concept: ${matchedStudyData.title}\n` +
        `- Equation: ${matchedStudyData.formula}\n` +
        `- Guidance: Put formulas inside a code block or $$ container so it renders in a nice box. Speak naturally without repeating the user question.`;
    }

    const history = chat.messages.slice(0, -1);
    const reply = await callWebLLMOffline(history, finalInstruction, (streamingText) => {
      assistantMsg.content = streamingText;
      updateStreamingBubble(streamingText);
    }, state.abortController.signal);
    assistantMsg.content = reply;

  } catch (err) {
    if (err.name === 'AbortError') {
      // Stopped by user
    } else if (err.message === 'OFFLINE_NOT_LOADED') {
      assistantMsg.content = '⚠️️ **Offline Model Not Ready**\n\nPlease tap **"⚡ Load Engine"** in the top bar to initialize WebGPU shaders.';
    } else {
      assistantMsg.content = `⚠️ **Error:** ${err.message || err}`;
    }
    updateStreamingBubble(assistantMsg.content);
  } finally {
    state.isGenerating = false;
    state.abortController = null;

    if (stopContainer) stopContainer.style.display = 'none';
    sendBtn.disabled = false;
    inputEl.disabled = false;
    saveChats();
    renderMessages();
    setTimeout(() => {
      inputEl.focus();
    }, 60);
  }
}

function createNewChat() {
  const newChat = {
    id: 'session_' + Date.now(),
    title: 'New Study Session',
    createdAt: Date.now(),
    summary: '',
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
// 9. Bootstrap & Event Listeners
// ============================================================================

function initKinStudyApp() {
  loadPersistedState();
  applyTheme(state.theme);
  fetchKnowledgeBase();

  const offlineModelSelect = document.getElementById('offline-model-select');
  if (offlineModelSelect) {
    offlineModelSelect.value = state.offlineModel;
    offlineModelSelect.onchange = async (e) => {
      state.offlineModel = e.target.value;
      saveSettings();
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

  const stopBtn = document.getElementById('btn-stop-generating');
  if (stopBtn) {
    stopBtn.onclick = () => {
      if (state.abortController) {
        state.abortController.abort();
      }
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
      if (confirm('Clear all chats and saved persona settings?')) {
        await unloadOfflineModel();
        localStorage.clear();
        state.chats = [];
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKinStudyApp);
} else {
  initKinStudyApp();
}
