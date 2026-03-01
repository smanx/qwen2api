const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// 从环境变量或直接配置获取 JWT Token
const AUTH_TOKEN = process.env.QWEN_TOKEN || `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjhkMTE4ZjI3LWFlNzItNDBhZC05YjIwLTY0MWMzZDAxMWVkMiIsImxhc3RfcGFzc3dvcmRfY2hhbmdlIjoxNzcyMzA0MjExLCJleHAiOjE3NzQ4OTY2NDB9.hCR1c8MfUWyIbNtrvON8jA80CyAExabdCCZDvkL_mRA`;

// 延迟加载 baxia-token 模块
let baxiaModule = null;

async function getBaxiaModule() {
  if (!baxiaModule) {
    baxiaModule = require('./baxia-token');
  }
  return baxiaModule;
}

// OpenAI 格式的模型列表 API
app.get('/v1/models', async (req, res) => {
  try {
    const { getModels, closeBrowser } = await getBaxiaModule();
    const result = await getModels(AUTH_TOKEN);
    
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: { message: result.error } });
    }
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ 
      error: { message: 'Failed to fetch models', type: 'api_error' }
    });
  }
});

// OpenAI 格式的聊天完成 API
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, stream = false } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: { message: 'Messages are required', type: 'invalid_request_error' }
      });
    }

    const { sendChatRequest, convertToOpenAIFormat, closeBrowser } = await getBaxiaModule();
    
    console.log(`[API] Chat request: model=${model || 'qwen3.5-flash'}, stream=${stream}`);
    
    const actualModel = model || 'qwen3.5-flash';
    console.log(`[API] Chat request: model=${actualModel}, stream=${stream}, messages=${JSON.stringify(messages)}`);
    
    const result = await sendChatRequest(AUTH_TOKEN, messages, actualModel, stream);
    
    console.log(`[API] Result: error=${result.error || 'none'}, dataType=${typeof result.data}, dataLength=${result.data ? result.data.length : 'N/A'}`);
    if (result.responseInfo) {
      console.log(`[API] Response info: status=${result.responseInfo.status}, contentType=${result.responseInfo.contentType}`);
    }
    if (result.error && result.data) {
      console.log(`[API] Error data: ${result.data.substring(0, 500)}`);
    }

    if (result.error) {
      console.error('[API] Chat error:', result.error);
      return res.status(500).json({ 
        error: { message: result.error, type: 'api_error' }
      });
    }

    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // 将 Qwen 的 SSE 格式转换为 OpenAI 格式并转发
      const responseStr = typeof result.data === 'string' 
        ? result.data 
        : JSON.stringify(result.data);
      
      const lines = responseStr.split('\n').filter(line => line.startsWith('data: '));
      
      // 所有 chunk 使用同一个 ID
      const responseId = `chatcmpl-${uuidv4()}`;
      const created = Math.floor(Date.now() / 1000);
      
      console.log(`[API] Processing ${lines.length} SSE lines, responseId=${responseId}`);
      
      let contentChunks = 0;
      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          console.log(`[API] Sending [DONE], total content chunks: ${contentChunks}`);
          res.write('data: [DONE]\n\n');
          continue;
        }
        
        try {
          const parsed = JSON.parse(data);
          
          // 转换为 OpenAI 格式
          const openAIChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: created,
            model: actualModel,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: null,
            }],
          };
          
          if (parsed.choices && parsed.choices[0]) {
            const choice = parsed.choices[0];
            
            if (choice.delta && choice.delta.content) {
              openAIChunk.choices[0].delta = {
                content: choice.delta.content,
              };
              contentChunks++;
            }
            
            if (choice.finish_reason) {
              openAIChunk.choices[0].finish_reason = choice.finish_reason;
            }
          }
          
          res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
        } catch (e) {
          console.log(`[API] Parse error: ${e.message}, line: ${line.substring(0, 100)}`);
        }
      }
      
      console.log(`[API] Stream completed, total content chunks sent: ${contentChunks}`);
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应
      const openAI = convertToOpenAIFormat(result.data, actualModel, false);
      res.json(openAI);
    }
  } catch (error) {
    console.error('Error in chat completions:', error);
    res.status(500).json({ 
      error: { message: error.message, type: 'internal_error' }
    });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 根路径
app.get('/', (req, res) => {
  res.json({
    message: 'Qwen to OpenAI API Proxy (with Baxia bypass)',
    version: '3.0.0',
    backend: 'Using Puppeteer to bypass Baxia',
    endpoints: {
      models: '/v1/models',
      chat: '/v1/chat/completions',
    },
    note: 'This version uses Puppeteer to handle Baxia security automatically',
  });
});

const PORT = process.env.PORT || 8765;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Qwen2API server running on port ${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Note: First request will launch a headless browser`);
}).on('error', (err) => {
  console.error('Server error:', err);
});
