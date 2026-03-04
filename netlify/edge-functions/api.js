/**
 * Netlify Edge Functions 入口 - 支持真正的流式输出
 */

// ============================================
// Baxia Token 生成
// ============================================

const BAXIA_VERSION = '2.5.36';

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

function generateWebGLFingerprint() {
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)',
  ];
  return { renderer: renderers[Math.floor(Math.random() * renderers.length)], vendor: 'Google Inc. (Intel)' };
}

async function generateCanvasFingerprint() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  return btoa(String.fromCharCode(...hashArray)).substring(0, 32);
}

async function collectFingerprintData() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US', 'zh-CN', 'en-GB'];
  const canvas = await generateCanvasFingerprint();
  
  return {
    p: platforms[Math.floor(Math.random() * platforms.length)],
    l: languages[Math.floor(Math.random() * languages.length)],
    hc: 4 + Math.floor(Math.random() * 12),
    dm: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    to: [-480, -300, 0, 60, 480][Math.floor(Math.random() * 5)],
    sw: 1920 + Math.floor(Math.random() * 200),
    sh: 1080 + Math.floor(Math.random() * 100),
    cd: 24,
    pr: [1, 1.25, 1.5, 2][Math.floor(Math.random() * 4)],
    wf: generateWebGLFingerprint().renderer.substring(0, 20),
    cf: canvas,
    af: (124.04347527516074 + Math.random() * 0.001).toFixed(14),
    ts: Date.now(),
    r: Math.random(),
  };
}

function encodeBaxiaToken(data) {
  return `${BAXIA_VERSION.replace(/\./g, '')}!${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}`;
}

async function getBaxiaTokens() {
  const bxUa = encodeBaxiaToken(await collectFingerprintData());
  let bxUmidToken;
  try {
    const resp = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    bxUmidToken = resp.headers.get('etag') || 'T2gA' + randomString(40);
  } catch { bxUmidToken = 'T2gA' + randomString(40); }
  return { bxUa, bxUmidToken, bxV: BAXIA_VERSION };
}

// ============================================
// UUID 生成
// ============================================

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ============================================
// 响应工具
// ============================================

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extraHeaders }
  });
}

function handleChatPage() {
  const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Qwen2API Chat</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; }
    main { max-width: 920px; margin: 0 auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    #messages { min-height: 52vh; max-height: 62vh; overflow: auto; }
    .msg { padding: 8px; border-radius: 8px; white-space: pre-wrap; margin: 8px 0; }
    .msg-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 12px; opacity: 0.8; }
    .mini { padding: 2px 8px; font-size: 12px; }
    .u { background: #e8f0ff; }
    .a { background: #f3f4f6; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    input, select, textarea, button { font: inherit; padding: 8px; border-radius: 8px; border: 1px solid #d1d5db; }
    textarea { width: 100%; min-height: 90px; }
    select, input[type=text] { flex: 1; min-width: 180px; }
    .primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    .warn { background: #ef4444; color: #fff; border-color: #ef4444; }
    .status { font-size: 13px; min-height: 20px; }
    .err { color: #b91c1c; }
    .ok { color: #047857; }
    .fi { display: flex; justify-content: space-between; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; margin-top: 6px; }
  </style>
</head>
<body>
  <main>
    <section>
      <div class="row">
        <input id="apiKey" type="text" placeholder="API Key（可选）" />
        <select id="model"><option value="qwen3.5-plus">qwen3.5-plus</option></select>
        <button id="refreshModels" type="button">刷新模型</button>
        <button id="clear" class="warn" type="button">清空会话</button>
      </div>
    </section>
    <section id="messages"></section>
    <section>
      <textarea id="prompt" placeholder="输入消息；Enter发送，Shift+Enter换行"></textarea>
      <div class="row">
        <input id="files" type="file" multiple accept=".pdf,.doc,.docx,.dot,.csv,.xlsx,.xls,.txt,.text,.md,.js,.mjs,.ts,.jsx,.tsx,.vue,.html,.htm,.css,.svg,.svgz,.xml,.json,.jsonc,.wasm,.tex,.latex,.c,.h,.cc,.cxx,.cpp,.hpp,.hh,.hxx,.ino,.java,.kt,.kts,.scala,.groovy,.go,.rs,.swift,.php,.rb,.cs,.vb,.fs,.csproj,.sln,.sql,.lua,.r,.pl,.tcl,.awk,.fish,.yaml,.yml,.toml,.ini,.sh,.bat,.cmd,.dockerfile,.containerfile,.proto,.thrift,.graphql,.gql,.qmd,.smali,.gif,.webp,.jpg,.jpeg,.png,.bmp,.icns,.jp2,.sgi,.tif,.tiff,.mkv,.mov,.wav,.mp3,.m4a,.amr,.aac,image/*,audio/*,video/*" />
        <button id="send" class="primary" type="button">发送</button>
        <button id="stop" type="button" disabled>中断</button>
      </div>
      <div id="atts"></div>
      <div id="status" class="status"></div>
    </section>
  </main>
  <script>
    (function () {
      var MAX = 5;
      var MAX_SIZE = 10 * 1024 * 1024;
      var KEY = 'qwen2api.chat.history.v1';
      var state = { hist: [], files: [], ac: null };
      var e = {
        apiKey: document.getElementById('apiKey'),
        model: document.getElementById('model'),
        refreshModels: document.getElementById('refreshModels'),
        clear: document.getElementById('clear'),
        messages: document.getElementById('messages'),
        prompt: document.getElementById('prompt'),
        files: document.getElementById('files'),
        atts: document.getElementById('atts'),
        send: document.getElementById('send'),
        stop: document.getElementById('stop'),
        status: document.getElementById('status')
      };
      function st(t, k) { e.status.textContent = t || ''; e.status.className = 'status ' + (k || ''); }
      function msg(role, text, idx) { var d = document.createElement('div'); d.className = 'msg ' + (role === 'assistant' ? 'a' : 'u'); var head = document.createElement('div'); head.className = 'msg-head'; var roleLabel = document.createElement('span'); roleLabel.textContent = role === 'assistant' ? 'Assistant' : 'User'; head.appendChild(roleLabel); if (role === 'user' && typeof idx === 'number') { var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'mini'; retry.textContent = '重发'; retry.onclick = function () { resendFromIndex(idx); }; head.appendChild(retry); } var body = document.createElement('div'); body.textContent = text || ''; d.appendChild(head); d.appendChild(body); e.messages.appendChild(d); e.messages.scrollTop = e.messages.scrollHeight; return body; }
      function summarizeMessageContent(content) { if (typeof content === 'string') return content; if (!Array.isArray(content)) return ''; var texts = []; var names = []; for (var i = 0; i < content.length; i++) { var part = content[i] || {}; var type = part.type || ''; if (type === 'input_text' && typeof part.input_text === 'string' && part.input_text.trim()) texts.push(part.input_text.trim()); if ((type === 'input_file' || type === 'input_image' || type === 'input_video' || type === 'input_audio') && typeof part.filename === 'string' && part.filename.trim()) names.push(part.filename.trim()); } var base = texts.join('\n'); if (names.length > 0) return (base ? base + '\n' : '') + '[附件] ' + names.join(', '); return base; }
      function rHist() { e.messages.innerHTML = ''; for (var i = 0; i < state.hist.length; i++) { var x = state.hist[i]; if (!x) continue; var content = x.content; if (typeof content !== 'string' && !Array.isArray(content)) continue; msg(x.role, summarizeMessageContent(content), i); } }
      function save() { try { var kept = state.hist.filter(function (x) { if (!x) return false; if (typeof x.content === 'string') return !!x.content.trim(); return Array.isArray(x.content) && x.content.length > 0; }).slice(-40); localStorage.setItem(KEY, JSON.stringify(kept)); } catch (_) {} }
      function load() { try { var v = localStorage.getItem(KEY); if (!v) return; var a = JSON.parse(v); if (Array.isArray(a)) state.hist = a.filter(function (x) { return x && (typeof x.content === 'string' || Array.isArray(x.content)); }); } catch (_) {} }
      function busy(b) { e.send.disabled = b; e.stop.disabled = !b; e.prompt.disabled = b; e.files.disabled = b; e.clear.disabled = b; e.refreshModels.disabled = b; }
      function bfmt(n) { if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; }
      function attRow() { e.atts.innerHTML = ''; for (var i = 0; i < state.files.length; i++) { (function (idx) { var w = document.createElement('div'); w.className = 'fi'; var t = document.createElement('div'); var f = state.files[idx]; t.textContent = f.name + ' (' + bfmt(f.size) + ')'; var rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '移除'; rm.onclick = function () { state.files.splice(idx, 1); attRow(); }; w.appendChild(t); w.appendChild(rm); e.atts.appendChild(w); })(i); } }
      function toDataUrl(file) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(String(r.result || '')); }; r.onerror = function () { bad(new Error('读取文件失败: ' + file.name)); }; r.readAsDataURL(file); }); }
      function emsg(code, txt) { if (code === 401) return '鉴权失败：Incorrect API key provided.'; if (code === 413) return '请求体过大，请减小附件。'; if (code >= 500) return '服务端异常，请稍后重试。'; return txt ? ('请求失败：' + txt) : ('请求失败（HTTP ' + code + '）'); }
      async function buildContent(text, files) { var c = []; if (text) c.push({ type: 'input_text', input_text: text }); for (var i = 0; i < files.length; i++) { var f = files[i], d = await toDataUrl(f), m = (f.type || 'application/octet-stream').toLowerCase(); if (m.startsWith('image/')) c.push({ type: 'input_image', image_url: d, filename: f.name, mime_type: m }); else c.push({ type: 'input_file', file_data: d, filename: f.name, mime_type: m }); } return c; }
      async function loadModels() { var prev = e.model.value; var headers = {}; var key = (e.apiKey.value || '').trim(); if (key) headers.Authorization = 'Bearer ' + key; try { st('正在加载模型列表...', 'ok'); var resp = await fetch('/v1/models', { headers: headers }); if (!resp.ok) { var t = await resp.text().catch(function(){ return ''; }); throw new Error(emsg(resp.status, t)); } var data = await resp.json(); var arr = Array.isArray(data && data.data) ? data.data : []; var ids = arr.map(function (x) { return x && x.id; }).filter(Boolean); if (ids.length === 0) ids = ['qwen3.5-plus']; e.model.innerHTML = ''; for (var i = 0; i < ids.length; i++) { var op = document.createElement('option'); op.value = ids[i]; op.textContent = ids[i]; e.model.appendChild(op); } if (prev && ids.indexOf(prev) >= 0) e.model.value = prev; st('模型列表已更新（' + ids.length + '）', 'ok'); } catch (err) { e.model.innerHTML = '<option value="qwen3.5-plus">qwen3.5-plus</option>'; st(err && err.message ? err.message : '加载模型失败，已回退默认模型。', 'err'); } }
      function resendFromIndex(idx) { if (state.ac) return; var item = state.hist[idx]; if (!item || item.role !== 'user' || (typeof item.content !== 'string' && !Array.isArray(item.content))) { st('仅支持重发用户消息。', 'err'); return; } e.prompt.value = summarizeMessageContent(item.content); send(item.content, true, idx); }
      async function send(forceText, fromResend, replayFromIndex) { if (state.ac) return; var text = ''; var filesForSend = fromResend ? [] : state.files; var userMessageContent; if (Array.isArray(forceText)) { userMessageContent = forceText; text = summarizeMessageContent(forceText).trim(); } else { text = (typeof forceText === 'string' ? forceText : (e.prompt.value || '')).trim(); if (!text && filesForSend.length === 0) { st('请输入内容或选择附件。', 'err'); return; } } var model = (e.model.value || '').trim() || 'qwen3.5-plus'; var key = (e.apiKey.value || '').trim(); if (!userMessageContent) { var content; try { st('正在处理附件...', 'ok'); content = await buildContent(text, filesForSend); } catch (err) { st(err && err.message || '附件处理失败', 'err'); return; } userMessageContent = (content.length <= 1 && text) ? text : content; } if (typeof replayFromIndex === 'number' && replayFromIndex >= 0) { state.hist = state.hist.slice(0, replayFromIndex); save(); rHist(); } msg('user', summarizeMessageContent(userMessageContent) || '[附件消息]', state.hist.length); var aEl = msg('assistant', ''); var payload = state.hist.slice(); payload.push({ role: 'user', content: userMessageContent }); state.ac = new AbortController(); busy(true); st('请求中（流式）...', 'ok'); try { var h = { 'Content-Type': 'application/json' }; if (key) h.Authorization = 'Bearer ' + key; var resp = await fetch('/v1/chat/completions', { method: 'POST', headers: h, body: JSON.stringify({ model: model, stream: true, messages: payload }), signal: state.ac.signal }); if (!resp.ok) { var t = await resp.text().catch(function () { return ''; }); throw new Error(emsg(resp.status, t)); } if (!resp.body) throw new Error('浏览器不支持流式响应。'); var r = resp.body.getReader(); var d = new TextDecoder(); var buf = ''; var out = ''; var done = false; while (!done) { var ch = await r.read(); done = ch.done; buf += d.decode(ch.value || new Uint8Array(), { stream: !done }); var lines = buf.split('\n'); buf = lines.pop() || ''; for (var i = 0; i < lines.length; i++) { var ln = lines[i].trim(); if (!ln || ln.indexOf('data:') !== 0) continue; var p = ln.slice(5).trim(); if (!p) continue; if (p === '[DONE]') { done = true; break; } try { var j = JSON.parse(p); var delta = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (typeof delta === 'string' && delta) { out += delta; aEl.textContent = 'Assistant: ' + out; e.messages.scrollTop = e.messages.scrollHeight; } } catch (_) {} } } if (!out) { out = '(empty response)'; aEl.textContent = 'Assistant: ' + out; } state.hist.push({ role: 'user', content: userMessageContent }); state.hist.push({ role: 'assistant', content: out }); save(); e.prompt.value = ''; state.files = []; attRow(); st('完成。', 'ok'); } catch (err) { if (err && err.name === 'AbortError') st('已中断请求。', 'err'); else { var m = err && err.message || '请求失败'; st(m, 'err'); if (!aEl.textContent) aEl.textContent = 'Assistant: [错误] ' + m; } } finally { state.ac = null; busy(false); } }
      e.files.onchange = function () { var fs = Array.from(e.files.files || []); for (var i = 0; i < fs.length; i++) { if (state.files.length >= MAX) { st('最多允许 ' + MAX + ' 个附件。', 'err'); break; } var f = fs[i]; if (f.size > MAX_SIZE) { st('文件过大：' + f.name + '（上限 ' + bfmt(MAX_SIZE) + '）', 'err'); continue; } state.files.push(f); } e.files.value = ''; attRow(); if (state.files.length) st('已选择 ' + state.files.length + ' 个附件。', 'ok'); };
      e.send.onclick = function () { send(); };
      e.stop.onclick = function () { if (state.ac) state.ac.abort(); };
      e.clear.onclick = function () { state.hist = []; save(); state.files = []; attRow(); rHist(); st('会话已清空。', 'ok'); };
      e.refreshModels.onclick = function () { loadModels(); };
      e.apiKey.addEventListener('blur', function () { loadModels(); });
      e.prompt.onkeydown = function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } };
      load();
      rHist();
      loadModels();
      st('就绪。', 'ok');
    })();
  </script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
}

function logChatDetail(runtime, event, detail = {}) {
  const rawFlag = (globalThis && globalThis.__CHAT_DETAIL_LOG) || '';
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(rawFlag).toLowerCase());
  if (!enabled) return;
  const prefix = `[qwen2api][${runtime}][chat]`;
  try {
    console.log(`${prefix} ${event}`, JSON.stringify(detail));
  } catch {
    console.log(`${prefix} ${event}`);
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMimeType(mimeType) {
  return (mimeType || 'application/octet-stream').toLowerCase();
}

function inferFileCategory(mimeType, explicitType) {
  if (explicitType === 'image' || explicitType === 'audio' || explicitType === 'video' || explicitType === 'document') return explicitType;
  const mime = normalizeMimeType(mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function fileExtensionFromMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  const mapping = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/avi': 'avi',
    'image/tiff': 'tif',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/x-icns': 'icns',
    'image/jp2': 'jp2',
    'image/sgi': 'sgi',
  };
  return mapping[mime] || 'bin';
}

function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const matched = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!matched) return null;
  return {
    mimeType: normalizeMimeType(matched[1] || 'application/octet-stream'),
    bytes: decodeBase64ToBytes(matched[2]),
  };
}

function inferFilename(rawFilename, mimeType) {
  const name = normalizeInputString(rawFilename);
  if (name) return name;
  return `attachment-${uuidv4()}.${fileExtensionFromMime(mimeType)}`;
}

function normalizeInputString(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === '[undefined]' || lower === 'undefined' || lower === '[null]' || lower === 'null') {
    return '';
  }
  return trimmed;
}

function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes || new Uint8Array()); }
  catch { return ''; }
}

function extractInlineTextFromAttachment(source, mimeType, filename) {
  const mime = normalizeMimeType(mimeType);
  const isTextLike = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'text/markdown';
  if (!isTextLike) return '';
  const parsed = parseDataUrl(source);
  if (!parsed) return '';
  const text = normalizeInputString(decodeUtf8(parsed.bytes));
  if (!text) return '';
  const label = normalizeInputString(filename) || 'unnamed.txt';
  const capped = text.length > 12000 ? `${text.slice(0, 12000)}\n...[truncated]` : text;
  return `[附件文本 ${label}]\n${capped}`;
}

function normalizeContentParts(content) {
  if (typeof content === 'string') {
    return { text: normalizeInputString(content), attachments: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', attachments: [] };
  }

  const textParts = [];
  const attachments = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      const text = normalizeInputString(part);
      if (text) textParts.push(text);
      continue;
    }
    const type = part.type || '';
    if (type === 'text' || type === 'input_text') {
      const text = normalizeInputString(part.text || part.input_text);
      if (text) textParts.push(text);
      continue;
    }
    if (type === 'image_url' || type === 'input_image') {
      const source = normalizeInputString(part.image_url?.url || part.image_url || part.url || part.file_url || part.file_data);
      if (source) {
        attachments.push({ source, filename: normalizeInputString(part.filename) || normalizeInputString(part.name), mimeType: normalizeInputString(part.mime_type) || normalizeInputString(part.content_type), explicitType: 'image' });
      }
      continue;
    }
    if (type === 'file' || type === 'input_file' || type === 'audio' || type === 'input_audio' || type === 'video' || type === 'input_video') {
      const source = normalizeInputString(part.file_data || part.url || part.file_url || part.data);
      if (source) {
        const normalizedFilename = normalizeInputString(part.filename) || normalizeInputString(part.name);
        const normalizedMimeType = normalizeInputString(part.mime_type) || normalizeInputString(part.content_type);
        const explicitType = type.includes('audio') ? 'audio' : (type.includes('video') ? 'video' : undefined);
        attachments.push({ source, filename: normalizedFilename, mimeType: normalizedMimeType, explicitType });
      }
    }
  }
  return { text: textParts.join('\n'), attachments };
}

function normalizeLegacyFiles(message) {
  const result = [];
  const candidates = [...toArray(message?.attachments), ...toArray(message?.files)];
  for (const item of candidates) {
    if (!item) continue;
    const source = normalizeInputString(item.data || item.file_data || item.url || item.file_url);
    if (!source) continue;
    result.push({ source, filename: normalizeInputString(item.filename) || normalizeInputString(item.name), mimeType: normalizeInputString(item.mime_type) || normalizeInputString(item.content_type) || normalizeInputString(item.type), explicitType: item.type });
  }
  return result;
}

function parseIncomingMessages(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalized = safeMessages.map(message => {
    const parsed = normalizeContentParts(message?.content);
    return { role: message?.role || 'user', text: parsed.text, attachments: [...parsed.attachments, ...normalizeLegacyFiles(message)] };
  });

  if (normalized.length === 0) {
    return { content: '', attachments: [] };
  }

  const last = normalized[normalized.length - 1];
  const history = normalized.slice(0, -1)
    .map(m => {
      if (!m.text) return '';
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
      return `[${role}]: ${m.text}`;
    })
    .filter(Boolean)
    .join('\n\n');
  const lastText = last.text || (last.attachments.length > 0 ? '请结合附件内容回答。' : '');
  return { content: history ? `${history}\n\n[User]: ${lastText}` : lastText, attachments: last.attachments };
}

async function getAttachmentBytes(attachment) {
  const dataParsed = parseDataUrl(attachment.source);
  if (dataParsed) {
    const mimeType = attachment.mimeType || dataParsed.mimeType;
    return { bytes: dataParsed.bytes, mimeType, filename: inferFilename(attachment.filename, mimeType), explicitType: attachment.explicitType };
  }
  if (/^https?:\/\//i.test(attachment.source)) {
    const resp = await fetch(attachment.source);
    if (!resp.ok) throw new Error(`Failed to fetch attachment URL: ${resp.status}`);
    const mimeType = attachment.mimeType || resp.headers.get('content-type') || 'application/octet-stream';
    return { bytes: new Uint8Array(await resp.arrayBuffer()), mimeType, filename: inferFilename(attachment.filename, mimeType), explicitType: attachment.explicitType };
  }
  const mimeType = attachment.mimeType || 'application/octet-stream';
  return { bytes: decodeBase64ToBytes(attachment.source.replace(/\s+/g, '')), mimeType, filename: inferFilename(attachment.filename, mimeType), explicitType: attachment.explicitType };
}

async function requestUploadToken(file, baxiaTokens) {
  const filetype = inferFileCategory(file.mimeType, file.explicitType);
  const resp = await fetch('https://chat.qwen.ai/api/v2/files/getstsToken', {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': 'https://chat.qwen.ai/',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ filename: file.filename, filesize: file.bytes.length, filetype }),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.success || !data?.data?.file_url) {
    throw new Error(`Failed to get upload token: ${resp.status}`);
  }
  return { tokenData: data.data, filetype };
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatOssDate(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function formatOssDateScope(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hash));
}

async function hmacSha256(keyBytes, content) {
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

async function buildOssSignedHeaders(uploadUrlWithQuery, tokenData, file) {
  const parsedUrl = new URL(uploadUrlWithQuery);
  const query = parsedUrl.searchParams;
  const credentialFromQuery = decodeURIComponent(query.get('x-oss-credential') || '');
  const credentialParts = credentialFromQuery.split('/');
  const dateScope = credentialParts[1] || formatOssDateScope();
  const region = credentialParts[2] || 'ap-southeast-1';
  const xOssDate = query.get('x-oss-date') || formatOssDate();

  const hostParts = parsedUrl.hostname.split('.');
  const bucket = hostParts.length > 0 ? hostParts[0] : '';
  const objectPath = parsedUrl.pathname || '/';
  const canonicalUri = bucket ? `/${bucket}${objectPath}` : objectPath;
  const xOssUserAgent = 'aliyun-sdk-js/6.23.0';
  const canonicalHeaders = [
    `content-type:${file.mimeType}`,
    'x-oss-content-sha256:UNSIGNED-PAYLOAD',
    `x-oss-date:${xOssDate}`,
    `x-oss-security-token:${tokenData.security_token}`,
    `x-oss-user-agent:${xOssUserAgent}`,
  ].join('\n') + '\n';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, '', 'UNSIGNED-PAYLOAD'].join('\n');
  const credentialScope = `${dateScope}/${region}/oss/aliyun_v4_request`;
  const stringToSign = ['OSS4-HMAC-SHA256', xOssDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmacSha256(new TextEncoder().encode(`aliyun_v4${tokenData.access_key_secret}`), dateScope);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 'oss');
  const kSigning = await hmacSha256(kService, 'aliyun_v4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return {
    'Accept': '*/*',
    'Content-Type': file.mimeType,
    'authorization': `OSS4-HMAC-SHA256 Credential=${tokenData.access_key_id}/${credentialScope},Signature=${signature}`,
    'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-oss-date': xOssDate,
    'x-oss-security-token': tokenData.security_token,
    'x-oss-user-agent': xOssUserAgent,
    'Referer': 'https://chat.qwen.ai/',
  };
}

async function uploadFileToQwenOss(file, tokenData) {
  const uploadUrl = typeof tokenData.file_url === 'string' ? tokenData.file_url.split('?')[0] : '';
  if (!uploadUrl) throw new Error('Upload failed: missing upload URL');
  const signedHeaders = await buildOssSignedHeaders(tokenData.file_url, tokenData, file);
  const resp = await fetch(uploadUrl, { method: 'PUT', headers: signedHeaders, body: file.bytes });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Upload failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
}

async function parseDocumentIfNeeded(qwenFilePayload, filetype, file, baxiaTokens) {
  if (filetype !== 'document') return;
  const resp = await fetch('https://chat.qwen.ai/api/v2/files/parse', {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': 'https://chat.qwen.ai/',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ file_id: qwenFilePayload.id }),
  });
  const detail = await resp.text().catch(() => '');
  if (!resp.ok) {
    logChatDetail('netlify-edge', 'attachments.parse.document.skip', { fileId: qwenFilePayload.id, filename: file.filename, status: resp.status, detail });
    throw new Error(`Document parse failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
  let payload = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {}
  if (payload && payload.success === false) {
    logChatDetail('netlify-edge', 'attachments.parse.document.skip', { fileId: qwenFilePayload.id, filename: file.filename, status: resp.status, detail });
    throw new Error(`Document parse rejected${payload?.msg ? `: ${payload.msg}` : ''}`);
  }
  logChatDetail('netlify-edge', 'attachments.parse.document.done', { fileId: qwenFilePayload.id, filename: file.filename });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureUploadStatusForNonVideo(filetype, baxiaTokens) {
  if (filetype === 'video') return;
  const maxAttempts = 6;
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch('https://chat.qwen.ai/api/v2/users/status', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'bx-v': baxiaTokens.bxV,
        'source': 'web',
        'timezone': new Date().toUTCString(),
        'Referer': 'https://chat.qwen.ai/',
        'x-request-id': uuidv4(),
      },
      body: JSON.stringify({
        typarms: {
          typarm1: 'web',
          typarm2: '',
          typarm3: 'prod',
          typarm4: 'qwen_chat',
          typarm5: 'product',
          orgid: 'tongyi',
        }
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Upload status check failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
    }
    const payload = await resp.json().catch(() => ({}));
    lastPayload = payload;
    if (payload?.data === true) return;
    if (attempt < maxAttempts) await sleep(400);
  }
  throw new Error(`Upload status not ready for non-video file${lastPayload ? `: ${JSON.stringify(lastPayload)}` : ''}`);
}

function extractUploadedFileId(fileUrl) {
  try {
    const pathname = decodeURIComponent(new URL(fileUrl).pathname);
    const filename = pathname.split('/').pop() || '';
    if (filename.includes('_')) return filename.split('_')[0];
  } catch {}
  return uuidv4();
}

function buildQwenFilePayload(file, tokenData, filetype) {
  const now = Date.now();
  const id = normalizeInputString(tokenData?.file_id) || extractUploadedFileId(tokenData.file_url);
  const isDocument = filetype === 'document';
  const showType = isDocument ? 'file' : filetype;
  const fileClass = isDocument ? 'document' : (filetype === 'image' ? 'vision' : filetype);
  const fileSize = file.bytes.length;
  const fileMimeType = file.mimeType;
  const uploadTaskId = uuidv4();
  return {
    type: showType,
    file: {
      created_at: now,
      data: {},
      filename: file.filename,
      hash: null,
      id,
      meta: { name: file.filename, size: fileSize, content_type: fileMimeType },
      update_at: now,
    },
    id,
    url: tokenData.file_url,
    name: file.filename,
    collection_name: '',
    progress: 0,
    status: 'uploaded',
    is_uploading: false,
    error: '',
    showType,
    file_class: fileClass,
    itemId: uuidv4(),
    greenNet: 'success',
    size: fileSize,
    file_type: fileMimeType,
    uploadTaskId,
  };
}

async function uploadAttachments(attachments, baxiaTokens) {
  logChatDetail('netlify-edge', 'attachments.upload.start', { count: attachments.length });
  const files = [];
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const loaded = await getAttachmentBytes(attachment);
    logChatDetail('netlify-edge', 'attachments.upload.file.prepare', {
      index: i,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      size: loaded.bytes.length,
    });
    const { tokenData, filetype } = await requestUploadToken(loaded, baxiaTokens);
    await uploadFileToQwenOss(loaded, tokenData);
    const qwenFilePayload = buildQwenFilePayload(loaded, tokenData, filetype);
    await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, baxiaTokens);
    if (filetype === 'document') await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    files.push(qwenFilePayload);
    logChatDetail('netlify-edge', 'attachments.upload.file.done', { index: i, filetype, filename: loaded.filename });
  }
  logChatDetail('netlify-edge', 'attachments.upload.done', { uploaded: files.length });
  return files;
}

// ============================================
// 认证
// ============================================

function validateToken(authHeader, env) {
  const tokens = env.API_TOKENS ? env.API_TOKENS.split(',').filter(t => t.trim()) : [];
  if (tokens.length === 0) return true;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return tokens.includes(token);
}

// ============================================
// API Handlers
// ============================================

async function handleModels(authHeader, env) {
  if (!validateToken(authHeader, env)) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }
  try {
    const resp = await fetch('https://chat.qwen.ai/api/models', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    return jsonResponse(await resp.json());
  } catch {
    return jsonResponse({ error: { message: 'Failed to fetch models', type: 'api_error' } }, 500);
  }
}

async function handleChatCompletions(body, authHeader, env) {
  logChatDetail('netlify-edge', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  if (!validateToken(authHeader, env)) {
    logChatDetail('netlify-edge', 'request.auth.failed', {});
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true } = body;
  if (!messages?.length) {
    logChatDetail('netlify-edge', 'request.validation.failed', { reason: 'Messages are required' });
    return jsonResponse({ error: { message: 'Messages are required' } }, 400);
  }
  logChatDetail('netlify-edge', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.5-plus',
    messageCount: Array.isArray(messages) ? messages.length : 0,
  });

  const actualModel = model || 'qwen3.5-plus';
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  // 检查是否启用搜索
  const enableSearch = (env.ENABLE_SEARCH || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';
  logChatDetail('netlify-edge', 'request.config', { actualModel, chatType, enableSearch });

  // 创建会话
  const createResp = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'Referer': 'https://chat.qwen.ai/c/guest', 'source': 'web',
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      title: '新建对话', models: [actualModel], chat_mode: 'guest', chat_type: chatType,
      timestamp: Date.now(), project_id: ''
    })
  });
  const createData = await createResp.json();
  logChatDetail('netlify-edge', 'chat.create.response', {
    status: createResp.status,
    success: !!createData?.success,
    hasChatId: !!createData?.data?.id,
  });
  if (!createData.success || !createData.data?.id) {
    return jsonResponse({ error: { message: 'Failed to create chat session', details: createData } }, 500);
  }
  const chatId = createData.data.id;

  const parsedMessages = parseIncomingMessages(messages);
  const content = parsedMessages.content;
  logChatDetail('netlify-edge', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  const uploadedFiles = parsedMessages.attachments.length > 0
    ? await uploadAttachments(parsedMessages.attachments, { bxUa, bxUmidToken, bxV })
    : [];
  logChatDetail('netlify-edge', 'message.ready', { uploadedFileCount: uploadedFiles.length });

  // 发送请求
  const chatResp = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'source': 'web', 'version': '0.2.9', 'Referer': 'https://chat.qwen.ai/c/guest', 'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      stream: true, version: '2.1', incremental_output: true,
      chat_id: chatId, chat_mode: 'guest', model: actualModel, parent_id: null,
      messages: [{
        fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content,
        user_action: 'chat', files: uploadedFiles, timestamp: Date.now(), models: [actualModel], chat_type: chatType,
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_format: 'summary', auto_search: enableSearch },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    logChatDetail('netlify-edge', 'chat.completion.error', { status: chatResp.status, chatId });
    return jsonResponse({ error: { message: await chatResp.text() } }, chatResp.status);
  }
  logChatDetail('netlify-edge', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 流式响应 - 使用 TransformStream 实现真正的流式输出
  if (stream) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    
    // 后台处理流
    (async () => {
      const reader = chatResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              await writer.write(encoder.encode('data: [DONE]\n\n'));
              continue;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                const chunk = {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created,
                  model: actualModel,
                  choices: [{
                    index: 0,
                    delta: { content: parsed.choices[0].delta.content },
                    finish_reason: parsed.choices[0].finish_reason || null
                  }]
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              } else if (parsed.choices?.[0]?.finish_reason) {
                const chunk = {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created,
                  model: actualModel,
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: parsed.choices[0].finish_reason
                  }]
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } catch {}
          }
        }
        
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } finally {
        await writer.close();
      }
    })();
    logChatDetail('netlify-edge', 'stream.proxy.started', { chatId, model: actualModel });
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 非流式响应 - 收集完整内容
  const reader = chatResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.choices?.[0]?.delta?.content) chunks.push(parsed.choices[0].delta.content);
    } catch {}
  }
  logChatDetail('netlify-edge', 'chat.completion.collected', {
    chunkCount: chunks.length,
    outputLength: chunks.join('').length,
  });

  return jsonResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

// ============================================
// Edge Handler 入口
// ============================================

export default async function handler(request, context) {
  const env = context.env || {};
  globalThis.__CHAT_DETAIL_LOG = env.CHAT_DETAIL_LOG || '';
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 
        'Access-Control-Allow-Headers': 'Content-Type, Authorization' 
      }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const authHeader = request.headers.get('Authorization') || '';

  if (request.method === 'GET' && path.includes('/v1/models')) {
    return handleModels(authHeader, env);
  }
  if (request.method === 'POST' && path.includes('/v1/chat/completions')) {
    return handleChatCompletions(await request.json(), authHeader, env);
  }
  if (request.method === 'GET' && (path === '/chat' || path === '/chat/')) {
    return handleChatPage();
  }
  if (request.method === 'GET' && (path === '/' || path === '')) {
    return new Response('<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>', { headers: { 'Content-Type': 'text/html' } });
  }
  return jsonResponse({ error: { message: 'Not found' } }, 404);
}

export const config = {
  path: "/*",
  excludedPath: ["/.netlify/*"]
};
