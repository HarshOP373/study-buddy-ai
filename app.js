/**
 * KinStudy - Unified Document, Vision, and Olympiad Engine
 * Architecture: Direct SmolVLM-2.2B (Quantized q4 on WebGPU) + Gemini Flash Online Fallback
 */

const state = {
  currentMode: 'online', // 'online' | 'offline'
  activeAttachment: null,
  activeQuality: '720p',
  vlmPipeline: null,
  isProcessing: false
};

// Canvas Downscaling Targets
const RESOLUTION_BOUNDS = {
  '480p': 512,
  '720p': 768,   // A16 iPad default balance point
  '1080p': 1024
};

// UI Selectors
const chatScroller = document.getElementById('chat-scroller');
const messagesList = document.getElementById('messages-list');
const textarea = document.getElementById('chat-textarea');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-upload-input');
const resSelect = document.getElementById('resolution-select');
const onlineBtn = document.getElementById('mode-online-btn');
const offlineBtn = document.getElementById('mode-offline-btn');
const engineStatus = document.getElementById('engine-status-badge');

const stagedBar = document.getElementById('staged-attachment-bar');
const stagedThumb = document.getElementById('staged-thumb');
const stagedFilename = document.getElementById('staged-filename');
const stagedFilesize = document.getElementById('staged-filesize');
const stagedRemoveBtn = document.getElementById('staged-remove-btn');

/* -------------------------------------------------------------------------- */
/*  1. Canvas Downscaler for WebGPU Memory Protection                          */
/* -------------------------------------------------------------------------- */

async function resizeImageToSafeResolution(fileOrBlob, maxDimension = 768) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        width,
        height
      });
    };

    img.onerror = reject;
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* -------------------------------------------------------------------------- */
/*  2. PDF Extraction with PDF.js                                             */
/* -------------------------------------------------------------------------- */

async function extractPDFText(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = `[Textbook File: ${file.name} | Total Pages: ${pdf.numPages}]\n\n`;

  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  return fullText;
}

/* -------------------------------------------------------------------------- */
/*  3. SmolVLM-2.2B WebGPU Offline Engine                                     */
/* -------------------------------------------------------------------------- */

async function loadSmolVLM22B(onProgress) {
  if (state.vlmPipeline) return state.vlmPipeline;

  onProgress?.("Downloading SmolVLM-2.2B (Quantized q4)...");
  state.vlmPipeline = await window.HFPipeline(
    'image-text-to-text',
    'onnx-community/SmolVLM-Instruct',
    {
      device: 'webgpu',
      dtype: 'q4', // Critical 4-bit quantization for iPad A16 Safari limits
      progress_callback: (p) => {
        if (p.status === 'progress') {
          onProgress?.(`Downloading Weights: ${Math.round(p.progress)}%`);
        }
      }
    }
  );
  return state.vlmPipeline;
}

async function runOfflineVLM(promptText, imageUrl, onStatus) {
  const pipe = await loadSmolVLM22B(onStatus);

  const messages = [
    {
      role: 'user',
      content: []
    }
  ];

  if (imageUrl) {
    messages[0].content.push({ type: 'image', image: imageUrl });
  }

  messages[0].content.push({
    type: 'text',
    text: promptText || "Analyze this image and explain the solution step-by-step."
  });

  onStatus?.("Executing reasoning on WebGPU...");
  const output = await pipe(messages, {
    max_new_tokens: 512,
    temperature: 0.1
  });

  return output[0].generated_text.at(-1).content;
}

/* -------------------------------------------------------------------------- */
/*  4. Online Fallback (Gemini Multimodal)                                    */
/* -------------------------------------------------------------------------- */

async function runGeminiOnline(promptText, attachment) {
  const apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
  if (!apiKey) {
    return "Please enter your Gemini API key in localStorage (GEMINI_API_KEY) or toggle to 📴 Offline Mode.";
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const parts = [];
  if (attachment && attachment.dataUrl) {
    const base64Data = attachment.dataUrl.split(',')[1];
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: base64Data
      }
    });
  }

  parts.push({ text: promptText });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
}

/* -------------------------------------------------------------------------- */
/*  5. Universal File Upload Router (Images, PDFs, Text/Code)                  */
/* -------------------------------------------------------------------------- */

resSelect.addEventListener('change', (e) => {
  state.activeQuality = e.target.value;
});

onlineBtn.addEventListener('click', () => {
  state.currentMode = 'online';
  onlineBtn.classList.add('active');
  offlineBtn.classList.remove('active');
  engineStatus.textContent = 'Cloud Active';
});

offlineBtn.addEventListener('click', () => {
  state.currentMode = 'offline';
  offlineBtn.classList.add('active');
  onlineBtn.classList.remove('active');
  engineStatus.textContent = 'WebGPU Ready';
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const maxBound = RESOLUTION_BOUNDS[state.activeQuality];

  // 1. Process Images
  if (file.type.startsWith('image/')) {
    const resized = await resizeImageToSafeResolution(file, maxBound);
    state.activeAttachment = {
      name: file.name,
      size: file.size,
      type: file.type,
      quality: state.activeQuality,
      dataUrl: resized.dataUrl,
      width: resized.width,
      height: resized.height
    };
    stagedThumb.src = resized.dataUrl;
  } 
  // 2. Process PDFs
  else if (file.type === 'application/pdf') {
    const pdfText = await extractPDFText(file);
    state.activeAttachment = {
      name: file.name,
      size: file.size,
      type: file.type,
      textContent: pdfText,
      dataUrl: null
    };
    stagedThumb.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📄</text></svg>';
  } 
  // 3. Process Text, Markdown & Code Files
  else if (file.name.match(/\.(txt|md|py|js|html|css|json|csv)$/i)) {
    const rawContent = await file.text();
    state.activeAttachment = {
      name: file.name,
      size: file.size,
      type: 'text/plain',
      textContent: `[File Content: ${file.name}]\n\n${rawContent}`,
      rawPreview: rawContent.slice(0, 1000),
      dataUrl: null
    };
    stagedThumb.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📝</text></svg>';
  }

  stagedFilename.textContent = file.name;
  stagedFilesize.textContent = `${formatBytes(file.size)} • ${state.activeQuality}`;
  stagedBar.classList.remove('hidden');
});

stagedRemoveBtn.addEventListener('click', () => {
  state.activeAttachment = null;
  fileInput.value = '';
  stagedBar.classList.add('hidden');
});

// Fullscreen Modal Preview Handlers
window.openModal = function(name, size, type, quality, src, previewText) {
  const modal = document.getElementById('file-preview-modal');
  document.getElementById('modal-file-title').textContent = name;
  document.getElementById('modal-file-meta').textContent =
    `Size: ${formatBytes(size)} | Profile: ${quality || 'Text'} | Type: ${type}`;

  const body = document.getElementById('modal-file-body');
  if (type.startsWith('image/')) {
    body.innerHTML = `<img src="${src}" alt="Preview" />`;
  } else if (type === 'application/pdf') {
    body.innerHTML = `<div style="font-size:3rem;text-align:center;">📄<br><span style="font-size:0.9rem;">PDF Document Parsed</span></div>`;
  } else {
    body.innerHTML = `<pre>${previewText || 'Text File Attached'}</pre>`;
  }
  modal.classList.remove('hidden');
};

window.closeModal = function() {
  document.getElementById('file-preview-modal').classList.add('hidden');
};

/* -------------------------------------------------------------------------- */
/*  6. Rendering & Chat Controller                                            */
/* -------------------------------------------------------------------------- */

function appendMessage(sender, text, attachment = null) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (attachment) {
    const pill = document.createElement('div');
    pill.className = 'msg-attachment-pill';
    pill.onclick = () => window.openModal(
      attachment.name,
      attachment.size,
      attachment.type,
      attachment.quality,
      attachment.dataUrl,
      attachment.rawPreview
    );

    const iconSrc = attachment.dataUrl || 
      (attachment.type === 'application/pdf' 
        ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📄</text></svg>'
        : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text y="20" font-size="20">📝</text></svg>');

    pill.innerHTML = `
      <img src="${iconSrc}" class="pill-thumb" />
      <div class="pill-meta">
        <span class="pill-title">${attachment.name}</span>
        <span class="pill-sub">${formatBytes(attachment.size)} • ${attachment.quality || 'Document'} • Tap to view</span>
      </div>
    `;
    bubble.appendChild(pill);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-body';
  textEl.textContent = text;
  bubble.appendChild(textEl);

  row.appendChild(bubble);
  messagesList.appendChild(row);
  chatScroller.scrollTop = chatScroller.scrollHeight;

  return textEl;
}

sendBtn.addEventListener('click', handleSendMessage);
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});

async function handleSendMessage() {
  const text = textarea.value.trim();
  const attachment = state.activeAttachment;

  if (!text && !attachment) return;
  if (state.isProcessing) return;

  state.isProcessing = true;
  textarea.value = '';

  state.activeAttachment = null;
  fileInput.value = '';
  stagedBar.classList.add('hidden');

  appendMessage('user', text, attachment);
  const assistantMsgBody = appendMessage('assistant', 'Thinking...');

  try {
    let finalAnswer = '';

    if (state.currentMode === 'online') {
      let promptToSend = text;
      if (attachment?.textContent) {
        promptToSend = `${attachment.textContent}\n\n${text}`;
      }
      finalAnswer = await runGeminiOnline(promptToSend, attachment);
    } else {
      let offlinePrompt = text;
      if (attachment?.textContent) {
        offlinePrompt = `${attachment.textContent}\n\n${text}`;
      }
      finalAnswer = await runOfflineVLM(
        offlinePrompt,
        attachment?.dataUrl || null,
        (status) => {
          assistantMsgBody.textContent = `⏳ ${status}`;
        }
      );
    }

    assistantMsgBody.textContent = finalAnswer;
  } catch (err) {
    console.error(err);
    assistantMsgBody.textContent = `Error: ${err.message || 'Processing failed'}`;
  } finally {
    state.isProcessing = false;
    chatScroller.scrollTop = chatScroller.scrollHeight;
  }
}
