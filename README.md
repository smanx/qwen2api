---
title: Qwen2API
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# Qwen2API

[中文文档](README_ZH.md) | English

A proxy service that converts Qwen Chat to an OpenAI-compatible API.

## Features

- 🔄 OpenAI API compatible format
- 🚀 Streaming response support (SSE)
- 🔐 Optional API Token authentication
- 🌐 Multi-platform deployment: Local NodeJS / Docker, Vercel, Netlify, Cloudflare Workers
- 🖼️ Image generation support
- 🎬📄 Video analysis, image and document parsing support
- 💬 Built-in web chat interface

## Architecture Overview

All deployment targets share one codebase: every platform entry (`index.js`,
`api/index.js`, `netlify/functions/api.js`, `worker.js`) is a thin protocol
adapter that calls the same `core.js` business logic. Routes, attachment
uploads, streaming and error handling therefore behave identically everywhere.

```
                     ┌──────────────────────────────────────┐
                     │  Clients: OpenAI SDK / curl / the    │
                     │  built-in /chat web page             │
                     └──────────────────┬───────────────────┘
                                        │  OpenAI-compatible HTTP
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Entry adapters (thin wrappers: routing + platform protocol only)        │
│                                                                          │
│   index.js              api/index.js       netlify/functions/api.js      │
│   (Express,             (Vercel Node fn,   (Netlify Node fn,             │
│    local / Docker)       maxDuration)         timeout)                   │
│   worker.js                                                              │
│   (CF Worker, nodejs_compat)                                             │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  core.js — the single business-logic module (bundled into every entry)  │
│                                                                          │
│   Routes:  GET  /v1/models                 (model list from upstream)    │
│            POST /v1/chat/completions       (chat, OpenAI compatible)     │
│            POST /v1/chat/completions/log   (chat + progress logs;        │
│                                              video-analysis endpoint)    │
│            POST /v1/images/generations     (image generation)            │
│            GET  /chat                      (built-in chat UI)            │
│            GET  /                          (health check)                │
│                                                                          │
│   /chat page:  read chat.html from disk (local dev, always fresh)        │
│                → fallback to bundled chat-html.js when unreadable        │
│                  (serverless function environments); regenerate with:    │
│                  npm run build:chat-html                                 │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  per-request pipeline
                                    ▼
   ①  Auth      validateToken — env API_TOKENS (empty ⇒ open access)
   ②  Tokens    getBaxiaTokens
                  ├─ Node + Chromium → real baxia SDK (T2gAv_ + cookies, 25-min cache)
                  └─ serverless / CF → simplified token (wu.json), auto fallback
   ③  Session   createChatSession — /api/v2/chats/new, retry with fresh token ×3
   ④  Parse     messages → text + attachments (image / audio / video / document)
   ⑤  Video     [only /log endpoint] body.video_url → yt-dlp download
                  → wrapped as a video attachment
                  (local/Docker only; serverless returns a clear error)
   ⑥  Upload    per attachment: bytes → getstsToken → PUT Qwen OSS (V4 signed)
                  → status poll (skipped for video) → document parse (documents)
   ⑦  Chat      POST /api/v2/chat/completions (upstream SSE, files=uploaded)
   ⑧  Respond   stream=true  → live SSE mapping (Express / Vercel / CF)
                               or buffered SSE, returned whole (Netlify)
                stream=false → collected JSON chat.completion
```

### Video analysis flow

Video analysis reuses the **general chat endpoint** (`/v1/chat/completions/log`)
plus one optional field — no dedicated endpoint is needed. The web chat UI
auto-switches to this endpoint when a video URL is filled in.

```
POST /v1/chat/completions/log
body: {
  "messages": [...],
  "stream": true,
  "video_url": "https://...",      // triggers video analysis
  "min_video_resolution": 480      // optional, default 480
}

  ①  yt-dlp downloads the video (resolution: body → env MIN_VIDEO_RESOLUTION → 480)
  ②  the video becomes a normal 'video' attachment
  ③  same OSS upload chain as images/files (status polling skipped for video)
  ④  regular chat completion against the uploaded file
```

### Platform capabilities

| Capability | Local / Docker | Vercel | Netlify | CF Worker |
|------------|----------------|--------|---------|-----------|
| Real baxia token (Chromium) | ✅ | ❌ simplified | ❌ simplified | ❌ simplified |
| Live SSE streaming | ✅ | ✅ | ⚠️ buffered | ✅ |
| Video analysis (yt-dlp) | ✅ | ❌ | ❌ | ❌ |
| Attachment upload (OSS) | ✅ | ✅  | ✅  | ✅  |
| Chat page `/chat` | ✅ file | ✅ inline | ✅ inline | ✅ inline |

### Design notes

- **`nodeRequire(name)`** loads Node built-ins dynamically. Bundlers never
  inline them, so the same `core.js` also builds on CF Workers; at runtime a
  missing module resolves to `null` and callers degrade gracefully (WebCrypto
  instead of `crypto`, `wu.json` instead of the baxia SDK).
- **`process` guards** — serverless runtimes may not define `process` at all;
  every access goes through `typeof process !== 'undefined'` checks.
- **`chat-html.js`** is generated from `chat.html` by
  `scripts/build-chat-html.js` (`npm run build:chat-html`) — re-run it after
  editing `chat.html`.

## Deployment

> Platform differences in **authentication token acquisition** directly affect
> chat stability. Read the [Platform Comparison](#platform-comparison) first.

### Local NodeJS / Docker (Recommended)

These run a full Node runtime and can launch headless **Chromium to run the real
baxia SDK**, producing stable auth tokens that are rarely blocked by upstream.

```bash
# Local
npm install
node index.js            # default port 8765 (override with PORT)

# Docker build + run
docker build -t qwen2api .
# NOTE: Chromium inside the container needs enough shared memory -- always add --shm-size
docker run -d -p 8765:8765 --shm-size=2g -e API_TOKENS=your_token qwen2api
```

- The image is Debian-based and bundles `chromium`, `ffmpeg`, and `yt-dlp`.
- `CHROME_PATH=/usr/bin/chromium` locates the browser automatically (see env table).
- If Chromium cannot run in your environment, set `USE_CHROME_BAXIA=false` to fall
  back to the simplified token (less stable).

#### Using the pre-built GHCR image (no local build)

Every push or manual trigger runs a GitHub Actions workflow that builds the image
and pushes it to **GitHub Container Registry** (see `.github/workflows/docker-build.yml`).
Pull and run it directly:

```bash
# Pull the latest image
docker pull ghcr.io/smanx/qwen2api:latest

# Run (container listens on 7860, mapped to host 8765; Chromium needs shared memory -- always add --shm-size)
docker run -d -p 8765:7860 --shm-size=2g -e API_TOKENS=your_token ghcr.io/smanx/qwen2api:latest
```

- Common tags: `latest` (newest build), `master` (branch), `sha-<7-char sha>` (per commit), `vX.Y.Z` (release tags).
- Pin a specific commit: `docker pull ghcr.io/smanx/qwen2api:sha-<7-char sha>`.
- The container listens on port `7860`; change the left side of `-p` to remap the host port (e.g. `-p 9000:7860`).

### Hugging Face Spaces (Docker)

1. Create a new **Docker** Space on Hugging Face.
2. Push this repository to the Space.
3. Optional: set `API_TOKENS` in Space Variables/Secrets.
4. The app listens on port `7860` in container mode (already configured in `Dockerfile`).

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Vercel
3. Optional: Set environment variable `API_TOKENS`

> Vercel is a serverless platform and **cannot run Chromium**, so it only uses
> the simplified token path. It may be intermittently blocked by upstream risk
> control; stability is lower than local/Docker.
> The Vercel entry (`api/index.js`) uses the **Node.js runtime** and shares the
> same `core.js` logic as local/Docker and Netlify. Function timeout is set via
> `module.exports.config.maxDuration` (capped by your Vercel plan); SSE streaming
> is forwarded in real time (Vercel Node functions support streaming).

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Netlify
3. Optional: Set environment variable `API_TOKENS`

> Netlify Functions (Node runtime) are also serverless and **cannot run Chromium**,
> so behavior is similar to Vercel: simplified token + automatic retry, limited stability.
> The function timeout is configured in `netlify.toml` (capped by your Netlify plan); streaming responses are buffered and returned whole.

### Cloudflare Workers

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Deploy
wrangler deploy
```

Set the environment variable `API_TOKENS` in the Cloudflare Dashboard.

> Cloudflare Workers are also serverless and cannot run Chromium; only the
> simplified token is available.
> The Worker entry (`worker.js`) is a thin wrapper that reuses the same `core.js`
> logic as local/Docker, Vercel and Netlify (requires the `nodejs_compat`
> compatibility flag, already set in `wrangler.toml`). SSE streaming is forwarded
> in real time. Video URL analysis / yt-dlp are not supported on Workers.

### Platform Comparison

| Aspect | Local Node / Docker | Vercel / Netlify / CF Workers |
|--------|---------------------|-------------------------------|
| Chromium (real baxia SDK) | ✅ Yes (stable token) | ❌ No |
| Token acquisition | Real `T2gAv_` token + cookies (25-min cache) | Simplified token (`wu.json`), low stability |
| Upstream risk control | Rarely blocked | Intermittently blocked (mitigated by retry) |
| Video URL / large files | ✅ Supported (needs yt-dlp) | ❌ Not supported (serverless limits) |
| Use case | Self-hosted, daily use | Quick deploy, light testing |

## Public Services

Three public services are available for testing:

| Service URL | Platform |
|-------------|----------|
| `https://qwen2api-n.smanx.xx.kg` | Netlify |
| ~~`https://qwen2api-v.smanx.xx.kg`~~ | ~~Vercel~~ (Usage limit exceeded, service stopped) |
| `https://qwen2api.smanx.xx.kg` | Cloudflare Workers |

- No API Token required (leave key empty)
- Self-deployment is recommended for more stable service

## Important Notes

- ✅ The `/v1/chat/completions` endpoint now supports attachments and multimodal message parts, including image/file/audio inputs.
- ✅ Supports image understanding and document parsing workflows in chat requests.
- ⚠️ Attachments are uploaded to Qwen OSS through the same workflow used by Qwen Web, so request latency increases when sending large files.
- ✅ **Tool calling is supported** - `tools` and `tool_choice` on `/v1/chat/completions` return OpenAI-shaped `tool_calls` with `finish_reason: "tool_calls"`, in both streaming and non-streaming mode. Multi-turn loops work: send `assistant.tool_calls` and `role: "tool"` results back in `messages` and they are replayed to the model.
  - Qwen Web has no native function-calling API, so calls are elicited by injecting Qwen's own `<tool_call>` prompt format and parsing them back out. Accuracy therefore depends on the model, unlike a native API.
  - Markers inside ``` code fences or `inline code` are never executed, so the model can document the format without triggering a call.
  - `tool_choice` accepts `auto` / `none` / `required` / a named function. `required` and named functions are prompt-level instructions: the model is told it must call, but a refusal is not rejected with an error.
  - Tool names and arguments are not validated against your schemas - validate them in your own executor.
  - Qwen Web runs its own tool layer that emits `Tool <name> does not exists.` when it cannot resolve your tool names. That prose is upstream noise and is stripped before it reaches you.
  - Guest sessions have a daily usage limit. When it is reached the proxy returns HTTP 429 with `type: "rate_limit_error"` and the upstream message, so clients back off correctly.

### Limitations (Video URL / Large Files)

- Video URL analysis and large-file analysis are **not supported on serverless function deployments** (e.g. Vercel / Netlify Functions / Cloudflare Workers).
  These environments typically have strict limits on runtime, request body size, and filesystem/process access.
- Video URL analysis requires `yt-dlp` to be installed on the host machine.
  Use the Docker/local Express deployment if you need this feature.

### Attachment Compatibility (OpenAI-style)

You can use these message content part formats in `messages[].content` arrays:

- `{"type":"text","text":"..."}` / `{"type":"input_text","input_text":"..."}`
- `{"type":"image_url","image_url":{"url":"https://..."}}`
- `{"type":"input_image","image_url":"https://..."}`
- `{"type":"file","file_data":"data:...base64,...","filename":"a.pdf"}`
- `{"type":"input_file","file_data":"<base64>","filename":"a.txt"}`
- `{"type":"audio","file_data":"https://..."}` / `{"type":"input_audio", ...}`

The proxy also accepts legacy message-level `files` / `attachments` arrays for compatibility.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `API_TOKENS` | API keys, multiple keys separated by commas | No |
| `CHAT_DETAIL_LOG` | Enable detailed chat/upload logs (`true/1/on/yes` to enable, default off) | No |
| `JSON_BODY_LIMIT` | Express JSON body size limit (default `20mb`, only for local/Docker Express runtime) | No |
| `CHROME_PATH` | Path to the Chromium/Chrome executable. Auto-detected from common locations (Windows/macOS/Linux) or `PATH`; usually not needed | No |
| `USE_CHROME_BAXIA` | Set to `false` to disable Chromium-based real token acquisition and fall back to the simplified token (for serverless or browser-less environments) | No |

> **Note:** Web search is now enabled by default for all models. The `ENABLE_SEARCH` variable has been deprecated.

## Usage

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | Get model list |
| `/v1/chat/completions` | POST | Chat completion |
| `/v1/images/generations` | POST | Image generation |
| `/chat` | GET | Built-in web chat UI |
| `/` | GET | Health check |

### Web Chat UI

Open `https://your-domain/chat` in a browser to use the built-in chat page.

- Supports streaming output, attachments, and an optional video URL (auto switches to video analysis when a URL is provided)
- Logs panel can be toggled on/off; when enabled the request uses `/v1/chat/completions/log`
- Language toggle (ZH/EN) is available in the top bar

### Request Examples

```bash
# Get model list
curl https://your-domain/v1/models \
  -H "Authorization: Bearer your_token"

# Chat completion
curl https://your-domain/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.8-max",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Image generation (ratio string format)
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "A cute kitten in a garden",
    "n": 1,
    "size": "1:1",
    "response_format": "url"
  }'

# Image generation (OpenAI size format)
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "A beautiful landscape",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

### Image Generation Parameter Reference

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | No | Model name, default: `qwen3.8-max` |
| `prompt` | string | Yes | Image description text |
| `n` | number | No | Number of images to generate, default: 1, max: 10 |
| `size` | string | No | Image size/ratio, default: `1:1` |
| `response_format` | string | No | Response format: `url` (default) or `b64_json` |

#### Supported size parameter formats

**Format 1: Ratio string (recommended)**
- `1:1` - Square
- `16:9` - Widescreen (landscape)
- `9:16` - Portrait (vertical)
- `4:3` - Traditional ratio (landscape)
- `3:4` - Traditional ratio (portrait)

**Format 2: OpenAI compatible size format**
- `1024x1024` - Automatically maps to closest ratio (1:1)
- `1920x1080` - Automatically maps to closest ratio (16:9)
- Any other width/height combination will automatically map to a supported ratio

#### Response Formats

**url format (default):**
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

**b64_json format:**
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

### OpenAI SDK Examples

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

## Supported Models

- `qwen3.8-max`
- `qwen3.7-plus`
- `qwen3.7-max`
- And other models supported by Qwen Chat

> The model list is scraped dynamically from `chat.qwen.ai`; `/v1/models` returns
> the latest available models.

## Project Structure

```
qwen2api/
├── chat.html             # Web chat UI source (edit this file)
├── chat-html.js          # Generated inline copy of chat.html (npm run build:chat-html)
├── core.js               # Core business logic (shared by all platforms)
├── index.js              # Docker / Local entry point
├── api/
│   └── index.js          # Vercel entry point (Node runtime, reuses core.js)
├── netlify/
│   └── functions/
│       └── api.js        # Netlify Functions (Node) entry point
├── scripts/
│   ├── baxia-token.js    # Get token via real baxia SDK using Chromium (local/Docker)
│   ├── build-chat-html.js # Regenerate chat-html.js from chat.html
│   └── tampermonkey.js   # Optional browser script
├── worker.js             # Cloudflare Workers entry point (reuses core.js)
├── Dockerfile
├── vercel.json
├── netlify.toml
└── wrangler.toml
```

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Server runs at http://localhost:8765
```

## Disclaimer

This project is for learning and testing purposes only. Do not use it in production or commercial environments. Users are solely responsible for any consequences arising from the use of this project, and the project author assumes no liability.

## License

MIT
