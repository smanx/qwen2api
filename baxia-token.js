/**
 * Qwen Chat API with Baxia Token Support
 * 使用 Puppeteer 模拟浏览器来绕过阿里云 Baxia 安全验证
 */

const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

// 缓存
let browserInstance = null;
let pageInstance = null;
let currentChatId = null;  // 当前活跃的聊天会话 ID
let lastChatModel = null;  // 上一次使用的模型

/**
 * 获取或创建 browser 实例
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[Qwen] Launching browser...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  }
  return browserInstance;
}

/**
 * 获取或创建已认证的 page
 */
async function getAuthenticatedPage(authToken) {
  const browser = await getBrowser();
  
  if (!pageInstance || pageInstance.isClosed()) {
    console.log('[Qwen] Creating new page...');
    pageInstance = await browser.newPage();
    
    // 设置 User-Agent
    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    
    // 设置认证 token
    await pageInstance.evaluateOnNewDocument((token) => {
      localStorage.setItem('token', token);
    }, authToken);
    
    // 访问页面
    console.log('[Qwen] Navigating to chat.qwen.ai...');
    await pageInstance.goto('https://chat.qwen.ai', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  return pageInstance;
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
  }
}

/**
 * 构建 Qwen 格式的消息
 */
function buildQwenMessage(content, role = 'user') {
  const fid = uuidv4();
  const responseId = uuidv4();
  
  return {
    fid,
    parentId: null,
    childrenIds: [responseId],
    role,
    content,
    user_action: 'chat',
    files: [],
    timestamp: Date.now(),
    models: ['qwen3.5-plus'],
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
  };
}

/**
 * 创建新的聊天会话
 */
async function createChat(authToken, model = 'qwen3.5-plus') {
  const page = await getAuthenticatedPage(authToken);
  
  const result = await page.evaluate(async ({ model }) => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'No token' };
    
    try {
      const response = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ model }),
        credentials: 'include',
      });
      
      if (response.ok) {
        return { success: true, data: await response.json() };
      }
      return { error: `HTTP ${response.status}`, body: await response.text() };
    } catch (e) {
      return { error: e.message };
    }
  }, { model });
  
  return result;
}

/**
 * 在浏览器中发送聊天请求
 * @param {string} authToken - JWT token
 * @param {Array} messages - 消息数组
 * @param {string} model - 模型名称
 * @param {boolean} stream - 是否流式
 * @param {string} chatId - 可选的聊天会话 ID，用于连续对话
 */
async function sendChatRequest(authToken, messages, model = 'qwen3.5-plus', stream = true, chatId = null) {
  // 如果没有提供 chatId，决定是否复用现有会话
  const hasHistory = messages.length > 1;
  
  if (!chatId) {
    // 如果模型相同，复用会话（不管是否有历史对话）
    if (currentChatId && lastChatModel === model) {
      chatId = currentChatId;
      console.log(`[Qwen] Reusing chat session: ${chatId} (hasHistory: ${hasHistory})`);
    } else {
      // 创建新的聊天会话
      const chatCreateResult = await createChat(authToken, model);
      if (!chatCreateResult.success) {
        return { error: 'Failed to create chat', details: chatCreateResult };
      }
      
      chatId = chatCreateResult.data?.data?.id || uuidv4();
      currentChatId = chatId;
      lastChatModel = model;
      console.log(`[Qwen] Created new chat: ${chatId} (hasHistory: ${hasHistory})`);
    }
  }
  
  const page = await getAuthenticatedPage(authToken);
  const requestId = uuidv4();
  const timezone = new Date().toUTCString();
  
  console.log(`[Qwen] Sending chat request: model=${model}, stream=${stream}, chatId=${chatId}`);
  console.log(`[Qwen] Original messages count: ${messages.length}`);
  
  // Qwen API 不支持在 messages 中发送多条消息（包括历史对话）
  // 只发送最后一条用户消息
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const messagesToSend = lastUserMessage ? [lastUserMessage] : messages;
  
  console.log(`[Qwen] Messages to send: ${messagesToSend.length}`);
  
  // 将 OpenAI 格式的 messages 转换为 Qwen 格式
  const qwenMessages = messagesToSend.map(msg => {
    if (msg.role === 'user') {
      return buildQwenMessage(msg.content, 'user');
    } else if (msg.role === 'assistant') {
      return buildQwenMessage(msg.content, 'assistant');
    } else if (msg.role === 'system') {
      // 系统消息通常不需要特殊处理，可以忽略或转换
      return null;
    }
    return msg;
  }).filter(Boolean);
  
  // 构建请求体
  const requestBody = {
    stream,
    version: '2.1',
    incremental_output: true,
    chat_id: chatId,
    chat_mode: 'guest',
    model,
    parent_id: null,
    messages: qwenMessages,
    timestamp: Date.now(),
  };
  
  // 在页面上下文中执行 fetch 请求
  const result = await page.evaluate(async ({ chatId, requestId, timezone, model, requestBody, stream }) => {
    const token = localStorage.getItem('token');
    if (!token) {
      return { error: 'No auth token in localStorage' };
    }
    
    try {
      const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'x-request-id': requestId,
          'timezone': timezone,
          'source': 'web',
          'version': '0.2.9',
        },
        body: JSON.stringify(requestBody),
        credentials: 'include',
      });
      
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok) {
        const text = await response.text();
        return { error: `HTTP ${response.status}`, body: text, status: response.status, contentType };
      }
      
      // 返回响应信息供调试
      const responseInfo = { status: response.status, contentType };
      
      if (stream && contentType.includes('text/event-stream')) {
        // 流式响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let chunks = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value, { stream: true }));
        }
        
        const fullData = chunks.join('');
        return { stream: true, data: fullData, responseInfo };
      } else {
        // 非流式或非预期格式
        const text = await response.text();
        return { 
          success: false, 
          error: `Unexpected content-type: ${contentType}`, 
          data: text,
          responseInfo 
        };
      }
    } catch (e) {
      return { error: e.message };
    }
  }, { chatId, requestId, timezone, model, requestBody, stream });
  
  return result;
}

/**
 * 将 Qwen 响应转换为 OpenAI 格式
 */
function convertToOpenAIFormat(qwenResponse, model, stream = false) {
  const id = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  
  if (stream) {
    // 解析 SSE 格式的流式响应
    const responseStr = typeof qwenResponse === 'string' ? qwenResponse : JSON.stringify(qwenResponse);
    const lines = responseStr.split('\n').filter(line => line.startsWith('data: '));
    const contentChunks = [];
    let finishReason = null;
    let usage = null;
    
    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      
      try {
        const parsed = JSON.parse(data);
        
        // 提取内容
        if (parsed.choices && parsed.choices[0]) {
          const choice = parsed.choices[0];
          if (choice.delta && choice.delta.content) {
            contentChunks.push(choice.delta.content);
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
        
        // 提取 usage
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: contentChunks.join(''),
        },
        finish_reason: finishReason || 'stop',
      }],
      usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  } else {
    // 非流式响应
    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: qwenResponse.data?.choices?.[0]?.message?.content || '',
        },
        finish_reason: 'stop',
      }],
      usage: qwenResponse.data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}

/**
 * 获取模型列表
 */
async function getModels(authToken) {
  const page = await getAuthenticatedPage(authToken);
  
  const result = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'No token' };
    
    try {
      const response = await fetch('https://chat.qwen.ai/api/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        return { success: true, data: await response.json() };
      }
      return { error: `HTTP ${response.status}` };
    } catch (e) {
      return { error: e.message };
    }
  });
  
  return result;
}

module.exports = {
  sendChatRequest,
  getModels,
  closeBrowser,
  getBrowser,
  getAuthenticatedPage,
  convertToOpenAIFormat,
  buildQwenMessage,
};