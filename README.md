# Qwen2API

[中文文档](README_ZH.md) | English

A proxy service that converts Qwen Chat to an OpenAI-compatible API.

## Features

- 🔄 OpenAI API compatible format
- 🚀 Streaming response support (SSE)
- 🔐 Optional API Token authentication
- 🌐 Multi-platform deployment support

## Deployment

### Docker

```bash
# Build image
docker build -t qwen2api .

# Run container
docker run -d -p 8765:8765 -e API_TOKENS=your_token qwen2api
```

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Vercel
3. Optional: Set environment variable `API_TOKENS`

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Netlify
3. Optional: Set environment variable `API_TOKENS`

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

## Public Services

Two public services are available for testing:

| Service URL | Platform |
|-------------|----------|
| `https://qwen2api-v.smanx.xx.kg` | Vercel |
| `https://qwen2api-n.smanx.xx.kg` | Netlify |

- No API Token required (leave key empty)
- Self-deployment is recommended for more stable service

## Important Notes

- ✅ The `/v1/chat/completions` endpoint now supports attachments and multimodal message parts, including image/file/audio inputs.
- ⚠️ Attachments are uploaded to Qwen OSS through the same workflow used by Qwen Web, so request latency increases when sending large files.

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

> **Note:** Web search is now enabled by default for all models. The `ENABLE_SEARCH` variable has been deprecated.

## Usage

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | Get model list |
| `/v1/chat/completions` | POST | Chat completion |
| `/` | GET | Health check |

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
    "model": "qwen3.5-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### OpenAI SDK Examples

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

## Supported Models

- `qwen3.5-plus`
- `qwen3.5-flash`
- `qwen3.5-turbo`
- And other models supported by Qwen Chat

## Project Structure

```
qwen2api/
├── core.js              # Core business logic
├── index.js             # Docker / Local entry point
├── api/
│   └── index.js         # Vercel entry point
├── netlify/
│   └── functions/
│       └── api.js       # Netlify entry point
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
