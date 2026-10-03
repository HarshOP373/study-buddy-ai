/* KinStudy Pro v7 — stable chat/context build
   - WebLLM pinned to 0.2.82 to avoid the reported disposed-object regression.
   - System prompt is ALWAYS message #1 for local chat.
   - Conversation history is preserved and compacted safely.
   - Code mode gets a larger output budget.
   - Every assistant message has Copy + code blocks have Copy code.
   - SmolVLM 500M uses Transformers.js 3.8.1's image-text-to-text pipeline.
   - Video is handled locally by extracting frames for SmolVLM.
   - Gemini AQ API keys are sent with x-goog-api-key, never as Bearer tokens.
*/

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.82";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs";

let webllm = null;
let transformers = null;
let pdfjs = null;

const $ = id => document.getElementById(id);

const ids = [
  "sidebar","closeSidebarBtn","newChatBtn","chatList","themeBtn","settingsBtn","menuBtn",
  "chatTitle","connectionText","modeSelect","modelSelect","codeModeBtn","offlinePanel",
  "webgpuStatus","loadModelBtn","freeModelBtn","modelProgress","modelProgressText",
  "offlineReadyText","messages","welcome","fileInput","attachBtn","promptInput","stopBtn",
  "sendBtn","tokenEstimate","attachmentCard","attachmentName","attachmentStatus","clearAttachmentBtn",
  "settingsModal","closeSettingsBtn","apiKeyInput","instructionsInput","thinkingSelect","exportBtn",
  "saveSettingsBtn","toast"
];

const els = Object.fromEntries(ids.map(id => [id, $(id)]));

const ONLINE_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" }
];

const OFFLINE_WANTED = [
  {
    key: "smol360",
    name: "SmolLM2 360M",
    patterns: [
      /^SmolLM2-360M-Instruct-q4f16_1-MLC$/i,
      /^SmolLM2-360M-Instruct-q4f32_1-MLC$/i,
      /^SmolLM2-360M-Instruct-q0f16-MLC$/i
    ]
  },
  {
    key: "qwen05",
    name: "Qwen 2.5 0.5B Instruct",
    patterns: [
      /^Qwen2\.5-0\.5B-Instruct-q4f16_1-MLC$/i
    ]
  },
  {
    key: "qwen15",
    name: "Qwen 2.5 1.5B Instruct",
    patterns: [
      /^Qwen2\.5-1\.5B-Instruct-q4f16_1-MLC$/i
    ]
  },
  {
    key: "coder15",
    name: "Qwen 2.5 Coder 1.5B",
    patterns: [
      /^Qwen2\.5-Coder-1\.5B-Instruct-q4f16_1-MLC$/i
    ]
  }
];

// This is the ONLY vision model exposed by KinStudy.
const VISION_MODEL = {
  key: "smolvlm500",
  name: "SmolVLM 500M • Vision",
  id: "HuggingFaceTB/SmolVLM-500M-Instruct"
};

const DEFAULT_INSTRUCTIONS =
  "You are KinStudy Pro, a helpful study and coding assistant. Explain accurately, show steps when useful, do not invent facts, and clearly state uncertainty. Use the verified study database only when relevant.";

const CHAT_DB = "kinstudy-chat-v7";
const FILE_DB = "kinstudy-files-v3";
const CHAT_STORE = "chats";
const FILE_STORE = "files";

let state = {
  chats: [],
  currentId: null,

  theme: localStorage.getItem("ks_theme") || "dark",

  mode: localStorage.getItem("ks_mode") || "online",

  onlineModel:
    localStorage.getItem("ks_online_model") ||
    ONLINE_MODELS[0].id,

  offlineKey:
    localStorage.getItem("ks_offline_key") ||
    "smol360",

  apiKey:
    localStorage.getItem("ks_api_key") || "",

  instructions:
    localStorage.getItem("ks_instructions") ||
    DEFAULT_INSTRUCTIONS,

  thinking:
    localStorage.getItem("ks_thinking") ||
    "medium",

  codeMode:
    localStorage.getItem("ks_code_mode") === "1",

  attachment: null,

  studyData: [],

  engine: null,
  loadedModelId: null,

  engineBusy: false,
  generating: false,

  aborter: null,

  webgpu: false,

  offlineCatalog: [],

  visionPipe: null,
  visionLoaded: false,

  runtimesReady: false,
  offlineStorageReady: false,
  libraryLoading: false
};

function uid() {
  return crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toast(msg, ms = 3000) {
  if (!els.toast) return;

  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");

  clearTimeout(toast.t);

  toast.t = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, ms);
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  }[c]));
}

function setTheme(theme) {
  state.theme = theme;

  document.documentElement.dataset.theme = theme;

  localStorage.setItem("ks_theme", theme);

  const meta = document.querySelector(
    'meta[name="theme-color"]'
  );

  if (meta) {
    meta.content =
      theme === "light"
        ? "#f7f8fb"
        : "#0b0d12";
  }
}

function setConnection(s) {
  if (els.connectionText) {
    els.connectionText.textContent = s;
  }
}

function estimateTokens(t = "") {
  return Math.ceil(String(t).length / 4);
}

function updateTokenEstimate() {
  let n = estimateTokens(
    els.promptInput?.value || ""
  );

  if (state.attachment?.text) {
    n += estimateTokens(state.attachment.text);
  }

  if (els.tokenEstimate) {
    els.tokenEstimate.textContent =
      `~${n.toLocaleString()} tokens`;
  }
}

function autoGrow() {
  if (!els.promptInput) return;

  els.promptInput.style.height = "auto";

  els.promptInput.style.height =
    `${Math.min(
      180,
      els.promptInput.scrollHeight
    )}px`;
}

function friendlyError(e) {
  const s = String(
    e?.message ||
    e ||
    "Unknown error"
  );

  if (
    /already been disposed|already disposed|module has already been disposed/i.test(s)
  ) {
    return `${s} The previous local engine was disposed. Use Free RAM, then Load Engine again.`;
  }

  if (
    /device.*lost|device.*removed|out of memory|allocation failed|memory/i.test(s)
  ) {
    return `${s} The iPad GPU ran out of usable memory. Free RAM and use a smaller model such as SmolLM2 360M.`;
  }

  if (
    /failed to fetch|network|offline|load failed/i.test(s)
  ) {
    return `${s} The required runtime/model is not cached locally yet. Connect once, load the model completely, then try offline again.`;
  }

  return s;
}

/* ---------- IndexedDB ---------- */

function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);

    req.onupgradeneeded = () => {
      upgrade?.(req.result);
    };

    req.onsuccess = () => {
      resolve(req.result);
    };

    req.onerror = () => {
      reject(req.error);
    };
  });
}

async function openChatDB() {
  return openDB(
    CHAT_DB,
    1,
    db => {
      if (!db.objectStoreNames.contains(CHAT_STORE)) {
        db.createObjectStore(
          CHAT_STORE,
          { keyPath: "id" }
        );
      }
    }
  );
}

async function openFileDB() {
  return openDB(
    FILE_DB,
    1,
    db => {
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(
          FILE_STORE,
          { keyPath: "id" }
        );
      }
    }
  );
}

async function persistChats() {
  try {
    const db = await openChatDB();

    await new Promise((resolve, reject) => {
      const tx =
        db.transaction(
          CHAT_STORE,
          "readwrite"
        );

      const store =
        tx.objectStore(CHAT_STORE);

      for (const chat of state.chats) {
        store.put(chat);
      }

      tx.oncomplete = resolve;

      tx.onerror = () => {
        reject(tx.error);
      };
    });

    localStorage.setItem(
      "ks_current_chat",
      state.currentId || ""
    );
  } catch {
    localStorage.setItem(
      "ks_chats_v7",
      JSON.stringify(state.chats)
    );

    localStorage.setItem(
      "ks_current_chat",
      state.currentId || ""
    );
  }
}

async function loadChats() {
  try {
    const db = await openChatDB();

    state.chats = await new Promise(
      (resolve, reject) => {
        const tx =
          db.transaction(
            CHAT_STORE,
            "readonly"
          );

        const req =
          tx.objectStore(
            CHAT_STORE
          ).getAll();

        req.onsuccess = () => {
          resolve(req.result || []);
        };

        req.onerror = () => {
          reject(req.error);
        };
      }
    );
  } catch {
    try {
      state.chats =
        JSON.parse(
          localStorage.getItem(
            "ks_chats_v7"
          ) || "[]"
        );
    } catch {
      state.chats = [];
    }
  }

  if (!state.chats.length) {
    newChat(false);
  } else {
    const saved =
      localStorage.getItem(
        "ks_current_chat"
      );

    state.currentId =
      state.chats.some(
        c => c.id === saved
      )
        ? saved
        : state.chats[0].id;
  }
}

async function saveFileToDB(
  file,
  text = ""
) {
  try {
    const db = await openFileDB();

    await new Promise((resolve, reject) => {
      const tx =
        db.transaction(
          FILE_STORE,
          "readwrite"
        );

      tx.objectStore(FILE_STORE).put({
        id:
          `${file.name}-${file.size}-${file.lastModified}`,

        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,

        text,

        savedAt: Date.now()
      });

      tx.oncomplete = resolve;

      tx.onerror = () => {
        reject(tx.error);
      };
    });
  } catch (e) {
    console.warn(
      "File storage",
      e
    );
  }
}

/* ---------- Chats ---------- */

function currentChat() {
  return state.chats.find(
    c => c.id === state.currentId
  );
}

function newChat(save = true) {
  const chat = {
    id: uid(),
    title: "New chat",
    messages: [],
    summary: ""
  };

  state.chats.unshift(chat);

  state.currentId = chat.id;

  localStorage.setItem(
    "ks_current_chat",
    state.currentId
  );

  renderChatList();
  renderMessages();

  if (save) {
    persistChats();
  }

  if (innerWidth <= 820) {
    els.sidebar?.classList.remove("open");
  }
}

function renderChatList() {
  els.chatList.innerHTML =
    state.chats.map(c => `
      <div class="chat-item ${c.id === state.currentId ? "active" : ""}">
        <button
          class="chat-open"
          data-chat="${escapeHtml(c.id)}"
        >${escapeHtml(c.title || "New chat")}</button>

        <button
          class="chat-delete"
          data-delete="${escapeHtml(c.id)}"
          aria-label="Delete chat"
        >×</button>
      </div>
    `).join("");

  els.chatList
    .querySelectorAll("[data-chat]")
    .forEach(btn => {
      btn.onclick = () => {
        state.currentId =
          btn.dataset.chat;

        localStorage.setItem(
          "ks_current_chat",
          state.currentId
        );

        renderChatList();
        renderMessages();
      };
    });

  els.chatList
    .querySelectorAll("[data-delete]")
    .forEach(btn => {
      btn.onclick = async () => {
        const id =
          btn.dataset.delete;

        state.chats =
          state.chats.filter(
            c => c.id !== id
          );

        if (!state.chats.length) {
          newChat(false);
        } else if (
          state.currentId === id
        ) {
          state.currentId =
            state.chats[0].id;
        }

        await persistChats();

        renderChatList();
        renderMessages();
      };
    });
}

/* ---------- Markdown ---------- */

function inlineMd(s) {
  return escapeHtml(s)
    .replace(
      /`([^`]+)`/g,
      "<code>$1</code>"
    )
    .replace(
      /\*\*([^*]+)\*\*/g,
      "<strong>$1</strong>"
    )
    .replace(
      /\*([^*]+)\*/g,
      "<em>$1</em>"
    )
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function renderMarkdown(src = "") {
  const blocks =
    String(src)
      .replace(/\r/g, "")
      .split(/```/);

  let html = "";

  for (
    let i = 0;
    i < blocks.length;
    i++
  ) {
    if (i % 2 === 1) {
      const code =
        blocks[i].replace(
          /^\w+\n/,
          ""
        );

      html +=
        `<pre><code>${escapeHtml(code)}</code></pre>`;

      continue;
    }

    const lines =
      blocks[i].split("\n");

    let list = false;

    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!list) {
          html += "<ul>";
          list = true;
        }

        html +=
          `<li>${inlineMd(
            line.replace(
              /^\s*[-*]\s+/,
              ""
            )
          )}</li>`;
      } else {
        if (list) {
          html += "</ul>";
          list = false;
        }

        if (!line.trim()) {
          html += "<br>";
        } else if (
          /^###\s+/.test(line)
        ) {
          html +=
            `<h3>${inlineMd(
              line.replace(
                /^###\s+/,
                ""
              )
            )}</h3>`;
        } else if (
          /^##\s+/.test(line)
        ) {
          html +=
            `<h2>${inlineMd(
              line.replace(
                /^##\s+/,
                ""
              )
            )}</h2>`;
        } else if (
          /^#\s+/.test(line)
        ) {
          html +=
            `<h1>${inlineMd(
              line.replace(
                /^#\s+/,
                ""
              )
            )}</h1>`;
        } else {
          html +=
            `<p>${inlineMd(line)}</p>`;
        }
      }
    }

    if (list) {
      html += "</ul>";
    }
  }

  return html;
}

async function copyText(
  text,
  btn
) {
  try {
    await navigator.clipboard.writeText(
      text
    );
  } catch {
    const ta =
      document.createElement(
        "textarea"
      );

    ta.value = text;

    document.body.appendChild(ta);

    ta.select();

    document.execCommand("copy");

    ta.remove();
  }

  btn.textContent = "Copied";

  setTimeout(() => {
    btn.textContent =
      btn.dataset.label ||
      "Copy";
  }, 1200);
}

function addMessageActions(
  wrap,
  message
) {
  if (message.role !== "assistant") {
    return;
  }

  const actions =
    document.createElement("div");

  actions.className =
    "message-actions";

  const copy =
    document.createElement("button");

  copy.className =
    "copy-answer";

  copy.dataset.label =
    "Copy";

  copy.textContent =
    "Copy";

  copy.onclick = () => {
    copyText(
      message.content || "",
      copy
    );
  };

  actions.appendChild(copy);

  wrap
    .querySelector(
      ".message-body"
    )
    ?.appendChild(actions);
}

function addCodeButtons(wrap) {
  wrap
    .querySelectorAll("pre")
    .forEach(pre => {
      if (
        pre.querySelector(
          ".copy-code"
        )
      ) {
        return;
      }

      const btn =
        document.createElement(
          "button"
        );

      btn.className =
        "copy-code";

      btn.dataset.label =
        "Copy code";

      btn.textContent =
        "Copy code";

      btn.onclick = () => {
        copyText(
          pre.querySelector(
            "code"
          )?.innerText || "",
          btn
        );
      };

      pre.appendChild(btn);
    });
}

function appendMessage(
  message
) {
  const wrap =
    document.createElement(
      "article"
    );

  wrap.className =
    `message ${message.role}`;

  wrap.dataset.messageId =
    message.id;

  wrap.innerHTML = `
    <div class="avatar">
      ${message.role === "user" ? "Y" : "K"}
    </div>

    <div class="message-body">
      <div class="message-head">
        ${message.role === "user" ? "You" : "KinStudy"}
      </div>

      <div class="message-content">
        ${renderMarkdown(message.content || "")}
      </div>

      ${
        message.attachmentName
          ? `<div class="attachment-inline">
              📎 ${escapeHtml(message.attachmentName)}
            </div>`
          : ""
      }
    </div>
  `;

  els.messages.appendChild(wrap);

  addCodeButtons(wrap);
  addMessageActions(
    wrap,
    message
  );

  return wrap;
}

function updateMessage(message) {
  const selector =
    `[data-message-id="${CSS.escape(message.id)}"]`;

  const el =
    els.messages.querySelector(
      selector
    );

  if (!el) return;

  const content =
    el.querySelector(
      ".message-content"
    );

  if (content) {
    content.innerHTML =
      renderMarkdown(
        message.content || ""
      );
  }

  el
    .querySelector(
      ".message-actions"
    )
    ?.remove();

  addCodeButtons(el);
  addMessageActions(
    el,
    message
  );

  scrollBottom();
}

function renderMessages() {
  const chat =
    currentChat();

  els.chatTitle.textContent =
    chat?.title ||
    "New chat";

  els.messages
    .querySelectorAll(
      ".message"
    )
    .forEach(x => x.remove());

  if (!chat?.messages?.length) {
    els.welcome.classList.remove(
      "hidden"
    );

    return;
  }

  els.welcome.classList.add(
    "hidden"
  );

  for (
    const message of chat.messages
  ) {
    appendMessage(message);
  }

  scrollBottom();
}

function scrollBottom() {
  requestAnimationFrame(() => {
    els.messages.scrollTop =
      els.messages.scrollHeight;
  });
}

/* ---------- Runtime loading ---------- */

async function loadRuntimes() {
  if (state.runtimesReady) {
    return true;
  }

  if (state.libraryLoading) {
    return false;
  }

  state.libraryLoading = true;

  try {
    setConnection(
      "Preparing local AI runtime…"
    );

    webllm =
      await import(
        WEBLLM_URL
      );

    transformers =
      await import(
        TRANSFORMERS_URL
      );

    state.runtimesReady = true;

    resolveOfflineCatalog();
    populateModels();
    updateOfflineReady();

    return true;
  } catch (e) {
    console.warn(
      "Runtime load failed",
      e
    );

    state.runtimesReady = false;

    setConnection(
      "Offline runtime not cached yet"
    );

    if (navigator.onLine) {
      toast(
        "AI runtime could not be loaded. Check the browser console for the exact error.",
        6000
      );
    }

    return false;
  } finally {
    state.libraryLoading = false;
  }
}

function resolveOfflineCatalog() {
  const list =
    webllm
      ?.prebuiltAppConfig
      ?.model_list ||
    [];

  state.offlineCatalog =
    OFFLINE_WANTED.map(
      wanted => {
        const found =
          list.find(
            model =>
              wanted.patterns.some(
                pattern =>
                  pattern.test(
                    model.model_id ||
                    ""
                  )
              )
          );

        return found
          ? {
              ...wanted,
              id: found.model_id,
              config: found,
              available: true
            }
          : {
              ...wanted,
              available: false
            };
      }
    );
}

function populateModels() {
  if (!els.modelSelect) {
    return;
  }

  if (state.mode === "online") {
    els.modelSelect.innerHTML =
      ONLINE_MODELS.map(
        m =>
          `<option value="${m.id}">
            ${m.name}
          </option>`
      ).join("");

    if (
      !ONLINE_MODELS.some(
        m =>
          m.id ===
          state.onlineModel
      )
    ) {
      state.onlineModel =
        ONLINE_MODELS[0].id;
    }

    els.modelSelect.value =
      state.onlineModel;

    els.offlinePanel.classList.add(
      "hidden"
    );

    return;
  }

  const options =
    state.offlineCatalog.map(
      m =>
        `<option
          value="${m.key}"
          ${m.available ? "" : "disabled"}
        >
          ${m.name}${m.available ? "" : " • unavailable"}
        </option>`
    );

  options.push(
    `<option value="${VISION_MODEL.key}">
      👁 ${VISION_MODEL.name}
    </option>`
  );

  els.modelSelect.innerHTML =
    options.join("");

  const desired =
    state.offlineKey;

  if (
    desired ===
      VISION_MODEL.key ||
    state.offlineCatalog.some(
      m =>
        m.key === desired &&
        m.available
    )
  ) {
    els.modelSelect.value =
      desired;
  } else {
    const fallback =
      state.offlineCatalog.find(
        m => m.available
      );

    state.offlineKey =
      fallback?.key ||
      VISION_MODEL.key;

    localStorage.setItem(
      "ks_offline_key",
      state.offlineKey
    );

    els.modelSelect.value =
      state.offlineKey;
  }

  els.offlinePanel.classList.remove(
    "hidden"
  );

  updateOfflinePanel();
}

function getSelectedOffline() {
  if (
    state.offlineKey ===
    VISION_MODEL.key
  ) {
    return VISION_MODEL;
  }

  return state.offlineCatalog.find(
    m =>
      m.key ===
        state.offlineKey &&
      m.available
  ) || null;
}

async function checkWebGPU() {
  state.webgpu =
    !!navigator.gpu;

  if (!state.webgpu) {
    els.webgpuStatus.textContent =
      "WebGPU unavailable in this browser";

    return false;
  }

  try {
    const adapter =
      await navigator.gpu.requestAdapter();

    state.webgpu =
      !!adapter;

    els.webgpuStatus.textContent =
      adapter
        ? "WebGPU detected"
        : "WebGPU adapter unavailable";
  } catch {
    state.webgpu = false;

    els.webgpuStatus.textContent =
      "WebGPU check failed";
  }

  return state.webgpu;
}

async function disposeTextEngine() {
  if (state.engineBusy) {
    return;
  }

  const old =
    state.engine;

  state.engine = null;
  state.loadedModelId = null;

  if (!old) {
    updateOfflinePanel();
    return;
  }

  try {
    await old.unload?.();
  } catch (e) {
    console.warn(
      "Engine unload",
      e
    );
  }

  updateOfflinePanel();
}

async function loadOfflineModel() {
  if (
    state.engineBusy ||
    state.generating
  ) {
    return;
  }

  const selected =
    getSelectedOffline();

  if (!selected) {
    toast(
      "That offline text model is not included in the current WebLLM catalog.",
      5000
    );

    return;
  }

  if (
    selected.key ===
    VISION_MODEL.key
  ) {
    await loadVision();
    return;
  }

  if (!state.webgpu) {
    toast(
      "WebGPU is required for the offline local model on this build.",
      5000
    );

    return;
  }

  if (!state.runtimesReady) {
    const ok =
      await loadRuntimes();

    if (!ok) return;
  }

  state.engineBusy = true;

  els.loadModelBtn.disabled = true;
  els.freeModelBtn.disabled = true;

  try {
    if (
      state.engine &&
      state.loadedModelId ===
        selected.id
    ) {
      toast(
        `${selected.name} is already loaded.`
      );

      return;
    }

    await disposeTextEngine();

    els.modelProgress.style.width =
      "0%";

    els.modelProgressText.textContent =
      `Loading ${selected.name}…`;

    const progress =
      report => {
        if (
          report?.progress !=
          null
        ) {
          els.modelProgress.style.width =
            `${Math.max(
              0,
              Math.min(
                100,
                report.progress *
                  100
              )
            )}%`;
        }

        if (report?.text) {
          els.modelProgressText.textContent =
            report.text;
        }
      };

    state.engine =
      await webllm.CreateMLCEngine(
        selected.id,
        {
          initProgressCallback:
            progress,

          appConfig:
            webllm.prebuiltAppConfig,

          logLevel: "WARN"
        }
      );

    state.loadedModelId =
      selected.id;

    els.modelProgress.style.width =
      "100%";

    els.modelProgressText.textContent =
      `${selected.name} loaded and ready.`;

    toast(
      `${selected.name} loaded.`
    );
  } catch (e) {
    console.error(e);

    await disposeTextEngine();

    throw e;
  } finally {
    state.engineBusy = false;

    els.loadModelBtn.disabled =
      false;

    updateOfflinePanel();
  }
}

async function freeOfflineModel(
  showToast = true
) {
  if (
    state.generating ||
    state.engineBusy
  ) {
    return;
  }

  await disposeTextEngine();

  if (state.visionPipe) {
    state.visionPipe = null;
    state.visionLoaded = false;
  }

  if (showToast) {
    toast(
      "Local engine released. Chats and cached model files remain."
    );
  }
}

function updateOfflinePanel() {
  if (!els.offlinePanel) {
    return;
  }

  els.freeModelBtn.disabled =
    !(
      state.engine ||
      state.visionLoaded
    );

  const selected =
    getSelectedOffline();

  if (!selected) {
    return;
  }

  if (
    selected.key ===
    VISION_MODEL.key
  ) {
    els.modelProgressText.textContent =
      state.visionLoaded
        ? "SmolVLM 500M loaded and ready for images/video frames."
        : "Load SmolVLM 500M for offline image/video understanding.";
  } else if (
    state.loadedModelId
  ) {
    els.modelProgressText.textContent =
      `${selected.name} is loaded.`;
  }
}

/* ---------- SmolVLM ---------- */

async function loadVision() {
  if (
    state.visionLoaded &&
    state.visionPipe
  ) {
    return true;
  }

  if (!state.webgpu) {
    throw new Error(
      "WebGPU is required for SmolVLM 500M in this browser."
    );
  }

  if (!state.runtimesReady) {
    const ok =
      await loadRuntimes();

    if (!ok) {
      throw new Error(
        "Transformers.js runtime is not available yet."
      );
    }
  }

  state.engineBusy = true;

  els.loadModelBtn.disabled =
    true;

  try {
    await disposeTextEngine();

    els.modelProgress.style.width =
      "0%";

    els.modelProgressText.textContent =
      "Loading SmolVLM 500M…";

    state.visionPipe =
      await transformers.pipeline(
        "image-text-to-text",
        VISION_MODEL.id,
        {
          device: "webgpu",
          dtype: "q4",

          progress_callback:
            report => {
              if (
                report?.progress !=
                null
              ) {
                els.modelProgress.style.width =
                  `${Math.max(
                    0,
                    Math.min(
                      100,
                      report.progress
                    )
                  )}%`;
              }

              if (report?.file) {
                els.modelProgressText.textContent =
                  `Downloading ${report.file}…`;
              } else if (
                report?.status
              ) {
                els.modelProgressText.textContent =
                  report.status;
              }
            }
        }
      );

    state.visionLoaded =
      true;

    els.modelProgress.style.width =
      "100%";

    els.modelProgressText.textContent =
      "SmolVLM 500M loaded and ready.";

    toast(
      "SmolVLM 500M loaded."
    );

    return true;
  } catch (e) {
    state.visionPipe = null;
    state.visionLoaded = false;

    throw new Error(
      `SmolVLM failed to load: ${
        e.message || e
      }`
    );
  } finally {
    state.engineBusy = false;

    els.loadModelBtn.disabled =
      false;

    updateOfflinePanel();
  }
}

function extractVisionText(result) {
  if (typeof result === "string") {
    return result;
  }

  if (Array.isArray(result)) {
    const last =
      result.at(-1);

    if (typeof last === "string") {
      return last;
    }

    if (last?.generated_text) {
      return last.generated_text;
    }

    return JSON.stringify(last);
  }

  return (
    result?.generated_text ||
    result?.text ||
    JSON.stringify(result)
  );
}

async function imageToDataURL(file) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        resolve(
          reader.result
        );
      };

      reader.onerror = () => {
        reject(
          reader.error ||
          new Error(
            "Image could not be read."
          )
        );
      };

      reader.readAsDataURL(file);
    }
  );
}

async function videoFrames(
  file,
  count = 4
) {
  const url =
    URL.createObjectURL(file);

  const video =
    document.createElement(
      "video"
    );

  video.src = url;
  video.muted = true;
  video.playsInline = true;

  await new Promise(
    (resolve, reject) => {
      video.onloadedmetadata =
        resolve;

      video.onerror = () => {
        reject(
          new Error(
            "Video could not be opened."
          )
        );
      };
    }
  );

  const duration =
    Number.isFinite(
      video.duration
    )
      ? video.duration
      : 0;

  if (!duration) {
    URL.revokeObjectURL(url);

    throw new Error(
      "Video has no readable duration."
    );
  }

  const frames = [];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const time =
      duration *
      (i + 1) /
      (count + 1);

    await new Promise(
      (resolve, reject) => {
        const onSeek = () => {
          cleanup();
          resolve();
        };

        const onError = () => {
          cleanup();

          reject(
            new Error(
              "Could not seek video."
            )
          );
        };

        const cleanup = () => {
          video.removeEventListener(
            "seeked",
            onSeek
          );

          video.removeEventListener(
            "error",
            onError
          );
        };

        video.addEventListener(
          "seeked",
          onSeek,
          { once: true }
        );

        video.addEventListener(
          "error",
          onError,
          { once: true }
        );

        video.currentTime =
          time;
      }
    );

    const canvas =
      document.createElement(
        "canvas"
      );

    const scale =
      Math.min(
        1,
        1280 /
          video.videoWidth,
        1280 /
          video.videoHeight
      );

    canvas.width =
      Math.max(
        1,
        Math.round(
          video.videoWidth *
            scale
        )
      );

    canvas.height =
      Math.max(
        1,
        Math.round(
          video.videoHeight *
            scale
        )
      );

    canvas
      .getContext("2d")
      .drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

    frames.push(
      canvas.toDataURL(
        "image/jpeg",
        0.78
      )
    );
  }

  URL.revokeObjectURL(url);

  return frames;
}

/* ---------- Files / PDF ---------- */

async function loadPdfJS() {
  if (pdfjs) {
    return pdfjs;
  }

  pdfjs =
    await import(
      PDFJS_URL
    );

  pdfjs.GlobalWorkerOptions.workerSrc =
    PDFJS_WORKER_URL;

  return pdfjs;
}

function fileKind(file) {
  if (
    file.type.startsWith(
      "image/"
    )
  ) {
    return "image";
  }

  if (
    file.type.startsWith(
      "video/"
    )
  ) {
    return "video";
  }

  if (
    file.type ===
      "application/pdf" ||
    /\.pdf$/i.test(
      file.name
    )
  ) {
    return "pdf";
  }

  return "text";
}

async function extractPdf(file) {
  const lib =
    await loadPdfJS();

  const buffer =
    await file.arrayBuffer();

  const pdf =
    await lib
      .getDocument({
        data: buffer
      })
      .promise;

  let text = "";

  for (
    let pageNo = 1;
    pageNo <= pdf.numPages;
    pageNo++
  ) {
    els.attachmentStatus.textContent =
      `Reading PDF: Page ${pageNo} of ${pdf.numPages}…`;

    const page =
      await pdf.getPage(
        pageNo
      );

    const content =
      await page.getTextContent();

    const pageText =
      content.items
        .map(
          item =>
            item.str || ""
        )
        .join(" ");

    text +=
      `\n\n[Page ${pageNo}]\n${pageText}`;
  }

  els.attachmentStatus.textContent =
    "Extracting text tokens…";

  return text.trim();
}

async function readText(file) {
  els.attachmentStatus.textContent =
    "Reading file…";

  return file.text();
}

async function handleFile(file) {
  if (!file) return;

  clearAttachment();

  const kind =
    fileKind(file);

  state.attachment = {
    file,
    name: file.name,
    type: file.type,
    kind,
    text: ""
  };

  els.attachmentCard.classList.remove(
    "hidden"
  );

  els.attachmentName.textContent =
    file.name;

  els.attachmentStatus.textContent =
    "Preparing…";

  updateTokenEstimate();

  try {
    if (kind === "pdf") {
      state.attachment.text =
        await extractPdf(file);
    } else if (
      kind === "text"
    ) {
      state.attachment.text =
        await readText(file);
    } else {
      state.attachment.text =
        "";
    }

    await saveFileToDB(
      file,
      state.attachment.text
    );

    els.attachmentStatus.textContent =
      kind === "image"
        ? "Image ready for vision."
        : kind === "video"
        ? "Video ready; local frames will be analyzed."
        : "Ready.";
  } catch (e) {
    state.attachment = null;

    els.attachmentStatus.textContent =
      "Could not read file.";

    toast(
      friendlyError(e),
      5000
    );
  }

  updateTokenEstimate();
}

function clearAttachment() {
  state.attachment = null;

  if (els.fileInput) {
    els.fileInput.value = "";
  }

  els.attachmentCard?.classList.add(
    "hidden"
  );

  if (els.attachmentName) {
    els.attachmentName.textContent =
      "";
  }

  if (els.attachmentStatus) {
    els.attachmentStatus.textContent =
      "";
  }

  updateTokenEstimate();
}

/* ---------- Study data ---------- */

async function loadStudyData() {
  try {
    const r =
      await fetch(
        "./study-data.json",
        {
          cache:
            "force-cache"
        }
      );

    if (!r.ok) {
      throw new Error(
        `study-data ${r.status}`
      );
    }

    const data =
      await r.json();

    state.studyData =
      Array.isArray(data)
        ? data
        : (
            data.entries ||
            []
          );
  } catch (e) {
    console.warn(
      "Study data unavailable",
      e
    );

    state.studyData = [];
  }
}

function studyContext(prompt) {
  if (!state.studyData.length) {
    return "";
  }

  const q =
    prompt.toLowerCase();

  const matches =
    state.studyData
      .filter(entry => {
        const hay =
          `${entry.title || ""} ${entry.topic || ""} ${entry.tags || ""} ${entry.content || entry.formula || entry.fact || ""}`
            .toLowerCase();

        return q
          .split(/\W+/)
          .filter(
            x => x.length > 2
          )
          .some(
            word =>
              hay.includes(word)
          );
      })
      .slice(0, 4);

  if (!matches.length) {
    return "";
  }

  return matches
    .map(
      x =>
        `- ${x.title || x.topic || "Study reference"}: ${x.content || x.formula || x.fact || ""}`
    )
    .join("\n");
}

/* ---------- Prompt / context management ---------- */

function isCodeLike(text) {
  return (
    state.codeMode ||
    /```|\b(code|coding|program|javascript|typescript|python|html|css|react|sql|api|function|class|debug|bug|error|async|await)\b/i.test(
      text || ""
    )
  );
}

function buildSystem(
  prompt,
  summary = ""
) {
  const mode =
    isCodeLike(prompt)
      ? `You are in CODE MODE. Prefer correct, runnable code. Explain important decisions briefly. Use fenced code blocks with the language name. Do not invent APIs. When debugging, identify the likely cause and give the corrected code.`
      : `You are in normal chat/study mode. Be clear, conversational, accurate, and helpful. Explain difficult ideas step by step when useful.`;

  const study =
    studyContext(
      prompt || ""
    );

  return [
    DEFAULT_INSTRUCTIONS,

    mode,

    state.instructions
      ? `Additional user instructions:\n${state.instructions}`
      : "",

    summary
      ? `Conversation memory from older turns:\n${summary}`
      : "",

    study
      ? `Verified local study references. Use only when relevant and do not force them into unrelated answers:\n${study}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compactHistory(
  chat,
  maxChars
) {
  const messages =
    (chat.messages || [])
      .filter(m => m.content);

  const total =
    messages.reduce(
      (n, m) =>
        n +
        String(
          m.content
        ).length,
      0
    );

  if (
    messages.length <= 8 &&
    total <= maxChars
  ) {
    return;
  }

  const keep =
    messages.slice(-6);

  const old =
    messages.slice(0, -6);

  const digest =
    old
      .map(
        m =>
          `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content).slice(0, 700)}`
      )
      .join("\n");

  chat.summary =
    `${
      chat.summary
        ? chat.summary + "\n"
        : ""
    }${digest}`.slice(-5000);

  chat.messages = keep;
}

function buildOfflineMessages(
  chat,
  prompt,
  attachment
) {
  compactHistory(
    chat,
    isCodeLike(prompt)
      ? 12000
      : 9000
  );

  // CRITICAL:
  // exactly ONE system message,
  // and it is ALWAYS first.
  const messages = [
    {
      role: "system",
      content: buildSystem(
        prompt,
        chat.summary || ""
      )
    }
  ];

  for (
    const m of
    chat.messages || []
  ) {
    if (!m.content) {
      continue;
    }

    messages.push({
      role: m.role,
      content: m.content
    });
  }

  // The current user message is already in chat.messages.
  // Add text attachment content to that final user turn.
  if (
    attachment?.text &&
    messages.length
  ) {
    const last =
      messages.at(-1);

    if (
      last?.role ===
      "user"
    ) {
      last.content +=
        `\n\nAttached file (${attachment.name}):\n${attachment.text.slice(0, 90000)}`;
    }
  }

  return messages;
}

function buildOnlineContents(
  chat,
  prompt,
  attachment
) {
  // Gemini uses system_instruction separately.
  // Its contents array contains only user/model turns.
  const contents = [];

  for (
    const m of
    chat.messages || []
  ) {
    if (!m.content) {
      continue;
    }

    contents.push({
      role:
        m.role === "assistant"
          ? "model"
          : "user",

      parts: [
        {
          text: m.content
        }
      ]
    });
  }

  const last =
    contents.at(-1);

  if (
    last?.role ===
      "user" &&
    attachment?.text
  ) {
    last.parts.push({
      text:
        `\n\nAttached file (${attachment.name}):\n${attachment.text.slice(0, 90000)}`
    });
  }

  return contents;
}

/* ---------- Online Gemini ---------- */

async function generateOnline(
  prompt,
  msg,
  attachment,
  chat
) {
  if (!state.apiKey) {
    throw new Error(
      "Add your Gemini API key in Settings first."
    );
  }

  compactHistory(
    chat,
    isCodeLike(prompt)
      ? 12000
      : 9000
  );

  const system =
    buildSystem(
      prompt,
      chat.summary || ""
    );

  const body = {
    system_instruction: {
      parts: [
        {
          text: system
        }
      ]
    },

    contents:
      buildOnlineContents(
        chat,
        prompt,
        attachment
      ),

    generationConfig: {
      thinkingConfig: {
        thinkingLevel:
          state.thinking
      }
    }
  };

  /*
    IMPORTANT:

    Gemini AQ authorization keys are API keys.
    They are NOT OAuth bearer tokens.

    Therefore:
      x-goog-api-key: AQ....

    is used.

    We intentionally do NOT:
      Authorization: Bearer AQ....
    and we do NOT put the key into the URL.
  */

  const apiKey =
    String(
      state.apiKey || ""
    )
      .trim()
      .replace(
        /^['"]|['"]$/g,
        ""
      );

  if (!apiKey) {
    throw new Error(
      "Gemini API key is empty. Add it in Settings."
    );
  }

  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.onlineModel)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey
        },

        body:
          JSON.stringify(body),

        signal:
          state.aborter.signal
      }
    );

  if (!response.ok) {
    let detail = "";

    try {
      const raw =
        await response.text();

      try {
        const data =
          JSON.parse(raw);

        detail =
          data?.error?.message ||
          raw;
      } catch {
        detail = raw;
      }
    } catch {
      detail =
        "Unable to read the API error response.";
    }

    if (
      response.status ===
      401
    ) {
      if (
        /ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(
          detail
        )
      ) {
        throw new Error(
          "Gemini authentication failed (401 ACCESS_TOKEN_TYPE_UNSUPPORTED). KinStudy is sending the AQ key using the x-goog-api-key header. Generate a fresh Gemini API key in Google AI Studio, copy the complete key beginning with AQ., and paste it without quotes or spaces. If a fresh key still returns this error, the key/project provisioning must be fixed by Google; changing the chat code will not bypass it."
        );
      }

      throw new Error(
        `Gemini authentication failed (401): ${detail}`
      );
    }

    if (
      response.status ===
      403
    ) {
      throw new Error(
        `Gemini access denied (403): ${detail}`
      );
    }

    if (
      response.status ===
      404
    ) {
      throw new Error(
        `Gemini model not found (404): ${detail}`
      );
    }

    if (
      response.status ===
      429
    ) {
      throw new Error(
        `Gemini quota/rate limit (429): ${detail}`
      );
    }

    throw new Error(
      `Gemini API ${response.status}: ${detail}`
    );
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";

  while (true) {
    const {
      value,
      done
    } =
      await reader.read();

    if (done) {
      break;
    }

    buffer +=
      decoder.decode(
        value,
        {
          stream: true
        }
      );

    const lines =
      buffer.split("\n");

    buffer =
      lines.pop() || "";

    for (
      const line of lines
    ) {
      if (
        !line.startsWith(
          "data:"
        )
      ) {
        continue;
      }

      const raw =
        line
          .slice(5)
          .trim();

      if (
        !raw ||
        raw === "[DONE]"
      ) {
        continue;
      }

      try {
        const json =
          JSON.parse(raw);

        const parts =
          json
            .candidates?.[0]
            ?.content
            ?.parts || [];

        for (
          const part of parts
        ) {
          if (part.text) {
            msg.content +=
              part.text;

            updateMessage(
              msg
            );
          }
        }
      } catch {
        // Ignore incomplete SSE fragments.
      }
    }
  }
}

/* ---------- Offline generation ---------- */

async function createOfflineStream(
  messages,
  maxTokens
) {
  if (!state.engine) {
    throw new Error(
      "Load an offline text model first."
    );
  }

  return state.engine.chat.completions.create(
    {
      messages,

      temperature:
        state.codeMode
          ? 0.2
          : 0.45,

      max_tokens:
        maxTokens,

      stream: true,

      stream_options: {
        include_usage: true
      }
    }
  );
}

async function generateOfflineText(
  prompt,
  msg,
  chat,
  attachment
) {
  const messages =
    buildOfflineMessages(
      chat,
      prompt,
      attachment
    );

  const maxTokens =
    isCodeLike(prompt)
      ? 2048
      : 1024;

  if (
    !state.engine ||
    !state.loadedModelId
  ) {
    throw new Error(
      "Load the selected offline text model first."
    );
  }

  try {
    const stream =
      await createOfflineStream(
        messages,
        maxTokens
      );

    for await (
      const chunk of stream
    ) {
      if (
        state.aborter
          ?.signal
          .aborted
      ) {
        break;
      }

      const piece =
        chunk
          .choices?.[0]
          ?.delta
          ?.content || "";

      if (piece) {
        msg.content +=
          piece;

        updateMessage(
          msg
        );
      }
    }
  } catch (e) {
    const s =
      String(
        e?.message || e
      );

    if (
      /already disposed|device.*lost|device.*removed|out of memory/i.test(
        s
      )
    ) {
      await disposeTextEngine();

      throw new Error(
        `Local engine became invalid during generation. The chat is saved. Press Load Engine and retry. Original: ${s}`
      );
    }

    throw e;
  }
}

async function generateOfflineVision(
  prompt,
  msg,
  attachment
) {
  if (
    !attachment ||
    !["image", "video"].includes(
      attachment.kind
    )
  ) {
    throw new Error(
      "SmolVLM 500M needs an image or video attachment."
    );
  }

  if (
    !state.visionLoaded ||
    !state.visionPipe
  ) {
    await loadVision();
  }

  const images =
    attachment.kind ===
    "image"
      ? [
          await imageToDataURL(
            attachment.file
          )
        ]
      : await videoFrames(
          attachment.file,
          4
        );

  let answer = "";

  for (
    let i = 0;
    i < images.length;
    i++
  ) {
    if (
      state.aborter
        ?.signal
        .aborted
    ) {
      break;
    }

    els.modelProgressText.textContent =
      attachment.kind ===
      "video"
        ? `Analyzing video frame ${i + 1} of ${images.length}…`
        : "Analyzing image…";

    const messages = [
      {
        role: "user",

        content: [
          {
            type: "image"
          },

          {
            type: "text",

            text:
              prompt ||
              "Analyze this image for a student. Explain what is visible and important."
          }
        ]
      }
    ];

    const result =
      await state.visionPipe(
        messages,
        {
          images: [
            images[i]
          ],

          max_new_tokens:
            state.codeMode
              ? 900
              : 600,

          return_full_text:
            false
        }
      );

    const text =
      extractVisionText(
        result
      );

    answer +=
      `${
        images.length > 1
          ? `Frame ${i + 1}: `
          : ""
      }${text}\n\n`;

    msg.content =
      answer.trim();

    updateMessage(
      msg
    );
  }
}

async function generateOffline(
  prompt,
  msg,
  attachment,
  chat
) {
  if (
    state.offlineKey ===
    VISION_MODEL.key
  ) {
    return generateOfflineVision(
      prompt,
      msg,
      attachment
    );
  }

  return generateOfflineText(
    prompt,
    msg,
    chat,
    attachment
  );
}

/* ---------- Send / stop ---------- */

async function sendMessage(
  prefill = null
) {
  if (
    state.generating ||
    state.engineBusy
  ) {
    return;
  }

  const text =
    (
      prefill ??
      els.promptInput.value
    ).trim();

  if (
    !text &&
    !state.attachment
  ) {
    return;
  }

  const chat =
    currentChat();

  if (!chat) {
    return;
  }

  const attachment =
    state.attachment;

  if (!chat.messages.length) {
    chat.title =
      (
        text ||
        attachment?.name ||
        "New chat"
      ).slice(
        0,
        42
      );
  }

  const user = {
    id: uid(),

    role: "user",

    content:
      text ||
      "Analyze this file.",

    attachmentName:
      attachment?.name ||
      null
  };

  chat.messages.push(
    user
  );

  appendMessage(
    user
  );

  const assistant = {
    id: uid(),
    role: "assistant",
    content: ""
  };

  chat.messages.push(
    assistant
  );

  appendMessage(
    assistant
  );

  await persistChats();

  renderChatList();

  els.promptInput.value =
    "";

  autoGrow();
  updateTokenEstimate();

  state.generating =
    true;

  state.aborter =
    new AbortController();

  els.sendBtn.disabled =
    true;

  els.stopBtn.classList.remove(
    "hidden"
  );

  setConnection(
    state.mode ===
      "online"
      ? "Generating online…"
      : "Generating locally…"
  );

  try {
    if (
      state.mode ===
      "online"
    ) {
      await generateOnline(
        text,
        assistant,
        attachment,
        chat
      );
    } else {
      await generateOffline(
        text,
        assistant,
        attachment,
        chat
      );
    }

    if (!assistant.content) {
      assistant.content =
        "No text response was returned.";
    }
  } catch (e) {
    if (
      e.name ===
      "AbortError"
    ) {
      assistant.content +=
        `${
          assistant.content
            ? "\n\n"
            : ""
        }_Generation stopped._`;
    } else {
      assistant.content +=
        `${
          assistant.content
            ? "\n\n"
            : ""
        }**Error:** ${friendlyError(e)}`;
    }

    console.error(e);
  } finally {
    state.generating =
      false;

    state.aborter =
      null;

    els.sendBtn.disabled =
      false;

    els.stopBtn.classList.add(
      "hidden"
    );

    updateMessage(
      assistant
    );

    await persistChats();

    clearAttachment();

    updateOfflinePanel();

    setConnection(
      state.mode ===
        "online"
        ? "Online • Gemini"
        : `Offline • ${
            state.loadedModelId ||
            (
              state.visionLoaded
                ? VISION_MODEL.name
                : "model not loaded"
            )
          }`
    );
  }
}

function stopGeneration() {
  state.aborter?.abort();

  try {
    state.engine
      ?.interruptGenerate?.();
  } catch {}
}

/* ---------- Settings ---------- */

function openSettings() {
  els.apiKeyInput.value =
    state.apiKey;

  els.instructionsInput.value =
    state.instructions;

  els.thinkingSelect.value =
    state.thinking;

  els.settingsModal.classList.remove(
    "hidden"
  );
}

function saveSettings() {
  state.apiKey =
    els.apiKeyInput.value
      .trim()
      .replace(
        /^['"]|['"]$/g,
        ""
      );

  state.instructions =
    els.instructionsInput.value
      .trim() ||
    DEFAULT_INSTRUCTIONS;

  state.thinking =
    els.thinkingSelect.value;

  localStorage.setItem(
    "ks_api_key",
    state.apiKey
  );

  localStorage.setItem(
    "ks_instructions",
    state.instructions
  );

  localStorage.setItem(
    "ks_thinking",
    state.thinking
  );

  els.settingsModal.classList.add(
    "hidden"
  );

  toast(
    "Settings saved."
  );
}

function exportChat() {
  const chat =
    currentChat();

  if (!chat) {
    return;
  }

  const md =
    `# ${chat.title}\n\n${
      (chat.messages || [])
        .map(
          m =>
            `## ${
              m.role === "user"
                ? "You"
                : "KinStudy"
            }\n\n${m.content}`
        )
        .join("\n\n")
    }`;

  const blob =
    new Blob(
      [md],
      {
        type:
          "text/markdown"
      }
    );

  const a =
    document.createElement(
      "a"
    );

  a.href =
    URL.createObjectURL(
      blob
    );

  a.download =
    `${
      (
        chat.title ||
        "kinstudy-chat"
      )
        .replace(
          /[^a-z0-9]+/gi,
          "-"
        )
        .replace(
          /^-|-$/g,
          ""
        ) ||
      "kinstudy-chat"
    }.md`;

  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(
      a.href
    );
  }, 1000);
}

function setCodeMode(on) {
  state.codeMode =
    !!on;

  els.codeModeBtn.setAttribute(
    "aria-pressed",
    String(
      state.codeMode
    )
  );

  localStorage.setItem(
    "ks_code_mode",
    state.codeMode
      ? "1"
      : "0"
  );

  els.codeModeBtn.textContent =
    state.codeMode
      ? "Code mode ✓"
      : "Code mode";
}

/* ---------- Offline storage / service worker ---------- */

async function updateOfflineReady() {
  try {
    if (
      navigator.storage
        ?.persist
    ) {
      await navigator.storage.persist();
    }

    state.offlineStorageReady =
      !!(
        navigator.storage
          ?.estimate
      );

    els.offlineReadyText.textContent =
      state.offlineStorageReady
        ? "Offline storage: available — models remain in browser storage after download."
        : "Offline storage: browser-managed.";
  } catch {
    els.offlineReadyText.textContent =
      "Offline storage: browser-managed.";
  }
}

async function warmOfflineCaches() {
  if (!navigator.onLine) {
    return;
  }

  try {
    await caches.open(
      "kinstudy-runtime-v7"
    );
  } catch {}

  updateOfflineReady();
}

async function registerSW() {
  if (
    !(
      "serviceWorker" in
      navigator
    ) ||
    !/^https?:$/.test(
      location.protocol
    )
  ) {
    return;
  }

  try {
    const reg =
      await navigator.serviceWorker.register(
        "./sw.js?v=7",
        {
          scope: "./"
        }
      );

    if (reg.waiting) {
      reg.waiting.postMessage({
        type:
          "SKIP_WAITING"
      });
    }

    await navigator.serviceWorker.ready;
  } catch (e) {
    console.warn(
      "Service worker registration failed",
      e
    );
  }
}

/* ---------- Events ---------- */

function bind() {
  els.newChatBtn.onclick =
    () => newChat();

  els.menuBtn.onclick =
    () => {
      els.sidebar.classList.add(
        "open"
      );
    };

  els.closeSidebarBtn.onclick =
    () => {
      els.sidebar.classList.remove(
        "open"
      );
    };

  els.themeBtn.onclick =
    () => {
      setTheme(
        state.theme ===
          "dark"
          ? "light"
          : "dark"
      );
    };

  els.settingsBtn.onclick =
    openSettings;

  els.closeSettingsBtn.onclick =
    () => {
      els.settingsModal.classList.add(
        "hidden"
      );
    };

  els.saveSettingsBtn.onclick =
    saveSettings;

  els.exportBtn.onclick =
    exportChat;

  els.settingsModal.onclick =
    e => {
      if (
        e.target ===
        els.settingsModal
      ) {
        els.settingsModal.classList.add(
          "hidden"
        );
      }
    };

  els.attachBtn.onclick =
    () => {
      els.fileInput.click();
    };

  els.fileInput.onchange =
    () => {
      handleFile(
        els.fileInput.files[0]
      );
    };

  els.clearAttachmentBtn.onclick =
    clearAttachment;

  els.sendBtn.onclick =
    () => sendMessage();

  els.stopBtn.onclick =
    stopGeneration;

  els.promptInput.oninput =
    () => {
      autoGrow();
      updateTokenEstimate();
    };

  els.promptInput.onkeydown =
    e => {
      if (
        e.key === "Enter" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        sendMessage();
      }
    };

  document
    .querySelectorAll(
      "[data-prompt]"
    )
    .forEach(
      btn => {
        btn.onclick =
          () =>
            sendMessage(
              btn.dataset.prompt
            );
      }
    );

  els.codeModeBtn.onclick =
    () =>
      setCodeMode(
        !state.codeMode
      );

  els.modeSelect.onchange =
    async () => {
      if (
        state.generating ||
        state.engineBusy
      ) {
        return;
      }

      if (
        state.mode ===
        "offline"
      ) {
        await freeOfflineModel(
          false
        );
      }

      state.mode =
        els.modeSelect.value;

      localStorage.setItem(
        "ks_mode",
        state.mode
      );

      populateModels();

      setConnection(
        state.mode ===
          "online"
          ? "Online • Gemini"
          : "Offline • cached runtime"
      );
    };

  els.modelSelect.onchange =
    async () => {
      if (
        state.generating ||
        state.engineBusy
      ) {
        return;
      }

      if (
        state.mode ===
        "online"
      ) {
        state.onlineModel =
          els.modelSelect.value;

        localStorage.setItem(
          "ks_online_model",
          state.onlineModel
        );

        return;
      }

      await freeOfflineModel(
        false
      );

      state.offlineKey =
        els.modelSelect.value;

      localStorage.setItem(
        "ks_offline_key",
        state.offlineKey
      );

      updateOfflinePanel();
    };

  els.loadModelBtn.onclick =
    async () => {
      try {
        await loadOfflineModel();
      } catch (e) {
        toast(
          friendlyError(e),
          7000
        );

        console.error(e);
      }
    };

  els.freeModelBtn.onclick =
    () =>
      freeOfflineModel(
        true
      );
}

window.addEventListener(
  "online",
  () => {
    if (
      state.mode ===
      "online"
    ) {
      setConnection(
        "Online • Gemini"
      );
    } else {
      setConnection(
        "Offline • cached runtime available"
      );
    }

    warmOfflineCaches();
  }
);

window.addEventListener(
  "offline",
  () => {
    setConnection(
      "Offline • browser cache only"
    );
  }
);

/* ---------- Boot ---------- */

async function init() {
  setTheme(
    state.theme
  );

  setCodeMode(
    state.codeMode
  );

  bind();

  els.modeSelect.value =
    state.mode;

  await loadChats();

  renderChatList();
  renderMessages();

  await checkWebGPU();

  await loadStudyData();

  await registerSW();

  await loadRuntimes();

  await updateOfflineReady();

  await warmOfflineCaches();

  populateModels();

  setConnection(
    navigator.onLine
      ? (
          state.mode ===
          "online"
            ? "Online • Gemini"
            : "Offline • cached runtime"
        )
      : "Offline • browser cache only"
  );

  autoGrow();

  updateTokenEstimate();
}

init();
