# AngelBot - Web Companion API

AngelBot now runs as a web API for a WordPress-embedded chat experience gated through Thinkific SSO. It keeps the same wisdom companion, memory, and RAG behavior, but no longer includes Discord runtime paths.

## Requirements

- Node.js 18+
- A Google AI (Gemini) API key
- Thinkific school with Custom SSO (JWT) enabled
- A WordPress page where you embed the chat widget

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Required `.env` values:

- `PORT` (default `3000`)
- `PUBLIC_API_BASE_URL` (public API base URL)
- `WORDPRESS_CHAT_URL` (WordPress page URL hosting chat)
- `CORS_ORIGINS` (comma-separated allowed web origins)
- `APP_SESSION_SECRET` (long random string)
- `THINKIFIC_SUBDOMAIN` (without `.thinkific.com`)
- `THINKIFIC_SSO_SIGNING_SECRET`
- `THINKIFIC_HANDOFF_SECRET`
- `GEMINI_API_KEY`

3. Start the API:

```bash
npm start
```

4. Health check:

```bash
curl http://localhost:3000/healthz
```

## API Routes

Public/auth routes:

- `GET /healthz`
- `GET /auth/thinkific/start?handoff=...`
- `GET /auth/thinkific/done?state=...`
- `POST /auth/thinkific/handoff-url`

Authenticated routes (Bearer app session JWT):

- `POST /api/chat/send`
- `POST /api/memories`
- `GET /api/memories`
- `DELETE /api/memories?name=...`

## WordPress Embed

Use `wordpress/angel-chat-widget.js` on your WordPress chat page. After successful Thinkific SSO flow, users are redirected back with a hash token:

- `#angelbot_access_token=<jwt>`

The widget reads/stores that token and calls `/api/chat/send`.

## Style Guides (RAG)

Style guide ingestion still works the same:

```bash
npm run ingest
npm run ingest:new
```

Files are read from `data/style-guides` or Dropbox if configured.