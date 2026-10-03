import * as webllm from "https://esm.run/@mlc-ai/web-llm";

/* KinStudy Pro — replacement app.js */

const $ = (...selectors) => {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
};

const ui = {
  mode: $("#modeSelect", "#mode-select", "#providerSelect", "#aiMode"),
  model: $("#modelSelect", "#model-select", "#offlineModelSelect"),
  load: $("#loadModelBtn", "#load-model", "#loadModel"),
  free: $("#freeRamBtn", "#free-ram", "#freeRam"),
  form: $("#chatForm", "#messageForm", "#composerForm"),
  input: $("#messageInput", "#message-input", "#promptInput", "textarea"),
  send: $("#sendBtn", "#send-button", "#sendButton"),
  messages: $("#messages", "#chatMessages", "#messagesContainer", "#chatContainer"),
  status: $("#statusText", "#engineStatus", "#status"),
  progress: $("#modelProgress", "#loadProgress", "progress"),
  apiKey: $("#apiKey", "#geminiApiKey", "#gemini-api-key"),
  settings: $("#settingsModal", "#settings"),
  newChat: $("#newChatBtn", "#new-chat", "#newChat"),
  theme: $("#themeBtn", "#themeToggle", "#theme-toggle"),
  chatList: $("#chatList", "#chat-list", "#conversationList"),
  tokenCount: $("#tokenCount", "#token-count")
};

const STORAGE = {
  key: "kinstudy_gemini_api_key",
  chats: "kinstudy_chats_v2",
  current: "kinstudy_current_chat_v2",
  mode: "kinstudy_mode_v2",
  model: "kinstudy_model_v2",
  theme: "kinstudy_theme_v2",
  instructions: "kinstudy_custom_instructions_v2"
};

const ONLINE_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" }
];

const OFFLINE_PREFERENCES = [
  /Qwen2.5-0.5B-Instruct-q4f16_1-MLC/i,
  /Qwen2.5-1.5B-Instruct-q4f16_1-MLC/i,
  /Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC/i,
  /SmolLM2-360M-Instruct-q4f16_1-MLC/i,
  /Llama-3.2-1B-Instruct-q4f16_1-MLC/i,
  /Qwen3-0.6B-q4f16_1-MLC/i
];

let modelRegistry = [];
let engine = null;
let engineModelId = null;
let busy = false;
let stopRequested = false;
let currentAbortController = null;
let studyEntries = [];
let currentChatId = null;
let chats = loadChats();

function safeJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadChats() {
  const value = safeJSON(localStorage.getItem(STORAGE.chats), []);
  return Array.isArray(value) ? value : [];
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentChat() {
  let chat = chats.find(item => item.id === currentChatId);

  if (!chat) {
    chat = {
      id: makeId(),
      title: "New chat",
      messages: [],
      updatedAt: Date.now()
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
  }

  if (!Array.isArray(chat.messages)) chat.messages = [];
  return chat;
}

function saveChats() {
  try {
    localStorage.setItem(STORAGE.chats, JSON.stringify(chats));
    localStorage.setItem(STORAGE.current, currentChatId || "");
  } catch {
    setStatus("Storage is full. Export or delete old chats.");
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function renderText(text) {
  const escaped = escapeHTML(text);
  const codeBlocks = [];

  let html = escaped.replace(
    /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
    (_, language, code) => {
      const index = codeBlocks.push({ language, code }) - 1;
      return `%%CODEBLOCK_${index}%%`;
    }
  );

  html = html
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\n)### (.+)/g, "$1<h3>$2</h3>")
    .replace(/(^|\n)## (.+)/g, "$1<h2>$2</h2>")
    .replace(/(^|\n)# (.+)/g, "$1<h1>$2</h1>")
    .replace(/\n/g, "<br>");

  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, index) => {
    const block = codeBlocks[Number(index)];
    if (!block) return "";

    return `<div class="ks-code">
      <div class="ks-code-head">
        <span>${escapeHTML(block.language || "Code")}</span>
        <button type="button" class="ks-copy-code"
          data-copy="${Number(index)}">Copy code</button>
      </div>
      <pre><code>${block.code}</code></pre>
    </div>`;
  });

  return html;
}

function ensureCodeStyles() {
  if ($("#kinstudy-runtime-styles")) return;

  const style = document.createElement("style");
  style.id = "kinstudy-runtime-styles";
  style.textContent = `
    .ks-code{margin:12px 0;border:1px solid var(--border-color,#303846);
      border-radius:12px;overflow:hidden;background:var(--code-bg,#141820)}
    .ks-code-head{display:flex;justify-content:space-between;align-items:center;
      gap:12px;padding:8px 12px;background:var(--surface-color,#202632);
      font-size:13px}
    .ks-code pre{overflow:auto;padding:14px;margin:0;white-space:pre}
    .ks-code code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .ks-copy-code{cursor:pointer;padding:5px 10px;border-radius:7px}
    .ks-message{white-space:normal;overflow-wrap:anywhere}
    .ks-message img{max-width:100%;height:auto}
    .ks-error{color:#d94a4a}
    .ks-status{font-size:13px;opacity:.85}
    .ks-math{padding:10px;margin:8px 0;overflow-x:auto;
      border-radius:8px;background:var(--surface-color,#202632)}
  `;
  document.head.appendChild(style);
}

function renderMath(root) {
  if (!root || !window.renderMathInElement) return;

  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false
    });
  } catch {
    // Keep readable plain-text equations if the renderer is unavailable.
  }
}

function renderMessages() {
  const chat = getCurrentChat();
  if (!ui.messages) return;

  ui.messages.innerHTML = "";

  for (const message of chat.messages) {
    const article = document.createElement("article");
    article.className = `ks-message ${message.role === "user" ? "user-message" : "assistant-message"}`;

    const heading = document.createElement("div");
    heading.className = "message-author";
    heading.textContent = message.role === "user" ? "You" : "KinStudy";

    const body = document.createElement("div");
    body.className = "message-content";
    body.innerHTML = renderText(message.content || "");

    article.append(heading, body);
    ui.messages.appendChild(article);
  }

  renderMath(ui.messages);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  updateTokenCount();
  renderChatList();
}

function renderChatList() {
  if (!ui.chatList) return;

  ui.chatList.innerHTML = "";

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "chat-list-item";

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = chat.title || "New chat";
    open.addEventListener("click", () => {
      currentChatId = chat.id;
      saveChats();
      renderMessages();
      updateHeader();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete chat");
    remove.addEventListener("click", () => {
      chats = chats.filter(item => item.id !== chat.id);

      if (currentChatId === chat.id) {
        currentChatId = chats[0]?.id || null;
      }

      saveChats();
      renderMessages();
      updateHeader();
    });

    row.append(open, remove);
    ui.chatList.appendChild(row);
  }
}

function updateTokenCount() {
  if (!ui.tokenCount) return;

  const chat = getCurrentChat();
  const text = chat.messages.map(item => item.content || "").join(" ");
  const estimate = Math.ceil(text.length / 4);

  ui.tokenCount.textContent = `~${estimate} tokens in chat (estimate)`;
}

function updateHeader() {
  const chat = getCurrentChat();
  const title = $("#chatTitle", "#conversationTitle");
  if (title) title.textContent = chat.title || "New chat";
}

function setStatus(message, progress = null) {
  if (ui.status) ui.status.textContent = message;

  const offlineStatus = $("#offlineStatus", "#engineStatusText");
  if (offlineStatus && offlineStatus !== ui.status) {
    offlineStatus.textContent = message;
  }

  if (ui.progress && progress !== null) {
    ui.progress.max = 100;
    ui.progress.value = Math.max(0, Math.min(100, progress));
  }
}

function appendMessage(role, content) {
  const chat = getCurrentChat();

  chat.messages.push({
    role,
    content: String(content ?? ""),
    timestamp: Date.now()
  });

  if (role === "user" && chat.messages.filter(m => m.role === "user").length === 1) {
    chat.title = String(content).trim().slice(0, 42) || "New chat";
  }

  chat.updatedAt = Date.now();
  saveChats();
  renderMessages();
}

function setBusy(value) {
  busy = value;

  if (ui.send) {
    ui.send.disabled = value;
    ui.send.textContent = value ? "Stop" : "Send";
  }

  if (ui.input) ui.input.disabled = false;
}

function getMode() {
  return (ui.mode?.value || localStorage.getItem(STORAGE.mode) || "offline")
    .toLowerCase()
    .includes("online") ? "online" : "offline";
}

function selectedModelId() {
  return ui.model?.value || localStorage.getItem(STORAGE.model) || "";
}

function setModelOptions(models) {
  if (!ui.model) return;

  const previous = selectedModelId();
  ui.model.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No supported models found";
    ui.model.appendChild(option);
    ui.model.disabled = true;
    return;
  }

  ui.model.disabled = false;

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    ui.model.appendChild(option);
  }

  const matching = models.find(model => model.id === previous);
  const preferred = OFFLINE_PREFERENCES
    .map(pattern => models.find(model => pattern.test(model.id)))
    .find(Boolean);

  ui.model.value = matching?.id || preferred?.id || models[0].id;
  localStorage.setItem(STORAGE.model, ui.model.value);
}

function readableModelName(id) {
  return id
    .replace(/-q\d+f\d+_\d+-MLC$/i, "")
    .replace(/-MLC$/i, "")
    .replace(/-/g, " ");
}

function getWebGPU() {
  return Boolean(navigator.gpu);
}

async function initializeModelRegistry() {
  try {
    const config = webllm.prebuiltAppConfig;
    modelRegistry = Array.isArray(config?.model_list)
      ? config.model_list
      : [];

    const models = modelRegistry
      .filter(item => item && item.model_id)
      .map(item => ({
        id: item.model_id,
        name: readableModelName(item.model_id)
      }));

    setModelOptions(models);

    if (!models.length) {
      setStatus("WebLLM loaded, but its model registry is empty.");
      return;
    }

    setStatus(
      getWebGPU()
        ? `${models.length} supported models found. Select one and load it.`
        : "WebGPU is unavailable in this browser. Offline AI cannot run here."
    );
  } catch (error) {
    modelRegistry = [];
    setModelOptions([]);
    setStatus(`Could not load WebLLM model registry: ${error.message}`);
  }
}

async function loadOfflineModel() {
  if (busy) return;

  if (!getWebGPU()) {
    setStatus("WebGPU is unavailable. Try a supported browser/device.");
    return;
  }

  const modelId = selectedModelId();

  if (!modelId || !modelRegistry.some(item => item.model_id === modelId)) {
    setStatus("Select a model listed in WebLLM's supported registry.");
    return;
  }

  try {
    if (engine && engineModelId === modelId) {
      setStatus(`Model ready: ${readableModelName(modelId)}`);
      return;
    }

    await freeOfflineModel();
    setStatus("Preparing model download and initialization…", 0);

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: report => {
        const progress = Number(report?.progress);
        const percent = Number.isFinite(progress)
          ? Math.round(progress * 100)
          : null;

        setStatus(
          report?.text || `Loading offline model${percent !== null ? `: ${percent}%` : "…"}`,
          percent
        );
      }
    });

    engineModelId = modelId;
    setStatus(`Model ready: ${readableModelName(modelId)}`, 100);
  } catch (error) {
    engine = null;
    engineModelId = null;

    setStatus(
      `Model failed to load: ${error.message || error}. Connect to internet for the first download, then retry.`
    );
  }
}

async function freeOfflineModel() {
  if (engine) {
    try {
      if (typeof engine.unload === "function") {
        await engine.unload();
      } else if (typeof engine.reset === "function") {
        await engine.reset();
      }
    } catch {
      // Release references even if the runtime cannot unload explicitly.
    }
  }

  engine = null;
  engineModelId = null;
  setStatus("Offline model unloaded.");
}

function getApiKey() {
  return (ui.apiKey?.value || localStorage.getItem(STORAGE.key) || "").trim();
}

function saveApiKey() {
  const key = getApiKey();

  if (key) localStorage.setItem(STORAGE.key, key);
  else localStorage.removeItem(STORAGE.key);

  setStatus(key ? "Gemini API key saved in this browser." : "Gemini API key removed.");
}

function cleanGeminiHistory(messages) {
  const history = [];

  for (const item of messages) {
    if (!item || !["user", "assistant", "model"].includes(item.role)) continue;

    const role = item.role === "user" ? "user" : "model";
    const text = String(item.content || "").trim();

    if (!text) continue;

    const last = history[history.length - 1];

    // Gemini contents must alternate roles. Merge adjacent same-role turns.
    if (last && last.role === role) {
      last.parts[0].text += `\n\n${text}`;
    } else {
      history.push({ role, parts: [{ text }] });
    }
  }

  // A GenerateContent request must end with a user turn.
  while (history.length && history[history.length - 1].role !== "user") {
    history.pop();
  }

  return history;
}

function getStudyContext(question) {
  if (!Array.isArray(studyEntries) || !studyEntries.length) return "";

  const terms = String(question)
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];

  const scored = studyEntries.map(entry => {
    const searchable = `${entry.title || ""} ${entry.subject || ""} ${entry.content || ""} ${entry.tags || ""}`
      .toLowerCase();

    const score = terms.reduce((total, term) => {
      return total + (searchable.includes(term) ? 1 : 0);
    }, 0);

    return { entry, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => `${item.entry.title || "Study note"}:\n${item.entry.content || ""}`)
    .join("\n\n");
}

async function loadStudyData() {
  try {
    const response = await fetch("./study-data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    studyEntries = Array.isArray(data) ? data : data.entries || [];
  } catch {
    studyEntries = [];
  }
}

function buildSystemInstruction(question) {
  const custom = localStorage.getItem(STORAGE.instructions) || "";
  const studyContext = getStudyContext(question);

  return [
    "You are KinStudy, a friendly study and coding tutor.",
    "Explain concepts clearly and step by step, using language suitable for a school student.",
    "For mathematics, show each calculation in readable form and explain what each step means.",
    "Use ordinary equations such as x = (-b ± √(b² - 4ac)) / 2a; do not hide explanations inside code.",
    "Use code blocks only when actual programming code is needed.",
    "When writing code, provide complete runnable examples and explain how to use them.",
    "Be honest when uncertain. Never claim to have executed code or verified a result unless you actually did.",
    custom ? `User instructions:\n${custom}` : "",
    studyContext ? `Relevant study notes (use only when relevant):\n${studyContext}` : ""
  ].filter(Boolean).join("\n\n");
}

async function askGemini() {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("Add a Gemini API key in Settings first.");
  }

  const chat = getCurrentChat();
  const lastUserIndex = chat.messages.map(item => item.role).lastIndexOf("user");

  if (lastUserIndex < 0) throw new Error("Send a message first.");

  const history = cleanGeminiHistory(chat.messages.slice(0, lastUserIndex + 1));

  if (!history.length || history[history.length - 1].role !== "user") {
    throw new Error("Could not prepare valid conversation history. Start a new chat.");
  }

  const latestQuestion = history[history.length - 1].parts
    .map(part => part.text || "")
    .join("\n");

  const modelId = ui.model?.value || ONLINE_MODELS[0].id;
  const systemInstruction = buildSystemInstruction(latestQuestion);

  currentAbortController = new AbortController();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
    {
      method: "POST",
      signal: currentAbortController.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: history,
        generationConfig: {
          maxOutputTokens: 4096
        }
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage = data?.error?.message || `HTTP ${response.status}`;
    const quotaHint = response.status === 429
      ? " Check your Gemini API quota, billing, and rate limits."
      : "";

    throw new Error(`Gemini API ${response.status}: ${apiMessage}${quotaHint}`);
  }

  const answer = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!answer) {
    const reason = data?.promptFeedback?.blockReason;
    throw new Error(reason ? `Gemini blocked this prompt: ${reason}` : "Gemini returned an empty response.");
  }

  return answer;
}

async function askOffline() {
  if (!engine || !engineModelId) {
    throw new Error("Load an offline model before sending messages.");
  }

  const chat = getCurrentChat();
  const lastUserIndex = chat.messages.map(item => item.role).lastIndexOf("user");

  if (lastUserIndex < 0) throw new Error("Send a message first.");

  const latestQuestion = chat.messages[lastUserIndex].content || "";
  const systemInstruction = buildSystemInstruction(latestQuestion);

  const messages = [
    { role: "system", content: systemInstruction },
    ...chat.messages.slice(0, lastUserIndex + 1).map(item => ({
      role: item.role === "user" ? "user" : "assistant",
      content: String(item.content || "")
    }))
  ];

  currentAbortController = new AbortController();

  const response = await engine.chat.completions.create({
    messages,
    temperature: 0.7,
    max_tokens: 2048,
    stream: false
  });

  const answer = response?.choices?.[0]?.message?.content;

  if (!answer) throw new Error("Offline model returned an empty response.");

  return answer;
}

async function sendMessage() {
  if (busy) {
    stopRequested = true;
    currentAbortController?.abort();
    setStatus("Stopping the current request…");
    return;
  }

  const question = ui.input?.value?.trim();

  if (!question) return;

  if (!currentChatId) getCurrentChat();

  appendMessage("user", question);
  if (ui.input) ui.input.value = "";

  setBusy(true);
  stopRequested = false;
  setStatus("Thinking…");

  try {
    const answer = getMode() === "online"
      ? await askGemini()
      : await askOffline();

    if (!stopRequested) {
      appendMessage("assistant", answer);
      setStatus(getMode() === "online" ? "Online · Gemini" : "Offline · Model ready");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Request stopped.");
    } else {
      appendMessage("assistant", `Error: ${error.message || String(error)}`);
      setStatus("Request failed.");
    }
  } finally {
    currentAbortController = null;
    setBusy(false);
  }
}

function createNewChat() {
  const chat = {
    id: makeId(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now()
  };

  chats.unshift(chat);
  currentChatId = chat.id;
  saveChats();
  renderMessages();
  updateHeader();
}

function installModeOptions() {
  if (!ui.mode) return;

  const current = localStorage.getItem(STORAGE.mode) || "offline";
  const hasOnline = Array.from(ui.mode.options || [])
    .some(option => option.value.toLowerCase().includes("online"));

  if (!hasOnline) {
    ui.mode.innerHTML = `
      <option value="offline">Offline</option>
      <option value="online">Online · Gemini</option>
    `;
  }

  const options = Array.from(ui.mode.options || []);
  const match = options.find(option => option.value.toLowerCase() === current);

  ui.mode.value = match ? match.value : "offline";
}

function installModelOptions() {
  if (!ui.model) return;

  const currentMode = getMode();

  if (currentMode === "online") {
    const previous = ui.model.value;
    ui.model.innerHTML = "";

    for (const model of ONLINE_MODELS) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      ui.model.appendChild(option);
    }

    ui.model.value = ONLINE_MODELS.some(model => model.id === previous)
      ? previous
      : ONLINE_MODELS[0].id;

    ui.model.disabled = false;
  } else {
    setModelOptions(modelRegistry.map(item => ({
      id: item.model_id,
      name: readableModelName(item.model_id)
    })));
  }
}

function loadSavedSettings() {
  if (ui.apiKey) {
    ui.apiKey.value = localStorage.getItem(STORAGE.key) || "";
  }

  const theme = localStorage.getItem(STORAGE.theme);
  if (theme) document.documentElement.dataset.theme = theme;

  installModeOptions();
  installModelOptions();
}

function installEvents() {
  if (ui.form) {
    ui.form.addEventListener("submit", event => {
      event.preventDefault();
      sendMessage();
    });
  }

  if (ui.send && !ui.form) {
    ui.send.addEventListener("click", sendMessage);
  }

  if (ui.input && !ui.form) {
    ui.input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  ui.load?.addEventListener("click", loadOfflineModel);
  ui.free?.addEventListener("click", freeOfflineModel);
  ui.newChat?.addEventListener("click", createNewChat);

  ui.mode?.addEventListener("change", () => {
    localStorage.setItem(STORAGE.mode, getMode());

    if (getMode() === "online") {
      installModelOptions();
      setStatus("Online mode selected. Add a valid Gemini API key in Settings.");
    } else {
      installModelOptions();
      setStatus(
        getWebGPU()
          ? "Offline mode selected. Load a supported model."
          : "WebGPU unavailable. Offline mode cannot run on this browser."
      );
    }
  });

  ui.model?.addEventListener("change", () => {
    localStorage.setItem(STORAGE.model, ui.model.value);
  });

  ui.apiKey?.addEventListener("change", saveApiKey);

  const saveKeyButton = $("#saveApiKey", "#save-api-key", "#saveSettingsBtn");
  saveKeyButton?.addEventListener("click", saveApiKey);

  const instructionsInput = $("#customInstructions", "#custom-instructions");
  if (instructionsInput) {
    instructionsInput.value = localStorage.getItem(STORAGE.instructions) || "";
    instructionsInput.addEventListener("change", () => {
      localStorage.setItem(STORAGE.instructions, instructionsInput.value);
    });
  }

  ui.theme?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || "dark";
    const next = current === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE.theme, next);
  });

  ui.messages?.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;

    const index = Number(button.dataset.copy);
    const blocks = Array.from(
      ui.messages.querySelectorAll(".ks-code pre code")
    );
    const code = blocks[index]?.textContent;

    if (code == null) return;

    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "Copied!";
      setTimeout(() => { button.textContent = "Copy code"; }, 1200);
    } catch {
      setStatus("Clipboard access unavailable. Select and copy the code manually.");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      updateTokenCount();
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

async function initialize() {
  ensureCodeStyles();

  currentChatId = localStorage.getItem(STORAGE.current) || null;

  if (!chats.some(chat => chat.id === currentChatId)) {
    currentChatId = chats[0]?.id || null;
  }

  loadSavedSettings();
  installEvents();

  await Promise.all([
    initializeModelRegistry(),
    loadStudyData()
  ]);

  installModelOptions();
  renderMessages();
  updateHeader();

  if (!getWebGPU()) {
    setStatus("WebGPU unavailable. Online mode can still work with an API key.");
  } else if (getMode() === "offline") {
    setStatus("WebGPU detected. Select a supported model and press Load model.");
  }

  await registerServiceWorker();
}

initialize().catch(error => {
  console.error("KinStudy initialization failed:", error);
  setStatus(`Initialization failed: ${error.message || error}`);
});
