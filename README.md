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
- 🌐 Multi-platform deployment support
- 🖼️ Image generation support
- 🎬📄 Video analysis, image and document parsing support
- 💬 Built-in web chat interface

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

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Netlify
3. Optional: Set environment variable `API_TOKENS`

> Netlify Edge Functions are also serverless and **cannot run Chromium**, so
> behavior is similar to Vercel: simplified token + automatic retry, limited stability.

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

### Platform Comparison

| Aspect                    | Local Node / Docker                          | Vercel / Netlify / CF Workers               |
| ------------------------- | -------------------------------------------- | ------------------------------------------- |
| Chromium (real baxia SDK) | ✅ Yes (stable token)                        | ❌ No                                       |
| Token acquisition         | Real `T2gAv_` token + cookies (25-min cache) | Simplified token (`wu.json`), low stability |
| Upstream risk control     | Rarely blocked                               | Intermittently blocked (mitigated by retry) |
| Video URL / large files   | ✅ Supported (needs yt-dlp)                  | ❌ Not supported (serverless limits)        |
| Use case                  | Self-hosted, daily use                       | Quick deploy, light testing                 |

## Public Services

Two public services are available for testing:

| Service URL                          | Platform                                           |
| ------------------------------------ | -------------------------------------------------- |
| `https://qwen2api-n.smanx.xx.kg`     | Netlify                                            |
| ~~`https://qwen2api-v.smanx.xx.kg`~~ | ~~Vercel~~ (Usage limit exceeded, service stopped) |

- No API Token required (leave key empty)
- Self-deployment is recommended for more stable service

## Important Notes

- ✅ The `/v1/chat/completions` endpoint now supports attachments and multimodal message parts, including image/file/audio inputs.
- ✅ Supports image understanding and document parsing workflows in chat requests.
- ⚠️ Attachments are uploaded to Qwen OSS through the same workflow used by Qwen Web, so request latency increases when sending large files.
- ❌ **Tool calling is not supported** - The project does not implement OpenAI-style tool/function calling capabilities.

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

| Variable           | Description                                                                                                                                                                                             | Required            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `API_TOKENS`       | API keys, multiple keys separated by commas                                                                                                                                                             | No                  |
| `QWEN_COOKIE`      | Logged-in `chat.qwen.ai` session cookie. **Required for `/v1/videos/generations` (t2v)** — the upstream gates text-to-video behind an authenticated account. Sent only to `chat.qwen.ai`, never logged. | No (only for video) |
| `CHAT_DETAIL_LOG`  | Enable detailed chat/upload logs (`true/1/on/yes` to enable, default off)                                                                                                                               | No                  |
| `JSON_BODY_LIMIT`  | Express JSON body size limit (default `20mb`, only for local/Docker Express runtime)                                                                                                                    | No                  |
| `CHROME_PATH`      | Path to the Chromium/Chrome executable. Auto-detected from common locations (Windows/macOS/Linux) or `PATH`; usually not needed                                                                         | No                  |
| `USE_CHROME_BAXIA` | Set to `false` to disable Chromium-based real token acquisition and fall back to the simplified token (for serverless/browser-less environments)                                                        | No                  |

> **Note:** Web search is now enabled by default for all models. The `ENABLE_SEARCH` variable has been deprecated.

## Usage

### API Endpoints

| Endpoint                 | Method | Description                        |
| ------------------------ | ------ | ---------------------------------- |
| `/v1/models`             | GET    | Get model list                     |
| `/v1/chat/completions`   | POST   | Chat completion                    |
| `/v1/images/generations` | POST   | Image generation                   |
| `/v1/videos/generations` | POST   | **Text-to-video (t2v) generation** |
| `/chat`                  | GET    | Built-in web chat UI               |
| `/`                      | GET    | Health check                       |

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
  -H "Authorization: Bearer ***" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "A beautiful landscape",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'

# Text-to-video (t2v) generation
curl https://your-domain/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ***" \
  -d '{
    "model": "qwen3.8-max",
    "prompt": "A cat playing piano in a sunny room",
    "size": "16:9",
    "response_format": "url"
  }'
# -> { "created": 1786310234, "data": [ { "url": "https://cdn.qwenlm.ai/output/.../t2v/...mp4" } ] }
```

> **t2v requires an authenticated Qwen session.** Unlike image generation, the
> upstream gates text-to-video behind a logged-in account. A guest request
> returns an empty answer with no task id. To generate video, forward your
> logged-in Qwen cookie in one of two ways:
>
> - **Request body:** add `"qwen_cookie": "<your qwen.ai session cookie>"` to the JSON.
> - **Environment variable:** set `QWEN_COOKIE` on the deployment (Node/Docker/Worker only).
>
> The cookie is sent only to `chat.qwen.ai` and is never logged. Treat it like a
> password and keep the deployment private.

### Image Generation Parameter Reference

#### Request Parameters

| Parameter         | Type   | Required | Description                                       |
| ----------------- | ------ | -------- | ------------------------------------------------- |
| `model`           | string | No       | Model name, default: `qwen3.8-max`                |
| `prompt`          | string | Yes      | Image description text                            |
| `n`               | number | No       | Number of images to generate, default: 1, max: 10 |
| `size`            | string | No       | Image size/ratio, default: `1:1`                  |
| `response_format` | string | No       | Response format: `url` (default) or `b64_json`    |

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
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your_token",
  baseURL: "https://your-domain/v1",
});

const stream = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
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
├── core.js              # Core business logic
├── index.js             # Docker / Local entry point
├── api/
│   └── index.js         # Vercel entry point
├── netlify/
│   └── edge-functions/
│       └── api.js       # Netlify entry point
├── scripts/
│   ├── baxia-token.js   # Get token via real baxia SDK using Chromium (local/Docker)
│   └── tampermonkey.js  # Optional browser script
├── worker.js            # Cloudflare Workers entry point
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
