/**
 * Vercel Edge Runtime 入口 - 支持真正的流式输出
 */

export const config = {
  runtime: 'edge',
};

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
    const bodyText = await resp.text();
    // wu.json body: try{umx.wu('T2gA...');}catch(e){} try{__fycb('T2gA...');}catch(e){}
    // The token inside is the real umid token required by the upstream API.
    const m = bodyText.match(/umx\.wu\('([^']+)'\)/) || bodyText.match(/'([^']+)'/);
    bxUmidToken = (m && m[1]) || resp.headers.get('etag') || '';
  } catch { bxUmidToken = ''; }
  if (!bxUmidToken || !/^T2gA/i.test(bxUmidToken)) {
    bxUmidToken = 'T2gA' + randomString(40);
  }
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

function tryParseOpenAiImageSize(size) {
  const text = normalizeInputString(size);
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d{2,5})\s*x\s*(\d{2,5})$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function mapOpenAiImageSizeToQwenRatio(size) {
  const ratio = tryParseRatioString(size);
  if (ratio) {
    const validRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    if (validRatios.includes(ratio)) return ratio;
  }
  const parsed = tryParseOpenAiImageSize(size);
  if (!parsed) return '1:1';
  const { width, height } = parsed;
  const r = width / height;
  const candidates = [
    { key: '1:1', r: 1 },
    { key: '16:9', r: 16 / 9 },
    { key: '9:16', r: 9 / 16 },
    { key: '4:3', r: 4 / 3 },
    { key: '3:4', r: 3 / 4 },
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(r - c.r);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best.key;
}

function extractImageUrlsFromUpstreamSse(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  const urls = [];
  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta || typeof delta !== 'object') continue;
      const phase = typeof delta.phase === 'string' ? delta.phase : '';
      if (phase !== 'image_gen') continue;
      const content = delta.content;
      if (typeof content !== 'string') continue;
      const url = content.trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      urls.push(url);
    } catch {}
  }
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function safeReadJson(response) {
  const status = response?.status;
  const rawText = await response.text().catch(() => '');
  if (!rawText) {
    return { ok: false, status, data: null, rawText: '', parseError: new Error('Empty response body') };
  }
  try {
    return { ok: true, status, data: JSON.parse(rawText), rawText, parseError: null };
  } catch (parseError) {
    return { ok: false, status, data: null, rawText, parseError };
  }
}

function extractUpstreamErrorFromSse(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const err = parsed?.error;
      if (err && err.code === 'data_inspection_failed') {
        return { message: err.details || err.message || '内容安全警告', code: err.code };
      }
    } catch {}
  }
  return null;
}

// Upstream risk-control returns HTTP 200 with an Aliyun punish payload like:
// {"rgv587_flag":"sm","url":"https://bixi.alicdn.com/punish/...?...&action=deny&pureDenyWait="}
// Surface the upstream content as a readable error instead of a silent "HTTP 200".
function tryParseRiskControlPayload(rawText) {
  const text = typeof rawText === 'string' ? rawText : '';
  const firstChar = text.trimStart().charAt(0);
  if (firstChar !== '{' && firstChar !== '[') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const punishUrl = typeof parsed.url === 'string' && /punish|action=deny|pureDenyWait/i.test(parsed.url) ? parsed.url : '';
  const hasRiskFlag = typeof parsed.rgv587_flag === 'string' || typeof parsed['rgv-flag'] === 'string';
  if (!hasRiskFlag && !punishUrl) return null;

  let message = '';
  if (typeof parsed.details === 'string' && parsed.details) message = parsed.details;
  else if (typeof parsed.message === 'string' && parsed.message) message = parsed.message;
  else if (typeof parsed.error === 'string' && parsed.error) message = parsed.error;
  else if (punishUrl) message = punishUrl;
  if (!message) message = text;
  return { message, code: parsed.rgv587_flag || 'rgv587', type: 'api_error', riskControlled: true };
}

function tryParseUpstreamErrorPayload(rawText) {
  const risk = tryParseRiskControlPayload(rawText);
  if (risk) return risk;
  const text = typeof rawText === 'string' ? rawText : '';
  const firstChar = text.trimStart().charAt(0);
  if (firstChar !== '{' && firstChar !== '[') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  if (Array.isArray(parsed.ret)) {
    const parts = parsed.ret.filter(p => typeof p === 'string' && p);
    if (parts.length > 0) {
      const code = parts[0];
      const message = parts.slice(1).filter(Boolean).join(' | ') || code;
      return { message, code, type: 'api_error' };
    }
  }

  if (parsed.success === false) {
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    const message = data.details || data.message || data.msg || data.code || 'Upstream request failed';
    return { message, code: data.code, type: 'api_error' };
  }

  if (parsed.error && typeof parsed.error === 'object') {
    return {
      message: parsed.error.message || 'Upstream request failed',
      code: parsed.error.code,
      type: parsed.error.type || 'api_error',
    };
  }

  return null;
}

function bytesToBase64(bytes) {
  // btoa expects a binary string
  let out = '';
  let chunk = '';
  for (let i = 0; i < bytes.length; i++) {
    chunk += String.fromCharCode(bytes[i]);
    if (chunk.length > 0x8000) {
      out += btoa(chunk);
      chunk = '';
    }
  }
  if (chunk) out += btoa(chunk);
  return out;
}

function handleChatPage() {
  const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Qwen2API Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light;
      --page-bg: #f6f7fb;
      --ink: #0f172a;
      --muted: #475569;
      --panel: rgba(255, 255, 255, 0.88);
      --panel-2: rgba(255, 255, 255, 0.72);
      --border: rgba(15, 23, 42, 0.10);
      --shadow: 0 18px 42px rgba(15, 23, 42, 0.10);
      --shadow-soft: 0 10px 24px rgba(15, 23, 42, 0.08);
      --ring: 0 0 0 4px rgba(14, 165, 164, 0.18);
      --accent: #0ea5a4;
      --accent-2: #16a34a;
      --danger: #ef4444;
      --radius: 14px;
      --radius-sm: 10px;
      --empty-hint: "开始对话吧。支持粘贴文本、上传文件，Enter 发送。";
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(1200px 700px at 15% 10%, rgba(14, 165, 164, 0.14), transparent 55%),
        radial-gradient(900px 520px at 85% 20%, rgba(34, 197, 94, 0.10), transparent 60%),
        radial-gradient(1000px 600px at 50% 100%, rgba(56, 189, 248, 0.10), transparent 55%),
        var(--page-bg);
      font-family: "Noto Sans SC", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.1px;
    }

    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 18px 14px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 100vh;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(10px);
    }

    .topbar {
      padding: 12px;
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 150px;
    }
    .brand b {
      font-family: "Space Grotesk", "Noto Sans SC", sans-serif;
      font-size: 16px;
      letter-spacing: 0.3px;
    }
    .brand span {
      color: var(--muted);
      font-size: 12px;
    }

    .controls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .controls .grow { flex: 1; min-width: 160px; }

    input, select, textarea, button {
      font: inherit;
      border-radius: 12px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      background: rgba(255, 255, 255, 0.75);
      color: var(--ink);
      outline: none;
    }

    input, select, button { padding: 10px 11px; }
    textarea { padding: 12px 12px; width: 100%; min-height: 96px; resize: vertical; }

    input:focus, select:focus, textarea:focus { box-shadow: var(--ring); border-color: rgba(14, 165, 164, 0.55); }
    button { cursor: pointer; transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
    button:disabled { cursor: not-allowed; opacity: 0.6; }
    button:active:not(:disabled) { transform: translateY(1px); }

    .btn {
      background: rgba(255, 255, 255, 0.75);
    }
    .primary {
      background: linear-gradient(135deg, #0ea5a4, #22c55e);
      color: #ffffff;
      border-color: rgba(14, 165, 164, 0.55);
      box-shadow: 0 10px 22px rgba(14, 165, 164, 0.18);
    }
    .primary:hover:not(:disabled) { box-shadow: 0 14px 28px rgba(14, 165, 164, 0.22); }
    .warn {
      background: rgba(239, 68, 68, 0.10);
      color: #991b1b;
      border-color: rgba(239, 68, 68, 0.35);
    }
    .warn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.14); }

    .log-toggle {
      background: rgba(15, 23, 42, 0.06);
      border-color: rgba(15, 23, 42, 0.14);
    }
    .log-toggle.active {
      background: rgba(14, 165, 164, 0.12);
      border-color: rgba(14, 165, 164, 0.35);
    }

    .shell {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      align-items: stretch;
      min-height: 58vh;
    }

    .shell.has-logs { grid-template-columns: 1fr; }
    @media (min-width: 981px) {
      .shell.has-logs { grid-template-columns: 1fr 360px; }
    }

    #messages {
      padding: 14px;
      overflow: auto;
      min-height: 56vh;
      max-height: 62vh;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #messages:empty::before {
      content: var(--empty-hint);
      color: rgba(71, 85, 105, 0.9);
      background: rgba(255, 255, 255, 0.55);
      border: 1px dashed rgba(15, 23, 42, 0.18);
      border-radius: 14px;
      padding: 14px 14px;
      line-height: 1.5;
    }

    .msg {
      max-width: min(760px, 92%);
      padding: 10px 12px;
      border-radius: 16px;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      border: 1px solid rgba(15, 23, 42, 0.10);
      animation: popIn 220ms ease both;
    }
    .msg.u {
      align-self: flex-end;
      background: linear-gradient(135deg, rgba(14, 165, 164, 0.12), rgba(34, 197, 94, 0.10));
    }
    .msg.a {
      align-self: flex-start;
      background: rgba(255, 255, 255, 0.72);
    }
    .msg-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      font-size: 12px;
      color: rgba(71, 85, 105, 0.92);
    }
    .msg-head span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .think {
      border: 1px solid rgba(15, 23, 42, 0.10);
      background: rgba(15, 23, 42, 0.035);
      border-radius: 12px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .think summary {
      cursor: pointer;
      font-size: 12px;
      color: rgba(71, 85, 105, 0.92);
      user-select: none;
      list-style: none;
    }
    .think summary::-webkit-details-marker { display: none; }
    .think summary::before {
      content: "▸";
      display: inline-block;
      margin-right: 6px;
      transform: translateY(-1px);
    }
    .think[open] summary::before { content: "▾"; }
    .think pre {
      margin: 8px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.55;
      color: rgba(71, 85, 105, 0.96);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    }
    .mini {
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      background: rgba(15, 23, 42, 0.06);
      border-color: rgba(15, 23, 42, 0.10);
    }
    .mini:hover:not(:disabled) { background: rgba(15, 23, 42, 0.08); }

    .composer {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .video-panel { padding: 12px; }
    .action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .file {
      flex: 1;
      min-width: 220px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.55);
    }
    .file::file-selector-button {
      font: inherit;
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      background: rgba(15, 23, 42, 0.05);
      margin-right: 10px;
      cursor: pointer;
    }
    .file::file-selector-button:hover { background: rgba(15, 23, 42, 0.08); }

    .status {
      font-size: 12px;
      min-height: 18px;
      color: rgba(71, 85, 105, 0.95);
    }
    .status.err { color: #b91c1c; }
    .status.ok { color: #047857; }

    #atts { display: grid; gap: 8px; }
    .fi {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px 10px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.62);
    }
    .fi button {
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(239, 68, 68, 0.10);
      color: #991b1b;
      border-color: rgba(239, 68, 68, 0.28);
    }

    .log-panel { display: none; padding: 12px; }
    .log-panel.visible {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .log-header span {
      font-family: "Space Grotesk", "Noto Sans SC", sans-serif;
      font-weight: 600;
      letter-spacing: 0.2px;
    }

    .video-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .video-tag {
      font-size: 12px;
      color: rgba(71, 85, 105, 0.95);
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      background: rgba(255, 255, 255, 0.55);
      white-space: nowrap;
    }
    .video-row input {
      flex: 1;
      min-width: 220px;
      font-size: 12px;
      padding: 10px 10px;
    }
    .video-clear {
      padding: 10px 12px;
      font-size: 12px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.06);
      border-color: rgba(15, 23, 42, 0.12);
    }

    #logs {
      flex: 1;
      min-height: 46vh;
      max-height: 56vh;
      overflow: auto;
      font-size: 12px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      background:
        radial-gradient(900px 450px at 20% 10%, rgba(14, 165, 164, 0.14), transparent 60%),
        radial-gradient(800px 420px at 80% 30%, rgba(34, 197, 94, 0.10), transparent 60%),
        #0b1220;
      color: rgba(226, 232, 240, 0.92);
      border-radius: var(--radius-sm);
      border: 1px solid rgba(148, 163, 184, 0.20);
      padding: 10px 10px;
    }
    .log-entry { padding: 3px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.16); }
    .log-entry:last-child { border-bottom: none; }
    .log-time { color: rgba(34, 197, 94, 0.85); margin-right: 8px; }
    .log-event { color: rgba(56, 189, 248, 0.95); font-weight: 600; }
    .log-detail { color: rgba(251, 191, 36, 0.88); margin-left: 8px; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      z-index: 999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: popIn 200ms ease;
    }
    .modal {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-width: 480px;
      width: 100%;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      backdrop-filter: blur(10px);
    }
    .modal h3 {
      margin: 0;
      font-family: "Space Grotesk", "Noto Sans SC", sans-serif;
      font-size: 16px;
      letter-spacing: 0.2px;
    }
    .modal .field-label {
      font-size: 12px;
      color: var(--muted);
    }
    .modal .hint {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.5;
    }
    .modal .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    @keyframes popIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .msg { animation: none; }
      button { transition: none; }
    }

    @media (max-width: 980px) {
      .shell.has-logs { grid-template-columns: 1fr; }
      #messages { max-height: 56vh; }
      #logs { max-height: 44vh; }
      .brand { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header class="panel topbar">
      <div class="brand">
        <b>Qwen2API Chat</b>
        <span id="brandSub">轻量 · 流式 · 支持附件</span>
      </div>
      <div class="controls">
        <button id="langToggle" class="btn" type="button" aria-label="Language">EN</button>
        <input id="apiKey" class="grow" type="text" placeholder="API Key（可选）" autocomplete="off" spellcheck="false" />
        <select id="model" class="grow"><option value="qwen3.8-max">qwen3.8-max</option></select>
        <button id="refreshModels" class="btn" type="button">刷新模型</button>
        <button id="logToggle" class="log-toggle" type="button">显示日志</button>
        <button id="settingsBtn" class="btn" type="button">设置</button>
      </div>
    </header>

    <section class="panel video-panel" aria-label="视频分析">
      <div class="video-row">
        <span class="video-tag" id="videoTag">视频分析（可选）</span>
        <input id="videoUrl" type="text" placeholder="粘贴视频链接；发送时自动进入视频分析；留空则普通对话" autocomplete="off" spellcheck="false" />
        <button id="clearVideo" class="video-clear" type="button">清空</button>
      </div>
    </section>

    <section class="panel video-panel" aria-label="图片生成">
      <div class="video-row">
        <select id="imageGenMode" style="flex: 0 0 auto; min-width: 120px;">
          <option value="chat">聊天模式</option>
          <option value="image">图片生成</option>
        </select>
        <select id="imageSize" style="flex: 0 0 auto; min-width: 120px;">
          <option value="1:1">1:1 (正方形)</option>
          <option value="16:9">16:9 (宽屏)</option>
          <option value="9:16">9:16 (竖屏)</option>
          <option value="4:3">4:3 (传统)</option>
          <option value="3:4">3:4 (传统竖)</option>
        </select>
        <select id="imageCount" style="flex: 0 0 auto; min-width: 80px;">
          <option value="1">1张</option>
          <option value="2">2张</option>
          <option value="3">3张</option>
          <option value="4">4张</option>
          <option value="5">5张</option>
        </select>
      </div>
    </section>

    <div class="shell" id="shell">
      <section id="messages" class="panel" aria-label="消息列表"></section>

      <aside class="panel log-panel" id="logPanel" aria-label="运行日志">
        <div class="log-header">
          <span id="logsTitle">运行日志</span>
          <button id="clearLogs" type="button" class="mini">清空</button>
        </div>
        <div id="logs"></div>
      </aside>
    </div>

    <section class="panel composer" aria-label="输入区">
      <textarea id="prompt" placeholder="输入消息；Enter 发送，Shift+Enter 换行"></textarea>
      <div class="action-row">
        <input id="files" class="file" type="file" multiple accept=".pdf,.doc,.docx,.dot,.csv,.xlsx,.xls,.txt,.text,.md,.js,.mjs,.ts,.jsx,.tsx,.vue,.html,.htm,.css,.svg,.svgz,.xml,.json,.jsonc,.wasm,.tex,.latex,.c,.h,.cc,.cxx,.cpp,.hpp,.hh,.hxx,.ino,.java,.kt,.kts,.scala,.groovy,.go,.rs,.swift,.php,.rb,.cs,.vb,.fs,.csproj,.sln,.sql,.lua,.r,.pl,.tcl,.awk,.fish,.yaml,.yml,.toml,.ini,.sh,.bat,.cmd,.dockerfile,.containerfile,.proto,.thrift,.graphql,.gql,.qmd,.smali,.gif,.webp,.jpg,.jpeg,.png,.bmp,.icns,.jp2,.sgi,.tif,.tiff,.mkv,.mov,.wav,.mp3,.m4a,.amr,.aac,image/*,audio/*,video/*" />
        <button id="send" class="primary" type="button">发送</button>
        <button id="stop" class="btn" type="button" disabled>中断</button>
        <button id="clear" class="warn" type="button">清空会话</button>
      </div>
      <div id="atts"></div>
      <div id="status" class="status"></div>
    </section>
    
    <footer style="text-align: center; padding: 16px; margin-top: 8px;">
      <a href="https://github.com/smanx/qwen2api" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--muted); font-size: 14px; padding: 10px 16px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel); transition: all 140ms ease;">
        <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        <span>GitHub</span>
      </a>
    </footer>
  </main>
  <script>
    (function () {
      var MAX = 5;
      var MAX_SIZE = 100 * 1024 * 1024;
      var MAX_HISTORY = 80;
      var MAX_HISTORY_TEXT_CHARS = 12000;
      var MAX_LOG_ENTRIES = 300;
      var MAX_LOG_RAW_PREVIEW = 300;
      var KEY = 'qwen2api.chat.history.v1';
      var VIDEO_URL_KEY = 'qwen2api.video.url.v1';
      var SHOW_LOGS_KEY = 'qwen2api.chat.showLogs.v1';
      var MODEL_KEY = 'qwen2api.chat.model.v1';
      var LANG_KEY = 'qwen2api.chat.lang.v1';
      var IMAGE_PROXY_KEY = 'qwen2api.chat.imageProxy.v1';
      var state = { hist: [], files: [], ac: null, sending: false, showLogs: false, videoUrl: '', modelLoadId: 0, modelLoading: false, preferredModel: '', lastModelAuthKey: null, imageGenMode: 'chat', imageProxy: '' };
      var API_BASE = (function () {
        var p = (location && location.pathname) ? location.pathname : '';
        if (p === '/.netlify/functions/api' || p.indexOf('/.netlify/functions/api/') === 0) return '/.netlify/functions/api';
        if (p === '/api' || p.indexOf('/api/') === 0) return '/api';
        return '';
      })();
      function apiUrl(path) {
        return API_BASE ? (API_BASE + path) : path;
      }

      var e = {
        shell: document.getElementById('shell'),
        langToggle: document.getElementById('langToggle'),
        apiKey: document.getElementById('apiKey'),
        model: document.getElementById('model'),
        refreshModels: document.getElementById('refreshModels'),
        clear: document.getElementById('clear'),
        logToggle: document.getElementById('logToggle'),
        settingsBtn: document.getElementById('settingsBtn'),
        logPanel: document.getElementById('logPanel'),
        logs: document.getElementById('logs'),
        clearLogs: document.getElementById('clearLogs'),
        videoUrl: document.getElementById('videoUrl'),
        clearVideo: document.getElementById('clearVideo'),
        messages: document.getElementById('messages'),
        prompt: document.getElementById('prompt'),
        files: document.getElementById('files'),
        atts: document.getElementById('atts'),
        send: document.getElementById('send'),
        stop: document.getElementById('stop'),
        status: document.getElementById('status'),
        imageGenMode: document.getElementById('imageGenMode'),
        imageSize: document.getElementById('imageSize'),
        imageCount: document.getElementById('imageCount')
      };

      function getPreferredLang() {
        var v = '';
        try { v = localStorage.getItem(LANG_KEY) || ''; } catch (_) {}
        v = String(v || '').toLowerCase();
        if (v === 'en' || v === 'zh') return v;
        try {
          var nav = (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) || '';
          nav = String(nav || '').toLowerCase();
          if (nav.indexOf('zh') === 0) return 'zh';
        } catch (_) {}
        return 'en';
      }

      function t(key) {
        var L = state.lang || 'zh';
        var dict = {
          zh: {
            brandSub: '轻量 · 流式 · 支持附件',
            apiKeyPh: 'API Key（可选）',
            refreshModels: '刷新模型',
            refreshModelsLoading: '加载中...',
            showLogs: '显示日志',
            hideLogs: '隐藏日志',
            clearChat: '清空会话',
            logsTitle: '运行日志',
            clear: '清空',
            videoTag: '视频分析（可选）',
            videoPh: '粘贴视频链接；发送时自动进入视频分析；留空则普通对话',
            inputPh: '输入消息；Enter 发送，Shift+Enter 换行',
            send: '发送',
            sending: '发送中...',
            stop: '中断',
            stopping: '中断中...',
            retry: '重发',
            assistant: '助手',
            user: '用户',
            think: '思考过程',
            emptyAssistant: '（空响应）',
            attachMsg: '[附件消息]',
            attachPrefix: '[附件] ',
            emptyHint: '开始对话吧。支持粘贴文本、上传文件，Enter 发送。'
            ,ready: '就绪。'
            ,loadingModels: '正在加载模型列表...'
            ,modelsUpdated: '模型列表已更新（{n}）'
            ,modelsLoadingWait: '模型列表加载中，请稍候。'
            ,modelsLoadingWaitSend: '模型列表加载中，请稍候发送。'
            ,resendWait: '模型列表加载中，请稍候重发。'
            ,onlyResendUser: '仅支持重发用户消息。'
            ,historySimplified: '历史附件已简化，已回退为文本重发。'
            ,inputOrFileRequired: '请输入内容或选择附件。'
            ,processingAttachments: '正在处理附件...'
            ,attachmentsFailed: '附件处理失败'
            ,requestingChat: '请求中（流式）...'
            ,requestingLogs: '请求中（日志）...'
            ,requestingVideo: '请求中（视频分析）...'
            ,requestingVideoLogs: '请求中（视频分析 + 日志）...'
            ,done: '完成。'
            ,aborted: '已中断请求。'
            ,abortInProgress: '正在中断请求...'
            ,noActiveRequest: '当前没有进行中的请求。'
            ,busyNoDoubleSend: '请求进行中，请勿重复发送。'
            ,maxAttachments: '最多允许 {n} 个附件。'
            ,fileTooLarge: '文件过大：{name}（上限 {max}）'
            ,addedAttachments: '已选择 {n} 个附件。'
            ,addedAndSkipped: '已添加 {added} 个附件，跳过 {skipped} 个重复/无效附件。'
            ,addedNoneSkipped: '未新增附件（均为重复或无效文件）。'
            ,videoUrlInvalid: '视频链接需以 http:// 或 https:// 开头。'
            ,videoSet: '已设置视频链接：发送时将自动进入视频分析。'
            ,videoCleared: '已清空视频链接：将恢复普通对话。'
            ,videoRestored: '已恢复上次视频链接。'
            ,logsClearBusy: '请求进行中，暂不能清空日志。'
            ,logsClearBusyModels: '模型列表加载中，请稍候清空日志。'
            ,logsCleared: '日志已清空。'
            ,logsAlreadyEmpty: '日志已为空。'
            ,clearChatBusy: '请求进行中，暂不能清空会话。'
            ,clearChatBusyModels: '模型列表加载中，请稍候清空会话。'
            ,chatCleared: '会话已清空。'
            ,chatAlreadyEmpty: '会话已为空。'
            ,refreshModelsBusy: '请求进行中，暂不能刷新模型。'
            ,loadingModelsStatus: '正在加载模型列表...'
            ,requestFailed: '请求失败'
            ,abortedTag: '[已中断]'
            ,errorTag: '[错误]'
            ,fileReadFailed: '读取文件失败: {name}'
            ,attachmentRemoveBusy: '请求进行中，暂不能修改附件。'
            ,attachmentRemoveBusyModels: '模型列表加载中，请稍候再修改附件。'
            ,remove: '移除'
            ,modelsLoadFailedFallback: '加载模型失败，已回退默认模型。'
            ,authFailed: '鉴权失败：Incorrect API key provided.'
            ,payloadTooLarge: '请求体过大，请减小附件。'
            ,serverError: '服务端异常，请稍后重试。'
            ,settings: '设置'
            ,imageProxy: '图片代理前缀'
            ,imageProxyPh: '例如：https://proxy.example.com/?url='
            ,imageProxyHint: '设置后，图片链接会直接拼接到该代理地址之后。留空则不使用代理。'
            ,save: '保存'
            ,cancel: '取消'
            ,clearProxy: '清除代理'
            ,imageProxySet: '图片代理已设置。'
            ,imageProxyCleared: '图片代理已清除。'
          },
          en: {
            brandSub: 'Light · Streaming · Attachments',
            apiKeyPh: 'API key (optional)',
            refreshModels: 'Refresh models',
            refreshModelsLoading: 'Loading...',
            showLogs: 'Show logs',
            hideLogs: 'Hide logs',
            clearChat: 'Clear chat',
            logsTitle: 'Runtime logs',
            clear: 'Clear',
            videoTag: 'Video analysis (optional)',
            videoPh: 'Paste a video URL; sending will trigger video analysis; empty = normal chat',
            inputPh: 'Type a message; Enter to send, Shift+Enter for newline',
            send: 'Send',
            sending: 'Sending...',
            stop: 'Stop',
            stopping: 'Stopping...',
            retry: 'Resend',
            assistant: 'Assistant',
            user: 'User',
            think: 'Thinking',
            emptyAssistant: '(empty response)',
            attachMsg: '[Attachment message]',
            attachPrefix: '[Attachments] ',
            emptyHint: 'Start chatting. Paste text, upload files, press Enter to send.'
            ,ready: 'Ready.'
            ,loadingModels: 'Loading model list...'
            ,modelsUpdated: 'Model list updated ({n})'
            ,modelsLoadingWait: 'Model list is loading, please wait.'
            ,modelsLoadingWaitSend: 'Model list is loading, please wait before sending.'
            ,resendWait: 'Model list is loading, please wait before resending.'
            ,onlyResendUser: 'Only user messages can be resent.'
            ,historySimplified: 'Attachments in history were simplified; falling back to text resend.'
            ,inputOrFileRequired: 'Type a message or choose attachments.'
            ,processingAttachments: 'Processing attachments...'
            ,attachmentsFailed: 'Failed to process attachments'
            ,requestingChat: 'Requesting (streaming)...'
            ,requestingLogs: 'Requesting (logs)...'
            ,requestingVideo: 'Requesting (video analysis)...'
            ,requestingVideoLogs: 'Requesting (video + logs)...'
            ,done: 'Done.'
            ,aborted: 'Request aborted.'
            ,abortInProgress: 'Aborting request...'
            ,noActiveRequest: 'No active request.'
            ,busyNoDoubleSend: 'Request in progress. Please do not send again.'
            ,maxAttachments: 'Up to {n} attachments.'
            ,fileTooLarge: 'File too large: {name} (limit {max})'
            ,addedAttachments: '{n} attachments selected.'
            ,addedAndSkipped: 'Added {added} attachments, skipped {skipped} duplicates/invalid.'
            ,addedNoneSkipped: 'No new attachments (all duplicates/invalid).'
            ,videoUrlInvalid: 'Video URL must start with http:// or https://'
            ,videoSet: 'Video URL set: sending will trigger video analysis.'
            ,videoCleared: 'Video URL cleared: normal chat mode.'
            ,videoRestored: 'Restored previous video URL.'
            ,logsClearBusy: 'Request in progress; cannot clear logs.'
            ,logsClearBusyModels: 'Model list is loading; cannot clear logs yet.'
            ,logsCleared: 'Logs cleared.'
            ,logsAlreadyEmpty: 'Logs are already empty.'
            ,clearChatBusy: 'Request in progress; cannot clear chat.'
            ,clearChatBusyModels: 'Model list is loading; cannot clear chat yet.'
            ,chatCleared: 'Chat cleared.'
            ,chatAlreadyEmpty: 'Chat is already empty.'
            ,refreshModelsBusy: 'Request in progress; cannot refresh models.'
            ,loadingModelsStatus: 'Loading model list...'
            ,requestFailed: 'Request failed'
            ,abortedTag: '[ABORTED]'
            ,errorTag: '[ERROR]'
            ,fileReadFailed: 'Failed to read file: {name}'
            ,attachmentRemoveBusy: 'Request in progress; attachments cannot be modified.'
            ,attachmentRemoveBusyModels: 'Model list is loading; attachments cannot be modified yet.'
            ,remove: 'Remove'
            ,modelsLoadFailedFallback: 'Failed to load models; fell back to default model.'
            ,authFailed: 'Auth failed: Incorrect API key provided.'
            ,payloadTooLarge: 'Request body too large; please reduce attachments.'
            ,serverError: 'Server error; please try again later.'
            ,settings: 'Settings'
            ,imageProxy: 'Image proxy prefix'
            ,imageProxyPh: 'e.g. https://proxy.example.com/?url='
            ,imageProxyHint: 'When set, image URLs are prepended with this proxy. Leave empty to disable.'
            ,save: 'Save'
            ,cancel: 'Cancel'
            ,clearProxy: 'Clear proxy'
            ,imageProxySet: 'Image proxy set.'
            ,imageProxyCleared: 'Image proxy cleared.'
          }
        };
        return (dict[L] && dict[L][key]) || (dict.zh && dict.zh[key]) || key;
      }

      function tf(key, params) {
        var s = String(t(key) || '');
        var p = params && typeof params === 'object' ? params : {};
        return s.replace(/\{(\w+)\}/g, function (_, k) { return (p[k] !== undefined && p[k] !== null) ? String(p[k]) : ''; });
      }

      function applyLangToUI() {
        document.documentElement.setAttribute('lang', state.lang === 'en' ? 'en' : 'zh-CN');
        try { document.documentElement.style.setProperty('--empty-hint', '"' + String(t('emptyHint')).replace(/"/g, '\\"') + '"'); } catch (_) {}
        if (e.langToggle) e.langToggle.textContent = state.lang === 'en' ? '中文' : 'EN';

        var brandSub = document.getElementById('brandSub');
        if (brandSub) brandSub.textContent = t('brandSub');

        if (e.apiKey) e.apiKey.placeholder = t('apiKeyPh');
        if (e.refreshModels) e.refreshModels.textContent = state.modelLoading ? t('refreshModelsLoading') : t('refreshModels');
        if (e.clear) e.clear.textContent = t('clearChat');
        if (e.clearLogs) e.clearLogs.textContent = t('clear');
        if (e.videoUrl) e.videoUrl.placeholder = t('videoPh');
        var videoTagEl = document.getElementById('videoTag');
        if (videoTagEl) videoTagEl.textContent = t('videoTag');
        if (e.clearVideo) e.clearVideo.textContent = t('clear');
        var logsTitle = document.getElementById('logsTitle');
        if (logsTitle) logsTitle.textContent = t('logsTitle');
        if (e.prompt) e.prompt.placeholder = t('inputPh');
        if (e.send) e.send.textContent = state.sending ? t('sending') : t('send');
        if (e.stop) e.stop.textContent = (state.ac && state.stop.disabled) ? t('stopping') : t('stop');

        if (e.logToggle) {
          e.logToggle.textContent = state.showLogs ? t('hideLogs') : t('showLogs');
        }

        if (e.settingsBtn) e.settingsBtn.textContent = t('settings');

        rHist();
      }

      function setLang(next) {
        var v = String(next || '').toLowerCase();
        if (v !== 'en' && v !== 'zh') v = 'zh';
        state.lang = v;
        try { localStorage.setItem(LANG_KEY, v); } catch (_) {}
        applyLangToUI();
      }

      // state/history
      function st(t, k) { e.status.textContent = t || ''; e.status.className = 'status ' + (k || ''); }
      function compactMessageContentForStorage(content) {
        if (typeof content === 'string') {
          if (content.length > MAX_HISTORY_TEXT_CHARS) return content.slice(0, MAX_HISTORY_TEXT_CHARS) + '\n\n[TRUNCATED]';
          return content;
        }
        return summarizeMessageContent(content);
      }
      function compactHistoryForStorage(list) {
        var source = Array.isArray(list) ? list : [];
        var out = [];
        for (var i = 0; i < source.length; i++) {
          var item = source[i] || {};
          out.push({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: compactMessageContentForStorage(item.content)
          });
        }
        return out;
      }
      function persistHistoryWithFallback(kept) {
        var list = compactHistoryForStorage(kept);
        for (var start = 0; start <= list.length; start++) {
          try {
            localStorage.setItem(KEY, JSON.stringify(list.slice(start)));
            return;
          } catch (_) {}
        }
      }
      function save() {
        var kept = [];
        try {
          kept = state.hist.filter(function (x) {
            if (!x) return false;
            if (typeof x.content === 'string') return !!x.content.trim();
            return Array.isArray(x.content) && x.content.length > 0;
          }).slice(-MAX_HISTORY);
        } catch (_) {}
        try { persistHistoryWithFallback(kept); } catch (_) {}
        try {
          if (state.videoUrl) localStorage.setItem(VIDEO_URL_KEY, state.videoUrl);
          else localStorage.removeItem(VIDEO_URL_KEY);
          localStorage.setItem(SHOW_LOGS_KEY, state.showLogs ? '1' : '0');
          if (state.preferredModel) localStorage.setItem(MODEL_KEY, state.preferredModel);
          else localStorage.removeItem(MODEL_KEY);
          if (state.imageProxy) localStorage.setItem(IMAGE_PROXY_KEY, state.imageProxy);
          else localStorage.removeItem(IMAGE_PROXY_KEY);
        } catch (_) {}
      }
      function load() {
        try {
          var v = localStorage.getItem(KEY);
          if (v) {
            var a = JSON.parse(v);
            if (Array.isArray(a)) {
              var normalized = [];
              for (var i = 0; i < a.length; i++) {
                var item = a[i] || {};
                var content = item.content;
                if (typeof content !== 'string' && !Array.isArray(content)) continue;
                normalized.push({
                  role: item.role === 'assistant' ? 'assistant' : 'user',
                  content: content
                });
              }
              state.hist = normalized.slice(-MAX_HISTORY);
            }
          }
        } catch (_) {}
        try {
          var savedVideoUrl = localStorage.getItem(VIDEO_URL_KEY);
          if (savedVideoUrl) {
            state.videoUrl = savedVideoUrl;
            e.videoUrl.value = savedVideoUrl;
          }
        } catch (_) {}
        try {
          state.showLogs = localStorage.getItem(SHOW_LOGS_KEY) === '1';
        } catch (_) {}
        try {
          var savedModel = localStorage.getItem(MODEL_KEY);
          if (savedModel) state.preferredModel = savedModel;
        } catch (_) {}
        try {
          var savedLang = localStorage.getItem(LANG_KEY);
          if (savedLang) state.lang = String(savedLang || '').toLowerCase();
        } catch (_) {}
        try {
          var savedImageProxy = localStorage.getItem(IMAGE_PROXY_KEY);
          if (savedImageProxy) state.imageProxy = String(savedImageProxy);
        } catch (_) {}
      }
      function summarizeMessageContent(content) {
        if (typeof content === 'string') {
          if (content.length > MAX_HISTORY_TEXT_CHARS) return content.slice(0, MAX_HISTORY_TEXT_CHARS) + '\n\n[TRUNCATED]';
          return content;
        }
        if (!Array.isArray(content)) return '';
        var texts = [];
        var names = [];
        for (var i = 0; i < content.length; i++) {
          var part = content[i] || {};
          var type = part.type || '';
          if (type === 'input_text' && typeof part.input_text === 'string' && part.input_text.trim()) texts.push(part.input_text.trim());
          if ((type === 'input_file' || type === 'input_image' || type === 'input_video' || type === 'input_audio') && typeof part.filename === 'string' && part.filename.trim()) names.push(part.filename.trim());
        }
        var base = texts.join('\n');
        if (base.length > MAX_HISTORY_TEXT_CHARS) base = base.slice(0, MAX_HISTORY_TEXT_CHARS) + '\n\n[TRUNCATED]';
        if (names.length > 0) return (base ? base + '\n' : '') + t('attachPrefix') + names.join(', ');
        return base;
      }

      function splitThinking(rawText) {
        var raw = String(rawText || '');
        if (!raw) return { think: '', final: '' };
        var thinkParts = [];
        var final = raw.replace(/<think>([\s\S]*?)<\/think>/gi, function (_, inner) {
          if (inner && String(inner).trim()) thinkParts.push(String(inner).trim());
          return '';
        });
        final = final.replace(/\n{3,}/g, '\n\n').trim();
        return { think: thinkParts.join('\n\n').trim(), final: final };
      }
      function msg(role, text, idx) {
        var d = document.createElement('div');
        d.className = 'msg ' + (role === 'assistant' ? 'a' : 'u');
        var head = document.createElement('div');
        head.className = 'msg-head';
        var roleLabel = document.createElement('span');
         roleLabel.textContent = role === 'assistant' ? t('assistant') : t('user');
        head.appendChild(roleLabel);
        if (role === 'user' && typeof idx === 'number') {
          var retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'mini';
           retry.textContent = t('retry');
          retry.disabled = state.sending || state.modelLoading;
          retry.onclick = function () { resendFromIndex(idx); };
          head.appendChild(retry);
        }
        var body = document.createElement('div');
        d.appendChild(head);
        d.appendChild(body);

        if (role === 'assistant') {
          var thinkWrap = document.createElement('details');
          thinkWrap.className = 'think';
          thinkWrap.open = false;
          var thinkSummary = document.createElement('summary');
          thinkSummary.textContent = t('think');
          var thinkPre = document.createElement('pre');
          thinkWrap.appendChild(thinkSummary);
          thinkWrap.appendChild(thinkPre);

          var finalDiv = document.createElement('div');
          var imageContainer = document.createElement('div');
          imageContainer.style.display = 'flex';
          imageContainer.style.flexWrap = 'wrap';
          imageContainer.style.gap = '10px';
          imageContainer.style.marginTop = '10px';
          
          body.appendChild(thinkWrap);
          body.appendChild(finalDiv);
          body.appendChild(imageContainer);

          function setAssistantRaw(rawText, imageUrls) {
            var sp = splitThinking(rawText);
            if (sp.think) {
              thinkWrap.style.display = '';
              thinkPre.textContent = sp.think;
            } else {
              thinkWrap.style.display = 'none';
              thinkPre.textContent = '';
            }
            finalDiv.textContent = sp.final || '';
            
            if (imageUrls && imageUrls.length > 0) {
              imageContainer.innerHTML = '';
              for (var i = 0; i < imageUrls.length; i++) {
                var img = document.createElement('img');
                var rawUrl = imageUrls[i];
                img.src = state.imageProxy ? (state.imageProxy + rawUrl) : rawUrl;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '400px';
                img.style.borderRadius = '8px';
                img.style.cursor = 'pointer';
                img.onclick = function() {
                  window.open(this.src, '_blank');
                };
                imageContainer.appendChild(img);
              }
            }
          }

          setAssistantRaw(text || '');
          e.messages.appendChild(d);
          e.messages.scrollTop = e.messages.scrollHeight;
          return { setRaw: setAssistantRaw };
        }

        body.textContent = text || '';
        e.messages.appendChild(d);
        e.messages.scrollTop = e.messages.scrollHeight;
        return body;
      }
      function rHist() {
        e.messages.innerHTML = '';
        for (var i = 0; i < state.hist.length; i++) {
          var x = state.hist[i];
          if (!x) continue;
          var content = x.content;
          if (typeof content !== 'string' && !Array.isArray(content)) continue;
          var preview = summarizeMessageContent(content);
          if (!preview || !String(preview).trim()) preview = x.role === 'assistant' ? t('emptyAssistant') : t('attachMsg');
          var msgObj = msg(x.role, preview, i);
          if (x.role === 'assistant' && x.imageUrls && x.imageUrls.length > 0 && msgObj && msgObj.setRaw) {
            msgObj.setRaw(preview, x.imageUrls);
          }
        }
        syncRetryEnabled();
      }
      function canSendNow() {
        return !!(e.prompt.value || '').trim() || state.files.length > 0;
      }
      function syncSendEnabled() {
        e.send.disabled = !!state.sending || !!state.modelLoading || !canSendNow();
      }
      function syncRetryEnabled() {
        var retryButtons = e.messages.querySelectorAll('.msg-head .mini');
        for (var i = 0; i < retryButtons.length; i++) {
          retryButtons[i].disabled = !!state.sending || !!state.modelLoading;
        }
      }
      function busy(b) {
        e.stop.disabled = !b;
        if (!b) e.stop.textContent = t('stop');
        e.prompt.disabled = b;
        e.files.disabled = b;
        e.clear.disabled = b;
        e.refreshModels.disabled = b || state.modelLoading;
        e.logToggle.disabled = b;
        e.clearLogs.disabled = b;
        e.videoUrl.disabled = b;
        e.clearVideo.disabled = b;
        e.apiKey.disabled = b;
        e.model.disabled = b;
        e.imageGenMode.disabled = b;
        e.imageSize.disabled = b;
        e.imageCount.disabled = b;
        e.send.textContent = b ? t('sending') : t('send');
        attRow();
      }

      // attachment
      function bfmt(n) { if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; }
      function attRow() {
        e.atts.innerHTML = '';
        for (var i = 0; i < state.files.length; i++) {
          (function (idx) {
            var w = document.createElement('div');
            w.className = 'fi';
            var textDiv = document.createElement('div');
            var f = state.files[idx];
            textDiv.textContent = f.name + ' (' + bfmt(f.size) + ')';
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = t('remove');
            rm.disabled = state.sending || state.modelLoading;
            rm.onclick = function () {
              if (state.sending || state.modelLoading) {
                st(state.sending ? t('attachmentRemoveBusy') : t('attachmentRemoveBusyModels'), 'err');
                return;
              }
              state.files.splice(idx, 1);
              attRow();
            };
            w.appendChild(textDiv);
            w.appendChild(rm);
            e.atts.appendChild(w);
          })(i);
        }
        syncSendEnabled();
        syncRetryEnabled();
      }
      function toDataUrl(file) {
        return new Promise(function (ok, bad) {
          var r = new FileReader();
          r.onload = function () { ok(String(r.result || '')); };
          r.onerror = function () { bad(new Error(tf('fileReadFailed', { name: file.name }))); };
          r.readAsDataURL(file);
        });
      }
      async function buildContent(text, files) {
        var c = [];
        if (text) c.push({ type: 'input_text', input_text: text });
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var d = await toDataUrl(f);
          var m = (f.type || 'application/octet-stream').toLowerCase();
          if (m.startsWith('image/')) c.push({ type: 'input_image', image_url: d, filename: f.name, mime_type: m });
          else c.push({ type: 'input_file', file_data: d, filename: f.name, mime_type: m });
        }
        return c;
      }

      // logs
      function formatTime(ts) {
        var d = new Date(ts);
        var h = String(d.getHours()).padStart(2, '0');
        var m = String(d.getMinutes()).padStart(2, '0');
        var s = String(d.getSeconds()).padStart(2, '0');
        var ms = String(d.getMilliseconds()).padStart(3, '0');
        return h + ':' + m + ':' + s + '.' + ms;
      }
      function formatLogValue(v) {
        var out = '';
        if (v === null || v === undefined) out = '';
        else if (typeof v === 'string') out = v;
        else if (typeof v === 'number' || typeof v === 'boolean') out = String(v);
        else {
          try { out = JSON.stringify(v); } catch (_) { out = String(v); }
        }
        if (out.length > 1000) out = out.slice(0, 1000) + '...';
        return out;
      }
      function addLog(logData) {
        if (!e.logs) return;
        var payload = logData && typeof logData === 'object' ? logData : { raw: String(logData || '') };
        var ts = Number(payload.timestamp || Date.now());
        var eventName = String(payload.event || 'log');
        var detailKeys = ['model', 'chatId', 'index', 'filename', 'filetype', 'status', 'error', 'messageCount', 'contentLength', 'attachmentCount', 'uploadedCount', 'outputLength', 'chatType', 'enableSearch', 'videoUrl', 'downloadProgress', 'downloadStatus', 'filepath', 'size', 'sizeMB', 'minResolution', 'raw'];
        var details = [];
        for (var i = 0; i < detailKeys.length; i++) {
          var k = detailKeys[i];
          if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') details.push(k + '=' + formatLogValue(payload[k]));
        }
        if (details.length === 0) {
          var fallback = [];
          for (var key in payload) {
            if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
            if (key === 'timestamp' || key === 'event') continue;
            if (payload[key] === undefined || payload[key] === null || payload[key] === '') continue;
            fallback.push(key + '=' + formatLogValue(payload[key]));
          }
          details = fallback;
        }
        var atBottom = (e.logs.scrollHeight - e.logs.scrollTop - e.logs.clientHeight) < 12;
        var row = document.createElement('div');
        row.className = 'log-entry';
        var t = document.createElement('span');
        t.className = 'log-time';
        t.textContent = '[' + formatTime(ts) + ']';
        var ev = document.createElement('span');
        ev.className = 'log-event';
        ev.textContent = eventName;
        var detail = document.createElement('span');
        detail.className = 'log-detail';
        detail.textContent = details.join(' | ');
        row.appendChild(t);
        row.appendChild(ev);
        row.appendChild(detail);
        e.logs.appendChild(row);
        while (e.logs.childNodes.length > MAX_LOG_ENTRIES) e.logs.removeChild(e.logs.firstChild);
        if (atBottom) e.logs.scrollTop = e.logs.scrollHeight;
      }

      // API + SSE
      function emsg(code, payloadText, payloadJson) {
        if (payloadJson && payloadJson.error && (payloadJson.error.message || payloadJson.error.details)) return String(payloadJson.error.message || payloadJson.error.details);
        if (code === 401) return t('authFailed');
        if (code === 413) return t('payloadTooLarge');
        if (code >= 500) return t('serverError');
        return payloadText ? (t('requestFailed') + '：' + payloadText) : (t('requestFailed') + '（HTTP ' + code + '）');
      }
      async function readErrorPayload(resp) {
        var txt = await resp.text().catch(function () { return ''; });
        var json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (_) {}
        return { txt: txt, json: json };
      }
      function extractAssistantText(payloadJson, payloadText) {
        if (payloadJson) {
          var c0 = payloadJson.choices && payloadJson.choices[0];
          var msgContent = c0 && c0.message && c0.message.content;
          var reasoning = c0 && c0.message && (c0.message.reasoning_content || c0.message.thinking || c0.message.reasoning);
          if (typeof msgContent === 'string' && msgContent.trim()) return msgContent;
          if (Array.isArray(msgContent)) {
            var parts = [];
            for (var i = 0; i < msgContent.length; i++) {
              var p = msgContent[i] || {};
              if (typeof p === 'string' && p.trim()) parts.push(p.trim());
              else if (typeof p.text === 'string' && p.text.trim()) parts.push(p.text.trim());
              else if (typeof p.output_text === 'string' && p.output_text.trim()) parts.push(p.output_text.trim());
            }
            if (parts.length > 0) return parts.join('\n');
          }
          var c0text = c0 && c0.text;
          if (typeof c0text === 'string' && c0text.trim()) return c0text;
          if (typeof payloadJson.output_text === 'string' && payloadJson.output_text.trim()) return payloadJson.output_text;
          if (typeof reasoning === 'string' && reasoning.trim()) return '<think>' + reasoning.trim() + '</think>';
        }
        return payloadText || '';
      }
      function createSSEState() {
        return { buffer: '', eventType: '', dataLines: [] };
      }
      function parseSSELines(state, chunkText, isDone, consumeLogs, outRef, aMsg) {
        state.buffer += chunkText;
        var lines = state.buffer.split('\n');
        state.buffer = lines.pop() || '';
        if (isDone && state.buffer) {
          lines.push(state.buffer);
          state.buffer = '';
        }

        var reachedDone = false;
        var apiError = '';

        function handlePayload(payload) {
          if (!payload) return;

          if (state.eventType === 'log') {
            if (!consumeLogs) return;
            try {
              addLog(JSON.parse(payload));
            } catch (_) {
              var clippedRaw = payload.length > MAX_LOG_RAW_PREVIEW
                ? (payload.slice(0, MAX_LOG_RAW_PREVIEW) + '...')
                : payload;
              addLog({ event: 'log.parse.failed', timestamp: Date.now(), raw: clippedRaw, size: payload.length });
            }
            return;
          }

          if (payload === '[DONE]') {
            reachedDone = true;
            return;
          }

          try {
            var parsed = JSON.parse(payload);
            if (parsed && parsed.error) {
              apiError = String((parsed.error && (parsed.error.message || parsed.error.details)) || t('requestFailed'));
              return;
            }
            var d0 = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            var delta = d0 && d0.content;
            var reasoning = d0 && (d0.reasoning_content || d0.thinking || d0.reasoning);
            if (typeof reasoning === 'string' && reasoning) outRef.value += '<think>' + reasoning + '</think>';
            if (typeof delta === 'string' && delta) outRef.value += delta;
            if (aMsg && aMsg.setRaw) {
              aMsg.setRaw(outRef.value);
              e.messages.scrollTop = e.messages.scrollHeight;
            }
          } catch (_) {
            // 忽略损坏行，继续消费后续流
          }
        }

        for (var i = 0; i < lines.length; i++) {
          var raw = lines[i] || '';
          var line = raw.replace(/\r$/, '');
          var normalized = line.trimStart();
          if (!normalized.trim()) {
            if (state.dataLines.length > 0) {
              handlePayload(state.dataLines.join('\n'));
              state.dataLines = [];
            }
            state.eventType = '';
            if (reachedDone || apiError) break;
            continue;
          }
          if (normalized.indexOf(':') === 0) {
            continue;
          }
          var eventMatch = normalized.match(/^event\s*:(.*)$/);
          if (eventMatch) {
            state.eventType = eventMatch[1].trim();
            continue;
          }
          var dataMatch = line.match(/^\s*data\s*:(.*)$/);
          if (dataMatch) {
            var dataLine = dataMatch[1];
            if (dataLine.indexOf(' ') === 0) dataLine = dataLine.slice(1);
            state.dataLines.push(dataLine);
          }
        }

        if ((isDone || reachedDone || apiError) && state.dataLines.length > 0) {
          handlePayload(state.dataLines.join('\n'));
          state.dataLines = [];
        }

        if (reachedDone || apiError) state.eventType = '';
        return { reachedDone: reachedDone, apiError: apiError };
      }
      async function loadModels() {
        var reqId = ++state.modelLoadId;
        var prev = (e.model.value || '').trim();
        var preferred = (state.preferredModel || '').trim();
        var headers = {};
        var key = (e.apiKey.value || '').trim();
        var authKey = key ? ('k:' + key) : 'anon';
        if (key) headers.Authorization = 'Bearer ' + key;
        e.refreshModels.disabled = true;
        e.refreshModels.textContent = t('refreshModelsLoading');
        state.modelLoading = true;
        syncSendEnabled();
        syncRetryEnabled();
        e.apiKey.disabled = true;
        e.model.disabled = true;
        e.files.disabled = true;
        e.clear.disabled = true;
        e.logToggle.disabled = true;
        e.clearLogs.disabled = true;
        e.videoUrl.disabled = true;
        e.clearVideo.disabled = true;
        try {
          st(t('loadingModels'), 'ok');
          var resp = await fetch(apiUrl('/v1/models'), { headers: headers });
          if (reqId !== state.modelLoadId) return;
          if (!resp.ok) {
            var modelErr = await readErrorPayload(resp);
            throw new Error(emsg(resp.status, modelErr.txt, modelErr.json));
          }
          var data = await resp.json();
          if (reqId !== state.modelLoadId) return;
          var latestSelected = (e.model.value || '').trim();
          var arr = Array.isArray(data && data.data) ? data.data : [];
          var ids = arr.map(function (x) { return x && x.id; }).filter(Boolean);
          if (ids.length === 0) ids = ['qwen3.8-max'];
          e.model.innerHTML = '';
          for (var i = 0; i < ids.length; i++) {
            var op = document.createElement('option');
            op.value = ids[i];
            op.textContent = ids[i];
            e.model.appendChild(op);
          }

          var authChanged = state.lastModelAuthKey !== null && state.lastModelAuthKey !== authKey;
          if (!authChanged && latestSelected && ids.indexOf(latestSelected) >= 0) e.model.value = latestSelected;
          else if (!authChanged && prev && ids.indexOf(prev) >= 0) e.model.value = prev;
          else if (!authChanged && preferred && ids.indexOf(preferred) >= 0) e.model.value = preferred;
          else e.model.value = ids[0];

          state.lastModelAuthKey = authKey;
          state.preferredModel = e.model.value;
          save();
          st(tf('modelsUpdated', { n: ids.length }), 'ok');
        } catch (err) {
          if (reqId !== state.modelLoadId) return;
          e.model.innerHTML = '<option value="qwen3.8-max">qwen3.8-max</option>';
          e.model.value = 'qwen3.8-max';
          state.lastModelAuthKey = authKey;
          state.preferredModel = e.model.value;
          save();
          st(err && err.message ? err.message : t('modelsLoadFailedFallback'), 'err');
        } finally {
          if (reqId === state.modelLoadId) {
            state.modelLoading = false;
            e.refreshModels.textContent = t('refreshModels');
            e.refreshModels.disabled = !!state.sending;
            syncSendEnabled();
            syncRetryEnabled();
            e.apiKey.disabled = !!state.sending;
            e.model.disabled = !!state.sending;
            e.files.disabled = !!state.sending;
            e.clear.disabled = !!state.sending;
            e.logToggle.disabled = !!state.sending;
            e.clearLogs.disabled = !!state.sending;
            e.videoUrl.disabled = !!state.sending;
            e.clearVideo.disabled = !!state.sending;
          }
        }
      }
      function isResendContentReplayable(content) {
        if (!Array.isArray(content)) return true;
        for (var i = 0; i < content.length; i++) {
          var part = content[i] || {};
          var type = part.type || '';
          if (type === 'input_file' && typeof part.file_data !== 'string') return false;
          if (type === 'input_image' && typeof part.image_url !== 'string') return false;
          if (type === 'input_video' && typeof part.video_url !== 'string' && typeof part.file_data !== 'string') return false;
          if (type === 'input_audio' && typeof part.audio_url !== 'string' && typeof part.file_data !== 'string') return false;
        }
        return true;
      }
      function resendFromIndex(idx) {
        if (state.sending || state.modelLoading) {
          st(state.sending ? t('busyNoDoubleSend') : t('resendWait'), 'err');
          return;
        }
        var item = state.hist[idx];
        if (!item || item.role !== 'user' || (typeof item.content !== 'string' && !Array.isArray(item.content))) {
          st(t('onlyResendUser'), 'err');
          return;
        }
        var replayable = isResendContentReplayable(item.content);
        var summarized = summarizeMessageContent(item.content).trim();
        if (!summarized) summarized = t('attachMsg');
        var resendContent = replayable ? item.content : summarized;
        e.prompt.value = summarizeMessageContent(resendContent) || t('attachMsg');
        if (!replayable) st(t('historySimplified'), 'ok');
        send(resendContent, true, idx);
      }
      async function send(forceText, fromResend, replayFromIndex) {
        if (state.sending) return;
        if (state.modelLoading) {
          st(t('modelsLoadingWaitSend'), 'err');
          return;
        }

        // 重发时先清掉该消息及其之后的所有消息（对话流和图片生成流通用）
        if (typeof replayFromIndex === 'number' && replayFromIndex >= 0) {
          state.hist = state.hist.slice(0, replayFromIndex);
          save();
          rHist();
        }

        var text = '';
        var filesForSend = fromResend ? [] : state.files;
        var userMessageContent;
        if (Array.isArray(forceText)) {
          userMessageContent = forceText;
          text = summarizeMessageContent(forceText).trim();
        } else {
          text = (typeof forceText === 'string' ? forceText : (e.prompt.value || '')).trim();
          if (!text && filesForSend.length === 0) {
            st(t('inputOrFileRequired'), 'err');
            return;
          }
        }

        var model = (e.model.value || '').trim() || 'qwen3.8-max';
        var key = (e.apiKey.value || '').trim();
        
        var imageGenMode = e.imageGenMode.value;
        if (imageGenMode === 'image') {
          var imageSize = e.imageSize.value;
          var imageCount = parseInt(e.imageCount.value, 10) || 1;
          
          msg('user', text, state.hist.length);
          var aMsg = msg('assistant', '');
          
          state.sending = true;
          state.ac = new AbortController();
          busy(true);
          st('正在生成图片...', 'ok');
          
          try {
            var h = { 'Content-Type': 'application/json' };
            if (key) h.Authorization = 'Bearer ' + key;
            
            var endpoint = apiUrl('/v1/images/generations');
            var reqBody = { 
              model: model, 
              prompt: text, 
              n: imageCount, 
              size: imageSize,
              response_format: 'url'
            };
            
            var resp = await fetch(endpoint, {
              method: 'POST',
              headers: h,
              body: JSON.stringify(reqBody),
              signal: state.ac.signal
            });
            
            if (!resp.ok) {
              var apiErr = await readErrorPayload(resp);
              throw new Error(emsg(resp.status, apiErr.txt, apiErr.json));
            }
            
            var data = await resp.json();
            var imageUrls = (data.data || []).map(function(item) { return item.url; });
            
            var resultText = '图片生成完成！点击图片可在新窗口打开。';
            if (aMsg && aMsg.setRaw) aMsg.setRaw(resultText, imageUrls);
            
            e.messages.scrollTop = e.messages.scrollHeight;
            state.hist.push({ role: 'user', content: text });
            state.hist.push({ role: 'assistant', content: resultText, imageUrls: imageUrls });
            if (state.hist.length > MAX_HISTORY) state.hist = state.hist.slice(-MAX_HISTORY);
            save();
            e.prompt.value = '';
            attRow();
            st('图片生成完成！', 'ok');
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') {
              st(t('aborted'), 'err');
              if (aMsg && aMsg.setRaw) aMsg.setRaw(t('abortedTag'));
            } else {
              var m = (err && err.message) || t('requestFailed');
              st(m, 'err');
              if (aMsg && aMsg.setRaw) aMsg.setRaw(t('errorTag') + ' ' + m);
            }
            state.hist.push({ role: 'user', content: text });
            state.hist.push({ role: 'assistant', content: (err && err.name === 'AbortError') ? t('abortedTag') : (t('errorTag') + ' ' + t('requestFailed')) });
            if (state.hist.length > MAX_HISTORY) state.hist = state.hist.slice(-MAX_HISTORY);
            save();
          } finally {
            state.ac = null;
            state.sending = false;
            busy(false);
            e.prompt.focus();
          }
          return;
        }

        var model = (e.model.value || '').trim() || 'qwen3.8-max';
        var key = (e.apiKey.value || '').trim();

        var videoUrl = (e.videoUrl.value || '').trim();
        if (videoUrl) {
          var normalizedVideoUrl = normalizeVideoUrl(videoUrl);
          if (normalizedVideoUrl === 'INVALID') {
            st(t('videoUrlInvalid'), 'err');
            e.videoUrl.focus();
            return;
          }
          if (normalizedVideoUrl !== videoUrl) e.videoUrl.value = normalizedVideoUrl;
          if (state.videoUrl !== normalizedVideoUrl) {
            state.videoUrl = normalizedVideoUrl;
            save();
          }
          videoUrl = normalizedVideoUrl;
        }

        if (!userMessageContent) {
          try {
            st(t('processingAttachments'), 'ok');
            var content = await buildContent(text, filesForSend);
            userMessageContent = (content.length <= 1 && text) ? text : content;
          } catch (err) {
            st((err && err.message) || t('attachmentsFailed'), 'err');
            return;
          }
        }

        if (typeof replayFromIndex === 'number' && replayFromIndex >= 0) {
          state.hist = state.hist.slice(0, replayFromIndex);
          save();
          rHist();
        }

        msg('user', summarizeMessageContent(userMessageContent) || t('attachMsg'), state.hist.length);
        var aMsg = msg('assistant', '');

        var payload = state.hist.slice();
        payload.push({ role: 'user', content: userMessageContent });

        state.sending = true;
        state.ac = new AbortController();
        busy(true);

        var wantVideo = !!videoUrl;
        var wantLogs = !!state.showLogs;
        var useLogEndpoint = wantLogs || wantVideo;
        if (wantVideo && wantLogs) st(t('requestingVideoLogs'), 'ok');
        else if (wantVideo) st(t('requestingVideo'), 'ok');
        else if (wantLogs) st(t('requestingLogs'), 'ok');
        else st(t('requestingChat'), 'ok');

        try {
          var h = { 'Content-Type': 'application/json' };
          if (key) h.Authorization = 'Bearer ' + key;

          var endpoint = useLogEndpoint ? apiUrl('/v1/chat/completions/log') : apiUrl('/v1/chat/completions');
          var reqBody = { model: model, stream: true, messages: payload };
          if (wantVideo) reqBody.video_url = videoUrl;

          var resp = await fetch(endpoint, {
            method: 'POST',
            headers: h,
            body: JSON.stringify(reqBody),
            signal: state.ac.signal
          });

          if (!resp.ok) {
            var apiErr = await readErrorPayload(resp);
            throw new Error(emsg(resp.status, apiErr.txt, apiErr.json));
          }

          var contentType = String(resp.headers.get('content-type') || '').toLowerCase();
          var isEventStream = contentType.indexOf('text/event-stream') >= 0;

          if (!isEventStream) {
            var plain = await readErrorPayload(resp);
            if (plain.json && plain.json.error) {
              throw new Error(emsg(resp.status, plain.txt, plain.json));
            }
            var directText = extractAssistantText(plain.json, plain.txt).trim();
            var plainOutput = directText || t('emptyAssistant');
            if (aMsg && aMsg.setRaw) aMsg.setRaw(plainOutput);
            e.messages.scrollTop = e.messages.scrollHeight;
            state.hist.push({ role: 'user', content: userMessageContent });
            state.hist.push({ role: 'assistant', content: plainOutput });
            if (state.hist.length > MAX_HISTORY) state.hist = state.hist.slice(-MAX_HISTORY);
            save();
            e.prompt.value = '';
            state.files = [];
            attRow();
            st(t('done'), 'ok');
            return;
          }

          if (!resp.body) throw new Error('浏览器不支持流式响应。');

          var reader = resp.body.getReader();
          var decoder = new TextDecoder();
          var sseState = createSSEState();
          var outRef = { value: '' };
          var gotDone = false;
          var streamError = '';

          while (!gotDone) {
            var ch = await reader.read();
            var done = !!ch.done;
            var chunkText = decoder.decode(ch.value || new Uint8Array(), { stream: !done });
            var parsed = parseSSELines(sseState, chunkText, done, wantLogs, outRef, aMsg);
            if (parsed.apiError) {
              streamError = parsed.apiError;
              gotDone = true;
            }
            if (parsed.reachedDone || done) gotDone = true;
          }

          if (streamError) {
            throw new Error(streamError);
          }

          if (!outRef.value) outRef.value = t('emptyAssistant');
          if (aMsg && aMsg.setRaw) aMsg.setRaw(outRef.value);

          state.hist.push({ role: 'user', content: userMessageContent });
          state.hist.push({ role: 'assistant', content: outRef.value });
          if (state.hist.length > MAX_HISTORY) state.hist = state.hist.slice(-MAX_HISTORY);
          save();
          e.prompt.value = '';
          state.files = [];
          attRow();
          st(t('done'), 'ok');
        } catch (err) {
          if (err && err.name === 'AbortError') {
            st(t('aborted'), 'err');
            var cur = outRef.value || '';
            outRef.value = cur ? (cur + '\n\n' + t('abortedTag')) : t('abortedTag');
            if (aMsg && aMsg.setRaw) aMsg.setRaw(outRef.value);
            e.messages.scrollTop = e.messages.scrollHeight;
          } else {
            var m = (err && err.message) || t('requestFailed');
            st(m, 'err');
            var cur2 = outRef.value || '';
            outRef.value = cur2 ? (cur2 + '\n\n' + t('errorTag') + ' ' + m) : (t('errorTag') + ' ' + m);
            if (aMsg && aMsg.setRaw) aMsg.setRaw(outRef.value);
            e.messages.scrollTop = e.messages.scrollHeight;
          }
          state.hist.push({ role: 'user', content: userMessageContent });
          state.hist.push({ role: 'assistant', content: outRef.value || ((err && err.name === 'AbortError') ? t('abortedTag') : (t('errorTag') + ' ' + t('requestFailed'))) });
          if (state.hist.length > MAX_HISTORY) state.hist = state.hist.slice(-MAX_HISTORY);
          save();
        } finally {
          state.ac = null;
          state.sending = false;
          busy(false);
          e.prompt.focus();
        }
      }

      function setLogPanelVisible(visible) {
        state.showLogs = !!visible;
        if (state.showLogs) {
          if (e.shell) e.shell.classList.add('has-logs');
          e.logPanel.classList.add('visible');
          e.logToggle.textContent = '隐藏日志';
          e.logToggle.classList.add('active');
          e.logs.scrollTop = e.logs.scrollHeight;
        } else {
          if (e.shell) e.shell.classList.remove('has-logs');
          e.logPanel.classList.remove('visible');
          e.logToggle.textContent = '显示日志';
          e.logToggle.classList.remove('active');
        }
      }

      function openSettingsDialog() {
        if (state.settingsDialog) return;

        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        function close() {
          document.removeEventListener('keydown', escListener);
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          state.settingsDialog = null;
        }
        function escListener(ev) {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            close();
          }
        }

        var dialog = document.createElement('div');
        dialog.className = 'modal';

        var title = document.createElement('h3');
        title.textContent = t('settings');

        var label = document.createElement('div');
        label.className = 'field-label';
        label.textContent = t('imageProxy');

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'imageProxyInput';
        input.placeholder = t('imageProxyPh');
        input.value = state.imageProxy || '';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.style.width = '100%';

        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('imageProxyHint');

        var actions = document.createElement('div');
        actions.className = 'actions';

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'warn';
        clearBtn.textContent = t('clearProxy');
        clearBtn.onclick = function () {
          state.imageProxy = '';
          save();
          close();
          st(t('imageProxyCleared'), 'ok');
          if (!state.sending) rHist();
        };

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn';
        cancelBtn.textContent = t('cancel');
        cancelBtn.onclick = close;

        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'primary';
        saveBtn.textContent = t('save');
        saveBtn.onclick = function () {
          var v = (input.value || '').trim();
          state.imageProxy = v;
          save();
          close();
          st(v ? t('imageProxySet') : t('imageProxyCleared'), 'ok');
          if (!state.sending) rHist();
        };

        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && !ev.isComposing) {
            ev.preventDefault();
            saveBtn.click();
          }
        });

        actions.appendChild(clearBtn);
        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);

        dialog.appendChild(title);
        dialog.appendChild(label);
        dialog.appendChild(input);
        dialog.appendChild(hint);
        dialog.appendChild(actions);

        backdrop.appendChild(dialog);

        backdrop.addEventListener('click', function (ev) {
          if (ev.target === backdrop) close();
        });

        document.addEventListener('keydown', escListener);

        document.body.appendChild(backdrop);
        state.settingsDialog = backdrop;

        setTimeout(function () { input.focus(); input.select(); }, 50);
      }

      // events
      if (e.langToggle) {
        e.langToggle.onclick = function () {
          setLang(state.lang === 'en' ? 'zh' : 'en');
        };
      }
      e.logToggle.onclick = function () {
        setLogPanelVisible(!state.showLogs);
        save();
      };
      if (e.settingsBtn) {
        e.settingsBtn.onclick = function () { openSettingsDialog(); };
      }
      e.clearLogs.onclick = function () {
        if (state.sending || state.modelLoading) {
          st(state.sending ? t('logsClearBusy') : t('logsClearBusyModels'), 'err');
          return;
        }
        var hadLogs = e.logs.childNodes.length > 0;
        e.logs.innerHTML = '';
        st(hadLogs ? t('logsCleared') : t('logsAlreadyEmpty'), 'ok');
      };
      function normalizeVideoUrl(v) {
        var url = (v || '').trim();
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) return 'INVALID';
        return url;
      }
      function syncVideoUrlFromInput(showHint) {
        var normalized = normalizeVideoUrl(e.videoUrl.value || '');
        if (normalized === 'INVALID') {
          st(t('videoUrlInvalid'), 'err');
          return false;
        }
        state.videoUrl = normalized;
        e.videoUrl.value = normalized;
        save();
        if (showHint) {
          if (normalized) st(t('videoSet'), 'ok');
          else st(t('videoCleared'), 'ok');
        }
        return true;
      }
      e.clearVideo.onclick = function () {
        if (state.sending || state.modelLoading) {
          st(state.sending ? t('busyNoDoubleSend') : t('modelsLoadingWait'), 'err');
          return;
        }
        e.videoUrl.value = '';
        syncVideoUrlFromInput(true);
        if (state.showLogs) addLog({ event: 'video.url.cleared', timestamp: Date.now() });
      };
      e.videoUrl.addEventListener('blur', function () {
        if (state.sending || state.modelLoading) return;
        syncVideoUrlFromInput(false);
      });
      e.videoUrl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          if (state.sending || state.modelLoading) return;
          ev.preventDefault();
          e.videoUrl.value = state.videoUrl || '';
          st(t('videoRestored'), 'ok');
          return;
        }
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          if (state.sending || state.modelLoading) return;
          syncVideoUrlFromInput(true);
          e.prompt.focus();
        }
      });
      e.files.onchange = function () {
        if (state.sending || state.modelLoading) {
          st(state.sending ? '请求进行中，暂不能修改附件。' : '模型列表加载中，请稍候再修改附件。', 'err');
          e.files.value = '';
          return;
        }
        var fs = Array.from(e.files.files || []);
        var added = 0;
        var skipped = 0;
        for (var i = 0; i < fs.length; i++) {
          if (state.files.length >= MAX) {
            st(tf('maxAttachments', { n: MAX }), 'err');
            break;
          }
          var f = fs[i];
          if (f.size > MAX_SIZE) {
            st(tf('fileTooLarge', { name: f.name, max: bfmt(MAX_SIZE) }), 'err');
            skipped++;
            continue;
          }
          var exists = false;
          for (var j = 0; j < state.files.length; j++) {
            var existing = state.files[j];
            if (existing && existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified) {
              exists = true;
              break;
            }
          }
          if (exists) {
            skipped++;
            continue;
          }
          state.files.push(f);
          added++;
        }
        e.files.value = '';
        attRow();
        if (added > 0 && skipped > 0) st(tf('addedAndSkipped', { added: added, skipped: skipped }), 'ok');
        else if (added > 0) st(tf('addedAttachments', { n: state.files.length }), 'ok');
        else if (skipped > 0) st(t('addedNoneSkipped'), 'err');
      };
      e.send.onclick = function () {
        if (state.sending) {
          st(t('busyNoDoubleSend'), 'err');
          return;
        }
        if (!canSendNow()) return;
        if (state.modelLoading) {
          st(t('modelsLoadingWaitSend'), 'err');
          return;
        }
        send();
      };
      e.stop.onclick = function () {
        if (!state.ac) {
          st(t('noActiveRequest'), 'err');
          return;
        }
        state.ac.abort();
        e.stop.disabled = true;
        e.stop.textContent = t('stopping');
        st(t('abortInProgress'), 'ok');
      };
      e.clear.onclick = function () {
        if (state.sending || state.modelLoading) {
          st(state.sending ? t('clearChatBusy') : t('clearChatBusyModels'), 'err');
          return;
        }
        var hadSession = state.hist.length > 0 || state.files.length > 0 || !!(e.prompt.value || '').trim();
        state.hist = [];
        save();
        state.files = [];
        attRow();
        rHist();
        e.prompt.value = '';
        syncSendEnabled();
        st(hadSession ? t('chatCleared') : t('chatAlreadyEmpty'), 'ok');
        e.prompt.focus();
      };
      e.refreshModels.onclick = function () {
        if (state.sending) {
          st(t('refreshModelsBusy'), 'err');
          return;
        }
        if (state.modelLoading) {
          st(t('modelsLoadingWait'), 'ok');
          return;
        }
        loadModels();
      };
      e.apiKey.addEventListener('blur', function () {
        if (state.sending || state.modelLoading) return;
        var key = (e.apiKey.value || '').trim();
        var authKey = key ? ('k:' + key) : 'anon';
        if (state.lastModelAuthKey === authKey) return;
        loadModels();
      });
      e.model.addEventListener('change', function () {
        state.preferredModel = (e.model.value || '').trim();
        save();
      });
      e.apiKey.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.isComposing) {
          ev.preventDefault();
          if (state.sending || state.modelLoading) return;
          var key = (e.apiKey.value || '').trim();
          var authKey = key ? ('k:' + key) : 'anon';
          if (state.lastModelAuthKey === authKey) return;
          loadModels();
        }
      });
      e.prompt.onkeydown = function (ev) {
        if (ev.key === 'Escape') {
          if (state.ac) {
            ev.preventDefault();
            state.ac.abort();
            e.stop.disabled = true;
            e.stop.textContent = t('stopping');
            st(t('abortInProgress'), 'ok');
          }
          return;
        }
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          if (state.sending) {
            st(t('busyNoDoubleSend'), 'err');
            return;
          }
          if (!canSendNow()) return;
          if (state.modelLoading) {
            st(t('modelsLoadingWaitSend'), 'err');
            return;
          }
          send();
        }
      };
      e.prompt.addEventListener('input', syncSendEnabled);

      load();
      state.lang = getPreferredLang();
      rHist();
      setLogPanelVisible(state.showLogs);
      syncSendEnabled();
      applyLangToUI();
      st(t('ready'), 'ok');
      loadModels();
    })();
  </script>
</body>
</html>
`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
}

function logChatDetail(runtime, event, detail = {}) {
  const rawFlag = (typeof process !== 'undefined' && process?.env?.CHAT_DETAIL_LOG) || '';
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

function tryParseRatioString(size) {
  const text = normalizeInputString(size);
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w}:${h}`;
}

function normalizeReasoningFragments(value) {
  if (typeof value === 'string') {
    const text = normalizeReasoningString(value);
    return text ? [text] : [];
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = normalizeReasoningString(item);
      if (text) out.push(text);
    } else if (item && typeof item === 'object') {
      const text = normalizeReasoningString(item.text || item.content || item.value);
      if (text) out.push(text);
    }
  }
  return out;
}

function normalizeReasoningString(value) {
  if (typeof value !== 'string') return '';
  const lowered = value.trim().toLowerCase();
  if (lowered === '[undefined]' || lowered === 'undefined' || lowered === '[null]' || lowered === 'null') {
    return '';
  }
  return value;
}

function extractReasoningContentFromDelta(delta) {
  if (!delta || typeof delta !== 'object') return '';
  const direct = normalizeReasoningString(delta.reasoning_content || delta.reasoning || '');
  if (direct) return direct;
  const phase = typeof delta.phase === 'string' ? delta.phase : '';
  if (phase !== 'thinking_summary') return '';
  const fromSummary = normalizeReasoningFragments(delta?.extra?.summary_thought?.content);
  if (fromSummary.length > 0) return fromSummary.join('\n');
  return '';
}

function mapUpstreamDeltaToOpenAI(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const mapped = {};
  // OpenAI API 规范: 流式响应中 delta.role 只能是 "assistant" 或不设置
  // 当上游返回 "function"/"tool" 等角色时，不设置 role 字段（兼容但不执行工具）
  if (delta.role === 'assistant') mapped.role = delta.role;
  if (typeof delta.content === 'string') mapped.content = delta.content;
  const reasoningContent = extractReasoningContentFromDelta(delta);
  if (reasoningContent) mapped.reasoning_content = reasoningContent;
  return Object.keys(mapped).length > 0 ? mapped : null;
}

function parseQwenSsePayload(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  const events = [];
  const contentParts = [];
  const reasoningParts = [];
  let usage = null;

  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.usage && typeof parsed.usage === 'object') usage = parsed.usage;
      const delta = mapUpstreamDeltaToOpenAI(parsed?.choices?.[0]?.delta);
      const finishReason = parsed?.choices?.[0]?.finish_reason || null;
      if (delta || finishReason) {
        events.push({ delta: delta || {}, finish_reason: finishReason });
      }
      if (delta?.content) contentParts.push(delta.content);
      if (delta?.reasoning_content) reasoningParts.push(delta.reasoning_content);
    } catch (parseError) {
      void parseError;
    }
  }

  return {
    events,
    content: contentParts.join(''),
    reasoning_content: reasoningParts.join(''),
    usage,
  };
}

function mapUsageToOpenAI(usage) {
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  const totalTokens = Number(usage?.total_tokens || (inputTokens + outputTokens));
  const mapped = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
  };
  const inputDetails = usage?.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? { ...usage.input_tokens_details }
    : null;
  const outputDetails = usage?.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? { ...usage.output_tokens_details }
    : null;
  if (inputDetails && Object.keys(inputDetails).length > 0) {
    mapped.prompt_tokens_details = inputDetails;
  }
  if (outputDetails && Object.keys(outputDetails).length > 0) {
    mapped.completion_tokens_details = outputDetails;
  }
  return mapped;
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
    logChatDetail('vercel-edge', 'attachments.parse.document.skip', { fileId: qwenFilePayload.id, filename: file.filename, status: resp.status, detail });
    throw new Error(`Document parse failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
  let payload = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {}
  if (payload && payload.success === false) {
    logChatDetail('vercel-edge', 'attachments.parse.document.skip', { fileId: qwenFilePayload.id, filename: file.filename, status: resp.status, detail });
    throw new Error(`Document parse rejected${payload?.msg ? `: ${payload.msg}` : ''}`);
  }
  logChatDetail('vercel-edge', 'attachments.parse.document.done', { fileId: qwenFilePayload.id, filename: file.filename });
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
  logChatDetail('vercel-edge', 'attachments.upload.start', { count: attachments.length });
  const files = [];
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const loaded = await getAttachmentBytes(attachment);
    logChatDetail('vercel-edge', 'attachments.upload.file.prepare', {
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
    logChatDetail('vercel-edge', 'attachments.upload.file.done', { index: i, filetype, filename: loaded.filename });
  }
  logChatDetail('vercel-edge', 'attachments.upload.done', { uploaded: files.length });
  return files;
}

// ============================================
// 认证
// ============================================

function validateToken(authHeader) {
  const tokens = process.env.API_TOKENS ? process.env.API_TOKENS.split(',').filter(t => t.trim()) : [];
  if (tokens.length === 0) return true;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return tokens.includes(token);
}

// ============================================
// API Handlers
// ============================================

// Upstream `/api/models` is behind a WAF and now returns an HTML block page
// instead of JSON. The web app ships the model list inside the homepage HTML
// as `window.__prerendered_data`, so we scrape that instead. The WAF also
// rejects short User-Agent strings, so a complete Chrome UA is required.
const MODELS_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const MODELS_SEC_CH_UA = '"Chromium";v="143", "Not(A:Brand";v="24", "Google Chrome";v="143"';
const MODELS_CACHE_TTL = 10 * 60 * 1000;

// Fallback list used when the upstream homepage cannot be scraped (e.g. Vercel
// egress IP gets WAF-blocked and returns a challenge page). These mirror the
// models currently exposed by https://chat.qwen.ai/ so the API keeps working.
const FALLBACK_MODELS = [
  'qwen3.8-max',
  'qwen3.7-plus',
  'qwen3.7-max',
];
const DEFAULT_MODEL = FALLBACK_MODELS[0];

let modelsCache = null;
let modelsCacheTime = 0;

// Extracts the balanced JSON object that follows `window.__prerendered_data`.
function extractPrerenderedData(html) {
  const marker = html.indexOf('window.__prerendered_data');
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchQwenModels() {
  const resp = await fetch('https://chat.qwen.ai/', {
    headers: {
      'User-Agent': MODELS_BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': MODELS_SEC_CH_UA,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
  });
  if (!resp.ok) throw new Error(`models page returned HTTP ${resp.status}`);
  const html = await resp.text();
  const data = extractPrerenderedData(html);
  const models = Array.isArray(data?.models) ? data.models : null;
  if (!models || models.length === 0) throw new Error('no models found in page');
  const ids = [];
  for (const m of models) {
    const id = typeof m?.id === 'string' ? m.id : (typeof m?.info?.id === 'string' ? m.info.id : '');
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) throw new Error('no model ids found in page');
  return ids;
}

async function getQwenModels() {
  const now = Date.now();
  if (modelsCache && now - modelsCacheTime < MODELS_CACHE_TTL) {
    return modelsCache;
  }
  let ids;
  try {
    ids = await fetchQwenModels();
  } catch (err) {
    logChatDetail('vercel-edge', 'models.fetch.failed', { message: err?.message || String(err) });
    ids = FALLBACK_MODELS.slice();
  }
  if (!ids || ids.length === 0) ids = FALLBACK_MODELS.slice();
  modelsCache = ids;
  modelsCacheTime = now;
  return ids;
}

async function handleModels(authHeader) {
  if (!validateToken(authHeader)) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }
  try {
    const ids = await getQwenModels();
    const created = Math.floor(Date.now() / 1000);
    return jsonResponse({
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', created, owned_by: 'qwen' })),
    });
  } catch (err) {
    logChatDetail('vercel-edge', 'models.fetch.failed', { message: err?.message || String(err) });
    return jsonResponse({ error: { message: 'Failed to fetch models', type: 'api_error' } }, 500);
  }
}

async function handleChatCompletions(body, authHeader) {
  logChatDetail('vercel-edge', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  if (!validateToken(authHeader)) {
    logChatDetail('vercel-edge', 'request.auth.failed', {});
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true } = body;
  if (!messages?.length) {
    logChatDetail('vercel-edge', 'request.validation.failed', { reason: 'Messages are required' });
    return jsonResponse({ error: { message: 'Messages are required', type: 'invalid_request_error' } }, 400);
  }
  logChatDetail('vercel-edge', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.8-max',
    messageCount: Array.isArray(messages) ? messages.length : 0,
  });

  const actualModel = model || 'qwen3.8-max';
  // 检查是否启用搜索
  const enableSearch = (process.env.ENABLE_SEARCH || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';
  logChatDetail('vercel-edge', 'request.config', { actualModel, chatType, enableSearch });

  // 创建会话（失败自动换 token 重试）
  let bxUa, bxUmidToken, bxV, chatId;
  let createFailMsg = '';
  let createFailStatus = 500;
  let createdOk = false;
  for (let attempt = 0; attempt <= 3 && !createdOk; attempt++) {
    const tokens = await getBaxiaTokens();
    bxUa = tokens.bxUa; bxUmidToken = tokens.bxUmidToken; bxV = tokens.bxV;
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
    const createParsed = await safeReadJson(createResp);
    logChatDetail('vercel-edge', 'chat.create.response', {
      status: createResp.status,
      parseOk: createParsed.ok,
      success: !!createParsed.data?.success,
      hasChatId: !!createParsed.data?.data?.id,
    });
    if (!createParsed.ok) {
      const preview = createParsed.rawText ? createParsed.rawText.slice(0, 300) : '(empty)';
      console.log(`[qwen2api][vercel][chat] Create chat session failed (attempt ${attempt + 1}): HTTP ${createResp.status}, body: ${preview}`);
      const wafMatch = preview.match(/aliyun_waf/i);
      createFailMsg = wafMatch
        ? 'Upstream WAF blocked the request. The IP may be rate-limited or banned by Aliyun WAF.'
        : `Failed to create chat session: upstream returned non-JSON response (HTTP ${createResp.status}).`;
      createFailStatus = createResp.ok ? 502 : createResp.status;
      continue;
    }
    const createData = createParsed.data;
    if (!createData?.success || !createData?.data?.id) {
      const parsedCreateErr = tryParseUpstreamErrorPayload(createParsed.rawText);
      createFailMsg = createData?.data?.details || createData?.data?.message || createData?.data?.code || parsedCreateErr?.message || 'Failed to create chat session';
      createFailStatus = 500;
      console.log(`[qwen2api][vercel][chat] Create chat session error (attempt ${attempt + 1}): ${JSON.stringify(createData?.data || createData)}`);
      if (parsedCreateErr?.riskControlled || parsedCreateErr?.code === 'rgv587' || /rgv.?587/i.test(createParsed.rawText || '')) {
        await new Promise(resolve => setTimeout(resolve, 600));
        continue;
      }
      return jsonResponse({ error: { message: createFailMsg, type: 'api_error', ...(parsedCreateErr?.code ? { code: parsedCreateErr.code } : {}) } }, createFailStatus);
    }
    chatId = createData.data.id;
    createdOk = true;
  }
  if (!createdOk) {
    return jsonResponse({ error: { message: createFailMsg || 'Failed to create chat session', type: 'api_error' } }, createFailStatus || 502);
  }

  const parsedMessages = parseIncomingMessages(messages);
  const content = parsedMessages.content;
  logChatDetail('vercel-edge', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  const uploadedFiles = parsedMessages.attachments.length > 0
    ? await uploadAttachments(parsedMessages.attachments, { bxUa, bxUmidToken, bxV })
    : [];
  logChatDetail('vercel-edge', 'message.ready', { uploadedFileCount: uploadedFiles.length });

  // 发送请求
  const chatResp = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'x-accel-buffering': 'no', 'source': 'web', 'version': '0.2.83', 'Referer': 'https://chat.qwen.ai/c/guest', 'x-request-id': uuidv4()
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
    const errorText = await chatResp.text().catch(() => '');
    logChatDetail('vercel-edge', 'chat.completion.error', { status: chatResp.status, chatId, error: errorText });
    const parsedErr = tryParseUpstreamErrorPayload(errorText);
    const errMsg = parsedErr?.message || errorText || `HTTP ${chatResp.status}`;
    return jsonResponse({ error: { message: errMsg, type: 'api_error', ...(parsedErr?.code ? { code: parsedErr.code } : {}) } }, chatResp.status);
  }
  logChatDetail('vercel-edge', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });

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
      let doneWritten = false;
      let nonDataBuffer = '';
      let anyChunkWritten = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trimStart();
            if (!trimmed.startsWith('data:')) {
              nonDataBuffer += (nonDataBuffer ? '\n' : '') + line;
              continue;
            }
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              await writer.write(encoder.encode('data: [DONE]\n\n'));
              doneWritten = true;
              anyChunkWritten = true;
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed?.error) {
                const upstreamError = typeof parsed.error === 'string' ? { message: parsed.error } : parsed.error;
                const errorMsg = upstreamError.message || upstreamError.details || '请求失败';
                // 内容安全警告作为正常输出而不是错误
                if (upstreamError.code === 'data_inspection_failed' || upstreamError.details) {
                  const warningChunk = {
                    id: responseId,
                    object: 'chat.completion.chunk',
                    created,
                    model: actualModel,
                    choices: [{
                      index: 0,
                      delta: { role: 'assistant', content: errorMsg },
                      finish_reason: 'stop',
                    }],
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(warningChunk)}\n\n`));
                  doneWritten = true;
                  anyChunkWritten = true;
                  await writer.write(encoder.encode('data: [DONE]\n\n'));
                  continue;
                }
                const errObj = {
                  error: {
                    message: errorMsg,
                    type: upstreamError.type || 'api_error',
                    code: upstreamError.code,
                  }
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(errObj)}\n\n`));
                anyChunkWritten = true;
                continue;
              }
              const delta = mapUpstreamDeltaToOpenAI(parsed?.choices?.[0]?.delta);
              if (delta || parsed.choices?.[0]?.finish_reason) {
                const chunk = {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created,
                  model: actualModel,
                  choices: [{
                    index: 0,
                    delta: delta || {},
                    finish_reason: parsed.choices[0].finish_reason || null
                  }]
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                anyChunkWritten = true;
              }
            } catch (streamParseError) {
              void streamParseError;
            }
          }
        }
        if (buffer.trim() && !buffer.trimStart().startsWith('data:')) {
          nonDataBuffer += buffer;
        }
        if (!doneWritten && !anyChunkWritten) {
          const upstreamErr = tryParseUpstreamErrorPayload(nonDataBuffer);
          if (upstreamErr) {
            logChatDetail('vercel-edge', 'chat.completion.error', { message: upstreamErr.message });
            await writer.write(encoder.encode(`data: ${JSON.stringify({ error: upstreamErr })}\n\n`));
            doneWritten = true;
          }
          await writer.write(encoder.encode('data: [DONE]\n\n'));
        }
      } catch (err) {
        const message = err && err.message ? err.message : 'stream proxy error';
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: { message, type: 'api_error' } })}\n\n`));
      } finally {
        if (!doneWritten) {
          await writer.write(encoder.encode('data: [DONE]\n\n'));
        }
        await writer.close();
      }
    })();
    logChatDetail('vercel-edge', 'stream.proxy.started', { chatId, model: actualModel });
    
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
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const upstreamErr = tryParseUpstreamErrorPayload(buffer);
  if (upstreamErr) {
    logChatDetail('vercel-edge', 'chat.completion.error', { message: upstreamErr.message });
    return jsonResponse({ error: upstreamErr }, 502);
  }
  const parsedSse = parseQwenSsePayload(buffer);
  logChatDetail('vercel-edge', 'chat.completion.collected', {
    chunkCount: parsedSse.events.length,
    outputLength: parsedSse.content.length,
  });

  return jsonResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parsedSse.content, ...(parsedSse.reasoning_content ? { reasoning_content: parsedSse.reasoning_content } : {}) }, finish_reason: 'stop' }],
    usage: mapUsageToOpenAI(parsedSse.usage)
  });
}

async function handleImageGenerations(body, authHeader) {
  if (!validateToken(authHeader)) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const prompt = normalizeInputString(body?.prompt);
  if (!prompt) {
    return jsonResponse({ error: { message: 'prompt is required', type: 'invalid_request_error' } }, 400);
  }

  const actualModel = normalizeInputString(body?.model) || 'qwen3.8-max';
  const nRaw = body?.n;
  let n = Number.isFinite(nRaw) ? Number(nRaw) : Number.parseInt(String(nRaw || ''), 10);
  if (!Number.isFinite(n) || n <= 0) n = 1;
  if (n > 10) n = 10;

  const responseFormat = normalizeInputString(body?.response_format) || 'url';
  if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
    return jsonResponse({ error: { message: 'response_format must be one of url or b64_json', type: 'invalid_request_error' } }, 400);
  }

  const qwenRatio = mapOpenAiImageSizeToQwenRatio(body?.size);
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  const createResp = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Referer': 'https://chat.qwen.ai/c/guest',
      'source': 'web',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ title: '新建对话', models: [actualModel], chat_mode: 'guest', chat_type: 't2i', timestamp: Date.now(), project_id: '' }),
  });

  const createParsed = await safeReadJson(createResp);
  if (!createParsed.ok) {
    const preview = createParsed.rawText ? createParsed.rawText.slice(0, 300) : '(empty)';
    console.log(`[qwen2api][vercel][image] Create chat session failed: HTTP ${createResp.status}, body: ${preview}`);
    const wafMatch = preview.match(/aliyun_waf/i);
    const msg = wafMatch
      ? 'Upstream WAF blocked the request. The IP may be rate-limited or banned by Aliyun WAF.'
      : `Failed to create image chat session: upstream returned non-JSON response (HTTP ${createResp.status}).`;
    return jsonResponse({ error: { message: msg, type: 'api_error' } }, createResp.ok ? 502 : createResp.status);
  }
  const createData = createParsed.data;
  if (!createData?.success || !createData?.data?.id) {
    const errMsg = createData?.data?.details || createData?.data?.message || createData?.data?.code || 'Failed to create image chat session';
    console.log(`[qwen2api][vercel][image] Create chat session error: ${JSON.stringify(createData?.data || createData)}`);
    return jsonResponse({ error: { message: errMsg, type: 'api_error' } }, 500);
  }
  const chatId = createData.data.id;

  const finalPrompt = n === 1 ? prompt : `${prompt}\n\n(Generate ${n} images.)`;
  const chatResp = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'x-accel-buffering': 'no',
      'source': 'web',
      'version': '0.2.83',
      'Referer': 'https://chat.qwen.ai/c/guest',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: chatId,
      chat_mode: 'guest',
      model: actualModel,
      parent_id: null,
      messages: [{
        fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content: finalPrompt,
        user_action: 'chat', files: [], timestamp: Date.now(), models: [actualModel], chat_type: 't2i',
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_mode: 'Auto', thinking_format: 'summary', auto_search: true },
        extra: { meta: { subChatType: 't2i' } }, sub_chat_type: 't2i', parent_id: null
      }],
      timestamp: Date.now(),
      size: qwenRatio,
    })
  });

  const rawText = await chatResp.text().catch(() => '');
  if (!chatResp.ok) {
    return jsonResponse({ error: { message: rawText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }

  const firstChar = rawText.trimStart().charAt(0);
  if (firstChar === '{' || firstChar === '[') {
    let parsed;
    try { parsed = JSON.parse(rawText); } catch {}
    if (parsed && parsed.success === false) {
      const errData = parsed.data || parsed;
      const msg = errData.details || errData.message || errData.code || 'Upstream request failed';
      return jsonResponse({ error: { message: msg, type: 'api_error', code: errData.code } }, 502);
    }
  }

  const urls = extractImageUrlsFromUpstreamSse(rawText);
  if (!urls || urls.length === 0) {
    const upstreamError = extractUpstreamErrorFromSse(rawText);
    if (upstreamError) {
      return jsonResponse({ error: { message: upstreamError.message, type: 'api_error', code: upstreamError.code } }, 502);
    }
    console.log('[qwen2api][vercel][image] Upstream SSE response with no image URLs:');
    console.log(rawText.slice(0, 2000));
    return jsonResponse({ error: { message: 'Upstream returned no image URLs', type: 'api_error' } }, 502);
  }

  const created = Math.floor(Date.now() / 1000);
  if (responseFormat === 'url') {
    return jsonResponse({ created, data: urls.slice(0, n).map((u) => ({ url: u })) });
  }

  try {
    const items = [];
    for (const u of urls.slice(0, n)) {
      const resp = await fetch(u);
      if (!resp.ok) throw new Error(`Failed to fetch image: HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      items.push({ b64_json: bytesToBase64(bytes) });
    }
    return jsonResponse({ created, data: items });
  } catch (err) {
    const message = err && err.message ? err.message : 'Failed to fetch image bytes';
    return jsonResponse({ error: { message, type: 'api_error' } }, 502);
  }
}

function extractAsyncTaskIdFromUpstreamSse(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  const candidates = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    for (const key of Object.keys(node)) {
      const lower = key.toLowerCase();
      if (lower === 'taskid' && typeof node[key] === 'string' && node[key].length > 0) {
        candidates.push(node[key]);
      }
      const v = node[key];
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.phase === 'string'
        && /async_task/i.test(parsed.phase)
        && typeof parsed.taskId === 'string' && parsed.taskId.length > 0) {
        candidates.push(parsed.taskId);
      }
      walk(parsed, 0);
    } catch {}
  }
  return candidates.length > 0 ? candidates[0] : null;
}

async function pollQwenTaskUntilDone(taskId, cookies, opts = {}) {
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 5000;
  const maxAttempts = Number.isFinite(opts.maxAttempts) ? opts.maxAttempts : 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let statusResp;
    try {
      statusResp = await fetch(`https://chat.qwen.ai/api/v2/task/status/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'bx-ua': cookies.bxUa,
          'bx-umidtoken': cookies.bxUmidToken,
          'bx-v': cookies.bxV,
          'Cookie': cookies.cookies || '',
          'Origin': 'https://chat.qwen.ai',
          'source': 'web',
          'version': '0.2.83',
          'Referer': 'https://chat.qwen.ai/c/guest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'x-request-id': uuidv4(),
        },
      });
    } catch (err) {
      console.log(`[qwen2api][vercel][video] task status request failed (attempt ${attempt + 1}): ${err && err.message ? err.message : String(err)}`);
      await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    const parsed = await safeReadJson(statusResp);
    const taskData = parsed && parsed.data ? parsed.data : (parsed || null);
    const taskStatus = (taskData && taskData.task_status) || '';
    console.log(`[qwen2api][vercel][video] poll attempt ${attempt + 1}: status=${taskStatus}`);
    if (taskStatus === 'success') {
      const content = taskData && taskData.content;
      let mediaUrl = typeof content === 'string' ? content.trim()
        : (content && typeof content === 'object' ? (content.url || content.video_url || content.media_url || content.file_url || null) : null);
      if (mediaUrl && typeof mediaUrl !== 'string') mediaUrl = null;
      if (mediaUrl && /^https?:\/\//i.test(mediaUrl)) {
        return { ok: true, url: mediaUrl, raw: taskData };
      }
      return { ok: false, error: 'Task succeeded but no media URL in content.', raw: taskData };
    }
    if (taskStatus === 'failed' || taskStatus === 'error') {
      const detail = (taskData && (taskData.detail || taskData.error || taskData.message)) || 'Task failed';
      return { ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail), raw: taskData };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, error: 'Timed out waiting for video generation task to complete.', raw: null };
}

async function handleVideoGenerations(body, authHeader) {
  if (!validateToken(authHeader)) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const prompt = normalizeInputString(body?.prompt);
  if (!prompt) {
    return jsonResponse({ error: { message: 'prompt is required', type: 'invalid_request_error' } }, 400);
  }

  const actualModel = normalizeInputString(body?.model) || 'qwen3.8-max';
  const responseFormat = normalizeInputString(body?.response_format) || 'url';
  if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
    return jsonResponse({ error: { message: 'response_format must be one of url or b64_json', type: 'invalid_request_error' } }, 400);
  }

  const qwenRatio = mapOpenAiImageSizeToQwenRatio(body?.size) || '16:9';
  const durationRaw = body?.duration;
  const duration = Number.isFinite(durationRaw) ? Number(durationRaw) : Number.parseInt(String(durationRaw || ''), 10);

  const qwenCookie = body?.qwen_cookie || '';
  const usingAuth = !!qwenCookie.trim();

  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();
  const cookies = { bxUa, bxUmidToken, bxV, cookies: qwenCookie };

  const createResp = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Cookie': qwenCookie,
      'Referer': 'https://chat.qwen.ai/c/guest',
      'source': 'web',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ title: '新建对话', models: [actualModel], chat_mode: usingAuth ? 'chat' : 'guest', chat_type: 't2v', timestamp: Date.now(), project_id: '' }),
  });
  const createParsed = await safeReadJson(createResp);
  if (!createParsed.ok) {
    const preview = createParsed.rawText ? createParsed.rawText.slice(0, 300) : '(empty)';
    console.log(`[qwen2api][vercel][video] Create chat session failed: HTTP ${createResp.status}, body: ${preview}`);
    return jsonResponse({ error: { message: `Failed to create video chat session (HTTP ${createResp.status}).`, type: 'api_error' } }, createResp.ok ? 502 : createResp.status);
  }
  const createData = createParsed.data;
  if (!createData?.success || !createData?.data?.id) {
    const errMsg = createData?.data?.details || createData?.data?.message || createData?.data?.code || 'Failed to create video chat session';
    return jsonResponse({ error: { message: errMsg, type: 'api_error' } }, 500);
  }
  const chatId = createData.data.id;

  const chatResp = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Cookie': qwenCookie,
      'x-accel-buffering': 'no',
      'source': 'web',
      'version': '0.2.83',
      'Referer': 'https://chat.qwen.ai/c/guest',
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: chatId,
      chat_mode: usingAuth ? 'chat' : 'guest',
      model: actualModel,
      parent_id: null,
      messages: [{
        fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content: prompt,
        user_action: 'chat', files: [], timestamp: Date.now(), models: [actualModel], chat_type: 't2v',
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_mode: 'Auto', thinking_format: 'summary', auto_search: false, video_generation: true },
        extra: { meta: { subChatType: 't2v' } }, sub_chat_type: 't2v', parent_id: null,
      }],
      timestamp: Date.now(),
      size: qwenRatio,
      ...(Number.isFinite(duration) ? { duration } : {}),
    }),
  });

  const rawText = await chatResp.text().catch(() => '');
  if (!chatResp.ok) {
    return jsonResponse({ error: { message: rawText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }

  const firstChar = rawText.trimStart().charAt(0);
  if (firstChar === '{' || firstChar === '[') {
    let parsed;
    try { parsed = JSON.parse(rawText); } catch {}
    if (parsed && parsed.success === false) {
      const errData = parsed.data || parsed;
      const msg = errData.details || errData.message || errData.code || 'Upstream request failed';
      return jsonResponse({ error: { message: msg, type: 'api_error', code: errData.code } }, 502);
    }
  }

  const taskId = extractAsyncTaskIdFromUpstreamSse(rawText);
  if (!taskId) {
    const upstreamError = extractUpstreamErrorFromSse(rawText);
    if (upstreamError) {
      return jsonResponse({ error: { message: upstreamError.message, type: 'api_error', code: upstreamError.code } }, 502);
    }
    console.log('[qwen2api][vercel][video] Upstream SSE response with no async taskId:');
    console.log(rawText.slice(0, 2000));
    const hint = usingAuth
      ? 'Upstream did not return a video generation task id (the session may be unauthorized for video).'
      : 'Upstream did not return a video generation task id. t2v requires an authenticated qwen session — pass your logged-in cookie via the qwen_cookie field.';
    return jsonResponse({ error: { message: hint, type: 'api_error' } }, 502);
  }

  console.log(`[qwen2api][vercel][video] got taskId=${taskId}, polling for completion...`);
  const pollResult = await pollQwenTaskUntilDone(taskId, cookies, { intervalMs: 5000, maxAttempts: 60 });
  if (!pollResult.ok) {
    return jsonResponse({ error: { message: pollResult.error, type: 'api_error' } }, 502);
  }

  const created = Math.floor(Date.now() / 1000);
  if (responseFormat === 'url') {
    return jsonResponse({ created, data: [{ url: pollResult.url }] });
  }

  try {
    const resp = await fetch(pollResult.url);
    if (!resp.ok) throw new Error(`Failed to fetch video: HTTP ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return jsonResponse({ created, data: [{ b64_json: bytesToBase64(bytes) }] });
  } catch (err) {
    const message = err && err.message ? err.message : 'Failed to fetch video bytes';
    return jsonResponse({ error: { message, type: 'api_error' } }, 502);
  }
}

async function handleChatCompletionsWithLogs(body, authHeader) {
  const baseResponse = await handleChatCompletions(body, authHeader);
  const contentType = String(baseResponse?.headers?.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('text/event-stream') || !baseResponse?.body) {
    return baseResponse;
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const reader = baseResponse.body.getReader();

  (async () => {
    try {
      const logEvent = {
        event: 'request.received',
        timestamp: Date.now(),
        model: body?.model || 'qwen3.8-max',
        messageCount: Array.isArray(body?.messages) ? body.messages.length : 0,
        chatType: body?.chat_type || 't2t',
        enableSearch: !!body?.enable_search,
        ...(body?.video_url ? { videoUrl: body.video_url } : {}),
      };
      await writer.write(encoder.encode('event: log\n'));
      await writer.write(encoder.encode(`data: ${JSON.stringify(logEvent)}\n\n`));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } finally {
      await writer.close();
    }
  })();

  const headers = new Headers(baseResponse.headers);
  headers.set('Content-Type', 'text/event-stream');
  return new Response(readable, { status: baseResponse.status, headers });
}

// ============================================
// Handler 入口
// ============================================

export default async function handler(request) {
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
  const rawPath = url.pathname;
  const apiPrefix = '/api';
  const path = rawPath === apiPrefix
    ? '/'
    : (rawPath.startsWith(apiPrefix + '/') ? rawPath.slice(apiPrefix.length) : rawPath);
  const authHeader = request.headers.get('Authorization') || '';

  if (request.method === 'GET' && path === '/v1/models') {
    return handleModels(authHeader);
  }
  if (request.method === 'POST' && path === '/v1/chat/completions/log') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { message: 'Invalid JSON body.', type: 'invalid_request_error' } }, 400);
    }
    return handleChatCompletionsWithLogs(body, authHeader);
  }
  if (request.method === 'POST' && path === '/v1/chat/completions') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { message: 'Invalid JSON body.', type: 'invalid_request_error' } }, 400);
    }
    return handleChatCompletions(body, authHeader);
  }
  if (request.method === 'POST' && path === '/v1/images/generations') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { message: 'Invalid JSON body.', type: 'invalid_request_error' } }, 400);
    }
    return handleImageGenerations(body, authHeader);
  }
  if (request.method === 'POST' && path === '/v1/videos/generations') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { message: 'Invalid JSON body.', type: 'invalid_request_error' } }, 400);
    }
    return handleVideoGenerations(body, authHeader);
  }
  if (request.method === 'GET' && (path === '/chat' || path === '/chat/')) {
    return handleChatPage();
  }
  if (request.method === 'GET' && (path === '/' || path === '')) {
    return new Response('<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>', { headers: { 'Content-Type': 'text/html' } });
  }
  return jsonResponse({ error: { message: 'Not found', type: 'invalid_request_error' } }, 404);
}
