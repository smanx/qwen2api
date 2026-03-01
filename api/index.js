/**
 * Vercel Serverless 入口
 */

const { handleModels, handleChatCompletions, handleRoot, createResponse } = require('../core.js');

module.exports = async (req, res) => {
  // 处理 CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const authHeader = req.headers?.authorization || '';
  const path = req.url || '';
  
  try {
    // 模型列表
    if (req.method === 'GET' && path.includes('/v1/models')) {
      const result = await handleModels(authHeader);
      return res.status(result.statusCode).set(result.headers).send(result.body);
    }
    
    // 聊天完成
    if (req.method === 'POST' && path.includes('/v1/chat/completions')) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const result = await handleChatCompletions(body, authHeader);
      return res.status(result.statusCode).set(result.headers).send(result.body);
    }
    
    // 根路径
    if (req.method === 'GET' && (path === '/' || path === '')) {
      const result = handleRoot();
      return res.status(200).set(result.headers).send(result.body);
    }
    
    // 404
    return res.status(404).json({ error: { message: 'Not found' } });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: { message: error.message } });
  }
};