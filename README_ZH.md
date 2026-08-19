# Qwen2API

中文 | [English](README.md)

将 Qwen Chat 转换为 OpenAI 兼容的 API 代理服务。

## 功能特性

- 🔄 OpenAI API 兼容格式
- 🚀 支持流式响应 (SSE)
- 🔐 可选的 API Token 认证
- 🌐 多平台部署：本地 NodeJS / Docker、Vercel、Netlify、Cloudflare Workers
- 🖼️ 支持图片生成
- 🎬📄 支持视频解析、图片与文档解析
- 💬 内置 Web 聊天界面

## 架构总览（运行全貌）

所有部署形态共用同一套代码：每个平台入口（`index.js`、`api/index.js`、
`netlify/functions/api.js`、`worker.js`）都只是薄协议适配层，调用同一个
`core.js` 业务逻辑，因此路由、附件上传、流式、错误处理在各平台行为一致。

```
                     ┌──────────────────────────────────────┐
                     │  客户端：OpenAI SDK / curl /          │
                     │  内置 /chat 聊天页面                  │
                     └──────────────────┬───────────────────┘
                                        │  OpenAI 兼容 HTTP
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  入口适配层（薄包装：只做路由与平台协议适配）                              │
│                                                                          │
│   index.js              api/index.js       netlify/functions/api.js      │
│   (Express,             (Vercel Node 函数,  (Netlify Node 函数,           │
│    本地 / Docker)        maxDuration)         timeout)                    │
│   worker.js                                                              │
│   (CF Worker, nodejs_compat)                                             │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  core.js —— 唯一的业务逻辑模块（esbuild 打包进每个入口）                    │
│                                                                          │
│   路由:   GET  /v1/models                 （模型列表，动态抓取上游）       │
│           POST /v1/chat/completions       （对话，OpenAI 兼容）           │
│           POST /v1/chat/completions/log   （对话+进度日志；               │
│                                             视频分析专用端点）            │
│           POST /v1/images/generations     （文生图）                      │
│           GET  /chat                      （内置聊天页面）                │
│           GET  /                          （健康检查）                    │
│                                                                          │
│   /chat 页面:  磁盘可读时读 chat.html（本地开发实时生效）                  │
│                读不到时回退到打包进代码的 chat-html.js 内联副本            │
│                （serverless 函数环境）；重新生成命令：                    │
│                npm run build:chat-html                                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  单次请求处理流水线
                                    ▼
   ①  鉴权     validateToken —— 环境变量 API_TOKENS（为空则开放访问）
   ②  Token    getBaxiaTokens
                 ├─ Node + Chromium → 真实 baxia SDK（T2gAv_ + cookies，缓存 25 分钟）
                 └─ serverless / CF → 简化 token（wu.json），自动降级
   ③  建会话   createChatSession —— /api/v2/chats/new，失败换 token 重试 3 次
   ④  解析     消息 → 文本 + 附件（图片 / 音频 / 视频 / 文档）
   ⑤  视频     [仅 /log 端点] body.video_url → yt-dlp 下载
                 → 包装成普通 video 附件
                 （仅本地/Docker；serverless 返回明确错误）
   ⑥  上传     每个附件：取字节 → getstsToken → PUT 阿里云 OSS（V4 签名）
                 → 状态轮询（视频跳过）→ 文档解析（仅文档）
   ⑦  对话     POST /api/v2/chat/completions（上游 SSE 流，files=已上传）
   ⑧  响应     stream=true  → 实时 SSE 映射（Express / Vercel / CF）
                              或缓冲后整体返回（Netlify）
               stream=false → 收集后返回非流式 JSON chat.completion
```

### 视频分析流程

视频分析**复用通用对话端点**（`/v1/chat/completions/log`）+ 一个可选字段，
不需要专用新接口。聊天页面填写视频链接后会自动切换到该端点。

```
POST /v1/chat/completions/log
body: {
  "messages": [...],
  "stream": true,
  "video_url": "https://...",      // 触发视频分析
  "min_video_resolution": 480      // 可选，默认 480
}

  ①  yt-dlp 下载视频（清晰度：请求参数 → 环境变量 MIN_VIDEO_RESOLUTION → 480）
  ②  视频包装成普通 'video' 附件
  ③  与图片/文件走同一条 OSS 上传链（视频跳过状态轮询）
  ④  携带上传文件发起普通对话
```

### 平台能力对比

| 能力 | 本地 / Docker | Vercel | Netlify | CF Worker |
|------|---------------|--------|---------|-----------|
| 真实 baxia token（Chromium） | ✅ | ❌ 简化 | ❌ 简化 | ❌ 简化 |
| 实时 SSE 流式 | ✅ | ✅ | ⚠️ 缓冲 | ✅ |
| 视频分析（yt-dlp） | ✅ | ❌ | ❌ | ❌ |
| 附件上传（OSS） | ✅ | ✅  | ✅  | ✅  |
| 聊天页 /chat | ✅ 读文件 | ✅ 内联副本 | ✅ 内联副本 | ✅ 内联副本 |

### 设计要点

- **`nodeRequire(name)`** 动态加载 Node 内置模块：打包器不会把它内联，
  因此同一份 `core.js` 也能在 CF Workers 上构建；运行时模块缺失时返回
  `null`，调用方优雅降级（WebCrypto 代替 `crypto`、`wu.json` 代替 baxia SDK）。
- **`process` 防护**——serverless 运行时可能完全没有 `process`，所有访问
  都经过 `typeof process !== 'undefined'` 判断。
- **`chat-html.js`** 由 `scripts/build-chat-html.js` 从 `chat.html` 生成
  （`npm run build:chat-html`）——修改 `chat.html` 后需重新生成。

## 部署方式

> 不同平台在**认证凭证获取**上有本质区别，直接影响对话稳定性，请先阅读
> [平台差异对比](#平台差异对比)。

### 本地 NodeJS / Docker（推荐）

这两种部署运行完整的 Node 运行时，**可以启动无头 Chromium 运行真实 baxia SDK**，
获取稳定的认证 token，对话几乎不被上游风控。

```bash
# 本地运行
npm install
node index.js            # 默认端口 8765（可通过 PORT 修改）

# Docker 构建 + 运行
docker build -t qwen2api .
# 注意：容器内跑 Chromium 需要足够的共享内存，务必加 --shm-size
docker run -d -p 8765:8765 --shm-size=2g -e API_TOKENS=your_token qwen2api
```

- 镜像基于 Debian，内置 `chromium`、`ffmpeg`、`yt-dlp`。
- 容器内通过 `CHROME_PATH=/usr/bin/chromium` 自动定位浏览器（见环境变量表）。
- 若某些环境无法运行 Chromium，可用 `USE_CHROME_BAXIA=false` 回退到简化 token（稳定性下降）。

#### 使用 GHCR 预构建镜像（免本地构建）

每次代码推送或手动触发，GitHub Actions 都会自动构建镜像并推送到
**GitHub Container Registry**（见 `.github/workflows/docker-build.yml`），可直接拉取使用：

```bash
# 拉取最新镜像
docker pull ghcr.io/smanx/qwen2api:latest

# 运行（容器内监听 7860，映射到宿主 8765；Chromium 需要足够共享内存，务必加 --shm-size）
docker run -d -p 8765:7860 --shm-size=2g -e API_TOKENS=your_token ghcr.io/smanx/qwen2api:latest
```

- 常用标签：`latest`（最新构建）、`master`（分支名）、`sha-<7位sha>`（每次提交）、`vX.Y.Z`（版本标签）。
- 想固定到某次提交：`docker pull ghcr.io/smanx/qwen2api:sha-<7位sha>`。
- 容器内端口为 `7860`，如要改宿主映射端口只需调整 `-p` 左侧（如 `-p 9000:7860`）。

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Vercel 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

> Vercel 是无服务器（serverless）环境，**无法运行 Chromium**，因此只能使用
> 简化的 token 获取方式。可能间歇性被上游风控，稳定性不如本地/Docker。
> Vercel 入口（`api/index.js`）使用 **Node.js 运行时**，与本地 / Netlify 共用
> 同一套 `core.js` 逻辑。函数超时通过 `module.exports.config.maxDuration` 配置
> （上限由 Vercel 计划决定）；SSE 流式响应实时转发（Vercel Node 函数支持流式）。

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Netlify 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

> Netlify Functions（Node 运行时）同样是无服务器环境，**无法运行 Chromium**，行为与
> Vercel 类似：走简化 token + 自动重试，稳定性有限。
> 函数超时在 `netlify.toml` 中配置（上限由 Netlify 计划决定）；流式(SSE)响应会被缓冲后整体返回。

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

> Cloudflare Workers 同样是无服务器环境，无法运行 Chromium，只能使用简化 token。
> Worker 入口（`worker.js`）是薄包装，复用与本地 / Vercel / Netlify 相同的 `core.js`
> 逻辑（依赖 `wrangler.toml` 中已配置的 `nodejs_compat` 标志）。SSE 流式输出实时转发；
> 视频链接分析（yt-dlp）在 Workers 上不支持。

### 平台差异对比

| 维度 | 本地 Node / Docker | Vercel / Netlify / Cloudflare Workers |
|------|-------------------|----------------------------------------|
| Chromium（真实 baxia SDK） | ✅ 支持（生成稳定 token） | ❌ 不支持 |
| token 获取方式 | 真实 `T2gAv_` token + cookies（缓存 25 分钟） | 简化 token（`wu.json`），有效性与稳定性低 |
| 上游风控 | 几乎不被拦 | 可能间歇性被拦（自动重试缓解） |
| 视频链接 / 大文件分析 | ✅ 支持（需 yt-dlp） | ❌ 不支持（serverless 限制） |
| 适用场景 | 自建服务器、日常使用 | 快速部署、轻量试用 |

## 公共服务

提供三个公共服务供测试使用：

| 服务地址 | 平台 |
|----------|------|
| `https://qwen2api-n.smanx.xx.kg` | Netlify |
| ~~`https://qwen2api-v.smanx.xx.kg`~~ | ~~Vercel~~ （使用超额已停机） |
| `https://qwen2api.smanx.xx.kg` | Cloudflare Workers |

- 无需 API Token（密钥为空）
- 建议自行部署以获得更稳定的服务

## 注意事项

- ✅ `/v1/chat/completions` 已支持附件与多模态消息（图片/文件/音频）。
- ✅ 支持图片理解与文档解析流程（可在对话中直接使用）。
- ⚠️ 附件会按 Qwen Web 的流程先上传到 Qwen OSS，文件较大时请求耗时会增加。
- ✅ **支持工具调用** - `/v1/chat/completions` 支持 `tools` 与 `tool_choice`，流式与非流式均返回 OpenAI 格式的 `tool_calls` 及 `finish_reason: "tool_calls"`。多轮回路可用：把 `assistant.tool_calls` 与 `role: "tool"` 结果放回 `messages` 即可。
  - Qwen Web 无原生 function calling，因此通过注入 Qwen 原生 `<tool_call>` 提示词格式并回解实现，准确率依赖模型表现，与原生接口不同。
  - 位于 ``` 代码围栏或 `行内代码` 内的标记不会被执行，因此模型可以安全地讲解该格式。
  - `tool_choice` 支持 `auto` / `none` / `required` / 指定函数。`required` 与指定函数仅为提示词约束，模型未调用时不会报错。
  - 不校验工具名与参数 schema，请在自己的执行层校验。
  - Qwen Web 自带工具层在无法解析你的工具名时会输出 `Tool <name> does not exists.`，该文本属于上游噪声，已在返回前剥离。
  - 访客会话有每日用量上限。达到上限时代理返回 HTTP 429 与 `type: "rate_limit_error"`，并附上游原始信息，便于客户端正确退避。

### 限制说明（视频链接 / 大文件）

- 通过视频链接分析、以及上传大文件进行分析：**不支持无服务器函数部署**（例如 Vercel / Netlify Functions / Cloudflare Workers）。
  这类环境通常会受限于运行时长、请求体大小、以及文件系统/子进程能力。
- 视频链接分析还需要宿主机安装 `yt-dlp` 工具。
  如需使用该能力，请选择 Docker / 本地 Express 部署。

### 附件兼容格式（OpenAI 风格）

`messages[].content` 支持以下分段格式：

- `{"type":"text","text":"..."}` / `{"type":"input_text","input_text":"..."}`
- `{"type":"image_url","image_url":{"url":"https://..."}}`
- `{"type":"input_image","image_url":"https://..."}`
- `{"type":"file","file_data":"data:...base64,...","filename":"a.pdf"}`
- `{"type":"input_file","file_data":"<base64>","filename":"a.txt"}`
- `{"type":"audio","file_data":"https://..."}` / `{"type":"input_audio", ...}`

另外也兼容消息级 `files` / `attachments` 传参。

## 环境变量

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `API_TOKENS` | API 密钥，多个用逗号分隔 | 否 |
| `CHAT_DETAIL_LOG` | 是否开启详细对话/上传日志（`true/1/on/yes` 开启，默认关闭） | 否 |
| `JSON_BODY_LIMIT` | Express JSON 请求体大小上限（默认 `20mb`，仅本地/Docker 的 Express 运行时生效） | 否 |
| `CHROME_PATH` | Chromium/Chrome 可执行文件路径。默认自动探测常见位置（Windows/macOS/Linux）或 `PATH`，一般无需设置 | 否 |
| `USE_CHROME_BAXIA` | 设为 `false` 时禁用 Chromium 拿真实 token，回退到简化 token（serverless 或不想依赖浏览器时用） | 否 |

> **注意：** `ENABLE_SEARCH` 已不推荐使用。当前版本仍兼容读取该变量（`true` 时启用 `search`，否则使用 `t2t`），后续版本可能移除，请尽量不要依赖。
>
> **安全提示（API_TOKENS）：** 如果未配置 `API_TOKENS`，服务将允许无鉴权访问所有接口（`/v1/models`、`/v1/chat/completions` 等）。公网部署时强烈建议设置至少一个 token，并通过 `Authorization: Bearer <token>` 访问。

## 使用方法

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 获取模型列表 |
| `/v1/chat/completions` | POST | 聊天完成 |
| `/v1/images/generations` | POST | 图片生成 |
| `/chat` | GET | 内置 Web 聊天页面 |
| `/` | GET | 健康检查 |

### Web 聊天页面

在浏览器打开 `https://your-domain/chat` 即可使用内置聊天 UI。

- 支持流式输出、附件上传、可选视频链接（填写链接后发送会自动进入视频分析；留空为普通对话）
- 可切换日志面板；开启后请求会使用 `/v1/chat/completions/log`
- 顶部栏提供中英文切换

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
    "model": "qwen3.8-max",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# 图片生成（比例字符串格式）
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "一只可爱的小猫在花园里",
    "n": 1,
    "size": "1:1",
    "response_format": "url"
  }'

# 图片生成（OpenAI 尺寸格式）
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "一片壮丽的山水风景",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

### 图片生成参数说明

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 否 | 模型名称，默认为 `qwen3.8-max` |
| `prompt` | string | 是 | 图片描述文本 |
| `n` | number | 否 | 生成图片数量，默认为 1，最大 10 |
| `size` | string | 否 | 图片尺寸/比例，默认为 `1:1` |
| `response_format` | string | 否 | 响应格式：`url`（默认）或 `b64_json` |

#### size 参数支持的格式

**格式 1：比例字符串（推荐）**
- `1:1` - 正方形
- `16:9` - 宽屏（横向）
- `9:16` - 竖屏（纵向）
- `4:3` - 传统比例（横向）
- `3:4` - 传统比例（纵向）

**格式 2：OpenAI 兼容的尺寸格式**
- `1024x1024` - 会自动映射到最接近的比例（1:1）
- `1920x1080` - 会自动映射到最接近的比例（16:9）
- 其他任何宽高组合都会自动映射到支持的比例

#### 响应格式

**url 格式（默认）：**
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://example.com/image.png"
    }
  ]
}
```

**b64_json 格式：**
```json
{
  "created": 1234567890,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ..."
    }
  ]
}
```

### OpenAI SDK 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_token",
    base_url="https://your-domain/v1"
)

response = client.chat.completions.create(
    model="qwen3.8-max",
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
  model: 'qwen3.8-max',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## 支持的模型

- `qwen3.8-max`
- `qwen3.7-plus`
- `qwen3.7-max`
- 以及 Qwen Chat 支持的其他模型

> 模型列表会从上游 `chat.qwen.ai` 动态抓取，`/v1/models` 返回最新可用模型。

## 项目结构

```
qwen2api/
├── chat.html             # Web 聊天页源码（改这个文件）
├── chat-html.js          # chat.html 的内联副本（npm run build:chat-html 生成）
├── core.js               # 核心业务逻辑（所有平台共用）
├── index.js              # Docker / 本地入口
├── api/
│   └── index.js          # Vercel 入口（Node 运行时，复用 core.js）
├── netlify/
│   └── functions/
│       └── api.js        # Netlify Functions（Node）入口
├── scripts/
│   ├── baxia-token.js    # 用 Chromium 运行真实 baxia SDK 获取 token（本地/Docker 用）
│   ├── build-chat-html.js # 从 chat.html 重新生成 chat-html.js
│   └── tampermonkey.js   # 浏览器脚本（可选）
├── worker.js             # Cloudflare Workers 入口（复用 core.js）
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
