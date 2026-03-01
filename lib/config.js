/**
 * 核心配置和常量
 */

// Baxia SDK 版本
const BAXIA_VERSION = '2.5.36';

// 缓存配置
const CACHE_TTL = 4 * 60 * 1000; // 4分钟缓存

// 缓存状态
let tokenCache = null;
let tokenCacheTime = 0;

// API Token 配置 (从环境变量获取，多个 token 用逗号分隔)
function getApiTokens() {
  const tokens = process.env.API_TOKENS;
  if (!tokens) return [];
  return tokens.split(',').map(t => t.trim()).filter(t => t);
}

module.exports = {
  BAXIA_VERSION,
  CACHE_TTL,
  tokenCache,
  tokenCacheTime,
  getApiTokens,
  
  // 缓存管理
  setCache: (data) => {
    tokenCache = data;
    tokenCacheTime = Date.now();
  },
  getCache: () => {
    if (tokenCache && (Date.now() - tokenCacheTime) < CACHE_TTL) {
      return tokenCache;
    }
    return null;
  },
  clearCache: () => {
    tokenCache = null;
    tokenCacheTime = 0;
  }
};
