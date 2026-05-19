# AngelBot - Web Companion API

AngelBot runs as a web API for an embedded chat experience on Thinkific site pages. It uses short-lived app bearer tokens from a bootstrap endpoint, preserving per-user memory/history isolation when a stable user ID is supplied.

## Requirements

- Node.js 18+
- Google AI (Gemini) API key
- A Thinkific page with `<div id="angelbot-chat-root">` and a hosted copy of `embed/angel-chat-widget.js`

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

Optional:

- `PORT` (default `3000`; often set by the host)
- `BOOTSTRAP_ALLOWED_ORIGINS` (explicit allowlist for `/auth/bootstrap`; defaults to `CORS_ORIGINS`)
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

## Thinkific embed

**Page body** (on the chat page only):

```html
<div id="angelbot-chat-root"></div>
```

**Site footer** (runs on all pages; loads the widget only when the mount div exists):

```html
<script>
(function () {
  function initAngelBot() {
    if (!document.getElementById('angelbot-chat-root')) return;

    var api = 'https://your-app.onrender.com';
    window.ANGELBOT_API_BASE = api;
    window.ANGELBOT_USER = {
      external_id: 'test-user-123',
      email: 'test@example.com'
    };

    var s = document.createElement('script');
    s.src = api + '/angel-chat-widget.js?v=19';
    s.defer = true;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAngelBot);
  } else {
    initAngelBot();
  }
})();
</script>
```

Replace `https://your-app.onrender.com` with your deployed API origin (no trailing slash). The API serves the widget at `GET /angel-chat-widget.js`. You can still host `embed/angel-chat-widget.js` elsewhere if you prefer.

Widget globals:

- `window.ANGELBOT_API_BASE` — API origin, e.g. `https://your-app.onrender.com`
- `window.ANGELBOT_USER` — `{ external_id, email, first_name, last_name }`; `external_id` or `email` required
- `window.ANGELBOT_SESSION_ID` — optional stable thread id

The widget calls `POST /auth/bootstrap`, stores `access_token` in `sessionStorage`, then calls chat APIs.

## Style Guides (RAG)

```bash
npm run ingest
npm run ingest:new
```

Files are read from `data/style-guides` or Dropbox if configured.
