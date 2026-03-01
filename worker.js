/**
 * Cloudflare Workers 入口
 * 
 * 使用方法:
 * 1. 安装 wrangler: npm install -g wrangler
 * 2. 登录: wrangler login
 * 3. 部署: wrangler deploy
 */

// ============================================
// Baxia Token 生成 (CF Worker 内联版本)
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
  const hashBuffer = await crypto.subtle.digest('MD5', bytes);
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

function streamResponse(body) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
  });
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
  if (!validateToken(authHeader, env)) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true } = body;
  if (!messages?.length) {
    return jsonResponse({ error: { message: 'Messages are required' } }, 400);
  }

  const actualModel = model || 'qwen3.5-plus';
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  // 检查是否启用搜索
  const enableSearch = (env.ENABLE_SEARCH || '').toLowerCase() === 'true';
  const chatType = enableSearch ? 'search' : 't2t';

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
  if (!createData.success || !createData.data?.id) {
    return jsonResponse({ error: { message: 'Failed to create chat session', details: createData } }, 500);
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
    return jsonResponse({ error: { message: await chatResp.text() } }, chatResp.status);
  }

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 流式响应
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

  return jsonResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

// ============================================
// Worker 入口
// ============================================

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
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
    if (request.method === 'GET' && (path === '/' || path === '')) {
      return new Response('<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>', { headers: { 'Content-Type': 'text/html' } });
    }
    return jsonResponse({ error: { message: 'Not found' } }, 404);
  }
};