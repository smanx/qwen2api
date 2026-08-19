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
const QWEN_BASE_URL = 'https://chat.qwen.ai';
const QWEN_WEB_REFERER = `${QWEN_BASE_URL}/`;
const QWEN_GUEST_REFERER = `${QWEN_BASE_URL}/c/guest`;
const WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const WEB_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
let tokenCache = null;
let tokenCacheTime = 0;

// ============================================
// 跨平台 require 助手
// ============================================

// 动态加载 Node 内置模块：Node 环境正常返回模块；无 require 的环境
// （Cloudflare Workers 等）返回 null，由调用方优雅降级。
// 注意：必须通过本函数间接 require，避免 esbuild 静态打包 Node 内置模块
// 导致 CF Worker 构建失败。
function nodeRequire(name) {
  if (typeof require !== 'function') return null;
  try {
    return require(name);
  } catch {
    return null;
  }
}

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
  // Node 环境优先用 crypto.randomBytes；其他环境回退 WebCrypto
  const nodeCrypto = nodeRequire('crypto');
  if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
    return nodeCrypto.randomBytes(length);
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function cryptoHash(data) {
  // Node 环境用 MD5；其他环境（CF Workers / 浏览器）返回随机字符串
  const nodeCrypto = nodeRequire('crypto');
  if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
    return nodeCrypto.createHash('md5').update(data).digest('base64').substring(0, 32);
  }
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

async function getBaxiaTokens(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && tokenCache && (now - tokenCacheTime) < CACHE_TTL) {
    return tokenCache;
  }

  // 优先用真实 baxia SDK（系统 Chrome 无头模式生成有效 token）。
  // 仅在本地 Node 环境可用；serverless / CF Workers 无 Chrome 时自动回退 wu.json。
  const isNodeRuntime = typeof process !== 'undefined' && process.versions && typeof process.versions.node === 'string';
  const chromeEnabled = isNodeRuntime && (!process.env || process.env.USE_CHROME_BAXIA !== 'false');
  if (chromeEnabled) {
    try {
      const baxiaMod = nodeRequire('./scripts/baxia-token.js');
      if (baxiaMod && typeof baxiaMod.getBaxiaTokens === 'function') {
        const t = await baxiaMod.getBaxiaTokens();
        if (t && t.bxUmidToken && /^T2gA/i.test(t.bxUmidToken)) {
          const result = { bxUa: t.bxUa, bxUmidToken: t.bxUmidToken, bxV: t.bxV || '2.5.37', cookies: t.cookies || '' };
          tokenCache = result;
          tokenCacheTime = now;
          return result;
        } else {
          console.log('[qwen2api][baxia] Chrome branch returned invalid token, fallback');
        }
      } else {
        console.log('[qwen2api][baxia] baxia SDK unavailable in this runtime, fallback');
      }
    } catch (e) {
      console.log('[qwen2api][baxia] Chrome branch failed:', e.message);
    }
  }

  const bxUa = encodeBaxiaToken(await collectFingerprintData());
  let bxUmidToken;
  try {
    const resp = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      headers: { 'User-Agent': WEB_USER_AGENT }
    });
    const bodyText = await resp.text();
    // wu.json body: try{umx.wu('T2gA...');}catch(e){} try{__fycb('T2gA...');}catch(e){}
    // The token inside is the real umid token required by the upstream API.
    const m = bodyText.match(/umx\.wu\('([^']+)'\)/) || bodyText.match(/'([^']+)'/);
    bxUmidToken = (m && m[1]) || resp.headers.get('etag') || '';
  } catch { bxUmidToken = ''; }
  if (!bxUmidToken || !/^T2gA/i.test(bxUmidToken)) {
    // Fallback only to avoid crashing; upstream will likely reject a fake token.
    bxUmidToken = 'T2gA' + randomString(40);
  }
  
  const result = { bxUa, bxUmidToken, bxV: BAXIA_VERSION };
  tokenCache = result;
  tokenCacheTime = now;
  return result;
}

// 创建会话，失败（风控/网络）时自动换 token 重试
async function createChatSession(actualModel, chatType, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { bxUa, bxUmidToken, bxV, cookies } = await getBaxiaTokens(attempt > 0);
    try {
      const createHeaders = {
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
        'Cookie': cookies,
        'Origin': QWEN_BASE_URL,
        'Referer': QWEN_GUEST_REFERER, 'source': 'web',
        'version': '0.2.83',
        'User-Agent': WEB_USER_AGENT,
        'Accept-Language': WEB_ACCEPT_LANGUAGE,
        'x-request-id': uuidv4()
      };
      const createBody = {
        title: '新建对话', models: [actualModel], chat_mode: 'guest', chat_type: chatType,
        timestamp: Date.now(), project_id: ''
      };
      const createResp = await fetch(`${QWEN_BASE_URL}/api/v2/chats/new`, {
        method: 'POST',
        headers: createHeaders,
        body: JSON.stringify(createBody)
      });
      const createParsed = await safeReadJson(createResp);
      if (!createParsed.ok) {
        lastErr = { parsed: createParsed, status: createResp.status, resp: createResp };
        const preview = createParsed.rawText ? createParsed.rawText.slice(0, 300) : '(empty)';
        console.log(`[qwen2api][chat] Create chat session failed (attempt ${attempt + 1}): HTTP ${createResp.status}, body: ${preview}`);
        continue;
      }
      const createData = createParsed.data;
      if (!createData.success || !createData.data?.id) {
        const parsedErr = tryParseUpstreamErrorPayload(createParsed.rawText);
        lastErr = { parsed: createParsed, status: createResp.status, resp: createResp, parsedErr };
        console.log(`[qwen2api][chat] Create chat session error (attempt ${attempt + 1}): ${JSON.stringify(createData?.data || createData)}`);
        // 风控/限流类错误值得重试
        if (parsedErr?.riskControlled || parsedErr?.code === 'rgv587' || /rgv.?587/i.test(createParsed.rawText || '')) {
          await new Promise(resolve => setTimeout(resolve, 600));
          continue;
        }
        return createResponse({ error: { message: createData?.data?.details || createData?.data?.message || createData?.data?.code || parsedErr?.message || 'Failed to create chat session', type: 'api_error', ...(parsedErr?.code ? { code: parsedErr.code } : {}) } }, 500);
      }
      return { chatId: createData.data.id, bxUa, bxUmidToken, bxV, cookies };
    } catch (err) {
      lastErr = { error: err, status: 0, resp: null };
      console.log(`[qwen2api][chat] Create chat session exception (attempt ${attempt + 1}): ${err && err.message ? err.message : String(err)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // 全部失败，返回最合理的错误
  const last = lastErr || {};
  if (last.parsed) {
    const parsed = last.parsed;
    const preview = parsed.rawText ? parsed.rawText.slice(0, 300) : '(empty)';
    const wafMatch = preview.match(/aliyun_waf/i);
    const msg = wafMatch
      ? 'Upstream WAF blocked the request. The IP may be rate-limited or banned by Aliyun WAF.'
      : (last.parsedErr?.message || `Failed to create chat session: upstream returned non-JSON response (HTTP ${last.status}).`);
    return createResponse({ error: { message: msg, type: 'api_error', ...(last.parsedErr?.code ? { code: last.parsedErr.code } : {}) } }, last.status && last.status >= 400 ? last.status : 502);
  }
  const errMsg = last.error && last.error.message ? last.error.message : 'Failed to create chat session';
  return createResponse({ error: { message: errMsg, type: 'api_error' } }, 502);
}

// ============================================
// 认证
// ============================================

function getApiTokens(env) {
  // 注意：不能用 process?.env 直接访问——在 CF Workers 等无 process 的环境里，
  // 未声明的标识符会直接抛 ReferenceError（可选链救不了未声明变量）。
  let tokens = env?.API_TOKENS;
  if (!tokens && typeof process !== 'undefined' && process?.env) {
    tokens = process.env.API_TOKENS;
  }
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body,
  };
}

function previewBody(rawText, maxLen = 240) {
  const text = normalizeInputString(rawText || '');
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
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
  if (explicitType === 'image' || explicitType === 'audio' || explicitType === 'video' || explicitType === 'document') {
    return explicitType;
  }
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
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/avi': 'avi',
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
  const thoughtContent = normalizeReasoningFragments(delta?.extra?.summary_thought?.content);
  if (thoughtContent.length > 0) return thoughtContent.join('\n');
  return '';
}

function mapUpstreamDeltaToOpenAI(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const mapped = {};
  // OpenAI API 规范: 流式响应中 delta.role 只能是 "assistant" 或不设置
  // 当上游返回 "function" 等角色时，不设置 role 字段
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
      if (parsed?.usage && typeof parsed.usage === 'object') {
        usage = parsed.usage;
      }
      const upstreamDelta = parsed?.choices?.[0]?.delta;
      const delta = mapUpstreamDeltaToOpenAI(upstreamDelta);
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

// ============================================
// 工具调用 (Tool Calling)
// 上游 chat.qwen.ai 无原生 function calling：
// 注入提示词让模型输出 Qwen 原生 Hermes 语法，再筛回 OpenAI tool_calls。
// 语法只在这一节定义，流式与缓冲两条路径共用，避免漂移。
// 注入的只有 Hermes 一种；XML <invoke> 形式仅在解析侧接受，作为模型漂移时的兜底。
// ============================================

const TOOL_MARKERS = [
  { open: '<tool_call>', close: '</tool_call>', kind: 'json' },
  { open: '<tool_calls>', close: '</tool_calls>', kind: 'xml' },
];

function normalizeToolChoice(toolChoice) {
  if (toolChoice === 'none') return { mode: 'none' };
  if (toolChoice === 'required') return { mode: 'required' };
  if (toolChoice && typeof toolChoice === 'object') {
    const name = normalizeInputString(toolChoice.function?.name || toolChoice.name);
    if (name) return { mode: 'function', name };
  }
  return { mode: 'auto' };
}

function buildToolPrompt(tools, toolChoice) {
  const list = Array.isArray(tools) ? tools.filter((tool) => tool && (tool.function || tool.name)) : [];
  if (list.length === 0) return '';
  const choice = normalizeToolChoice(toolChoice);
  if (choice.mode === 'none') return '';
  const signatures = list.map((tool) => JSON.stringify(tool.function || tool)).join('\n');
  let mandate = '';
  if (choice.mode === 'required') mandate = '\n\nYou MUST call at least one function in this turn.';
  // 名称来自调用方，必须转义后再插入提示词
  if (choice.mode === 'function') mandate = `\n\nYou MUST call the function ${JSON.stringify(choice.name)} in this turn.`;
  return [
    '# Tools',
    '',
    'You may call one or more functions to assist with the user query.',
    '',
    'You are provided with function signatures within <tools></tools> XML tags:',
    '<tools>',
    signatures,
    '</tools>',
    '',
    'For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:',
    '<tool_call>',
    '{"name": <function-name>, "arguments": <args-json-object>}',
    '</tool_call>',
    '',
    'Emit <tool_call> tags only outside code fences; a tag inside ``` or inline code is never executed.',
  ].join('\n') + mandate;
}

function newToolCallId() {
  return `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
}

// arguments 必须是可 JSON.parse 的对象字符串，否则客户端会在解析时炸掉；
// 无法规范化时返回 null，整块按“畸形”原样释放为文本。
function normalizeToolArguments(args) {
  let value = args;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '{}';
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (value === undefined || value === null) return '{}';
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function makeToolCall(name, args) {
  const safeName = normalizeInputString(name);
  if (!safeName) return null;
  const serialized = normalizeToolArguments(args);
  if (serialized === null) return null;
  return { id: newToolCallId(), type: 'function', function: { name: safeName, arguments: serialized } };
}

function stripCdata(value) {
  const matched = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return matched ? matched[1] : value;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function coerceParameterValue(raw) {
  const cdata = stripCdata(raw);
  // CDATA 内是原样载荷，不做实体解码
  const text = cdata === raw ? decodeXmlEntities(raw) : cdata;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (/^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null|\[[\s\S]*\]|\{[\s\S]*\})$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function parseJsonToolBlock(inner) {
  let parsed;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const calls = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return [];
    const call = makeToolCall(
      item.name || item.function?.name,
      item.arguments ?? item.parameters ?? item.function?.arguments,
    );
    if (!call) return [];
    calls.push(call);
  }
  return calls;
}

function parseXmlToolBlock(inner) {
  const calls = [];
  const invokeRe = /<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/g;
  let invoke;
  while ((invoke = invokeRe.exec(inner)) !== null) {
    // null 原型：参数名由模型产出，不能让 __proto__ 之类污染原型
    const args = Object.create(null);
    const paramRe = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/g;
    let param;
    while ((param = paramRe.exec(invoke[2])) !== null) {
      if (param[1] === '__proto__' || param[1] === 'constructor' || param[1] === 'prototype') continue;
      args[param[1]] = coerceParameterValue(param[2]);
    }
    const call = makeToolCall(invoke[1], args);
    if (!call) return [];
    calls.push(call);
  }
  return calls;
}

function parseToolCallBlock(raw, marker) {
  const inner = raw.slice(marker.open.length, raw.length - marker.close.length);
  return marker.kind === 'json' ? parseJsonToolBlock(inner.trim()) : parseXmlToolBlock(inner);
}

// Qwen Web 自带工具层会尝试在它自己的注册表里解析我们的工具名，失败后把
// "Tool xxx does not exists." 塞进输出流。这不是模型的回答，是上游噪声。
const TOOL_NOISE_RE = /^Tool\s+\S+\s+does not exists?\.[ \t]*\n?/i;
const TOOL_NOISE_MAX = 96;

function matchToolNoise(rest, final) {
  const matched = TOOL_NOISE_RE.exec(rest);
  if (matched) {
    // 匹配正好吃到 rest 末尾时，后面可能还有属于噪声的空白/换行。
    // 不等到能区分就消费，切块位置不同会得出不同结果。
    if (!final && matched[0].length === rest.length) return 'partial';
    return matched[0].length;
  }
  // 还可能随后续文本长成一次完整匹配吗？
  if (!final && rest.length < TOOL_NOISE_MAX && /^T(o(o(l(\s[\s\S]*)?)?)?)?$/i.test(rest)) return 'partial';
  return null;
}

function matchToolMarker(rest) {
  for (const marker of TOOL_MARKERS) {
    if (rest.startsWith(marker.open)) return marker;
  }
  for (const marker of TOOL_MARKERS) {
    if (marker.open.startsWith(rest)) return 'partial';
  }
  return null;
}

// 增量筛选器：普通文本实时放行；只有可能是标记前缀的尾巴才回退缓冲。
// 解析失败的块原样作为文本释放，绝不静默吞掉。
const MAX_TOOL_CAPTURE_BYTES = 256 * 1024;
const MAX_LINE_SCAN_BYTES = 4096;

function createToolCallSieve() {
  let pending = '';
  let curLine = '';
  let fence = null;
  let inInline = false;
  let capture = null;
  const calls = [];

  function applyLineState(line) {
    inInline = false;
    const text = line.replace(/\r?\n$/, '');
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (!opener) return;
    const char = opener[1][0];
    const len = opener[1].length;
    if (fence) {
      if (char === fence.char && len >= fence.len && /^\s*$/.test(text.slice(opener[0].length))) fence = null;
    } else {
      fence = { char, len };
    }
  }

  function drain(final) {
    let out = '';
    for (;;) {
      if (capture) {
        const idx = pending.indexOf(capture.marker.close);
        if (idx === -1) {
          // 开标记始终不闭合时，超过上限就整块当文本放行，避免无限缓冲和静默卡流
          if (!final && capture.raw.length + pending.length <= MAX_TOOL_CAPTURE_BYTES) return out;
          out += capture.raw + pending;
          pending = '';
          capture = null;
          if (!final) continue;
          return out;
        }
        const raw = capture.raw + pending.slice(0, idx + capture.marker.close.length);
        pending = pending.slice(idx + capture.marker.close.length);
        const parsed = parseToolCallBlock(raw, capture.marker);
        capture = null;
        curLine = '';
        inInline = false;
        if (parsed.length > 0) {
          for (const call of parsed) calls.push(call);
        } else {
          out += raw;
        }
        continue;
      }

      let i = 0;
      // 消费掉标记或噪声后置位：跳出内层扫描，让外层循环用更新后的 pending 重来
      let restart = false;
      while (i < pending.length) {
        const ch = pending[i];
        if (ch === '\n') {
          if (curLine.length < MAX_LINE_SCAN_BYTES) curLine += ch;
          applyLineState(curLine);
          curLine = '';
          i += 1;
          continue;
        }
        if (!fence && ch === '`') {
          inInline = !inInline;
          if (curLine.length < MAX_LINE_SCAN_BYTES) curLine += ch;
          i += 1;
          continue;
        }
        if (!fence && !inInline && (ch === 'T' || ch === 't')) {
          const noise = matchToolNoise(pending.slice(i), final);
          if (noise === 'partial') {
            if (!final) {
              out += pending.slice(0, i);
              pending = pending.slice(i);
              return out;
            }
          } else if (noise) {
            out += pending.slice(0, i);
            pending = pending.slice(i + noise);
            restart = true;
            break;
          }
        }
        if (!fence && !inInline && ch === '<') {
          const matched = matchToolMarker(pending.slice(i));
          if (matched === 'partial') {
            if (!final) {
              out += pending.slice(0, i);
              pending = pending.slice(i);
              return out;
            }
          } else if (matched) {
            out += pending.slice(0, i);
            capture = { marker: matched, raw: matched.open };
            pending = pending.slice(i + matched.open.length);
            restart = true;
            break;
          }
        }
        if (curLine.length < MAX_LINE_SCAN_BYTES) curLine += ch;
        i += 1;
      }
      if (restart) continue;
      out += pending;
      pending = '';
      return out;
    }
  }

  return {
    push(text) {
      if (typeof text !== 'string' || !text) return '';
      pending += text;
      return drain(false);
    },
    flush() {
      const content = drain(true);
      // 未闭合的代码围栏会压制其后所有标记；报出来才能诊断“整轮工具调用消失”
      return { content, tool_calls: calls.slice(), unterminatedFence: !!fence };
    },
  };
}

function extractToolCalls(text) {
  const sieve = createToolCallSieve();
  const head = sieve.push(typeof text === 'string' ? text : '');
  const tail = sieve.flush();
  return { content: head + tail.content, tool_calls: tail.tool_calls };
}

// 筛子捕获大块工具调用期间不会向客户端写入任何字节，中间的代理和负载均衡器
// 常按空闲超时掐断连接。默认 15s 发一个 SSE 注释保活；不同部署的超时不同，
// 所以留出 SSE_KEEPALIVE_MS 调节（0 表示每次都发，便于测试）。
function getSieveKeepaliveMs() {
  const raw = (typeof process !== 'undefined' && process.env && process.env.SSE_KEEPALIVE_MS) || '';
  const parsed = Number(raw);
  return raw !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : 15000;
}

// 把上游 delta 的 content 过一遍筛子；整块被吞时返回 null 以跳过该 chunk
function sieveDelta(sieve, delta) {
  if (!sieve || !delta || typeof delta.content !== 'string') return delta;
  const emitted = sieve.push(delta.content);
  const rest = { ...delta };
  delete rest.content;
  if (emitted) return { ...rest, content: emitted };
  const keys = Object.keys(rest);
  // 只剩 role 的 chunk 没有任何信息量：上游每个 delta 都带 role，捕获期间会刷出
  // 几十个空 chunk。丢掉它们，让连接真正空闲下来，由保活注释来兜。
  if (keys.length === 0 || (keys.length === 1 && rest.role)) return null;
  return rest;
}

// 流末尾：释放筛子里剩下的文本 + tool_calls + finish_reason
function writeSieveFinale(write, sieve, responseId, created, model, options = {}) {
  const flushed = sieve.flush();
  const hasCalls = flushed.tool_calls.length > 0;
  let roleSent = !!options.roleSent;
  const emit = (delta, finishReason) => {
    // 纯工具调用时前面可能一个 chunk 都没发过，role 必须由这里补上
    const payload = roleSent ? delta : { role: 'assistant', ...delta };
    roleSent = true;
    write(`data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: payload, finish_reason: finishReason }],
    })}\n\n`);
  };
  if (flushed.content) emit({ content: flushed.content }, null);
  if (hasCalls) {
    emit({ tool_calls: flushed.tool_calls.map((call, index) => ({ index, ...call })) }, null);
  }
  if (!options.suppressFinal) {
    // 只有真的解析出调用才改写终止原因；否则透传上游的 length / content_filter
    emit({}, hasCalls ? 'tool_calls' : (options.upstreamFinish || 'stop'));
  }
  logChatDetail('core', 'toolcall.extracted', { count: flushed.tool_calls.length, stream: true });
  if (flushed.unterminatedFence && !hasCalls) {
    logChatDetail('core', 'toolcall.fence.unterminated', { contentLength: flushed.content.length });
  }
  return flushed;
}

// 非流式 / 重打包流式的统一出口
function buildToolAwareResponse({ stream, responseId, created, model, content, toolCalls, reasoningContent, usage, upstreamFinish }) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const finishReason = calls.length > 0 ? 'tool_calls' : (upstreamFinish || 'stop');
  if (stream) {
    const events = [];
    let roleSent = false;
    const push = (delta, reason) => {
      events.push({ delta: roleSent ? delta : { role: 'assistant', ...delta }, finish_reason: reason });
      roleSent = true;
    };
    // 无工具时这条路径不会走到，但有工具时 reasoning 同样不能丢
    if (reasoningContent) push({ reasoning_content: reasoningContent }, null);
    if (content) push({ content }, null);
    if (calls.length > 0) {
      push({ tool_calls: calls.map((call, index) => ({ index, ...call })) }, null);
    }
    events.push({ delta: {}, finish_reason: finishReason });
    const body = events.map((event) => `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: event.delta, finish_reason: event.finish_reason }],
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    return createStreamResponse(body);
  }
  const message = { role: 'assistant', content: calls.length > 0 && !content ? null : content };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (calls.length > 0) message.tool_calls = calls;
  return createResponse({
    id: responseId,
    object: 'chat.completion',
    created,
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: mapUsageToOpenAI(usage),
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

function tryParseRatioString(size) {
  const text = normalizeInputString(size);
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w}:${h}`;
}

function mapOpenAiImageSizeToQwenRatio(size) {
  // Qwen Web t2i 在抓包中使用 ratio 文本，例如 "16:9"。
  // 支持两种格式：
  // 1. 直接比例字符串："1:1", "16:9", "9:16", "4:3", "3:4"
  // 2. OpenAI 格式："1024x1024" (映射到最接近的比例)
  
  // 首先尝试直接解析比例字符串
  const ratio = tryParseRatioString(size);
  if (ratio) {
    // 验证是否为支持的比例
    const validRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    if (validRatios.includes(ratio)) {
      return ratio;
    }
  }
  
  // 否则尝试解析 OpenAI 尺寸格式并映射到最近比例
  const parsed = tryParseOpenAiImageSize(size);
  if (!parsed) return '1:1';
  const { width, height } = parsed;
  const r = width / height;

  // 常见目标比例
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
    } catch {
      // ignore
    }
  }

  // 去重但保持顺序
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
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

async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: HTTP ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  return bytesToBase64(new Uint8Array(arrayBuffer));
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes || new Uint8Array());
  } catch {
    return '';
  }
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

    if (type === 'file' || type === 'input_file' || type === 'audio' || type === 'input_audio' || type === 'video' || type === 'input_video') {
      const fileSource = normalizeInputString(part.file_data || part.url || part.file_url || part.data);
      if (fileSource) {
        const normalizedFilename = normalizeInputString(part.filename) || normalizeInputString(part.name);
        const normalizedMimeType = normalizeInputString(part.mime_type) || normalizeInputString(part.content_type);
        const explicitType = type.includes('audio') ? 'audio' : (type.includes('video') ? 'video' : undefined);
        attachments.push({
          source: fileSource,
          filename: normalizedFilename,
          mimeType: normalizedMimeType,
          explicitType,
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

// 历史文本是不可信输入（尤其工具结果）：中和标记，否则模型照抄后会被筛子当成真调用
function neutralizeToolMarkers(text) {
  if (typeof text !== 'string' || !text) return '';
  return text.replace(/<(\/?)(tool_calls?|invoke|parameter)\b/gi, '&lt;$1$2');
}

function renderToolCallBlocks(toolCalls) {
  const blocks = [];
  for (const toolCall of Array.isArray(toolCalls) ? toolCalls : []) {
    const fn = toolCall?.function || {};
    const name = normalizeInputString(fn.name);
    if (!name) continue; // 无名调用只会教模型产出空名
    const args = normalizeToolArguments(fn.arguments) || '{}';
    const id = normalizeInputString(toolCall?.id);
    // 带上 id：并行调用时模型才能把结果对回具体那一次
    const idPart = id ? `, "id": ${JSON.stringify(id)}` : '';
    blocks.push(`<tool_call>\n{"name": ${JSON.stringify(name)}, "arguments": ${args}${idPart}}\n</tool_call>`);
  }
  return blocks;
}

function renderHistoryMessage(m) {
  if (m.role === 'tool' || m.role === 'function') {
    const label = [m.name, m.toolCallId].filter(Boolean).join(' #');
    return `[Tool Result]${label ? ` (${label})` : ''}: ${neutralizeToolMarkers(m.text)}`;
  }
  const blocks = [];
  if (m.text) blocks.push(neutralizeToolMarkers(m.text));
  if (m.role === 'assistant') blocks.push(...renderToolCallBlocks(m.toolCalls));
  if (blocks.length === 0) return '';
  const role = m.role === 'assistant'
    ? 'Assistant'
    : (m.role === 'system' || m.role === 'developer') ? 'System' : 'User';
  return `[${role}]: ${blocks.join('\n')}`;
}

function parseIncomingMessages(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalized = safeMessages.map(message => {
    const parsed = normalizeContentParts(message?.content);
    return {
      role: message?.role || 'user',
      text: parsed.text,
      attachments: [...parsed.attachments, ...normalizeLegacyFiles(message)],
      toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
      toolCallId: normalizeInputString(message?.tool_call_id),
      name: normalizeInputString(message?.name),
    };
  });

  if (normalized.length === 0) {
    return { content: '', attachments: [] };
  }

  const last = normalized[normalized.length - 1];
  const history = normalized.slice(0, -1)
    .map(renderHistoryMessage)
    .filter(Boolean)
    .join('\n\n');

  // 工具消息（assistant.tool_calls / role:"tool"）要按角色回写，否则智能体回路无法闭合
  const lastIsToolTurn = last.role === 'tool' || last.role === 'function' || last.toolCalls.length > 0;
  let merged;
  if (lastIsToolTurn) {
    let rendered = renderHistoryMessage(last);
    // 工具轮同样可能只带附件而无文本
    if (!last.text && last.attachments.length > 0) rendered += '\n请结合附件内容回答。';
    merged = history ? `${history}\n\n${rendered}` : rendered;
  } else {
    const lastText = last.text || (last.attachments.length > 0 ? '请结合附件内容回答。' : '');
    merged = history
      ? `${history}\n\n[User]: ${lastText}`
      : lastText;
  }

  return {
    content: merged,
    attachments: last.attachments,
    // 即便本次请求没带 tools，历史里的调用记录也会诱导模型继续输出标记
    hasToolHistory: normalized.some((m) => m.role === 'tool' || m.role === 'function' || m.toolCalls.length > 0),
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
  const resp = await fetch(`${QWEN_BASE_URL}/api/v2/files/getstsToken`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': QWEN_WEB_REFERER,
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
  const nodeCrypto = nodeRequire('crypto');
  if (nodeCrypto && nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) {
    return nodeCrypto.webcrypto;
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
    'Referer': QWEN_WEB_REFERER,
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
  if (filetype !== 'document') return;
  const resp = await fetch(`${QWEN_BASE_URL}/api/v2/files/parse`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': QWEN_WEB_REFERER,
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ file_id: qwenFilePayload.id }),
  });
  const detail = await resp.text().catch(() => '');
  if (!resp.ok) {
    logChatDetail('core', 'attachments.parse.document.skip', {
      fileId: qwenFilePayload.id,
      filename: file.filename,
      status: resp.status,
      detail,
    });
    throw new Error(`Document parse failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
  let payload = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {}
  if (payload && payload.success === false) {
    logChatDetail('core', 'attachments.parse.document.skip', {
      fileId: qwenFilePayload.id,
      filename: file.filename,
      status: resp.status,
      detail,
    });
    throw new Error(`Document parse rejected${payload?.msg ? `: ${payload.msg}` : ''}`);
  }
  logChatDetail('core', 'attachments.parse.document.done', {
    fileId: qwenFilePayload.id,
    filename: file.filename,
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureUploadStatusForNonVideo(filetype, baxiaTokens) {
  if (filetype === 'video') return;
  const maxAttempts = 6;
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`${QWEN_BASE_URL}/api/v2/users/status`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'bx-v': baxiaTokens.bxV,
        'source': 'web',
        'timezone': new Date().toUTCString(),
        'Referer': QWEN_WEB_REFERER,
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
    if (payload?.data === true) {
      return;
    }
    if (attempt < maxAttempts) {
      await sleep(400);
    }
  }
  throw new Error(`Upload status not ready for non-video file${lastPayload ? `: ${JSON.stringify(lastPayload)}` : ''}`);
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
      meta: {
        name: file.filename,
        size: fileSize,
        content_type: fileMimeType,
      },
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
    await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, baxiaTokens);
    if (filetype === 'document') {
      await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    }
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

// Upstream `/api/models` is behind a WAF and now returns an HTML block page
// instead of JSON. The web app ships the model list inside the homepage HTML
// as `window.__prerendered_data`, so we scrape that instead. The WAF also
// rejects short User-Agent strings, so a complete Chrome UA is required.
const MODELS_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const MODELS_SEC_CH_UA = '"Chromium";v="143", "Not(A:Brand";v="24", "Google Chrome";v="143"';
const MODELS_CACHE_TTL = 10 * 60 * 1000;
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
  const resp = await fetch(`${QWEN_BASE_URL}/`, {
    headers: {
      'User-Agent': MODELS_BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
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
  const ids = await fetchQwenModels();
  modelsCache = ids;
  modelsCacheTime = now;
  return ids;
}

async function handleModels(authHeader, env) {
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }
  try {
    const ids = await getQwenModels();
    const created = Math.floor(Date.now() / 1000);
    return createResponse({
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', created, owned_by: 'qwen' })),
    });
  } catch (err) {
    logChatDetail('core', 'models.fetch.failed', { message: err?.message || String(err) });
    return createResponse({ error: { message: 'Failed to fetch models', type: 'api_error' } }, 500);
  }
}

async function handleImageGenerations(body, authHeader, env) {
  // OpenAI Images API compatible: POST /v1/images/generations
  // Request fields: prompt (required), model (optional), n (optional), size (optional), response_format (optional)
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const prompt = normalizeInputString(body?.prompt);
  if (!prompt) {
    return createResponse({ error: { message: 'prompt is required', type: 'invalid_request_error' } }, 400);
  }

  const actualModel = normalizeInputString(body?.model) || 'qwen3.8-max';
  const nRaw = body?.n;
  let n = Number.isFinite(nRaw) ? Number(nRaw) : Number.parseInt(String(nRaw || ''), 10);
  if (!Number.isFinite(n) || n <= 0) n = 1;
  if (n > 10) n = 10;

  const responseFormat = normalizeInputString(body?.response_format) || 'url';
  if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
    return createResponse({ error: { message: 'response_format must be one of url or b64_json', type: 'invalid_request_error' } }, 400);
  }

  const qwenRatio = mapOpenAiImageSizeToQwenRatio(body?.size);
  // 创建 t2i 会话（失败自动换 token 重试）
  const createdChat = await createChatSession(actualModel, 't2i');
  if (createdChat.statusCode) {
    return createdChat;
  }
  const { chatId, bxUa, bxUmidToken, bxV, cookies } = createdChat;

  // 尽力把 n 映射给上游：上游未发现显式参数，只能通过 prompt 提示。
  const finalPrompt = n === 1 ? prompt : `${prompt}\n\n(Generate ${n} images.)`;

  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Cookie': cookies,
      'x-accel-buffering': 'no',
      'Origin': QWEN_BASE_URL,
      'source': 'web',
      'version': '0.2.83',
      'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
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
        fid: uuidv4(),
        parentId: null,
        childrenIds: [uuidv4()],
        role: 'user',
        content: finalPrompt,
        user_action: 'chat',
        files: [],
        timestamp: Date.now(),
        models: [actualModel],
        chat_type: 't2i',
        feature_config: {
          thinking_enabled: true,
          output_schema: 'phase',
          research_mode: 'normal',
          auto_thinking: true,
          thinking_mode: 'Auto',
          thinking_format: 'summary',
          auto_search: true,
        },
        extra: { meta: { subChatType: 't2i' } },
        sub_chat_type: 't2i',
        parent_id: null,
      }],
      timestamp: Date.now(),
      size: qwenRatio,
    }),
  });

  const rawText = await chatResp.text().catch(() => '');
  if (!chatResp.ok) {
    return createResponse({ error: { message: rawText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }

  const firstChar = rawText.trimStart().charAt(0);
  if (firstChar === '{' || firstChar === '[') {
    let parsed;
    try { parsed = JSON.parse(rawText); } catch {}
    if (parsed && parsed.success === false) {
      const errData = parsed.data || parsed;
      const msg = errData.details || errData.message || errData.code || 'Upstream request failed';
      return createResponse({ error: { message: msg, type: 'api_error', code: errData.code } }, 502);
    }
  }

  const urls = extractImageUrlsFromUpstreamSse(rawText);
  if (!urls || urls.length === 0) {
    const upstreamError = extractUpstreamErrorFromSse(rawText);
    if (upstreamError) {
      return createResponse({ error: { message: upstreamError.message, type: 'api_error', code: upstreamError.code } }, 502);
    }
    console.log('[qwen2api][image] Upstream SSE response with no image URLs:');
    console.log(rawText.slice(0, 2000));
    return createResponse({ error: { message: 'Upstream returned no image URLs', type: 'api_error' } }, 502);
  }

  const created = Math.floor(Date.now() / 1000);
  if (responseFormat === 'url') {
    return createResponse({
      created,
      data: urls.slice(0, n).map((u) => ({ url: u })),
    });
  }

  // b64_json
  try {
    const b64List = [];
    for (const u of urls.slice(0, n)) {
      b64List.push(await fetchImageAsBase64(u));
    }
    return createResponse({
      created,
      data: b64List.map((b64) => ({ b64_json: b64 })),
    });
  } catch (err) {
    const message = err && err.message ? err.message : 'Failed to fetch image bytes';
    return createResponse({ error: { message, type: 'api_error' } }, 502);
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

  const { model, messages, stream = false, tools, tool_choice: toolChoice } = body;
  if (!messages?.length) {
    logChatDetail('core', 'request.validation.failed', { reason: 'Messages are required' });
    return createResponse({ error: { message: 'Messages are required', type: 'invalid_request_error' } }, 400);
  }

  logChatDetail('core', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.8-max',
    messageCount: Array.isArray(messages) ? messages.length : 0,
    hasTools: !!(tools && Array.isArray(tools) && tools.length > 0),
  });

  const actualModel = model || 'qwen3.8-max';

  // 检查是否启用搜索
  const enableSearch = (env?.ENABLE_SEARCH || (typeof process !== 'undefined' && process.env && process.env.ENABLE_SEARCH) || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';
  logChatDetail('core', 'request.config', { actualModel, chatType, enableSearch });

  // 创建会话（失败自动换 token 重试）
  const createdChat = await createChatSession(actualModel, chatType);
  if (createdChat.statusCode) {
    return createdChat;
  }
  const { chatId, bxUa, bxUmidToken, bxV, cookies } = createdChat;

  // 解析 OpenAI 兼容消息与附件
  const parsedMessages = parseIncomingMessages(messages);
  const toolPrompt = buildToolPrompt(tools, toolChoice);
  // Qwen 原生模板把 # Tools 放在系统位；展平后最接近的位置是最前面
  const content = toolPrompt ? `${toolPrompt}\n\n${parsedMessages.content}` : parsedMessages.content;
  const needsSieve = !!toolPrompt || !!parsedMessages.hasToolHistory;
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
  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'Cookie': cookies,
      'x-accel-buffering': 'no',
      'Origin': QWEN_BASE_URL,
      'source': 'web', 'version': '0.2.83', 'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      stream: true, version: '2.1', incremental_output: true,
      chat_id: chatId, chat_mode: 'guest', model: actualModel, parent_id: null,
      messages: [{
        id: null, fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content,
        user_action: 'chat', files: uploadedFiles, timestamp: Date.now(), models: [actualModel], model: '', chat_type: chatType,
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_mode: 'Auto', thinking_format: 'summary', auto_search: enableSearch },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    const errorText = await chatResp.text().catch(() => '');
    console.log(`[qwen2api][chat] Completion error: HTTP ${chatResp.status}, body: ${errorText.slice(0, 500)}`);
    const parsedErr = tryParseUpstreamErrorPayload(errorText);
    const errMsg = parsedErr?.message || errorText || `HTTP ${chatResp.status}`;
    return createResponse({ error: { message: errMsg, type: 'api_error', ...(parsedErr?.code ? { code: parsedErr.code } : {}) } }, chatResp.status);
  }
  logChatDetail('core', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 如果有流写入器 (Express)，使用真正的流式
  if (streamWriter && stream) {
    logChatDetail('core', 'stream.proxy.express', { chatId, model: actualModel });
    return streamWriter(chatResp, actualModel, responseId, created, needsSieve ? createToolCallSieve() : null);
  }

  // 默认：收集完整响应
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
    console.log(`[qwen2api][chat] Upstream returned error (HTTP 200): ${upstreamErr.message}`);
    return createResponse({ error: upstreamErr }, 502);
  }
  const parsedSse = parseQwenSsePayload(buffer);
  logChatDetail('core', 'chat.completion.collected', {
    chunkCount: parsedSse.events.length,
    outputLength: parsedSse.content.length,
    stream: !!stream,
  });
  logChatDetail('core', 'stream.content.full', {
    content: parsedSse.content,
  });

  if (needsSieve) {
    const sieved = extractToolCalls(parsedSse.content);
    logChatDetail('core', 'toolcall.extracted', { count: sieved.tool_calls.length, stream: !!stream });
    return buildToolAwareResponse({
      stream, responseId, created, model: actualModel,
      content: sieved.content, toolCalls: sieved.tool_calls,
      reasoningContent: parsedSse.reasoning_content, usage: parsedSse.usage,
      upstreamFinish: parsedSse.events.reduce((acc, e) => e.finish_reason || acc, null),
    });
  }

  if (stream) {
    logChatDetail('core', 'stream.repack.start', { chunkCount: parsedSse.events.length });
    const streamBody = parsedSse.events.map((event) => `data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model: actualModel,
      choices: [{ index: 0, delta: event.delta, finish_reason: event.finish_reason || null }]
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    logChatDetail('core', 'stream.repack.done', { responseId });
    return createStreamResponse(streamBody);
  }

  return createResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parsedSse.content, ...(parsedSse.reasoning_content ? { reasoning_content: parsedSse.reasoning_content } : {}) }, finish_reason: 'stop' }],
    usage: mapUsageToOpenAI(parsedSse.usage)
  });
}

function handleRoot() {
  const html = '<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>';
  return createResponse(html, 200, { 'Content-Type': 'text/html' });
}

// Chat HTML 缓存 (开发模式禁用缓存)
let chatHtmlCache = null;

function getChatHtml() {
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  if (fs && path) {
    try {
      const htmlPath = path.join(__dirname, 'chat.html');
      // 开发模式下每次都重新读取文件（本地/磁盘可读时以文件为准）
      chatHtmlCache = fs.readFileSync(htmlPath, 'utf-8');
      return chatHtmlCache;
    } catch {
      // 函数打包环境（Vercel/Netlify）读不到 chat.html，落到下方内联副本
    }
  }
  // 兜底：chat-html.js 是构建脚本从 chat.html 生成的内联副本，
  // esbuild 会把它静态打包进所有平台（本地、Vercel、Netlify、CF Workers）。
  return require('./chat-html.js');
}

function handleChatPage() {
  const html = getChatHtml();
  return createResponse(html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
}

// ============================================
// 视频下载 (yt-dlp)
// ============================================

let ytdlpEnsurePromise = null;

function isTruthyFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timer);
  });
}

function resolveYtDlpAsset(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') return { assetName: 'yt-dlp_arm64.exe', binaryName: 'yt-dlp.exe' };
    if (arch === 'ia32') return { assetName: 'yt-dlp_x86.exe', binaryName: 'yt-dlp.exe' };
    return { assetName: 'yt-dlp.exe', binaryName: 'yt-dlp.exe' };
  }
  if (platform === 'darwin') {
    return { assetName: 'yt-dlp_macos', binaryName: 'yt-dlp' };
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return { assetName: 'yt-dlp_linux_aarch64', binaryName: 'yt-dlp' };
    return { assetName: 'yt-dlp_linux', binaryName: 'yt-dlp' };
  }
  throw new Error(`Unsupported platform for auto-install yt-dlp: ${platform}/${arch}`);
}

function canRunYtDlp(binaryPath) {
  const childProcess = nodeRequire('child_process');
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return false;
  const result = childProcess.spawnSync(binaryPath, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

async function ensureYtDlpAvailable(sendLog) {
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  const os = nodeRequire('os');
  if (!fs || !path || !os) {
    throw new Error('yt-dlp is not supported in this runtime (no filesystem)');
  }
  const log = typeof sendLog === 'function' ? sendLog : () => {};
  const platform = process.platform;
  const arch = process.arch;
  const configuredPath = (process.env.YT_DLP_PATH || '').trim();
  if (configuredPath) {
    if (!canRunYtDlp(configuredPath)) {
      throw new Error(`YT_DLP_PATH is set but not executable: ${configuredPath}`);
    }
    return configuredPath;
  }

  if (canRunYtDlp('yt-dlp')) {
    return 'yt-dlp';
  }

  const autoDownload = isTruthyFlag(process.env.YT_DLP_AUTO_DOWNLOAD, true);
  if (!autoDownload) {
    throw new Error('yt-dlp not found and auto-download is disabled (YT_DLP_AUTO_DOWNLOAD=false).');
  }

  if (ytdlpEnsurePromise) {
    return ytdlpEnsurePromise;
  }

  ytdlpEnsurePromise = (async () => {
    const { assetName, binaryName } = resolveYtDlpAsset(platform, arch);
    const baseDir = path.join(os.tmpdir(), 'qwen2api_bin', 'yt-dlp');
    const binaryPath = path.join(baseDir, binaryName);
    const tempPath = `${binaryPath}.tmp-${process.pid}-${Date.now()}`;
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

    if (fs.existsSync(binaryPath) && canRunYtDlp(binaryPath)) {
      log('video.ytdlp.ready', { source: 'cached', binaryPath, platform, arch });
      return binaryPath;
    }

    log('video.ytdlp.download.start', { platform, arch, assetName, downloadUrl });
    fs.mkdirSync(baseDir, { recursive: true });

    let response;
    try {
      response = await fetchWithTimeout(downloadUrl, { method: 'GET' }, 45000);
    } catch (err) {
      throw new Error(`Failed to download yt-dlp: ${err.message}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to download yt-dlp: HTTP ${response.status}`);
    }

    let bytes;
    try {
      const arrayBuffer = await response.arrayBuffer();
      bytes = Buffer.from(arrayBuffer);
      fs.writeFileSync(tempPath, bytes);

      if (platform !== 'win32') {
        fs.chmodSync(tempPath, 0o755);
      }

      fs.renameSync(tempPath, binaryPath);
    } finally {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {}
    }

    if (!canRunYtDlp(binaryPath)) {
      try {
        if (fs.existsSync(binaryPath)) {
          fs.unlinkSync(binaryPath);
        }
      } catch (cleanupErr) {
        log('video.ytdlp.cleanup.failed', { error: cleanupErr.message, binaryPath });
      }
      throw new Error(`yt-dlp downloaded but execution failed: ${binaryPath}`);
    }

    log('video.ytdlp.download.done', {
      binaryPath,
      size: bytes.length,
      platform,
      arch,
      assetName,
    });

    return binaryPath;
  })();

  try {
    return await ytdlpEnsurePromise;
  } finally {
    ytdlpEnsurePromise = null;
  }
}

function resolveMinVideoResolutionFromInput(rawValue) {
  const allowed = new Set([360, 480, 720]);
  if (rawValue === undefined || rawValue === null) return null;
  const text = String(rawValue).trim().toLowerCase();
  if (!text || text === 'default') return null;
  const numeric = Number.parseInt(text, 10);
  if (!Number.isFinite(numeric)) return null;
  return allowed.has(numeric) ? numeric : null;
}

function getEffectiveMinResolution(preferredResolution) {
  const fromWeb = resolveMinVideoResolutionFromInput(preferredResolution);
  if (fromWeb) {
    return { minResolution: fromWeb, source: 'web' };
  }
  const fromEnv = resolveMinVideoResolutionFromInput(process.env.MIN_VIDEO_RESOLUTION || '480');
  if (fromEnv) {
    return { minResolution: fromEnv, source: 'env' };
  }
  return { minResolution: 480, source: 'fallback' };
}

async function downloadVideoWithYtDlp(videoUrl, sendLog, preferredResolution) {
  const childProcess = nodeRequire('child_process');
  const path = nodeRequire('path');
  const fs = nodeRequire('fs');
  const os = nodeRequire('os');
  if (!childProcess || !path || !fs || !os) {
    throw new Error('yt-dlp is not supported in this runtime (no child_process/filesystem)');
  }
  const { spawn } = childProcess;

  // 从环境变量获取最低分辨率，默认 480p
  const resolutionInfo = getEffectiveMinResolution(preferredResolution);
  const minResolution = resolutionInfo.minResolution;

  return new Promise((resolve, reject) => {
    const tmpDir = path.join(os.tmpdir(), 'qwen2api_videos');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputFile = path.join(tmpDir, `video_${Date.now()}.mp4`);
    
    // 格式选择：优先选不高于目标高度的可用流，避免精确高度导致部分站点误判“格式不可用”
    // 兜底链：<=目标高度的视频音频分离 -> <=目标高度的单文件 -> 任意可用分离流 -> 任意 best
    const formatSelector = `bestvideo[height<=${minResolution}][vcodec!=none][acodec=none]+bestaudio[acodec!=none]/best[height<=${minResolution}]/bestvideo[vcodec!=none][acodec=none]+bestaudio[acodec!=none]/best`;

    sendLog('video.download.running', {
      videoUrl,
      minResolution: minResolution + 'p',
      minResolutionHint: 'height',
      resolutionSource: resolutionInfo.source,
      requestedResolution: preferredResolution === undefined ? null : String(preferredResolution),
      formatSelector,
    });

    let ytdlpBinary = 'yt-dlp';
    ensureYtDlpAvailable(sendLog).then((resolvedBinary) => {
      ytdlpBinary = resolvedBinary;
      const ytdlp = spawn(ytdlpBinary, [
        '-f', formatSelector,
        '--no-playlist',
        '--max-filesize', '100M',
        '-o', outputFile,
        '--no-warnings',
        '--merge-output-format', 'mp4',
        videoUrl
      ]);

      let stderr = '';
      
      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
        // 解析下载进度
        const progressMatch = stderr.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
          sendLog('video.download.progress', { progress: progressMatch[1] + '%' });
        }
      });

      ytdlp.on('close', (code) => {
        if (code !== 0) {
          // 失败时清理临时文件
          try {
            if (fs.existsSync(outputFile)) {
              fs.unlinkSync(outputFile);
            }
          } catch {}
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          return;
        }

        if (!fs.existsSync(outputFile)) {
          reject(new Error('Video file not found after download'));
          return;
        }

        try {
          const stats = fs.statSync(outputFile);
          const bytes = fs.readFileSync(outputFile);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          
          sendLog('video.download.finished', {
            filepath: outputFile,
            size: stats.size,
            sizeMB: sizeMB + ' MB'
          });

          // 创建附件对象，格式与网页上传的一致
          const base64 = bytes.toString('base64');
          const dataUrl = `data:video/mp4;base64,${base64}`;
          
        const attachment = {
          source: dataUrl,
          filename: path.basename(outputFile),
          mimeType: 'video/mp4',
          explicitType: 'video',
          size: stats.size,
          sizeMB: sizeMB + ' MB',
          _tempFilePath: outputFile, // 保留临时文件路径，后续删除
        };

          resolve(attachment);
        } catch (err) {
          reject(err);
        }
      });

      ytdlp.on('error', (err) => {
        // 错误时清理临时文件
        try {
          if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
          }
        } catch (cleanupErr) {
          sendLog('video.download.cleanup.failed', { error: cleanupErr.message, outputFile });
        }
        if (err.code === 'ENOENT') {
          reject(new Error(`yt-dlp not found after ensure step. binary=${ytdlpBinary}`));
        } else {
          reject(err);
        }
      });
    }).catch((err) => {
      sendLog('video.ytdlp.ensure.failed', { error: err && err.message ? err.message : String(err) });
      reject(err);
    });
  });
}

// ============================================
// 带日志流式返回的 Chat Completions
// ============================================

function createLogStreamWriter(writer, onDone = null) {
  // writer 是一个对象，包含 write/log/end 方法
  return async (response, model, responseId, created, sieve = null) => {
    const reader = response.body?.getReader ? response.body.getReader() : null;
    const decoder = new TextDecoder();
    let buffer = '';
    let doneWritten = false;
    let anyChunkWritten = false;
    let nonDataBuffer = '';
    let upstreamFinish = null;
    let roleSent = false;
    let errorWritten = false;
    let lastWriteAt = Date.now();

    if (!reader) {
      throw new Error('Upstream response has no readable body');
    }

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
            nonDataBuffer += line + '\n';
            continue;
          }
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            // 有筛子时把 [DONE] 推迟到 finale 之后，否则 tool_calls 会排在 [DONE] 后面
            if (!sieve) {
              writer.write('data: [DONE]\n\n');
              doneWritten = true;
            }
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
                  model,
                  choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: errorMsg },
                    finish_reason: 'stop',
                  }],
                };
                // 先放出筛子里已解析的内容/调用，再报安全警告
                if (sieve) writeSieveFinale((data) => writer.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
                writer.write(`data: ${JSON.stringify(warningChunk)}\n\n`);
                doneWritten = true;
                writer.write('data: [DONE]\n\n');
                continue;
              }
              const errObj = {
                error: {
                  message: errorMsg,
                  type: upstreamError.type || 'api_error',
                  code: upstreamError.code,
                }
              };
              if (sieve) writeSieveFinale((data) => writer.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
              writer.write(`data: ${JSON.stringify(errObj)}\n\n`);
              anyChunkWritten = true;
              errorWritten = true;
              continue;
            }

            const delta = sieveDelta(sieve, mapUpstreamDeltaToOpenAI(parsed?.choices?.[0]?.delta));
            if (parsed?.choices?.[0]?.finish_reason) upstreamFinish = parsed.choices[0].finish_reason;
            // 筛子接管终止语义：finish_reason 由 finale 发出，上游原因经 upstreamFinish 透传
            const finishReason = sieve ? null : (parsed?.choices?.[0]?.finish_reason || null);
            if (delta || finishReason) {
              if (delta && delta.role === 'assistant') roleSent = true;
              const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: delta || {},
                  finish_reason: finishReason,
                }],
              };
              writer.write(`data: ${JSON.stringify(chunk)}\n\n`);
              lastWriteAt = Date.now();
              anyChunkWritten = true;
            } else if (sieve && Date.now() - lastWriteAt >= getSieveKeepaliveMs()) {
              writer.write(': keepalive\n\n');
              lastWriteAt = Date.now();
            }
          } catch {}
        }
      }
      if (buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        nonDataBuffer += buffer;
      }
      // 顺序要紧：先判上游的纯错误体，否则 finale 会把它盖成一次空的成功响应
      if (!doneWritten && !anyChunkWritten) {
        const err = tryParseUpstreamErrorPayload(nonDataBuffer);
        if (err) {
          writer.write(`data: ${JSON.stringify({ error: err })}\n\n`);
          writer.write('data: [DONE]\n\n');
          doneWritten = true;
          errorWritten = true;
        }
      }
      if (sieve && !doneWritten && !errorWritten) {
        writeSieveFinale((data) => writer.write(data), sieve, responseId, created, model, { roleSent, upstreamFinish });
        anyChunkWritten = true;
      }
    } catch (err) {
      const message = err && err.message ? err.message : 'stream proxy error';
      // 中断前先释放筛子，否则已解析的内容和调用会静默丢失
      if (sieve && !doneWritten) {
        try {
          writeSieveFinale((data) => writer.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
        } catch {}
      }
      writer.write(`data: ${JSON.stringify({ error: { message, type: 'api_error' } })}\n\n`);
    } finally {
      if (!doneWritten) {
        writer.write('data: [DONE]\n\n');
      }
      writer.end();
      // 执行清理回调
      if (onDone) {
        try {
          onDone();
        } catch {}
      }
    }
  };
}

async function handleChatCompletionsWithLogs(body, authHeader, env, streamWriter) {
  logChatDetail('core', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  // 验证 token
  if (!validateToken(authHeader, env)) {
    logChatDetail('core', 'request.auth.failed', {});
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = false, tools, tool_choice: toolChoice } = body;
  if (!messages?.length) {
    logChatDetail('core', 'request.validation.failed', { reason: 'Messages are required' });
    return createResponse({ error: { message: 'Messages are required', type: 'invalid_request_error' } }, 400);
  }

  // 日志辅助函数
  const sendLog = (event, detail = {}) => {
    const logData = JSON.stringify({ event, timestamp: Date.now(), ...detail });
    if (streamWriter && streamWriter.log) {
      streamWriter.log(logData);
    }
  };

  logChatDetail('core', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.8-max',
    messageCount: Array.isArray(messages) ? messages.length : 0,
    hasTools: !!(tools && Array.isArray(tools) && tools.length > 0),
  });
  sendLog('request.received', { model: model || 'qwen3.8-max', messageCount: messages.length });

  const actualModel = model || 'qwen3.8-max';

  // 检查是否启用搜索
  const enableSearch = (env?.ENABLE_SEARCH || (typeof process !== 'undefined' && process.env && process.env.ENABLE_SEARCH) || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';
  logChatDetail('core', 'request.config', { actualModel, chatType, enableSearch });
  sendLog('config.ready', { model: actualModel, chatType, enableSearch });

  // 创建会话（失败自动换 token 重试）
  sendLog('chat.creating', {});
  const createdChat = await createChatSession(actualModel, chatType);
  if (createdChat.statusCode) {
    sendLog('chat.create.failed', { status: createdChat.statusCode, error: 'create-failed', response: null });
    return createdChat;
  }
  const { chatId, bxUa, bxUmidToken, bxV, cookies } = createdChat;
  sendLog('chat.created', { chatId });

  // 解析消息与附件
  const parsedMessages = parseIncomingMessages(messages);
  const toolPrompt = buildToolPrompt(tools, toolChoice);
  // Qwen 原生模板把 # Tools 放在系统位；展平后最接近的位置是最前面
  const content = toolPrompt ? `${toolPrompt}\n\n${parsedMessages.content}` : parsedMessages.content;
  const needsSieve = !!toolPrompt || !!parsedMessages.hasToolHistory;
  logChatDetail('core', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  sendLog('message.parsed', { contentLength: content.length, attachmentCount: parsedMessages.attachments.length });

  // 临时文件路径收集（用于后续清理）
  const tempFilesToClean = [];

  // 处理视频链接下载
  const videoUrl = body.video_url;
  const preferredResolution = body?.min_video_resolution;
  if (videoUrl) {
    sendLog('video.download.start', {
      videoUrl,
      preferredResolution: preferredResolution === undefined ? null : String(preferredResolution),
    });
    try {
      const videoAttachment = await downloadVideoWithYtDlp(videoUrl, sendLog, preferredResolution);
      if (videoAttachment) {
        parsedMessages.attachments.push(videoAttachment);
        // 记录临时文件路径
        if (videoAttachment._tempFilePath) {
          tempFilesToClean.push(videoAttachment._tempFilePath);
        }
        sendLog('video.download.completed', {
          filename: videoAttachment.filename,
          size: videoAttachment.size || 0,
          sizeMB: videoAttachment.sizeMB || '',
        });
      }
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      sendLog('video.download.failed', { error: errorMessage });
      return createResponse({
        error: {
          message: `Video download failed: ${errorMessage}`,
          type: 'api_error'
        }
      }, 500);
    }
  }

  // 上传附件
  let uploadedFiles = [];
  if (parsedMessages.attachments.length > 0) {
    sendLog('attachments.upload.start', { count: parsedMessages.attachments.length });
    for (let i = 0; i < parsedMessages.attachments.length; i++) {
      const rawAttachment = parsedMessages.attachments[i];
      sendLog('attachment.uploading', { index: i + 1, filename: rawAttachment.filename || 'unknown' });
      
      try {
        const loaded = await getAttachmentBytes(rawAttachment);
        loaded.explicitType = rawAttachment.explicitType;
        const { tokenData, filetype } = await requestUploadToken(loaded, { bxUa, bxUmidToken, bxV });
        await uploadFileToQwenOss(loaded, tokenData);
        const qwenFilePayload = buildQwenFilePayload(loaded, tokenData, filetype);
        await ensureUploadStatusForNonVideo(filetype, { bxUa, bxUmidToken, bxV });
        await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, { bxUa, bxUmidToken, bxV });
        if (filetype === 'document') {
          await ensureUploadStatusForNonVideo(filetype, { bxUa, bxUmidToken, bxV });
        }
        uploadedFiles.push(qwenFilePayload);
        sendLog('attachment.uploaded', { index: i + 1, filetype, filename: loaded.filename });
      } catch (err) {
        const errorMessage = err && err.message ? err.message : String(err);
        sendLog('attachment.upload.failed', { index: i + 1, error: errorMessage });
        return createResponse({
          error: {
            message: `Attachment upload failed (index ${i + 1}): ${errorMessage}`,
            type: 'api_error'
          }
        }, 500);
      }
    }
    sendLog('attachments.upload.done', { uploadedCount: uploadedFiles.length });
  }

  logChatDetail('core', 'message.ready', {
    uploadedFileCount: uploadedFiles.length,
  });

  // 发送请求
  sendLog('chat.sending', { chatId });
  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'Cookie': cookies,
      'x-accel-buffering': 'no',
      'Origin': QWEN_BASE_URL,
      'source': 'web', 'version': '0.2.83', 'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      stream: true, version: '2.1', incremental_output: true,
      chat_id: chatId, chat_mode: 'guest', model: actualModel, parent_id: null,
      messages: [{
        id: null, fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content,
        user_action: 'chat', files: uploadedFiles, timestamp: Date.now(), models: [actualModel], model: '', chat_type: chatType,
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_mode: 'Auto', thinking_format: 'summary', auto_search: enableSearch },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    const errorText = await chatResp.text().catch(() => '');
    logChatDetail('core', 'chat.completion.error', { status: chatResp.status, chatId, error: errorText });
    sendLog('chat.response.failed', { status: chatResp.status, error: errorText });
    const parsedErr = tryParseUpstreamErrorPayload(errorText);
    const errMsg = parsedErr?.message || errorText || `HTTP ${chatResp.status}`;
    return createResponse({ error: { message: errMsg, type: 'api_error', ...(parsedErr?.code ? { code: parsedErr.code } : {}) } }, chatResp.status);
  }

  logChatDetail('core', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });
  sendLog('chat.streaming', {});

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 清理临时视频文件的函数
  const cleanupTempFiles = () => {
    const fs = nodeRequire('fs');
    if (!fs) return;
    for (const tempFile of tempFilesToClean) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          sendLog('video.tempfile.cleaned', { file: tempFile });
        }
      } catch {}
    }
  };

  // 如果有流写入器，使用流式处理
  if (streamWriter && stream) {
    logChatDetail('core', 'stream.proxy.express', { chatId, model: actualModel });
    const logAwareWriter = createLogStreamWriter(streamWriter, cleanupTempFiles);
    return logAwareWriter(chatResp, actualModel, responseId, created, needsSieve ? createToolCallSieve() : null);
  }

  // 非 Express 环境：收集完整响应
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
    console.log(`[qwen2api][chat-log] Upstream returned error (HTTP 200): ${upstreamErr.message}`);
    sendLog('chat.response.failed', { error: upstreamErr.message });
    return createResponse({ error: upstreamErr }, 502);
  }
  const parsedSse = parseQwenSsePayload(buffer);

  logChatDetail('core', 'chat.completion.collected', {
    chunkCount: parsedSse.events.length,
    outputLength: parsedSse.content.length,
    stream: !!stream,
  });
  logChatDetail('core', 'stream.content.full', {
    content: parsedSse.content,
  });
  sendLog('chat.completed', { outputLength: parsedSse.content.length });

  // 清理临时视频文件
  cleanupTempFiles();

  if (needsSieve) {
    const sieved = extractToolCalls(parsedSse.content);
    logChatDetail('core', 'toolcall.extracted', { count: sieved.tool_calls.length, stream: !!stream });
    return buildToolAwareResponse({
      stream, responseId, created, model: actualModel,
      content: sieved.content, toolCalls: sieved.tool_calls,
      reasoningContent: parsedSse.reasoning_content, usage: parsedSse.usage,
      upstreamFinish: parsedSse.events.reduce((acc, e) => e.finish_reason || acc, null),
    });
  }

  if (stream) {
    logChatDetail('core', 'stream.repack.start', { chunkCount: parsedSse.events.length });
    const streamBody = parsedSse.events.map((event) => `data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model: actualModel,
      choices: [{ index: 0, delta: event.delta, finish_reason: event.finish_reason || null }]
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    logChatDetail('core', 'stream.repack.done', { responseId });
    return createStreamResponse(streamBody);
  }

  return createResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parsedSse.content, ...(parsedSse.reasoning_content ? { reasoning_content: parsedSse.reasoning_content } : {}) }, finish_reason: 'stop' }],
    usage: mapUsageToOpenAI(parsedSse.usage)
  });
}

// ============================================
// 流式响应写入器（Express / Vercel Node 共用）
// ============================================

// 通用 SSE 流写入器：把上游 SSE 实时转成 OpenAI 格式并写入 res
// （res 只需支持 setHeader / write / end / writableEnded，Express 与 Vercel Node 均满足）
function createExpressStreamHandler(res) {
  return async (response, model, responseId, created, sieve = null) => {
    const rawFlag = (typeof process !== 'undefined' && process.env && process.env.CHAT_DETAIL_LOG) || '';
    const debugEnabled = ['1', 'true', 'yes', 'on'].includes(String(rawFlag).toLowerCase());
    let hasStreamContent = false;

    const writeStreamContent = (content) => {
      if (!debugEnabled || !content) return;
      hasStreamContent = true;
      if (typeof process !== 'undefined' && process.stdout) process.stdout.write(content);
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    const reader = response.body?.getReader ? response.body.getReader() : null;
    const decoder = new TextDecoder();
    let buffer = '';
    let doneWritten = false;
    let anyChunkWritten = false;
    let nonDataBuffer = '';
    let upstreamFinish = null;
    let roleSent = false;
    let errorWritten = false;
    let lastWriteAt = Date.now();

    try {
      if (!reader) {
        throw new Error('Upstream response has no readable body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith('data:')) {
            nonDataBuffer += line + '\n';
            continue;
          }
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            // 有筛子时把 [DONE] 推迟到 finale 之后，否则 tool_calls 会排在 [DONE] 后面
            if (!sieve) {
              res.write('data: [DONE]\n\n');
              doneWritten = true;
            }
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
                  model,
                  choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: errorMsg },
                    finish_reason: 'stop',
                  }],
                };
                // 先放出筛子里已解析的内容/调用，再报安全警告
                if (sieve) writeSieveFinale((data) => res.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
                res.write(`data: ${JSON.stringify(warningChunk)}\n\n`);
                doneWritten = true;
                res.write('data: [DONE]\n\n');
                continue;
              }
              const errObj = {
                error: {
                  message: errorMsg,
                  type: upstreamError.type || 'api_error',
                  code: upstreamError.code,
                }
              };
              if (sieve) writeSieveFinale((data) => res.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
              res.write(`data: ${JSON.stringify(errObj)}\n\n`);
              anyChunkWritten = true;
              errorWritten = true;
              continue;
            }

            const delta = sieveDelta(sieve, mapUpstreamDeltaToOpenAI(parsed?.choices?.[0]?.delta));
            if (parsed?.choices?.[0]?.finish_reason) upstreamFinish = parsed.choices[0].finish_reason;
            // 筛子接管终止语义：finish_reason 由 finale 发出，上游原因经 upstreamFinish 透传
            const finishReason = sieve ? null : (parsed?.choices?.[0]?.finish_reason || null);
            if (delta || finishReason) {
              if (delta && delta.role === 'assistant') roleSent = true;
              if (delta && typeof delta.content === 'string' && delta.content) {
                writeStreamContent(delta.content);
              }
              const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: delta || {},
                  finish_reason: finishReason,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              lastWriteAt = Date.now();
              anyChunkWritten = true;
            } else if (sieve && Date.now() - lastWriteAt >= getSieveKeepaliveMs()) {
              res.write(': keepalive\n\n');
              lastWriteAt = Date.now();
            }
          } catch {}
        }
      }
      if (buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        nonDataBuffer += buffer;
      }
      // 顺序要紧：先判上游的纯错误体，否则 finale 会把它盖成一次空的成功响应
      if (!doneWritten && !anyChunkWritten) {
        const err = tryParseUpstreamErrorPayload(nonDataBuffer);
        if (err) {
          res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
          res.write('data: [DONE]\n\n');
          doneWritten = true;
          errorWritten = true;
        }
      }
      if (sieve && !doneWritten && !errorWritten && !res.writableEnded) {
        writeSieveFinale((data) => res.write(data), sieve, responseId, created, model, { roleSent, upstreamFinish });
        anyChunkWritten = true;
      }
    } catch (err) {
      if (!res.writableEnded) {
        const message = err && err.message ? err.message : 'stream proxy error';
        // 中断前先释放筛子，否则已解析的内容和调用会静默丢失
        if (sieve && !doneWritten) {
          try {
            writeSieveFinale((data) => res.write(data), sieve, responseId, created, model, { roleSent, suppressFinal: true });
          } catch {}
        }
        res.write(`data: ${JSON.stringify({ error: { message, type: 'api_error' } })}\n\n`);
      }
    } finally {
      if (!doneWritten && !res.writableEnded) {
        res.write('data: [DONE]\n\n');
      }
      if (!res.writableEnded) {
        res.end();
      }
    }

    if (debugEnabled && hasStreamContent && typeof process !== 'undefined' && process.stdout) {
      process.stdout.write('\n');
      console.log('[qwen2api][stream] 输出完毕');
    }
  };
}

// 带日志事件（event: log）的流式写入器
function createExpressLogStreamHandler(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  const streamWriter = {
    write: (data) => {
      if (!res.writableEnded) {
        res.write(data);
      }
    },
    log: (logData) => {
      if (!res.writableEnded) {
        res.write(`event: log\n`);
        res.write(`data: ${logData}\n\n`);
      }
    },
    end: () => {
      if (!res.writableEnded) {
        res.end();
      }
    }
  };

  return streamWriter;
}

// ============================================
// 导出
// ============================================

module.exports = {
  handleModels,
  handleChatCompletions,
  handleChatCompletionsWithLogs,
  handleImageGenerations,
  handleRoot,
  handleChatPage,
  createResponse,
  validateToken,
  getBaxiaTokens,
  mapUpstreamDeltaToOpenAI,
  parseQwenSsePayload,
  buildToolPrompt,
  extractToolCalls,
  createToolCallSieve,
  buildToolAwareResponse,
  parseIncomingMessages,
  mapUsageToOpenAI,
  tryParseUpstreamErrorPayload,
  createExpressStreamHandler,
  createExpressLogStreamHandler,
  createLogStreamWriter,
  uuidv4,
};
