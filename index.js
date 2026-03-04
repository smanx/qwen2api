/**
 * Qwen2API - 统一入口
 * 
 * 支持: Docker (Express) / Vercel / Netlify
 */

const { handleModels, handleChatCompletions, handleRoot, handleChatPage, createResponse, validateToken, uuidv4 } = require('./core.js');

// ============================================
// Express Stream Handler
// ============================================

function createExpressStreamHandler(res) {
  return async (response, model, responseId, created) => {
    const rawFlag = process.env.CHAT_DETAIL_LOG || '';
    const debugEnabled = ['1', 'true', 'yes', 'on'].includes(String(rawFlag).toLowerCase());
    let hasStreamContent = false;

    const writeStreamContent = (content) => {
      if (!debugEnabled || !content) return;
      hasStreamContent = true;
      process.stdout.write(content);
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const reader = response.body?.getReader ? response.body.getReader() : null;
    const decoder = new TextDecoder();
    let buffer = '';
    let doneWritten = false;

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
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            doneWritten = true;
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
              const errObj = typeof parsed.error === 'string'
                ? { error: { message: parsed.error, type: 'api_error' } }
                : { error: parsed.error };
              res.write(`data: ${JSON.stringify(errObj)}\n\n`);
              continue;
            }

            const delta = parsed?.choices?.[0]?.delta;
            if (delta && typeof delta === 'object') {
              if (typeof delta.content === 'string' && delta.content) {
                writeStreamContent(delta.content);
              }
              const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: {
                    ...(typeof delta.role === 'string' ? { role: delta.role } : {}),
                    ...(typeof delta.content === 'string' ? { content: delta.content } : {}),
                  },
                  finish_reason: parsed?.choices?.[0]?.finish_reason || null,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch {}
        }
      }
    } catch (err) {
      if (!res.writableEnded) {
        const message = err && err.message ? err.message : 'stream proxy error';
        res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
      }
    } finally {
      if (!doneWritten && !res.writableEnded) {
        res.write('data: [DONE]\n\n');
      }
      if (!res.writableEnded) {
        res.end();
      }
    }

    if (debugEnabled && hasStreamContent) {
      process.stdout.write('\n');
      console.log('[qwen2api][express][stream] 输出完毕');
    }
  };
}

// ============================================
// Serverless Handler (Vercel / Netlify)
// ============================================

async function serverlessHandler(req, res) {
  if (req.method === 'OPTIONS') {
    return res ? res.status(200).end() : createResponse('', 200);
  }
  
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const path = req.url || req.path || '';
  let pathname = path;
  try {
    pathname = new URL(path, 'http://localhost').pathname;
  } catch {}
  
  if (req.method === 'GET' && path.includes('/v1/models')) {
    const result = await handleModels(authHeader);
    if (res) return res.status(result.statusCode).set(result.headers).send(result.body);
    return result;
  }
  
  if (req.method === 'POST' && path.includes('/v1/chat/completions')) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handleChatCompletions(body, authHeader);
    if (res) return res.status(result.statusCode).set(result.headers).send(result.body);
    return result;
  }
  
  if (req.method === 'GET' && (pathname === '/chat' || pathname === '/chat/')) {
    const result = handleChatPage();
    if (res) return res.status(200).set(result.headers).send(result.body);
    return result;
  }

  if (req.method === 'GET' && (path === '/' || path.endsWith('/'))) {
    const result = handleRoot();
    if (res) return res.status(200).set(result.headers).send(result.body);
    return result;
  }
  
  return res ? res.status(404).json({ error: { message: 'Not found' } }) : createResponse({ error: { message: 'Not found' } }, 404);
}

// ============================================
// Express Server (Docker / 本地开发)
// ============================================

function startExpressServer() {
  const express = require('express');
  const app = express();
  const jsonLimit = process.env.JSON_BODY_LIMIT || '20mb';
  app.use(express.json({ limit: jsonLimit }));

  app.use((error, req, res, next) => {
    if (!error) return next();
    if (error.type === 'entity.too.large' || error.status === 413) {
      return res.status(413).json({
        error: {
          message: `Payload too large. Current JSON body limit is ${jsonLimit}. You can increase it with JSON_BODY_LIMIT.`,
          type: 'invalid_request_error',
        },
      });
    }
    return next(error);
  });

  // Token 验证中间件
  function authMiddleware(req, res, next) {
    if (!validateToken(req.headers.authorization)) {
      return res.status(401).json({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } });
    }
    next();
  }

  app.get('/v1/models', authMiddleware, async (req, res) => {
    const result = await handleModels(req.headers.authorization);
    res.status(result.statusCode).set(result.headers).send(result.body);
  });

  app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
    await handleChatCompletions(req.body, req.headers.authorization, null, createExpressStreamHandler(res));
  });

  app.get('/', (req, res) => {
    const result = handleRoot();
    res.status(200).set(result.headers).send(result.body);
  });

  app.get('/chat', (req, res) => {
    const result = handleChatPage();
    res.status(200).set(result.headers).send(result.body);
  });

  const PORT = process.env.PORT || 8765;
  app.listen(PORT, '0.0.0.0', () => console.log(`Qwen2API server running on port ${PORT}`));
}

// ============================================
// 导出 & 入口判断
// ============================================

module.exports = serverlessHandler;
module.exports.handleModels = handleModels;
module.exports.handleChatCompletions = handleChatCompletions;
module.exports.handleRoot = handleRoot;
module.exports.createResponse = createResponse;

const isServerless = process.env.VERCEL === '1' || process.env.NETLIFY === 'true';
if (!isServerless && require.main === module) {
  startExpressServer();
}
