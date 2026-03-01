const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// OpenAI 格式的模型列表 API
app.get('/v1/models', async (req, res) => {
  try {
    const response = await fetch('https://chat.qwen.ai/api/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
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
    const { model, messages, stream = true } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: { message: 'Messages are required', type: 'invalid_request_error' }
      });
    }

    const actualModel = model || 'qwen3.5-plus';
    
    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage ? lastUserMessage.content : 'hello';
    
    // 动态获取 baxia tokens (纯 Node.js 实现，无需浏览器)
    const baxiaNode = require('./baxia-node');
    const { bxUa, bxUmidToken, bxV } = await baxiaNode.getBaxiaTokensNode({ silent: true });
    
    console.log('[API] Got baxia tokens:', { bxUaLength: bxUa.length, bxUmidToken: bxUmidToken.substring(0, 20) + '...', bxV });
    
    // 先创建新的 chat 会话 (guest 模式，不需要登录)
    console.log('[API] Creating new chat session (guest mode)...');
    const createChatBody = {
      title: '新建对话',
      models: [actualModel],
      chat_mode: 'guest',
      chat_type: 't2t',
      timestamp: Date.now(),
      project_id: '',
    };
    
    const createHeaders = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Referer': 'https://chat.qwen.ai/c/guest',
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'x-request-id': uuidv4(),
    };
    
    const createResponse = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(createChatBody),
    });
    
    const createData = await createResponse.json();
    
    if (!createData.success || !createData.data?.id) {
      return res.status(500).json({ 
        error: { message: 'Failed to create chat session', details: createData }
      });
    }
    
    const chatId = createData.data.id;
    
    // 将多轮对话合并成一个消息
    let combinedContent = '';
    if (messages.length > 1) {
      // 多轮对话：把历史对话格式化到一个 content 中
      const historyParts = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        historyParts.push(`[${roleLabel}]: ${msg.content}`);
      }
      combinedContent = historyParts.join('\n\n') + '\n\n[User]: ' + messages[messages.length - 1].content;
    } else {
      combinedContent = userContent;
    }
    
    const fid = uuidv4();
    const responseFid = uuidv4();
    
    const requestBody = {
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: chatId,
      chat_mode: 'guest',
      model: actualModel,
      parent_id: null,
      messages: [{
        fid: fid,
        parentId: null,
        childrenIds: [responseFid],
        role: 'user',
        content: combinedContent,
        user_action: 'chat',
        files: [],
        timestamp: Date.now(),
        models: [actualModel],
        chat_type: 't2t',
        feature_config: {
          thinking_enabled: true,
          output_schema: 'phase',
          research_mode: 'normal',
          auto_thinking: true,
          thinking_format: 'summary',
          auto_search: true,
        },
        extra: {
          meta: {
            subChatType: 't2t',
          },
        },
        sub_chat_type: 't2t',
        parent_id: null,
      }],
      timestamp: Date.now(),
    };
    
    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Content-Type': 'application/json',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'source': 'web',
      'version': '0.2.9',
      'timezone': new Date().toUTCString(),
      'x-accel-buffering': 'no',
      'x-request-id': uuidv4(),
      'Cookie': '',
      'Referer': 'https://chat.qwen.ai/c/guest',
    };
    
    const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Chat error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: { message: errorText, type: 'api_error' }
      });
    }

    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const responseId = `chatcmpl-${uuidv4()}`;
      const created = Math.floor(Date.now() / 1000);
      
      let buffer = '';
      
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
              }
              
              if (choice.finish_reason) {
                openAIChunk.choices[0].finish_reason = choice.finish_reason;
              }
            }
            
            res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应 - 读取所有数据
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let contentChunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
      }
      
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0]?.delta?.content) {
            contentChunks.push(parsed.choices[0].delta.content);
          }
        } catch (e) {}
      }
      
      const openAI = {
        id: `chatcmpl-${uuidv4()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: actualModel,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: contentChunks.join(''),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      
      res.json(openAI);
    }
  } catch (error) {
    console.error('Error in chat completions:', error);
    res.status(500).json({ 
      error: { message: error.message, type: 'internal_error' }
    });
  }
});

// 根路径 - 模拟 nginx
app.get('/', (req, res) => {
  res.status(200).send('<html>\n<head><title>200 OK</title></head>\n<body>\n<center><h1>200 OK</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n');
});

const PORT = process.env.PORT || 8765;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Qwen2API server running on port ${PORT}`);
}).on('error', (err) => {
  console.error('Server error:', err);
});
