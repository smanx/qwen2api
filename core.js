/**
 * 核心业务逻辑 - 所有平台共用
 */

// ============================================
// UUID 生成 (内联，避免 ESM 问题)
// ============================================

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ============================================
// 配置
// ============================================

const BAXIA_VERSION = '2.5.36';
const CACHE_TTL = 4 * 60 * 1000;
let tokenCache = null;
let tokenCacheTime = 0;

// ============================================
// Baxia Token 生成
// ============================================

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const randomBytes = cryptoRandomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

function cryptoRandomBytes(length) {
  // Node.js 环境 (包括 Vercel/Netlify)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return require('crypto').randomBytes(length);
  }
  // Cloudflare Workers / 浏览器
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function cryptoHash(data) {
  // Node.js 环境 (包括 Vercel/Netlify)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return require('crypto').createHash('md5').update(data).digest('base64').substring(0, 32);
  }
  // Cloudflare Workers / 浏览器 - 返回随机字符串
  return randomString(32);
}

function generateWebGLFingerprint() {
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)',
  ];
  return { renderer: renderers[Math.floor(Math.random() * renderers.length)], vendor: 'Google Inc. (Intel)' };
}

async function collectFingerprintData() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US', 'zh-CN', 'en-GB'];
  const canvas = cryptoHash(cryptoRandomBytes(32));
  
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
  const jsonStr = JSON.stringify(data);
  let encoded;
  if (typeof Buffer === 'undefined') {
    encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  } else {
    encoded = Buffer.from(jsonStr).toString('base64');
  }
  return `${BAXIA_VERSION.replace(/\./g, '')}!${encoded}`;
}

async function getBaxiaTokens() {
  const now = Date.now();
  if (tokenCache && (now - tokenCacheTime) < CACHE_TTL) {
    return tokenCache;
  }
  
  const bxUa = encodeBaxiaToken(await collectFingerprintData());
  let bxUmidToken;
  try {
    const resp = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    bxUmidToken = resp.headers.get('etag') || 'T2gA' + randomString(40);
  } catch { bxUmidToken = 'T2gA' + randomString(40); }
  
  const result = { bxUa, bxUmidToken, bxV: BAXIA_VERSION };
  tokenCache = result;
  tokenCacheTime = now;
  return result;
}

// ============================================
// 认证
// ============================================

function getApiTokens(env) {
  const tokens = env?.API_TOKENS || process?.env?.API_TOKENS;
  if (!tokens) return [];
  return tokens.split(',').map(t => t.trim()).filter(t => t);
}

function validateToken(authHeader, env) {
  const tokens = getApiTokens(env);
  if (tokens.length === 0) return true;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return tokens.includes(token);
}

// ============================================
// 响应工具
// ============================================

function createResponse(body, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function createStreamResponse(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
    body,
  };
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
  if (explicitType === 'image' || explicitType === 'audio' || explicitType === 'document') {
    return explicitType;
  }
  const mime = normalizeMimeType(mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
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
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/json': 'json',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
  };
  return mapping[mime] || 'bin';
}

function decodeBase64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
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
  if (name) {
    return name;
  }
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

function pushTextPart(parts, value) {
  const text = normalizeInputString(value);
  if (text) {
    parts.push(text);
  }
}

function normalizeContentParts(content) {
  if (typeof content === 'string') {
    const text = normalizeInputString(content);
    return {
      text,
      attachments: [],
    };
  }

  if (!Array.isArray(content)) {
    return {
      text: '',
      attachments: [],
    };
  }

  const textParts = [];
  const attachments = [];

  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      pushTextPart(textParts, part);
      continue;
    }

    const type = part.type || '';
    if (type === 'text' || type === 'input_text') {
      pushTextPart(textParts, part.text || part.input_text);
      continue;
    }

    if (type === 'image_url' || type === 'input_image') {
      const imageUrl = normalizeInputString(
        part.image_url?.url ||
        part.image_url ||
        part.url ||
        part.file_url ||
        part.file_data
      );
      if (imageUrl) {
        attachments.push({
          source: imageUrl,
          filename: normalizeInputString(part.filename) || normalizeInputString(part.name),
          mimeType: normalizeInputString(part.mime_type) || normalizeInputString(part.content_type),
          explicitType: 'image',
        });
      }
      continue;
    }

    if (type === 'file' || type === 'input_file' || type === 'audio' || type === 'input_audio') {
      const fileSource = normalizeInputString(part.file_data || part.url || part.file_url || part.data);
      if (fileSource) {
        attachments.push({
          source: fileSource,
          filename: normalizeInputString(part.filename) || normalizeInputString(part.name),
          mimeType: normalizeInputString(part.mime_type) || normalizeInputString(part.content_type),
          explicitType: type.includes('audio') ? 'audio' : undefined,
        });
      }
      continue;
    }

    if (typeof part.text === 'string') {
      pushTextPart(textParts, part.text);
    }
  }

  return {
    text: textParts.join('\n'),
    attachments,
  };
}

function normalizeLegacyFiles(message) {
  const attachments = [];
  const candidates = [...toArray(message?.attachments), ...toArray(message?.files)];
  for (const item of candidates) {
    if (!item) continue;
    const source = normalizeInputString(item.data || item.file_data || item.url || item.file_url);
    if (!source) continue;
    attachments.push({
      source,
      filename: normalizeInputString(item.filename) || normalizeInputString(item.name),
      mimeType: normalizeInputString(item.mime_type) || normalizeInputString(item.content_type) || normalizeInputString(item.type),
      explicitType: item.type,
    });
  }
  return attachments;
}

function parseIncomingMessages(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalized = safeMessages.map(message => {
    const parsed = normalizeContentParts(message?.content);
    return {
      role: message?.role || 'user',
      text: parsed.text,
      attachments: [...parsed.attachments, ...normalizeLegacyFiles(message)],
    };
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
  const merged = history
    ? `${history}\n\n[User]: ${lastText}`
    : lastText;

  return {
    content: merged,
    attachments: last.attachments,
  };
}

async function getAttachmentBytes(attachment) {
  const dataParsed = parseDataUrl(attachment.source);
  if (dataParsed) {
    return {
      bytes: dataParsed.bytes,
      mimeType: attachment.mimeType || dataParsed.mimeType,
      filename: inferFilename(attachment.filename, attachment.mimeType || dataParsed.mimeType),
    };
  }

  if (/^https?:\/\//i.test(attachment.source)) {
    const resp = await fetch(attachment.source);
    if (!resp.ok) {
      throw new Error(`Failed to fetch attachment URL: ${resp.status}`);
    }
    const mimeType = attachment.mimeType || resp.headers.get('content-type') || 'application/octet-stream';
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return {
      bytes,
      mimeType,
      filename: inferFilename(attachment.filename, mimeType),
    };
  }

  const maybeBase64 = attachment.source.replace(/\s+/g, '');
  const bytes = decodeBase64ToBytes(maybeBase64);
  const mimeType = attachment.mimeType || 'application/octet-stream';
  return {
    bytes,
    mimeType,
    filename: inferFilename(attachment.filename, mimeType),
  };
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
    body: JSON.stringify({
      filename: file.filename,
      filesize: file.bytes.length,
      filetype,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.success || !data?.data?.file_url) {
    throw new Error(`Failed to get upload token: ${resp.status}`);
  }

  return {
    tokenData: data.data,
    filetype,
  };
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

function getWebCrypto() {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  if (typeof require === 'function') {
    const nodeCrypto = require('crypto');
    if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) {
      return nodeCrypto.webcrypto;
    }
  }
  throw new Error('WebCrypto is not available');
}

async function sha256Hex(input) {
  const cryptoApi = getWebCrypto();
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await cryptoApi.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hash));
}

async function hmacSha256(keyBytes, content) {
  const cryptoApi = getWebCrypto();
  const cryptoKey = await cryptoApi.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const signature = await cryptoApi.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

async function buildOssSignedHeaders(uploadUrl, tokenData, file) {
  const parsedUrl = new URL(uploadUrl);
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
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    '',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const credentialScope = `${dateScope}/${region}/oss/aliyun_v4_request`;
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    xOssDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

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
  if (!uploadUrl) {
    throw new Error('Upload failed: missing upload URL');
  }
  const signedHeaders = await buildOssSignedHeaders(tokenData.file_url, tokenData, file);
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: signedHeaders,
    body: file.bytes,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Upload failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
}

async function parseDocumentIfNeeded(qwenFilePayload, filetype, file, baxiaTokens) {
  const mime = (file.mimeType || '').toLowerCase();
  const isTextLike = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'text/markdown';
  if (filetype !== 'document' || !isTextLike) return;
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
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Parse document failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
  logChatDetail('core', 'attachments.parse.document.done', {
    fileId: qwenFilePayload.id,
    filename: file.filename,
  });
}

function extractUploadedFileId(fileUrl) {
  try {
    const pathname = decodeURIComponent(new URL(fileUrl).pathname);
    const filename = pathname.split('/').pop() || '';
    if (filename.includes('_')) {
      return filename.split('_')[0];
    }
  } catch {}
  return uuidv4();
}

function buildQwenFilePayload(file, tokenData, filetype) {
  const now = Date.now();
  const id = extractUploadedFileId(tokenData.file_url);
  return {
    type: filetype,
    file: {
      created_at: now,
      data: {},
      filename: file.filename,
      hash: null,
      id,
      meta: {
        name: file.filename,
        size: file.bytes.length,
        content_type: file.mimeType,
      },
      update_at: now,
    },
    id,
    url: tokenData.file_url,
    name: file.filename,
    collection_name: '',
    progress: 100,
    status: 'uploaded',
    is_uploading: false,
    error: null,
  };
}

async function uploadAttachments(attachments, baxiaTokens) {
  logChatDetail('core', 'attachments.upload.start', { count: attachments.length });
  const files = [];
  for (let i = 0; i < attachments.length; i++) {
    const rawAttachment = attachments[i];
    const loaded = await getAttachmentBytes(rawAttachment);
    loaded.explicitType = rawAttachment.explicitType;
    logChatDetail('core', 'attachments.upload.file.prepare', {
      index: i,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      size: loaded.bytes.length,
    });
    const { tokenData, filetype } = await requestUploadToken(loaded, baxiaTokens);
    await uploadFileToQwenOss(loaded, tokenData);
    const qwenFilePayload = buildQwenFilePayload(loaded, tokenData, filetype);
    await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, baxiaTokens);
    files.push(qwenFilePayload);
    logChatDetail('core', 'attachments.upload.file.done', {
      index: i,
      filetype,
      filename: loaded.filename,
    });
  }
  logChatDetail('core', 'attachments.upload.done', { uploaded: files.length });
  return files;
}

// ============================================
// API Handlers
// ============================================

async function handleModels(authHeader, env) {
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }
  try {
    const resp = await fetch('https://chat.qwen.ai/api/models', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    return createResponse(await resp.json());
  } catch {
    return createResponse({ error: { message: 'Failed to fetch models', type: 'api_error' } }, 500);
  }
}

async function handleChatCompletions(body, authHeader, env, streamWriter) {
  logChatDetail('core', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  if (!validateToken(authHeader, env)) {
    logChatDetail('core', 'request.auth.failed', {});
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true } = body;
  if (!messages?.length) {
    logChatDetail('core', 'request.validation.failed', { reason: 'Messages are required' });
    return createResponse({ error: { message: 'Messages are required' } }, 400);
  }

  logChatDetail('core', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.5-plus',
    messageCount: Array.isArray(messages) ? messages.length : 0,
  });

  const actualModel = model || 'qwen3.5-plus';
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  // 检查是否启用搜索
  const enableSearch = (env?.ENABLE_SEARCH || process?.env?.ENABLE_SEARCH || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';
  logChatDetail('core', 'request.config', { actualModel, chatType, enableSearch });

  // 创建会话
  const createResp = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
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
  logChatDetail('core', 'chat.create.response', {
    status: createResp.status,
    success: !!createData?.success,
    hasChatId: !!createData?.data?.id,
  });
  if (!createData.success || !createData.data?.id) {
    return createResponse({ error: { message: 'Failed to create chat session' } }, 500);
  }
  const chatId = createData.data.id;

  // 解析 OpenAI 兼容消息与附件
  const parsedMessages = parseIncomingMessages(messages);
  const content = parsedMessages.content;
  logChatDetail('core', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  const uploadedFiles = parsedMessages.attachments.length > 0
    ? await uploadAttachments(parsedMessages.attachments, { bxUa, bxUmidToken, bxV })
    : [];
  logChatDetail('core', 'message.ready', {
    uploadedFileCount: uploadedFiles.length,
  });

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
    logChatDetail('core', 'chat.completion.error', { status: chatResp.status, chatId });
    return createResponse({ error: { message: await chatResp.text() } }, chatResp.status);
  }
  logChatDetail('core', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 如果有流写入器 (Express)，使用真正的流式
  if (streamWriter && stream) {
    logChatDetail('core', 'stream.proxy.express', { chatId, model: actualModel });
    return streamWriter(chatResp, actualModel, responseId, created);
  }

  // 默认：收集完整响应
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
  logChatDetail('core', 'chat.completion.collected', {
    chunkCount: chunks.length,
    outputLength: chunks.join('').length,
    stream: !!stream,
  });

  if (stream) {
    const streamBody = chunks.map((c, i) => `data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model: actualModel,
      choices: [{ index: 0, delta: { content: c }, finish_reason: i === chunks.length - 1 ? 'stop' : null }]
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    return createStreamResponse(streamBody);
  }

  return createResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

function handleRoot() {
  const html = '<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>';
  return createResponse(html, 200, { 'Content-Type': 'text/html' });
}

// ============================================
// 导出
// ============================================

module.exports = {
  handleModels,
  handleChatCompletions,
  handleRoot,
  createResponse,
  validateToken,
  getBaxiaTokens,
  uuidv4,
};
