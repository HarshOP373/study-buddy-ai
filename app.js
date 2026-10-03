/* ==========================================================================
   KinStudy Pro - iPad Design System
   Modern ChatGPT/Gemini Polish, Smooth Animations & iPad Safe Areas
   ========================================================================== */

:root,
[data-theme="dark"] {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-surface: #21262d;
  --bg-surface-hover: #30363d;
  --bg-chat-bubble: #161b22;
  --bg-user-bubble: #1f2937;
  --bg-input: #161b22;

  --text-primary: #f0f6fc;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --text-accent: #58a6ff;

  --border-subtle: #21262d;
  --border-medium: #30363d;
  --border-focus: #58a6ff;

  --accent-gradient: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
  --accent-glow: rgba(59, 130, 246, 0.25);

  --status-online: #238636;
  --status-offline: #d29922;
  --status-danger: #f85149;

  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

[data-theme="light"] {
  --bg-primary: #f6f8fa;
  --bg-secondary: #ffffff;
  --bg-surface: #eaeef2;
  --bg-surface-hover: #d0d7de;
  --bg-chat-bubble: #ffffff;
  --bg-user-bubble: #e8f0fe;
  --bg-input: #ffffff;

  --text-primary: #1f2328;
  --text-secondary: #57606a;
  --text-muted: #8c959f;
  --text-accent: #0969da;

  --border-subtle: #d0d7de;
  --border-medium: #afb8c1;
  --border-focus: #0969da;

  --accent-gradient: linear-gradient(135deg, #0969da 0%, #6366f1 100%);
  --accent-primary: #0969da;
  --accent-hover: #0550ae;
  --accent-glow: rgba(9, 105, 218, 0.15);

  --status-online: #1a7f37;
  --status-offline: #9a6700;
  --status-danger: #cf222e;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

#app-container {
  display: flex;
  height: 100%;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
  position: relative;
}

/* Sidebar */
#sidebar {
  width: 290px;
  height: 100%;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 40;
}

@media (max-width: 820px) {
  #sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    transform: translateX(-100%);
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  }
  #sidebar.open {
    transform: translateX(0);
  }
}

#sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 35;
}
#sidebar-backdrop.active {
  display: block;
}

.sidebar-header {
  padding: 1.1rem 1rem 0.6rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-badge {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.brand-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1.25rem;
}

.brand-text h1 {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.brand-text span.pill {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent-primary);
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.brand-text p {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.btn-icon-close {
  display: none;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.25rem;
  padding: 0.4rem;
  cursor: pointer;
}
@media (max-width: 820px) {
  .btn-icon-close { display: block; }
}

.new-chat-container {
  padding: 0.7rem 0.9rem;
}

.btn-new-chat {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-new-chat:hover {
  background: var(--bg-surface-hover);
  border-color: var(--text-accent);
}
.badge-shortcut {
  font-size: 0.7rem;
  color: var(--text-muted);
  background: var(--bg-primary);
  padding: 2px 6px;
  border-radius: 6px;
}

.chat-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  padding: 0.4rem 0.5rem;
}

.chat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.82rem;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.chat-item:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}
.chat-item.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 700;
  border-color: var(--border-medium);
}
.chat-item-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin-right: 0.5rem;
}
.btn-delete-chat {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.btn-delete-chat:hover {
  color: var(--status-danger);
}

.sidebar-footer {
  padding: 0.85rem;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.2rem;
}
.mode-indicator {
  font-size: 0.75rem;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.online { background-color: var(--status-online); }
.dot.offline { background-color: var(--status-offline); }

.btn-theme-toggle {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 5px 9px;
  border-radius: 8px;
  font-size: 0.78rem;
  cursor: pointer;
}

.btn-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.btn-footer:hover { background-color: var(--bg-surface-hover); }
.sub-pill {
  font-size: 0.68rem;
  color: var(--text-muted);
}

/* Main Area */
#main-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-primary);
  position: relative;
  overflow: hidden;
}

.top-bar {
  height: 62px;
  padding: 0 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-secondary);
  flex-shrink: 0;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.btn-menu-toggle {
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem;
  border-radius: 8px;
}
.btn-menu-toggle:hover { background: var(--bg-surface); }

.chat-title-group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.chat-header-title {
  font-size: 0.92rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
@media (min-width: 900px) {
  .chat-header-title { max-width: 380px; }
}

.model-tag {
  font-size: 0.68rem;
  background: var(--bg-surface);
  color: var(--text-accent);
  border: 1px solid var(--border-medium);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.mode-select-pill {
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  border-radius: 20px;
  padding: 0.4rem 1.8rem 0.4rem 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.65rem center;
  outline: none;
}

.btn-top-action {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  padding: 0.45rem 0.65rem;
  border-radius: 10px;
  cursor: pointer;
}

/* Offline Bar */
#offline-status-bar {
  display: none;
  padding: 0.65rem 1.25rem;
  background-color: rgba(210, 153, 34, 0.1);
  border-bottom: 1px solid rgba(210, 153, 34, 0.25);
  font-size: 0.8rem;
}
#offline-status-bar.active { display: block; }

.status-bar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.status-left {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.ram-badge {
  font-size: 0.68rem;
  padding: 2px 8px;
  border-radius: 9999px;
  background: rgba(210, 153, 34, 0.15);
  color: var(--status-offline);
  border: 1px solid rgba(210, 153, 34, 0.3);
  font-weight: 700;
}
.ram-badge.ready {
  background: rgba(35, 134, 54, 0.15);
  color: var(--status-online);
  border-color: rgba(35, 134, 54, 0.3);
}

.btn-load-model {
  background: var(--accent-gradient);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.35rem 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.btn-unload-model {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.load-progress-bar {
  display: none;
  width: 100%;
  height: 4px;
  background: var(--border-medium);
  border-radius: 9999px;
  margin-top: 0.45rem;
  overflow: hidden;
}
.load-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--accent-gradient);
  transition: width 0.2s ease;
}

/* Chat Messages */
#messages-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

.welcome-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: auto;
  max-width: 580px;
  padding: 2rem 1rem;
}
.welcome-avatar {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin-bottom: 1.2rem;
}
.welcome-hero h2 {
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 0.5rem;
}
.welcome-hero p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 1.75rem;
}

.quick-prompts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.75rem;
  width: 100%;
}
.prompt-card {
  text-align: left;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 0.85rem 1rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.prompt-card:hover {
  border-color: var(--accent-primary);
  transform: translateY(-2px);
}
.prompt-tag {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-accent);
  display: block;
  margin-bottom: 0.25rem;
}
.prompt-desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.message-row {
  display: flex;
  gap: 0.9rem;
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
}
.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}
.message-row.user .message-avatar { background-color: var(--border-medium); }
.message-row.assistant .message-avatar {
  background: var(--accent-gradient);
  color: #fff;
}

.message-content-wrapper {
  flex: 1;
  min-width: 0;
}
.message-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.sender-name {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-secondary);
}
.btn-copy-bubble {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.message-body {
  background-color: var(--bg-chat-bubble);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem 1.2rem;
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--text-primary);
  word-break: break-word;
}
.message-row.user .message-body {
  background-color: var(--bg-user-bubble);
  border-color: var(--border-subtle);
}

.instant-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--status-online);
  background: rgba(35, 134, 54, 0.15);
  border: 1px solid rgba(35, 134, 54, 0.3);
  padding: 3px 8px;
  border-radius: 6px;
  margin-bottom: 0.6rem;
}

/* Typing pulse animation */
.typing-dot {
  font-style: italic;
  color: var(--text-accent);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
}

/* ChatGPT Code Block Window */
.code-block-container {
  margin: 0.85rem 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-medium);
  background-color: #0b0f17;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.85rem;
  background-color: #161b26;
  border-bottom: 1px solid var(--border-subtle);
}

.code-lang-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: lowercase;
  color: var(--text-secondary);
}

.btn-copy-code {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-copy-code:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.btn-copy-code.copied {
  color: var(--status-online);
}

.code-block-container pre {
  margin: 0 !important;
  padding: 1rem !important;
  background-color: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  overflow-x: auto;
}

.code-block-container code {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.55;
  color: #e6edf3;
  tab-size: 2;
  white-space: pre;
}

.inline-code {
  background-color: rgba(110, 118, 129, 0.2);
  color: var(--text-accent);
  padding: 2px 6px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.82rem;
}

/* Stop Generation Floating Button */
.stop-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0.4rem 0;
  position: absolute;
  bottom: 80px;
  left: 0;
  right: 0;
  z-index: 25;
  pointer-events: none;
}

.btn-stop {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  border-radius: 20px;
  padding: 0.45rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: all 0.15s ease;
}

.btn-stop:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--status-danger);
  color: var(--status-danger);
}

.btn-stop:active {
  transform: scale(0.96);
}

.stop-icon {
  font-size: 0.65rem;
  color: var(--status-danger);
}

/* Input Area */
.input-section {
  padding: 0.85rem 1.25rem max(0.85rem, env(safe-area-inset-bottom)) 1.25rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.input-box-wrapper {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  background-color: var(--bg-input);
  border: 1px solid var(--border-medium);
  border-radius: 18px;
  padding: 0.5rem 0.75rem 0.5rem 1rem;
  transition: all 0.15s;
}
.input-box-wrapper:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

#chat-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 0.92rem;
  line-height: 1.45;
  resize: none;
  max-height: 160px;
  min-height: 38px;
  padding: 0.4rem 0;
}

.btn-send {
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 12px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.15s;
  flex-shrink: 0;
}
.btn-send:active { transform: scale(0.92); }
.btn-send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.input-caption {
  text-align: center;
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 0.45rem;
}

/* Modal */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 50;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-overlay.active { display: flex; }

.modal-dialog {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 20px;
  max-width: 520px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 15px 35px rgba(0,0,0,0.4);
}

.modal-header {
  padding: 1.1rem 1.35rem;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-header h3 {
  font-size: 0.98rem;
  font-weight: 700;
}
.btn-modal-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.modal-body {
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.box-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 0.85rem;
}

.form-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-input, .form-textarea {
  width: 100%;
  background-color: var(--bg-input);
  border: 1px solid var(--border-medium);
  border-radius: 10px;
  padding: 0.7rem 0.9rem;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 0.85rem;
  outline: none;
}
.form-input:focus, .form-textarea:focus { border-color: var(--border-focus); }
.form-textarea { resize: vertical; }

.form-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* Custom Toggle Switch */
.toggle-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.toggle-control input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: relative;
  width: 36px;
  height: 20px;
  background-color: var(--border-medium);
  border-radius: 20px;
  transition: 0.2s;
  display: inline-block;
}
.toggle-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.2s;
}
.toggle-control input:checked + .toggle-slider {
  background-color: var(--accent-primary);
}
.toggle-control input:checked + .toggle-slider:before {
  transform: translateX(16px);
}

.btn-text-action {
  background: none;
  border: none;
  color: var(--text-accent);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.modal-footer {
  padding: 1rem 1.35rem;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.btn-primary {
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0.6rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.btn-danger {
  background: rgba(248, 81, 73, 0.15);
  color: var(--status-danger);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: 8px;
  padding: 0.5rem 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
