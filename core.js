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
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true } = body;
  if (!messages?.length) {
    return createResponse({ error: { message: 'Messages are required' } }, 400);
  }

  const actualModel = model || 'qwen3.5-plus';
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  // 检查是否启用搜索
  const enableSearch = (env?.ENABLE_SEARCH || process?.env?.ENABLE_SEARCH || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';

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
  if (!createData.success || !createData.data?.id) {
    return createResponse({ error: { message: 'Failed to create chat session' } }, 500);
  }
  const chatId = createData.data.id;

  // 合并消息
  let content = messages.length === 1 
    ? messages[0].content 
    : messages.slice(0, -1).map(m => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`).join('\n\n') 
      + '\n\n[User]: ' + messages[messages.length - 1].content;

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
        user_action: 'chat', files: [], timestamp: Date.now(), models: [actualModel], chat_type: chatType,
        feature_config: { thinking_enabled: true, output_schema: 'phase', research_mode: 'normal', auto_thinking: true, thinking_format: 'summary', auto_search: enableSearch },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    return createResponse({ error: { message: await chatResp.text() } }, chatResp.status);
  }

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 如果有流写入器 (Express)，使用真正的流式
  if (streamWriter && stream) {
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
