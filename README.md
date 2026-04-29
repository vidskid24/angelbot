# AngelBot - Web Companion API

AngelBot runs as a web API for an embedded chat experience (WordPress or Thinkific pages). It uses short-lived app bearer tokens from a bootstrap endpoint, preserving per-user memory/history isolation when a stable user ID is supplied.

## Requirements

- Node.js 18+
- Google AI (Gemini) API key
- A page where you can embed `div#angelbot-chat-root`

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
- `WORDPRESS_CHAT_URL` (page URL hosting chat)
- `CORS_ORIGINS` (comma-separated allowed web origins)
- `APP_SESSION_SECRET` (long random string)
- `GEMINI_API_KEY`

Recommended optional:

- `BOOTSTRAP_ALLOWED_ORIGINS` (explicit allowlist for `/auth/bootstrap`)
- `APP_BOOTSTRAP_TOKEN_TTL_SECONDS` (default `900`)

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
- `POST /auth/bootstrap`

Authenticated routes (Bearer app session JWT):

- `POST /api/chat/send`
- `POST /api/memories`
- `GET /api/memories`
- `DELETE /api/memories?name=...`

## Embed Notes

Use `wordpress/angel-chat-widget.js` and set:

- `window.ANGELBOT_API_BASE`
- `window.ANGELBOT_USER` with `external_id` or `email`

The widget requests `/auth/bootstrap`, stores `access_token` in sessionStorage, then calls chat APIs.

## Style Guides (RAG)

```bash
npm run ingest
npm run ingest:new
```

Files are read from `data/style-guides` or Dropbox if configured.