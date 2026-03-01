/**
 * Vercel Serverless 入口
 */

const { handleModels, handleChatCompletions, handleRoot, createResponse } = require('../core.js');

module.exports = async (req, res) => {
  // 处理 CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }
  
  const authHeader = req.headers?.authorization || '';
  const path = req.url || '';
  
  try {
    // 模型列表
    if (req.method === 'GET' && path.includes('/v1/models')) {
      const result = await handleModels(authHeader);
      res.writeHead(result.statusCode, result.headers);
      return res.end(result.body);
    }
    
    // 聊天完成
    if (req.method === 'POST' && path.includes('/v1/chat/completions')) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const result = await handleChatCompletions(body, authHeader);
      res.writeHead(result.statusCode, result.headers);
      return res.end(result.body);
    }
    
    // 根路径
    if (req.method === 'GET' && (path === '/' || path === '')) {
      const result = handleRoot();
      res.writeHead(result.statusCode, result.headers);
      return res.end(result.body);
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: { message: 'Not found' } }));
  } catch (error) {
    console.error('Handler error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: { message: error.message } }));
  }
};
