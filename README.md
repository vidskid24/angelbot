# Omi Bot - Web Companion API

Omi Bot runs as a web API for an embedded chat experience on Thinkific site pages. It uses short-lived app bearer tokens from a bootstrap endpoint, preserving per-user memory/history isolation when a stable user ID is supplied.

## Requirements

- Node.js 18+
- Google AI (Gemini) API key
- Render PostgreSQL (`DATABASE_URL`) for saved threads and durable chat history
- A Thinkific page with `<div id="omibot-chat-root"></div>` (legacy id `angelbot-chat-root` still works)

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

- `APP_SESSION_SECRET` (long random string)
- `GEMINI_API_KEY`
- `CORS_ORIGINS` (comma-separated allowed web origins, e.g. `https://courses.masteringalchemy.com`)
- `DATABASE_URL` (Render PostgreSQL connection string)

Optional:

- `PORT` (default `3000`; often set by the host)
- `DATABASE_SSL` — set to `false` only for local Postgres without SSL
- `BOOTSTRAP_ALLOWED_ORIGINS` (explicit allowlist for `/auth/bootstrap`; defaults to `CORS_ORIGINS`)
- `APP_BOOTSTRAP_TOKEN_TTL_SECONDS` (default `3600`)
- `OMIBOT_FREE_THREAD_LIMIT` (default `2`)
- `OMIBOT_PAID_THREAD_LIMIT` (default `10`)
- `OMIBOT_TIER_CACHE_MINUTES` (default `60`)
- `THINKIFIC_API_KEY`, `THINKIFIC_SUBDOMAIN`, `THINKIFIC_PAID_PRODUCT_IDS` (comma-separated) and/or `THINKIFIC_PAID_PRODUCT_ID` — paid tier if enrolled in any listed product
- `OMIBOT_PAID_USER_IDS` — comma-separated Thinkific user ids treated as paid (testing)
- `OMIBOT_FORCE_TIER` — `free` or `paid` (dev override)

Legacy env names `ANGELBOT_*` are still read as fallbacks.

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

- `POST /api/chat/send` — body: `{ message, threadId? }`; returns `threadId`
- `GET /api/threads` — list conversations (limit by tier)
- `POST /api/threads` — create conversation (`{ title? }`)
- `GET /api/threads/:threadId` — thread + messages
- `POST /api/memories`
- `GET /api/memories`
- `DELETE /api/memories?name=...`

## Render PostgreSQL

1. In Render: **New → PostgreSQL**, then link the database to your Omi Bot web service.
2. Render sets `DATABASE_URL` on the web service automatically.
3. Deploy — migrations run on startup (`src/db/migrations/`).
4. Health check: `GET /healthz` returns `database: "configured"` and `databaseOk: true` when connected.

Paid vs free thread limits are enforced on the server. Configure Thinkific enrollment vars or `OMIBOT_PAID_USER_IDS` for testing.

## Thinkific embed

**Page body** (on the chat page only):

```html
<div id="omibot-chat-root"></div>
```

**Site footer** (runs on all pages; loads the widget only when the mount div exists):

```html
<script>
(function () {
  function initOmiBot() {
    if (!document.getElementById('omibot-chat-root') && !document.getElementById('angelbot-chat-root')) return;

    var api = 'https://your-app.onrender.com';
    window.OMIBOT_API_BASE = api;

    var u = window.Thinkific && Thinkific.current_user;
    if (u && u.id) {
      window.OMIBOT_USER = {
        external_id: String(u.id),
        email: u.email || '',
        first_name: u.first_name || ''
      };
    }

    var s = document.createElement('script');
    s.src = api + '/omi-chat-widget.js?v=22';
    s.defer = true;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOmiBot);
  } else {
    initOmiBot();
  }
})();
</script>
```

Replace `https://your-app.onrender.com` with your deployed API origin (no trailing slash). The API serves the widget at `GET /omi-chat-widget.js`. The legacy URL `/angel-chat-widget.js` serves the same file.

Widget globals:

- `window.OMIBOT_API_BASE` — API origin
- `window.OMIBOT_USER` — `{ external_id, email, first_name, last_name }`; `external_id` or `email` required
- `window.OMIBOT_SESSION_ID` — optional initial thread id (widget also stores `threadId` in `sessionStorage` after first reply)

Legacy `ANGELBOT_*` globals are still supported by the widget.

## Style Guides (RAG)

```bash
npm run ingest
npm run ingest:new
```

Files are read from `data/style-guides` or Dropbox if configured.
