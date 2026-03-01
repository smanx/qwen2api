# Qwen2API

将 Qwen Chat 转换为 OpenAI 兼容的 API 代理服务。

## 功能特性

- 🔄 OpenAI API 兼容格式
- 🚀 支持流式响应 (SSE)
- 🔐 可选的 API Token 认证
- 🌐 多平台部署支持

## 部署方式

### Docker

```bash
# 构建镜像
docker build -t qwen2api .

# 运行容器
docker run -d -p 8765:8765 -e API_TOKENS=your_token qwen2api
```

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Vercel 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Netlify 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

### Cloudflare Workers

```bash
# 安装 wrangler
npm install -g wrangler

# 登录
wrangler login

# 部署
wrangler deploy
```

在 Cloudflare Dashboard 中设置环境变量 `API_TOKENS`。

## 公共服务

提供两个公共服务供测试使用：

| 服务地址 | 平台 |
|----------|------|
| `https://qwen2api-v.smanx.xx.kg` | Vercel |
| `https://qwen2api-n.smanx.xx.kg` | Netlify |

- 无需 API Token（密钥为空）
- 建议自行部署以获得更稳定的服务

## 注意事项

- ⚠️ 本项目 API 只支持纯文本对话，不支持图片、文件等多模态内容

## 环境变量

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `API_TOKENS` | API 密钥，多个用逗号分隔 | 否 |

## 使用方法

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 获取模型列表 |
| `/v1/chat/completions` | POST | 聊天完成 |
| `/` | GET | 健康检查 |

### 请求示例

```bash
# 获取模型列表
curl https://your-domain/v1/models \
  -H "Authorization: Bearer your_token"

# 聊天完成
curl https://your-domain/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### OpenAI SDK 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_token",
    base_url="https://your-domain/v1"
)

response = client.chat.completions.create(
    model="qwen3.5-plus",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your_token',
  baseURL: 'https://your-domain/v1'
});

const stream = await client.chat.completions.create({
  model: 'qwen3.5-plus',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## 支持的模型

- `qwen3.5-plus`
- `qwen3.5-flash`
- `qwen3.5-turbo`
- 以及 Qwen Chat 支持的其他模型

## 项目结构

```
qwen2api/
├── core.js              # 核心业务逻辑
├── index.js             # Docker / 本地入口
├── api/
│   └── index.js         # Vercel 入口
├── netlify/
│   └── functions/
│       └── api.js       # Netlify 入口
├── worker.js            # Cloudflare Workers 入口
├── Dockerfile
├── vercel.json
├── netlify.toml
└── wrangler.toml
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 服务运行在 http://localhost:8765
```

## 免责声明

本项目仅供学习和测试使用，请勿用于生产环境或商业用途。使用本项目所产生的一切后果由使用者自行承担，与项目作者无关。

## License

MIT
