/**
 * Netlify Functions 入口
 */

const { handleModels, handleChatCompletions, handleRoot, handleChatPage, createResponse } = require('../../core.js');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const path = event.path || '';
  const pathname = typeof path === 'string' ? path.split('?')[0] : '';

  if (event.httpMethod === 'GET' && path.includes('/v1/models')) {
    return handleModels(authHeader);
  }
  if (event.httpMethod === 'POST' && path.includes('/v1/chat/completions')) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return handleChatCompletions(body, authHeader);
  }
  if (event.httpMethod === 'GET' && (path === '/' || path === '')) {
    return handleRoot();
  }
  if (event.httpMethod === 'GET' && (pathname === '/chat' || pathname === '/chat/')) {
    return handleChatPage();
  }
  
  return createResponse({ error: { message: 'Not found' } }, 404);
};
