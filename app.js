/* ============================================================
   KinStudy Pro
   app.js
   Main application engine
   ============================================================ */

import { CreateMLCEngine, prebuiltAppConfig } from
    "https://esm.run/@mlc-ai/web-llm";


/* ============================================================
   APPLICATION CONSTANTS
   ============================================================ */

const APP_NAME = "KinStudy Pro";

const STORAGE_KEYS = {
    chats: "kinstudy_chats_v1",
    activeChat: "kinstudy_active_chat_v1",
    theme: "kinstudy_theme_v1",
    geminiKey: "kinstudy_gemini_key_v1",
    customInstruction: "kinstudy_custom_instruction_v1",
    customInstructionEnabled: "kinstudy_custom_instruction_enabled_v1"
};


/*
 * These are the online Gemini models used by the interface.
 *
 * Current Gemini 3 model IDs are used here.
 */
const ONLINE_MODELS = {
    "gemini-3.8-flash": {
        name: "Gemini 3.8 Flash",
        description: "Fast general-purpose Gemini 3 model",
        thinkingLevel: "medium"
    },

    "gemini-3.7-flash": {
        name: "Gemini 3.7 Flash",
        description: "Advanced multi-step reasoning and coding",
        thinkingLevel: "medium"
    },

    "gemini-3.1-pro-preview": {
        name: "Gemini 3.1 Pro Preview",
        description: "Advanced reasoning and complex problems",
        thinkingLevel: "medium"
    }
};


/*
 * The UI uses these friendly names.
 *
 * WebLLM itself requires a model ID that exists in its
 * prebuilt model configuration.
 */
const OFFLINE_MODELS = {
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": {
        name: "Qwen 2.5 0.5B",
        type: "text",
        aliases: [
            "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
            "Qwen2.5-0.5B"
        ]
    },

    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": {
        name: "Qwen 2.5 1.5B",
        type: "text",
        aliases: [
            "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
            "Qwen2.5-1.5B"
        ]
    },

    "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC": {
        name: "Qwen 2.5 Coder 1.5B",
        type: "coder",
        aliases: [
            "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
            "Qwen2.5-Coder-1.5B"
        ]
    },

    "SmolVLM-2.2B-Instruct-q4f16_1-MLC": {
        name: "SmolVLM 2.2B",
        type: "vision",
        aliases: [
            "SmolVLM-2.2B-Instruct-q4f16_1-MLC",
            "SmolVLM-2.2B"
        ]
    }
};


/* ============================================================
   APPLICATION STATE
   ============================================================ */

const state = {

    mode: "online",

    selectedModel: "gemini-3.8-flash",

    chats: [],

    activeChatId: null,

    attachment: null,

    isProcessing: false,

    isLoadingEngine: false,

    offlineEngine: null,

    loadedOfflineModelId: null,

    resolvedOfflineModelId: null,

    studyData: null,

    settings: {
        geminiKey: "",
        customInstruction: "",
        useCustomInstruction: false
    },

    theme: "dark",

    abortController: null
};


/* ============================================================
   DOM REFERENCES
   ============================================================ */

const UI = {

    body: document.body,

    sidebar: document.getElementById("sidebar"),
    sidebarOpen: document.getElementById("sidebar-open"),
    sidebarClose: document.getElementById("sidebar-close"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),

    newChatButton: document.getElementById("new-chat-button"),
    chatHistory: document.getElementById("chat-history"),
    chatSearchInput: document.getElementById("chat-search-input"),

    themeButton: document.getElementById("theme-button"),
    settingsButton: document.getElementById("settings-button"),

    conversationTitle: document.getElementById("conversation-title"),
    connectionStatus: document.getElementById("connection-status"),

    modeSelect: document.getElementById("mode-select"),
    modelSelect: document.getElementById("model-select"),

    engineStatus: document.getElementById("engine-status"),
    engineStatusDot: document.getElementById("engine-status-dot"),
    engineStatusText: document.getElementById("engine-status-text"),

    offlineControls: document.getElementById("offline-controls"),
    offlineModelName: document.getElementById("offline-model-name"),
    offlineModelInfo: document.getElementById("offline-model-info"),

    loadEngineButton: document.getElementById("load-engine-button"),
    freeRamButton: document.getElementById("free-ram-button"),

    chatScroller: document.getElementById("chat-scroller"),
    messagesList: document.getElementById("messages-list"),
    welcomeScreen: document.getElementById("welcome-screen"),

    processingStatus: document.getElementById("processing-status"),
    processingStatusText: document.getElementById("processing-status-text"),

    attachmentArea: document.getElementById("attachment-area"),
    attachmentName: document.getElementById("attachment-name"),
    attachmentSize: document.getElementById("attachment-size"),
    removeAttachmentButton:
        document.getElementById("remove-attachment-button"),

    attachButton: document.getElementById("attach-button"),
    fileInput: document.getElementById("file-input"),

    messageInput: document.getElementById("message-input"),
    sendButton: document.getElementById("send-button"),

    tokenCounter: document.getElementById("token-counter"),

    settingsModal: document.getElementById("settings-modal"),
    settingsClose: document.getElementById("settings-close"),
    settingsCancel: document.getElementById("settings-cancel"),
    settingsSave: document.getElementById("settings-save"),

    geminiApiKey: document.getElementById("gemini-api-key"),
    toggleApiKey: document.getElementById("toggle-api-key"),

    customInstructionInput:
        document.getElementById("custom-instruction-input"),

    customInstructionToggle:
        document.getElementById("custom-instruction-toggle"),

    lightThemeButton:
        document.getElementById("light-theme-button"),

    darkThemeButton:
        document.getElementById("dark-theme-button"),

    exportChatsButton:
        document.getElementById("export-chats-button"),

    confirmModal: document.getElementById("confirm-modal"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmMessage: document.getElementById("confirm-message"),
    confirmCancel: document.getElementById("confirm-cancel"),
    confirmOk: document.getElementById("confirm-ok"),

    toast: document.getElementById("toast"),
    toastMessage: document.getElementById("toast-message")
};


/* ============================================================
   BASIC UTILITIES
   ============================================================ */

function createId(prefix = "id") {

    return `${prefix}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
}


function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function formatBytes(bytes) {

    if (!Number.isFinite(bytes)) {
        return "Unknown size";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}


function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));
}


function estimateTokens(text) {

    /*
     * This is intentionally labelled as an estimate.
     * It is NOT pretending to be the model's exact tokenizer.
     */
    if (!text) {
        return 0;
    }

    return Math.max(
        1,
        Math.ceil(String(text).trim().length / 4)
    );
}


function scrollToBottom() {

    requestAnimationFrame(() => {

        UI.chatScroller.scrollTop =
            UI.chatScroller.scrollHeight;

    });
}


function showToast(message) {

    UI.toastMessage.textContent = message;

    UI.toast.classList.remove("hidden");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {

        UI.toast.classList.add("hidden");

    }, 2600);
}


/* ============================================================
   THEME
   ============================================================ */

function applyTheme(theme) {

    state.theme = theme === "light"
        ? "light"
        : "dark";

    UI.body.setAttribute(
        "data-theme",
        state.theme
    );

    localStorage.setItem(
        STORAGE_KEYS.theme,
        state.theme
    );
}


function loadTheme() {

    const saved =
        localStorage.getItem(
            STORAGE_KEYS.theme
        );

    if (saved === "light" || saved === "dark") {

        applyTheme(saved);

        return;
    }

    const prefersLight =
        window.matchMedia &&
        window.matchMedia(
            "(prefers-color-scheme: light)"
        ).matches;

    applyTheme(
        prefersLight
            ? "light"
            : "dark"
    );
}


/* ============================================================
   DYNAMIC MANIFEST
   ============================================================ */

/*
 * We are keeping the project to five files.
 *
 * Instead of adding manifest.json as a sixth repository file,
 * create the manifest as a Blob at runtime.
 *
 * The actual Service Worker is still sw.js.
 */

function createDynamicManifest() {

    const manifest = {

        name: APP_NAME,

        short_name: "KinStudy",

        start_url: "./",

        scope: "./",

        display: "standalone",

        background_color:
            state.theme === "dark"
                ? "#0b0d10"
                : "#f7f8fa",

        theme_color:
            state.theme === "dark"
                ? "#111318"
                : "#ffffff",

        description:
            "Online and offline AI study and coding assistant.",

        icons: []
    };

    const blob = new Blob(
        [JSON.stringify(manifest)],
        {
            type: "application/manifest+json"
        }
    );

    const url =
        URL.createObjectURL(blob);

    const link =
        document.getElementById(
            "dynamic-manifest"
        );

    if (link) {
        link.href = url;
    }
}


/* ============================================================
   LOCAL STORAGE
   ============================================================ */

function loadSettings() {

    state.settings.geminiKey =
        localStorage.getItem(
            STORAGE_KEYS.geminiKey
        ) || "";

    state.settings.customInstruction =
        localStorage.getItem(
            STORAGE_KEYS.customInstruction
        ) || "";

    state.settings.useCustomInstruction =
        localStorage.getItem(
            STORAGE_KEYS.customInstructionEnabled
        ) === "true";
}


function saveSettings() {

    localStorage.setItem(
        STORAGE_KEYS.geminiKey,
        state.settings.geminiKey
    );

    localStorage.setItem(
        STORAGE_KEYS.customInstruction,
        state.settings.customInstruction
    );

    localStorage.setItem(
        STORAGE_KEYS.customInstructionEnabled,
        String(
            state.settings.useCustomInstruction
        )
    );
}


function loadChats() {

    try {

        const raw =
            localStorage.getItem(
                STORAGE_KEYS.chats
            );

        if (!raw) {

            state.chats = [];

            return;
        }

        const parsed =
            JSON.parse(raw);

        if (!Array.isArray(parsed)) {

            state.chats = [];

            return;
        }

        state.chats = parsed;

    } catch (error) {

        console.error(
            "Could not load chats:",
            error
        );

        state.chats = [];
    }
}


function saveChats() {

    try {

        localStorage.setItem(
            STORAGE_KEYS.chats,
            JSON.stringify(state.chats)
        );

    } catch (error) {

        console.error(
            "Could not save chats:",
            error
        );

        showToast(
            "Could not save chat history."
        );
    }
}


function saveActiveChatId() {

    if (state.activeChatId) {

        localStorage.setItem(
            STORAGE_KEYS.activeChat,
            state.activeChatId
        );

    } else {

        localStorage.removeItem(
            STORAGE_KEYS.activeChat
        );
    }
}


function getActiveChat() {

    return state.chats.find(
        chat =>
            chat.id === state.activeChatId
    ) || null;
}


/* ============================================================
   CHAT MANAGEMENT
   ============================================================ */

function createChat() {

    const chat = {

        id: createId("chat"),

        title: "New Chat",

        createdAt: Date.now(),

        updatedAt: Date.now(),

        messages: []
    };

    state.chats.unshift(chat);

    state.activeChatId = chat.id;

    saveChats();

    saveActiveChatId();

    renderSidebar();

    renderChat();

    UI.conversationTitle.textContent =
        chat.title;

    closeSidebar();

    UI.messageInput.focus();
}


function ensureActiveChat() {

    if (getActiveChat()) {
        return getActiveChat();
    }

    createChat();

    return getActiveChat();
}


function updateChatTitleFromMessage(
    chat,
    message
) {

    if (!chat || chat.title !== "New Chat") {
        return;
    }

    const cleaned =
        message
            .replace(/\s+/g, " ")
            .trim();

    if (!cleaned) {
        return;
    }

    chat.title =
        cleaned.length > 42
            ? `${cleaned.slice(0, 42)}…`
            : cleaned;
}


function deleteChat(chatId) {

    const index =
        state.chats.findIndex(
            chat => chat.id === chatId
        );

    if (index === -1) {
        return;
    }

    state.chats.splice(index, 1);

    if (state.activeChatId === chatId) {

        if (state.chats.length > 0) {

            state.activeChatId =
                state.chats[0].id;

        } else {

            state.activeChatId = null;

            createChat();

            return;
        }
    }

    saveChats();

    saveActiveChatId();

    renderSidebar();

    renderChat();
}


function askDeleteChat(chatId) {

    const chat =
        state.chats.find(
            item => item.id === chatId
        );

    if (!chat) {
        return;
    }

    UI.confirmTitle.textContent =
        "Delete chat?";

    UI.confirmMessage.textContent =
        `Delete "${chat.title}"? This cannot be undone.`;

    UI.confirmModal.classList.remove("hidden");

    UI.confirmOk.onclick = () => {

        UI.confirmModal.classList.add("hidden");

        deleteChat(chatId);
    };
}


function renderSidebar() {

    const search =
        UI.chatSearchInput.value
            .trim()
            .toLowerCase();

    UI.chatHistory.innerHTML = "";

    const filtered =
        state.chats.filter(chat => {

            if (!search) {
                return true;
            }

            return chat.title
                .toLowerCase()
                .includes(search);
        });


    if (filtered.length === 0) {

        const empty =
            document.createElement("div");

        empty.style.padding = "15px 10px";

        empty.style.color =
            "var(--text-muted)";

        empty.style.fontSize =
            "11px";

        empty.textContent =
            search
                ? "No chats found."
                : "No saved chats yet.";

        UI.chatHistory.appendChild(
            empty
        );

        return;
    }


    for (const chat of filtered) {

        const item =
            document.createElement("div");

        item.className =
            "chat-history-item";

        if (
            chat.id ===
            state.activeChatId
        ) {
            item.classList.add("active");
        }


        const content =
            document.createElement("div");

        content.className =
            "chat-history-item-content";

        content.innerHTML = `
            <div class="chat-history-item-title">
                ${escapeHtml(chat.title)}
            </div>

            <div class="chat-history-item-date">
                ${formatChatDate(chat.updatedAt)}
            </div>
        `;


        const deleteButton =
            document.createElement("button");

        deleteButton.type = "button";

        deleteButton.className =
            "chat-history-delete";

        deleteButton.setAttribute(
            "aria-label",
            "Delete chat"
        );

        deleteButton.textContent = "×";


        item.appendChild(content);

        item.appendChild(deleteButton);


        content.addEventListener(
            "click",
            () => {

                state.activeChatId =
                    chat.id;

                saveActiveChatId();

                renderSidebar();

                renderChat();

                closeSidebar();
            }
        );


        deleteButton.addEventListener(
            "click",
            event => {

                event.stopPropagation();

                askDeleteChat(chat.id);
            }
        );


        UI.chatHistory.appendChild(item);
    }
}


function formatChatDate(timestamp) {

    const date =
        new Date(timestamp);

    const now =
        new Date();

    const sameDay =
        date.toDateString() ===
        now.toDateString();

    if (sameDay) {

        return date.toLocaleTimeString(
            [],
            {
                hour: "numeric",
                minute: "2-digit"
            }
        );
    }

    return date.toLocaleDateString(
        [],
        {
            month: "short",
            day: "numeric"
        }
    );
}


/* ============================================================
   MESSAGE RENDERING
   ============================================================ */

function renderChat() {

    const chat =
        getActiveChat();

    UI.messagesList.innerHTML = "";

    if (!chat) {

        UI.conversationTitle.textContent =
            "New Chat";

        createWelcomeScreen();

        return;
    }


    UI.conversationTitle.textContent =
        chat.title;


    if (
        !chat.messages ||
        chat.messages.length === 0
    ) {

        createWelcomeScreen();

        return;
    }


    for (const message of chat.messages) {

        appendMessageElement(
            message.role,
            message.content,
            {
                attachmentName:
                    message.attachmentName || null,
                timestamp:
                    message.timestamp || null
            }
        );
    }

    scrollToBottom();
}


function createWelcomeScreen() {

    UI.messagesList.innerHTML = "";

    const welcome =
        document.createElement("div");

    welcome.className =
        "welcome-screen";

    welcome.innerHTML = `
        <div class="welcome-icon">📚</div>

        <h1>Welcome to KinStudy</h1>

        <p>
            Your online and offline AI study & coding buddy.
        </p>

        <div class="welcome-cards">

            <button
                class="welcome-card"
                data-prompt="Explain this topic to me step by step."
                type="button"
            >
                <span>🧠</span>
                <strong>Learn</strong>
                <small>Explain difficult topics</small>
            </button>

            <button
                class="welcome-card"
                data-prompt="Help me solve this math problem step by step."
                type="button"
            >
                <span>📐</span>
                <strong>Math</strong>
                <small>Solve with explanations</small>
            </button>

            <button
                class="welcome-card"
                data-prompt="Help me understand and improve this code."
                type="button"
            >
                <span>💻</span>
                <strong>Code</strong>
                <small>Debug and explain code</small>
            </button>

            <button
                class="welcome-card"
                data-prompt="Give me a short quiz on what I am studying."
                type="button"
            >
                <span>🎯</span>
                <strong>Quiz</strong>
                <small>Test your knowledge</small>
            </button>

        </div>
    `;


    UI.messagesList.appendChild(
        welcome
    );


    welcome
        .querySelectorAll(
            ".welcome-card"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    UI.messageInput.value =
                        button.dataset.prompt;

                    autoResizeTextarea();

                    UI.messageInput.focus();
                }
            );
        });
}


function appendMessageElement(
    role,
    content,
    options = {}
) {

    const row =
        document.createElement("div");

    row.className =
        `message-row ${role}`;


    const bubble =
        document.createElement("div");

    bubble.className =
        "msg-bubble";


    if (role === "assistant") {

        bubble.innerHTML =
            renderMarkdown(content);

    } else {

        bubble.innerHTML =
            renderUserContent(content);
    }


    row.appendChild(bubble);


    if (
        options.attachmentName
    ) {

        const attachment =
            document.createElement("div");

        attachment.className =
            "message-meta";

        attachment.textContent =
            `📎 ${options.attachmentName}`;

        bubble.prepend(attachment);
    }


    if (role === "assistant") {

        const actions =
            document.createElement("div");

        actions.className =
            "message-actions";


        const copyButton =
            document.createElement("button");

        copyButton.type = "button";

        copyButton.className =
            "message-action-button";

        copyButton.textContent =
            "📋 Copy";


        copyButton.addEventListener(
            "click",
            async () => {

                try {

                    await navigator.clipboard.writeText(
                        content
                    );

                    copyButton.textContent =
                        "✓ Copied";

                    setTimeout(() => {

                        copyButton.textContent =
                            "📋 Copy";

                    }, 1400);

                } catch {

                    showToast(
                        "Copy failed."
                    );
                }
            }
        );


        actions.appendChild(
            copyButton
        );

        bubble.appendChild(
            actions
        );


        attachCodeCopyButtons(
            bubble
        );
    }


    UI.messagesList.appendChild(row);

    return bubble;
}


function renderUserContent(text) {

    return escapeHtml(text)
        .replace(/\n/g, "<br>");
}


/* ============================================================
   SIMPLE MARKDOWN RENDERER
   ============================================================ */

function renderMarkdown(text) {

    if (!text) {
        return "";
    }


    /*
     * Protect fenced code blocks first.
     */
    const codeBlocks = [];

    let working =
        String(text).replace(
            /```([a-zA-Z0-9_+#.-]*)\n?([\s\S]*?)```/g,
            (match, language, code) => {

                const index =
                    codeBlocks.length;

                codeBlocks.push({
                    language:
                        language || "text",

                    code:
                        code.replace(
                            /\n$/,
                            ""
                        )
                });

                return `\n@@CODEBLOCK_${index}@@\n`;
            }
        );


    working =
        escapeHtml(working);


    /*
     * Inline code.
     */
    working =
        working.replace(
            /`([^`\n]+)`/g,
            "<code>$1</code>"
        );


    /*
     * Bold.
     */
    working =
        working.replace(
            /\*\*([^*]+)\*\*/g,
            "<strong>$1</strong>"
        );


    /*
     * Italic.
     */
    working =
        working.replace(
            /(^|[^\*])\*([^*\n]+)\*(?!\*)/g,
            "$1<em>$2</em>"
        );


    /*
     * Headings.
     */
    working =
        working.replace(
            /^### (.+)$/gm,
            "<strong>$1</strong>"
        );

    working =
        working.replace(
            /^## (.+)$/gm,
            "<strong>$1</strong>"
        );

    working =
        working.replace(
            /^# (.+)$/gm,
            "<strong>$1</strong>"
        );


    /*
     * Unordered lists.
     */
    working =
        working.replace(
            /^(?:-|\*) (.+)$/gm,
            "• $1"
        );


    /*
     * Links.
     */
    working =
        working.replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );


    /*
     * Split paragraphs.
     */
    let html =
        working
            .split(/\n{2,}/)
            .map(block => {

                const trimmed =
                    block.trim();

                if (!trimmed) {
                    return "";
                }

                if (
                    trimmed.startsWith(
                        "@@CODEBLOCK_"
                    )
                ) {
                    return trimmed;
                }

                return `<p>${trimmed.replace(
                    /\n/g,
                    "<br>"
                )}</p>`;
            })
            .join("");


    /*
     * Restore code blocks.
     */
    for (
        let i = 0;
        i < codeBlocks.length;
        i++
    ) {

        const block =
            codeBlocks[i];

        const code =
            escapeHtml(
                block.code
            );

        const replacement = `
            <div class="code-block-wrapper">

                <div class="code-block-header">

                    <span class="code-language">
                        ${escapeHtml(block.language)}
                    </span>

                    <button
                        class="copy-code-button"
                        type="button"
                        data-code-index="${i}"
                    >
                        Copy Code
                    </button>

                </div>

                <pre class="code-block"><code>${code}</code></pre>

            </div>
        `;

        html =
            html.replace(
                `@@CODEBLOCK_${i}@@`,
                replacement
            );
    }


    return html;
}


function attachCodeCopyButtons(container) {

    container
        .querySelectorAll(
            ".copy-code-button"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    const pre =
                        button
                            .closest(
                                ".code-block-wrapper"
                            )
                            ?.querySelector(
                                "code"
                            );

                    if (!pre) {
                        return;
                    }

                    try {

                        await navigator.clipboard.writeText(
                            pre.textContent
                        );

                        button.textContent =
                            "✓ Copied";

                        setTimeout(() => {

                            button.textContent =
                                "Copy Code";

                        }, 1400);

                    } catch {

                        showToast(
                            "Could not copy code."
                        );
                    }
                }
            );
        });
}


/* ============================================================
   UI MESSAGE HELPERS
   ============================================================ */

function setEngineStatus(
    status,
    text
) {

    UI.engineStatusText.textContent =
        text;

    UI.engineStatusDot.className =
        "status-dot";

    if (status === "loading") {

        UI.engineStatusDot.classList.add(
            "loading"
        );

    } else if (status === "error") {

        UI.engineStatusDot.classList.add(
            "error"
        );
    }
}


function setConnectionStatus(text) {

    UI.connectionStatus.textContent =
        text;
}


function setProcessing(
    processing,
    statusText = "Processing..."
) {

    state.isProcessing =
        processing;

    UI.processingStatusText.textContent =
        statusText;

    UI.processingStatus.classList.toggle(
        "hidden",
        !processing
    );

    UI.sendButton.disabled =
        processing;

    UI.messageInput.disabled =
        processing;

    UI.attachButton.disabled =
        processing;

    scrollToBottom();
}


/* ============================================================
   MODE / MODEL UI
   ============================================================ */

function updateModeUI() {

    const offline =
        state.mode === "offline";


    UI.offlineControls.classList.toggle(
        "hidden",
        !offline
    );


    if (offline) {

        const info =
            OFFLINE_MODELS[
                state.selectedModel
            ];

        if (info) {

            UI.offlineModelName.textContent =
                info.name;

            UI.offlineModelInfo.textContent =
                state.loadedOfflineModelId
                    ? "Engine loaded"
                    : "WebGPU engine not loaded";
        }

        UI.attachButton.disabled =
            false;

    } else {

        UI.attachButton.disabled =
            state.isProcessing;

        setConnectionStatus(
            "Online mode"
        );
    }
}


function updateModelFromSelect() {

    const selected =
        UI.modelSelect.value;


    if (
        ONLINE_MODELS[selected]
    ) {

        state.mode = "online";

        state.selectedModel =
            selected;

        updateModeUI();

        /*
         * If an offline engine is currently loaded,
         * release it before switching to online mode.
         */
        if (state.offlineEngine) {

            freeOfflineEngine();
        }

        setEngineStatus(
            "ready",
            "Online ready"
        );

        setConnectionStatus(
            ONLINE_MODELS[selected].name
        );

        return;
    }


    if (
        OFFLINE_MODELS[selected]
    ) {

        state.mode = "offline";

        state.selectedModel =
            selected;

        updateModeUI();

        setEngineStatus(
            "ready",
            "WebGPU engine ready"
        );

        setConnectionStatus(
            "Offline mode"
        );

        checkWebGPU();
    }
}


/* ============================================================
   WEBGPU DETECTION
   ============================================================ */

async function checkWebGPU() {

    if (state.mode !== "offline") {
        return false;
    }


    if (!("gpu" in navigator)) {

        setEngineStatus(
            "error",
            "WebGPU unavailable"
        );

        UI.offlineModelInfo.textContent =
            "This browser does not expose WebGPU.";

        return false;
    }


    try {

        const adapter =
            await navigator.gpu.requestAdapter();


        if (!adapter) {

            setEngineStatus(
                "error",
                "No WebGPU adapter"
            );

            UI.offlineModelInfo.textContent =
                "No compatible GPU adapter was found.";

            return false;
        }


        setEngineStatus(
            "ready",
            "WebGPU available"
        );

        UI.offlineModelInfo.textContent =
            state.loadedOfflineModelId
                ? "Engine loaded"
                : "WebGPU available — load when needed";

        return true;

    } catch (error) {

        console.error(
            "WebGPU test failed:",
            error
        );

        setEngineStatus(
            "error",
            "WebGPU test failed"
        );

        UI.offlineModelInfo.textContent =
            error.message;

        return false;
    }
}


/* ============================================================
   WEBLLM MODEL RESOLUTION
   ============================================================ */

function getPrebuiltModelList() {

    if (
        !prebuiltAppConfig ||
        !Array.isArray(
            prebuiltAppConfig.model_list
        )
    ) {

        return [];
    }

    return prebuiltAppConfig.model_list;
}


function resolveOfflineModelId(
    requestedId
) {

    const config =
        OFFLINE_MODELS[
            requestedId
        ];

    const models =
        getPrebuiltModelList();


    /*
     * Exact match.
     */
    const exact =
        models.find(
            model =>
                model.model_id ===
                requestedId
        );

    if (exact) {
        return exact.model_id;
    }


    /*
     * Alias / case-insensitive match.
     */
    if (config) {

        for (
            const alias of config.aliases
        ) {

            const found =
                models.find(
                    model =>
                        model.model_id
                            .toLowerCase() ===
                        alias.toLowerCase()
                );

            if (found) {
                return found.model_id;
            }
        }
    }


    /*
     * More flexible matching.
     */
    const lower =
        requestedId.toLowerCase();

    const flexible =
        models.find(model => {

            const id =
                String(
                    model.model_id
                ).toLowerCase();

            if (
                id === lower
            ) {
                return true;
            }

            if (
                lower.includes("coder") &&
                id.includes("coder") &&
                id.includes("1.5b")
            ) {
                return true;
            }

            if (
                lower.includes("0.5b") &&
                id.includes("qwen") &&
                id.includes("0.5b")
            ) {
                return true;
            }

            if (
                lower.includes("1.5b") &&
                !lower.includes("coder") &&
                id.includes("qwen") &&
                id.includes("1.5b") &&
                !id.includes("coder")
            ) {
                return true;
            }

            if (
                lower.includes("smolvlm") &&
                id.includes("smolvlm")
            ) {
                return true;
            }

            return false;
        });


    return flexible
        ? flexible.model_id
        : null;
}


/* ============================================================
   LOAD OFFLINE ENGINE
   ============================================================ */

async function loadOfflineEngine() {

    if (state.mode !== "offline") {

        showToast(
            "Switch to Offline mode first."
        );

        return;
    }


    if (state.isLoadingEngine) {
        return;
    }


    if (state.offlineEngine) {

        showToast(
            "Offline engine is already loaded."
        );

        return;
    }


    state.isLoadingEngine =
        true;

    UI.loadEngineButton.disabled =
        true;

    UI.freeRamButton.disabled =
        true;

    setEngineStatus(
        "loading",
        "Checking WebGPU..."
    );


    try {

        const webgpuOK =
            await checkWebGPU();

        if (!webgpuOK) {

            throw new Error(
                "WebGPU is not available in this browser/device."
            );
        }


        const requested =
            state.selectedModel;

        const modelId =
            resolveOfflineModelId(
                requested
            );


        if (!modelId) {

            const available =
                getPrebuiltModelList()
                    .map(
                        model =>
                            model.model_id
                    )
                    .filter(Boolean)
                    .slice(0, 20);

            throw new Error(
                `The selected model is not currently present in WebLLM's prebuilt model list. ` +
                `Available examples: ${available.join(", ")}`
            );
        }


        state.resolvedOfflineModelId =
            modelId;


        setEngineStatus(
            "loading",
            "Loading offline model..."
        );

        UI.offlineModelInfo.textContent =
            "Downloading/loading model. First run can take a while.";


        const engine =
            await CreateMLCEngine(
                modelId,
                {
                    initProgressCallback:
                        progress => {

                            const text =
                                progress?.text ||
                                "Loading model...";

                            setEngineStatus(
                                "loading",
                                "Loading"
                            );

                            UI.offlineModelInfo.textContent =
                                text;
                        },

                    logLevel: "ERROR"
                }
            );


        state.offlineEngine =
            engine;

        state.loadedOfflineModelId =
            modelId;


        UI.offlineModelInfo.textContent =
            `Loaded: ${modelId}`;

        setEngineStatus(
            "ready",
            "Offline engine loaded"
        );

        setConnectionStatus(
            "Offline engine ready"
        );

        showToast(
            "Offline model loaded."
        );

    } catch (error) {

        console.error(
            "Offline model load error:",
            error
        );

        state.offlineEngine =
            null;

        state.loadedOfflineModelId =
            null;

        setEngineStatus(
            "error",
            "Offline model failed"
        );

        UI.offlineModelInfo.textContent =
            error.message ||
            "Could not load offline model.";

        showToast(
            "Offline model could not be loaded."
        );

    } finally {

        state.isLoadingEngine =
            false;

        UI.loadEngineButton.disabled =
            false;

        UI.freeRamButton.disabled =
            !state.offlineEngine;
    }
}


/* ============================================================
   FREE OFFLINE ENGINE / RAM
   ============================================================ */

async function freeOfflineEngine() {

    if (!state.offlineEngine) {

        return;
    }


    try {

        setEngineStatus(
            "loading",
            "Freeing RAM..."
        );


        if (
            typeof state.offlineEngine.unload ===
            "function"
        ) {

            await state.offlineEngine.unload();
        }


    } catch (error) {

        console.warn(
            "Engine unload warning:",
            error
        );

    } finally {

        state.offlineEngine =
            null;

        state.loadedOfflineModelId =
            null;

        state.resolvedOfflineModelId =
            null;

        UI.freeRamButton.disabled =
            true;

        UI.offlineModelInfo.textContent =
            "WebGPU engine not loaded";

        setEngineStatus(
            "ready",
            "Engine unloaded"
        );

        showToast(
            "Offline engine unloaded."
        );
    }
}


/* ============================================================
   STUDY DATA
   ============================================================ */

async function loadStudyData() {

    try {

        const response =
            await fetch(
                "./study-data.json",
                {
                    cache: "no-cache"
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        state.studyData =
            await response.json();


        console.log(
            "Study data loaded."
        );


    } catch (error) {

        console.warn(
            "study-data.json could not be loaded:",
            error
        );

        state.studyData =
            null;
    }
}


function searchStudyData(query) {

    if (!state.studyData) {
        return null;
    }


    const normalized =
        query
            .toLowerCase()
            .trim();


    if (!normalized) {
        return null;
    }


    /*
     * Supports either:
     *
     * {
     *   "entries": [...]
     * }
     *
     * or a direct array.
     */

    let entries =
        Array.isArray(state.studyData)
            ? state.studyData
            : state.studyData.entries;


    if (!Array.isArray(entries)) {
        return null;
    }


    let best = null;

    let bestScore = 0;


    for (const entry of entries) {

        if (!entry) {
            continue;
        }


        const searchable = [

            entry.title,

            entry.name,

            entry.topic,

            entry.category,

            entry.key,

            entry.keywords,

            entry.question,

            entry.content,

            entry.answer

        ]
            .flatMap(value => {

                if (Array.isArray(value)) {
                    return value;
                }

                return [value];
            })
            .filter(Boolean)
            .join(" ")
            .toLowerCase();


        if (!searchable) {
            continue;
        }


        const words =
            normalized
                .split(/\s+/)
                .filter(word => word.length > 2);


        let score = 0;


        for (const word of words) {

            if (
                searchable.includes(word)
            ) {

                score++;
            }
        }


        /*
         * Exact title/topic match gets
         * additional weight.
         */

        const title =
            String(
                entry.title ||
                entry.topic ||
                entry.name ||
                ""
            ).toLowerCase();


        if (
            title &&
            normalized.includes(title)
        ) {
            score += 5;
        }


        if (score > bestScore) {

            bestScore = score;

            best = entry;
        }
    }


    /*
     * Avoid hijacking normal AI questions.
     * A result needs a reasonable match.
     */

    if (
        !best ||
        bestScore < 2
    ) {

        return null;
    }


    return best;
}


function formatStudyEntry(entry) {

    if (!entry) {
        return "";
    }


    if (typeof entry === "string") {
        return entry;
    }


    if (entry.answer) {
        return String(entry.answer);
    }


    if (entry.content) {
        return String(entry.content);
    }


    if (entry.explanation) {
        return String(entry.explanation);
    }


    return JSON.stringify(
        entry,
        null,
        2
    );
}


/* ============================================================
   FILE HANDLING
   ============================================================ */

function handleFileSelected(file) {

    if (!file) {
        return;
    }


    const allowedExtensions = [
        "png",
        "jpg",
        "jpeg",
        "webp",
        "pdf",
        "txt",
        "md",
        "py",
        "js",
        "html",
        "css",
        "json",
        "csv"
    ];


    const extension =
        file.name
            .split(".")
            .pop()
            ?.toLowerCase();


    if (
        !extension ||
        !allowedExtensions.includes(
            extension
        )
    ) {

        showToast(
            "This file type is not supported."
        );

        UI.fileInput.value = "";

        return;
    }


    state.attachment = {
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        extension
    };


    UI.attachmentName.textContent =
        file.name;

    UI.attachmentSize.textContent =
        formatBytes(file.size);

    UI.attachmentArea.classList.remove(
        "hidden"
    );
}


function removeAttachment() {

    state.attachment =
        null;

    UI.fileInput.value = "";

    UI.attachmentArea.classList.add(
        "hidden"
    );
}


/* ============================================================
   TEXT FILE READER
   ============================================================ */

async function readTextFile(file) {

    return await file.text();
}


/* ============================================================
   PDF TEXT EXTRACTION
   ============================================================ */

async function extractPdfText(
    file
) {

    setProcessing(
        true,
        "Opening PDF..."
    );


    /*
     * PDF.js is loaded only when a PDF is actually selected.
     * This avoids loading a large extra library for normal chats.
     */

    const pdfjs =
        await import(
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
        );


    const arrayBuffer =
        await file.arrayBuffer();


    const loadingTask =
        pdfjs.getDocument({
            data: arrayBuffer
        });


    const pdf =
        await loadingTask.promise;


    let fullText = "";


    for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
    ) {

        setProcessing(
            true,
            `Reading PDF: Page ${pageNumber}/${pdf.numPages}...`
        );


        const page =
            await pdf.getPage(
                pageNumber
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


        fullText +=
            `\n\n--- Page ${pageNumber} ---\n\n` +
            pageText;


        /*
         * Give the browser UI a chance to repaint
         * the live progress status.
         */
        await sleep(0);
    }


    setProcessing(
        true,
        "PDF text extraction complete."
    );


    return fullText.trim();
}


/* ============================================================
   IMAGE READER
   ============================================================ */

async function readImageAsDataUrl(
    file,
    maxDimension = 1536
) {

    const bitmap =
        await createImageBitmap(file);


    const scale =
        Math.min(
            1,
            maxDimension /
                Math.max(
                    bitmap.width,
                    bitmap.height
                )
        );


    const width =
        Math.max(
            1,
            Math.round(
                bitmap.width * scale
            )
        );


    const height =
        Math.max(
            1,
            Math.round(
                bitmap.height * scale
            )
        );


    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        width;

    canvas.height =
        height;


    const ctx =
        canvas.getContext(
            "2d"
        );


    ctx.drawImage(
        bitmap,
        0,
        0,
        width,
        height
    );


    bitmap.close();


    return canvas.toDataURL(
        "image/jpeg",
        0.86
    );
}


/* ============================================================
   GENERIC ATTACHMENT PROCESSOR
   ============================================================ */

async function processAttachment(
    attachment
) {

    if (!attachment) {
        return null;
    }


    const file =
        attachment.file;


    const extension =
        attachment.extension;


    if (
        [
            "txt",
            "md",
            "py",
            "js",
            "html",
            "css",
            "json",
            "csv"
        ].includes(extension)
    ) {

        setProcessing(
            true,
            `Reading ${file.name}...`
        );


        const text =
            await readTextFile(file);


        setProcessing(
            true,
            "Extracting text..."
        );


        return {
            kind: "text",
            name: file.name,
            text
        };
    }


    if (extension === "pdf") {

        const text =
            await extractPdfText(
                file
            );


        return {
            kind: "text",
            name: file.name,
            text
        };
    }


    if (
        [
            "png",
            "jpg",
            "jpeg",
            "webp"
        ].includes(extension)
    ) {

        setProcessing(
            true,
            `Preparing image: ${file.name}...`
        );


        const dataUrl =
            await readImageAsDataUrl(
                file
            );


        return {
            kind: "image",
            name: file.name,
            dataUrl
        };
    }


    return null;
}


/* ============================================================
   ONLINE GEMINI API
   ============================================================ */

function buildSystemInstruction() {

    const base = `
You are KinStudy Pro, an AI study and coding assistant.

Give accurate, clear, useful answers.

When teaching:
- explain concepts step by step
- use examples
- avoid unnecessary complexity
- show formulas clearly
- distinguish facts from assumptions

When helping with code:
- explain the cause of problems
- provide corrected code when useful
- preserve the user's requested language/framework

Do not pretend to have accessed files, tools, or information that you did not actually receive.
`.trim();


    if (
        state.settings.useCustomInstruction &&
        state.settings.customInstruction.trim()
    ) {

        return (
            base +
            "\n\nAdditional user instructions:\n" +
            state.settings.customInstruction.trim()
        );
    }


    return base;
}


function convertHistoryForGemini(
    messages
) {

    return messages.map(
        message => {

            const role =
                message.role === "assistant"
                    ? "model"
                    : "user";


            return {
                role,

                parts: [
                    {
                        text:
                            String(
                                message.content ||
                                ""
                            )
                    }
                ]
            };
        }
    );
}


async function generateGeminiResponse(
    userText,
    attachmentData,
    onChunk
) {

    const apiKey =
        state.settings.geminiKey.trim();


    if (!apiKey) {

        throw new Error(
            "Gemini API key is missing. Open Settings and add your API key."
        );
    }


    const chat =
        ensureActiveChat();


    const previousMessages =
        chat.messages || [];


    const contents =
        convertHistoryForGemini(
            previousMessages
        );


    /*
     * Build the current user message.
     */

    const currentParts = [];


    if (userText.trim()) {

        currentParts.push({
            text: userText.trim()
        });
    }


    if (
        attachmentData?.kind ===
        "text"
    ) {

        currentParts.push({
            text:
                `\n\n[Attached file: ${attachmentData.name}]\n` +
                attachmentData.text
        });
    }


    if (
        attachmentData?.kind ===
        "image"
    ) {

        const comma =
            attachmentData.dataUrl.indexOf(
                ","
            );


        const mimeType =
            attachmentData.dataUrl
                .slice(
                    5,
                    comma
                )
                .replace(
                    ";base64",
                    ""
                );


        const base64 =
            attachmentData.dataUrl
                .slice(
                    comma + 1
                );


        currentParts.push({
            inlineData: {
                mimeType,
                data: base64
            }
        });
    }


    contents.push({
        role: "user",
        parts: currentParts
    });


    const model =
        state.selectedModel;


    const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:streamGenerateContent` +
        `?alt=sse&key=${encodeURIComponent(apiKey)}`;


    const generationConfig = {

        thinkingConfig: {
            thinkingLevel:
                ONLINE_MODELS[
                    model
                ]?.thinkingLevel ||
                "medium"
        }
    };


    const requestBody = {

        systemInstruction: {
            parts: [
                {
                    text:
                        buildSystemInstruction()
                }
            ]
        },

        contents,

        generationConfig
    };


    state.abortController =
        new AbortController();


    const response =
        await fetch(
            endpoint,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        requestBody
                    ),

                signal:
                    state.abortController
                        .signal
            }
        );


    if (!response.ok) {

        let errorText =
            `HTTP ${response.status}`;

        try {

            const errorJson =
                await response.json();

            errorText =
                errorJson?.error?.message ||
                errorText;

        } catch {
            /* ignore */
        }


        throw new Error(
            `Gemini API error: ${errorText}`
        );
    }


    if (!response.body) {

        throw new Error(
            "Gemini returned no streaming body."
        );
    }


    const reader =
        response.body.getReader();


    const decoder =
        new TextDecoder();


    let buffer = "";

    let fullText = "";


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
            const rawLine of lines
        ) {

            const line =
                rawLine.trim();


            if (
                !line ||
                line === "data: [DONE]"
            ) {
                continue;
            }


            if (
                !line.startsWith(
                    "data:"
                )
            ) {
                continue;
            }


            const payload =
                line
                    .slice(5)
                    .trim();


            if (!payload) {
                continue;
            }


            let chunk;

            try {

                chunk =
                    JSON.parse(
                        payload
                    );

            } catch {

                /*
                 * An individual network chunk can
                 * split JSON. The SSE line parser
                 * above prevents most cases.
                 */
                continue;
            }


            const candidates =
                chunk.candidates ||
                [];


            for (
                const candidate of candidates
            ) {

                const parts =
                    candidate?.content
                        ?.parts || [];


                for (
                    const part of parts
                ) {

                    /*
                     * Thinking/reasoning parts can
                     * exist in Gemini responses.
                     *
                     * Only send ordinary text to
                     * the visible answer.
                     */

                    if (
                        typeof part.text ===
                        "string"
                    ) {

                        const piece =
                            part.text;

                        fullText +=
                            piece;

                        onChunk(
                            piece,
                            fullText
                        );
                    }
                }
            }
        }
    }


    /*
     * Process anything remaining in the buffer.
     */

    const finalLine =
        buffer.trim();


    if (
        finalLine.startsWith(
            "data:"
        )
    ) {

        try {

            const payload =
                finalLine
                    .slice(5)
                    .trim();

            const chunk =
                JSON.parse(
                    payload
                );

            const parts =
                chunk
                    ?.candidates?.[0]
                    ?.content?.parts ||
                [];


            for (
                const part of parts
            ) {

                if (
                    typeof part.text ===
                    "string"
                ) {

                    const piece =
                        part.text;

                    fullText +=
                        piece;

                    onChunk(
                        piece,
                        fullText
                    );
                }
            }

        } catch {
            /* ignore incomplete final data */
        }
    }


    return fullText.trim();
}


/* ============================================================
   OFFLINE WEBLLM CHAT
   ============================================================ */

function buildOfflineSystemMessage() {

    let instruction = `
You are KinStudy Pro running locally on the user's device.

You are an offline study and coding assistant.

Be clear and concise.

Explain difficult subjects step by step.

For mathematics, show the reasoning and formulas.

For coding, explain errors and provide practical corrected code.

You may use the provided offline study knowledge context when relevant.
`.trim();


    if (
        state.settings.useCustomInstruction &&
        state.settings.customInstruction.trim()
    ) {

        instruction +=
            "\n\nAdditional instructions:\n" +
            state.settings.customInstruction.trim();
    }


    return instruction;
}


function buildOfflineMessages(
    chat,
    currentText,
    attachmentData
) {

    const messages = [];


    messages.push({
        role: "system",
        content:
            buildOfflineSystemMessage()
    });


    for (
        const message of
        chat.messages || []
    ) {

        messages.push({
            role:
                message.role,
            content:
                message.content
        });
    }


    let currentContent =
        currentText.trim();


    if (
        attachmentData?.kind ===
        "text"
    ) {

        currentContent +=
            `\n\n[Attached file: ${attachmentData.name}]\n` +
            attachmentData.text;
    }


    if (
        attachmentData?.kind ===
        "image"
    ) {

        /*
         * Image messages are converted below
         * because WebLLM vision models can accept
         * OpenAI-style content arrays.
         */
        messages.push({
            role: "user",

            content: [
                {
                    type: "text",
                    text:
                        currentContent ||
                        "Analyze this image."
                },

                {
                    type: "image_url",

                    image_url: {
                        url:
                            attachmentData.dataUrl
                    }
                }
            ]
        });

        return messages;
    }


    messages.push({
        role: "user",
        content:
            currentContent
    });


    return messages;
}


async function generateOfflineResponse(
    userText,
    attachmentData,
    onChunk
) {

    if (!state.offlineEngine) {

        throw new Error(
            "No offline engine is loaded. Tap Load Engine first."
        );
    }


    const chat =
        ensureActiveChat();


    let studyContext = "";


    const studyMatch =
        searchStudyData(
            userText
        );


    if (studyMatch) {

        studyContext =
            "\n\nRelevant verified offline study context:\n" +
            formatStudyEntry(
                studyMatch
            );
    }


    const messages =
        buildOfflineMessages(
            chat,
            userText +
                studyContext,
            attachmentData
        );


    let fullText = "";


    const stream =
        await state.offlineEngine.chat.completions.create({

            messages,

            stream: true,

            temperature: 0.6,

            max_tokens: 1024
        });


    for await (
        const chunk of stream
    ) {

        const piece =
            chunk?.choices?.[0]
                ?.delta?.content ||
            "";


        if (!piece) {
            continue;
        }


        fullText +=
            piece;


        onChunk(
            piece,
            fullText
        );
    }


    return fullText.trim();
}


/* ============================================================
   MAIN RESPONSE ROUTER
   ============================================================ */

async function generateResponse(
    userText,
    attachmentData,
    assistantBubble
) {

    /*
     * This function deliberately receives the attachment
     * as an argument.
     *
     * This prevents the attachment-cleared-before-generation
     * bug that existed in the previous implementation.
     */

    if (
        state.mode === "offline"
    ) {

        return await generateOfflineResponse(
            userText,
            attachmentData,
            (piece, fullText) => {

                assistantBubble.innerHTML =
                    renderMarkdown(
                        fullText
                    );

                scrollToBottom();

                updateTokenCounter(
                    fullText
                );
            }
        );
    }


    return await generateGeminiResponse(
        userText,
        attachmentData,
        (piece, fullText) => {

            assistantBubble.innerHTML =
                renderMarkdown(
                    fullText
                );

            scrollToBottom();

            updateTokenCounter(
                fullText
            );
        }
    );
}


/* ============================================================
   TOKEN COUNTER
   ============================================================ */

function updateTokenCounter(text) {

    UI.tokenCounter.textContent =
        estimateTokens(text)
            .toLocaleString();
}


/* ============================================================
   SEND MESSAGE
   ============================================================ */

async function sendMessage() {

    if (state.isProcessing) {
        return;
    }


    const text =
        UI.messageInput.value.trim();


    const attachment =
        state.attachment;


    if (
        !text &&
        !attachment
    ) {

        return;
    }


    /*
     * Copy the attachment reference before
     * clearing the UI.
     *
     * This is important.
     */
    const attachmentForGeneration =
        attachment;


    const chat =
        ensureActiveChat();


    /*
     * Build user display text.
     */

    const displayText =
        text ||
        `Analyze ${attachment.name}.`;


    /*
     * Save the user message first.
     */

    chat.messages.push({

        role: "user",

        content:
            displayText,

        attachmentName:
            attachment?.name ||
            null,

        timestamp:
            Date.now()
    });


    updateChatTitleFromMessage(
        chat,
        displayText
    );


    chat.updatedAt =
        Date.now();


    saveChats();


    /*
     * Render the new user message.
     */

    if (
        UI.welcomeScreen
    ) {
        UI.welcomeScreen.remove();
    }


    appendMessageElement(
        "user",
        displayText,
        {
            attachmentName:
                attachment?.name ||
                null
        }
    );


    /*
     * NOW clear the attachment UI.
     *
     * The actual attachment object is still safely
     * held in attachmentForGeneration.
     */

    removeAttachment();


    UI.messageInput.value = "";

    autoResizeTextarea();

    updateChatTitleFromMessage(
        chat,
        displayText
    );

    UI.conversationTitle.textContent =
        chat.title;

    renderSidebar();

    scrollToBottom();


    /*
     * Create assistant bubble.
     */

    const assistantBubble =
        appendMessageElement(
            "assistant",
            ""
        );


    assistantBubble.innerHTML = `
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;


    setProcessing(
        true,
        state.mode === "offline"
            ? "Preparing offline model..."
            : "Connecting to Gemini..."
    );


    setEngineStatus(
        "loading",
        state.mode === "offline"
            ? "Generating offline"
            : "Generating"
    );


    try {

        /*
         * Process file before generation.
         */

        let attachmentData =
            null;


        if (
            attachmentForGeneration
        ) {

            attachmentData =
                await processAttachment(
                    attachmentForGeneration
                );


            if (!attachmentData) {

                throw new Error(
                    "Could not process the attached file."
                );
            }
        }


        setProcessing(
            true,
            state.mode === "offline"
                ? "Sending context to model..."
                : "Sending context to Gemini..."
        );


        assistantBubble.innerHTML = "";


        const response =
            await generateResponse(
                text,
                attachmentData,
                assistantBubble
            );


        if (!response) {

            throw new Error(
                "The model returned an empty response."
            );
        }


        /*
         * Save assistant response.
         */

        chat.messages.push({

            role: "assistant",

            content:
                response,

            timestamp:
                Date.now()
        });


        chat.updatedAt =
            Date.now();


        saveChats();


        assistantBubble.innerHTML =
            renderMarkdown(
                response
            );


        attachCodeCopyButtons(
            assistantBubble
        );


        setEngineStatus(
            "ready",
            state.mode === "offline"
                ? "Offline ready"
                : "Online ready"
        );


        setConnectionStatus(
            state.mode === "offline"
                ? "Offline mode"
                : ONLINE_MODELS[
                    state.selectedModel
                ]?.name ||
                "Online mode"
        );


        updateTokenCounter(
            response
        );


        scrollToBottom();


    } catch (error) {

        console.error(
            "Generation error:",
            error
        );


        if (
            error?.name ===
            "AbortError"
        ) {

            assistantBubble.innerHTML =
                "<p>Generation stopped.</p>";

        } else {

            assistantBubble.innerHTML =
                `<p><strong>Error:</strong> ${escapeHtml(
                    error.message ||
                    "Something went wrong."
                )}</p>`;

            showToast(
                error.message ||
                "AI generation failed."
            );
        }


        setEngineStatus(
            "error",
            "Generation error"
        );


    } finally {

        /*
         * We do NOT keep temporary attachment data
         * in state after generation.
         */

        state.attachment =
            null;


        setProcessing(
            false,
            ""
        );


        state.abortController =
            null;


        UI.messageInput.disabled =
            false;

        UI.sendButton.disabled =
            false;

        UI.attachButton.disabled =
            false;


        saveChats();

        renderSidebar();

        scrollToBottom();
    }
}


/* ============================================================
   STOP GENERATION
   ============================================================ */

function stopGeneration() {

    if (
        state.abortController
    ) {

        state.abortController.abort();

        state.abortController =
            null;
    }
}


/* ============================================================
   TEXTAREA AUTO RESIZE
   ============================================================ */

function autoResizeTextarea() {

    const textarea =
        UI.messageInput;


    textarea.style.height =
        "auto";


    const height =
        Math.min(
            textarea.scrollHeight,
            180
        );


    textarea.style.height =
        `${height}px`;
}


/* ============================================================
   SETTINGS UI
   ============================================================ */

function openSettings() {

    UI.geminiApiKey.value =
        state.settings.geminiKey;

    UI.customInstructionInput.value =
        state.settings.customInstruction;

    UI.customInstructionToggle.checked =
        state.settings.useCustomInstruction;

    UI.settingsModal.classList.remove(
        "hidden"
    );
}


function closeSettings() {

    UI.settingsModal.classList.add(
        "hidden"
    );
}


function saveSettingsFromUI() {

    state.settings.geminiKey =
        UI.geminiApiKey.value.trim();

    state.settings.customInstruction =
        UI.customInstructionInput.value.trim();

    state.settings.useCustomInstruction =
        UI.customInstructionToggle.checked;


    saveSettings();

    closeSettings();

    showToast(
        "Settings saved."
    );
}


/* ============================================================
   EXPORT CHAT HISTORY
   ============================================================ */

function exportChats() {

    if (
        !state.chats.length
    ) {

        showToast(
            "There are no chats to export."
        );

        return;
    }


    const lines = [];


    lines.push(
        `${APP_NAME} — Chat Export`
    );

    lines.push(
        `Exported: ${new Date().toLocaleString()}`
    );

    lines.push(
        ""
    );


    for (
        const chat of
        [...state.chats].reverse()
    ) {

        lines.push(
            `===== ${chat.title} =====`
        );

        lines.push(
            `Created: ${new Date(
                chat.createdAt
            ).toLocaleString()}`
        );

        lines.push(
            ""
        );


        for (
            const message of
            chat.messages || []
        ) {

            const role =
                message.role === "user"
                    ? "YOU"
                    : "KINSTUDY";


            lines.push(
                `[${role}]`
            );

            lines.push(
                message.content || ""
            );


            if (
                message.attachmentName
            ) {

                lines.push(
                    `[Attachment: ${message.attachmentName}]`
                );
            }


            lines.push(
                ""
            );
        }


        lines.push(
            ""
        );
    }


    const blob =
        new Blob(
            [
                lines.join("\n")
            ],
            {
                type:
                    "text/plain;charset=utf-8"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const anchor =
        document.createElement(
            "a"
        );


    anchor.href =
        url;

    anchor.download =
        `kinstudy-chats-${Date.now()}.txt`;


    document.body.appendChild(
        anchor
    );

    anchor.click();

    anchor.remove();


    URL.revokeObjectURL(
        url
    );


    showToast(
        "Chats exported."
    );
}


/* ============================================================
   SIDEBAR
   ============================================================ */

function openSidebar() {

    document.body.classList.add(
        "sidebar-open"
    );

    UI.sidebarBackdrop.classList.remove(
        "hidden"
    );
}


function closeSidebar() {

    document.body.classList.remove(
        "sidebar-open"
    );

    UI.sidebarBackdrop.classList.add(
        "hidden"
    );
}


/* ============================================================
   SERVICE WORKER
   ============================================================ */

function registerServiceWorker() {

    if (
        !("serviceWorker" in navigator)
    ) {

        console.warn(
            "Service Workers are not supported."
        );

        return;
    }


    window.addEventListener(
        "load",
        async () => {

            try {

                const registration =
                    await navigator.serviceWorker.register(
                        "./sw.js",
                        {
                            scope: "./"
                        }
                    );


                console.log(
                    "KinStudy Service Worker registered:",
                    registration.scope
                );


            } catch (error) {

                console.error(
                    "Service Worker registration failed:",
                    error
                );
            }
        }
    );
}


/* ============================================================
   EVENT LISTENERS
   ============================================================ */

function setupEvents() {

    /*
     * Sidebar
     */

    UI.sidebarOpen.addEventListener(
        "click",
        openSidebar
    );

    UI.sidebarClose.addEventListener(
        "click",
        closeSidebar
    );

    UI.sidebarBackdrop.addEventListener(
        "click",
        closeSidebar
    );


    /*
     * New chat
     */

    UI.newChatButton.addEventListener(
        "click",
        () => {

            if (
                state.isProcessing
            ) {

                showToast(
                    "Wait for the current response to finish."
                );

                return;
            }

            createChat();
        }
    );


    /*
     * Chat search
     */

    UI.chatSearchInput.addEventListener(
        "input",
        renderSidebar
    );


    /*
     * Theme
     */

    UI.themeButton.addEventListener(
        "click",
        () => {

            applyTheme(
                state.theme === "dark"
                    ? "light"
                    : "dark"
            );

            createDynamicManifest();
        }
    );


    /*
     * Settings
     */

    UI.settingsButton.addEventListener(
        "click",
        openSettings
    );

    UI.settingsClose.addEventListener(
        "click",
        closeSettings
    );

    UI.settingsCancel.addEventListener(
        "click",
        closeSettings
    );

    UI.settingsSave.addEventListener(
        "click",
        saveSettingsFromUI
    );


    /*
     * Settings theme buttons
     */

    UI.lightThemeButton.addEventListener(
        "click",
        () => {

            applyTheme("light");

            createDynamicManifest();
        }
    );


    UI.darkThemeButton.addEventListener(
        "click",
        () => {

            applyTheme("dark");

            createDynamicManifest();
        }
    );


    /*
     * API key visibility
     */

    UI.toggleApiKey.addEventListener(
        "click",
        () => {

            const password =
                UI.geminiApiKey.type ===
                "password";

            UI.geminiApiKey.type =
                password
                    ? "text"
                    : "password";

            UI.toggleApiKey.textContent =
                password
                    ? "Hide"
                    : "Show";
        }
    );


    /*
     * Export
     */

    UI.exportChatsButton.addEventListener(
        "click",
        exportChats
    );


    /*
     * Mode/model
     */

    UI.modeSelect.addEventListener(
        "change",
        () => {

            const mode =
                UI.modeSelect.value;

            if (mode === "online") {

                if (
                    state.offlineEngine
                ) {
                    freeOfflineEngine();
                }

                state.mode =
                    "online";

                /*
                 * Select first online model
                 * if current selection is offline.
                 */
                if (
                    !ONLINE_MODELS[
                        state.selectedModel
                    ]
                ) {

                    state.selectedModel =
                        "gemini-3.8-flash";

                    UI.modelSelect.value =
                        state.selectedModel;
                }

            } else {

                state.mode =
                    "offline";

                if (
                    !OFFLINE_MODELS[
                        state.selectedModel
                    ]
                ) {

                    state.selectedModel =
                        "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

                    UI.modelSelect.value =
                        state.selectedModel;
                }
            }


            updateModeUI();

            updateModelFromSelect();
        }
    );


    UI.modelSelect.addEventListener(
        "change",
        updateModelFromSelect
    );


    /*
     * Offline engine
     */

    UI.loadEngineButton.addEventListener(
        "click",
        loadOfflineEngine
    );


    UI.freeRamButton.addEventListener(
        "click",
        freeOfflineEngine
    );


    /*
     * Attachments
     */

    UI.attachButton.addEventListener(
        "click",
        () => {

            UI.fileInput.click();
        }
    );


    UI.fileInput.addEventListener(
        "change",
        () => {

            const file =
                UI.fileInput.files?.[0];

            handleFileSelected(
                file
            );
        }
    );


    UI.removeAttachmentButton.addEventListener(
        "click",
        removeAttachment
    );


    /*
     * Message input
     */

    UI.messageInput.addEventListener(
        "input",
        autoResizeTextarea
    );


    UI.messageInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();
            }
        }
    );


    /*
     * Send
     */

    UI.sendButton.addEventListener(
        "click",
        () => {

            if (
                state.isProcessing
            ) {

                stopGeneration();

            } else {

                sendMessage();
            }
        }
    );


    /*
     * Confirmation modal
     */

    UI.confirmCancel.addEventListener(
        "click",
        () => {

            UI.confirmModal.classList.add(
                "hidden"
            );
        }
    );


    /*
     * Close modal by clicking backdrop.
     */

    UI.settingsModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                UI.settingsModal
            ) {

                closeSettings();
            }
        }
    );


    UI.confirmModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                UI.confirmModal
            ) {

                UI.confirmModal.classList.add(
                    "hidden"
                );
            }
        }
    );


    /*
     * Escape key.
     */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Escape"
            ) {

                closeSettings();

                UI.confirmModal.classList.add(
                    "hidden"
                );

                closeSidebar();
            }
        }
    );
}


/* ============================================================
   APPLICATION INITIALIZATION
   ============================================================ */

async function initializeApp() {

    console.log(
        `${APP_NAME} starting...`
    );


    /*
     * Load persistent state.
     */

    loadTheme();

    loadSettings();

    loadChats();


    /*
     * Create first chat if necessary.
     */

    if (
        state.chats.length === 0
    ) {

        const chat = {

            id:
                createId("chat"),

            title:
                "New Chat",

            createdAt:
                Date.now(),

            updatedAt:
                Date.now(),

            messages:
                []
        };


        state.chats.push(
            chat
        );
    }


    /*
     * Restore active chat.
     */

    const savedActive =
        localStorage.getItem(
            STORAGE_KEYS.activeChat
        );


    const activeExists =
        state.chats.some(
            chat =>
                chat.id ===
                savedActive
        );


    state.activeChatId =
        activeExists
            ? savedActive
            : state.chats[0].id;


    saveChats();

    saveActiveChatId();


    /*
     * Set initial model.
     */

    UI.modeSelect.value =
        "online";

    UI.modelSelect.value =
        "gemini-3.8-flash";


    state.mode =
        "online";

    state.selectedModel =
        "gemini-3.8-flash";


    /*
     * Render interface.
     */

    renderSidebar();

    renderChat();

    updateModeUI();

    createDynamicManifest();


    /*
     * Setup events.
     */

    setupEvents();


    /*
     * Study knowledge base.
     */

    await loadStudyData();


    /*
     * Service Worker.
     */

    registerServiceWorker();


    /*
     * Initial WebGPU check is intentionally NOT performed
     * until offline mode is selected.
     *
     * This keeps startup lightweight.
     */

    setEngineStatus(
        "ready",
        "Online ready"
    );

    setConnectionStatus(
        "Gemini 3.8 Flash"
    );


    console.log(
        `${APP_NAME} ready.`
    );
}


/* ============================================================
   START
   ============================================================ */

initializeApp().catch(
    error => {

        console.error(
            "KinStudy initialization failed:",
            error
        );

        showToast(
            "KinStudy failed to initialize."
        );
    }
);
