# Omi Bot - Web Companion API

Omi Bot runs as a web API for an embedded chat experience on Thinkific site pages. It uses short-lived app bearer tokens from a bootstrap endpoint, preserving per-user conversation history when a stable user ID is supplied.

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
- `OMIBOT_FREE_THREAD_LIMIT` (default `3`)
- `OMIBOT_PAID_THREAD_LIMIT` (default `15`)
- `OMIBOT_FREE_DAILY_MESSAGE_LIMIT` (default `15`)
- `OMIBOT_PAID_DAILY_MESSAGE_LIMIT` (default `110`)
- `OMIBOT_DAILY_LIMIT_TIMEZONE` (default `America/Los_Angeles`; calendar day boundary for daily counts)
- `OMIBOT_TIER_CACHE_MINUTES` (default `60`)
- `THINKIFIC_API_KEY` — Thinkific **API Access Token** (Bearer auth; from Settings → Code & analytics; not SSO Signing Secret)
- `THINKIFIC_PAID_PRODUCT_IDS` — comma-separated course/product ids and/or exact names — paid tier if user has an active enrollment in any listed product
- `OMIBOT_PAID_USER_IDS` — comma-separated Thinkific user ids and/or emails treated as paid (testing; bypasses tier cache)
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
- `GET /api/user/preferences` — tone, MA experience, and (paid) memory fields
- `PATCH /api/user/preferences` — save settings (`{ tone?, maExperience?, memoryInstructions?, memorySummary? }`)
- `DELETE /api/user/data` — delete all saved conversations, memory, and preferences for the signed-in user
- `POST /internal/jobs/regenerate-memory` — nightly memory synthesis (header `x-cron-secret`; defaults to the previous calendar day in `OMIBOT_MEMORY_TIMEZONE`, or pass `?date=YYYY-MM-DD`; selects paid users with messages on that day; retries Gemini on failure and preserves prior summary if all attempts fail)
- `GET /internal/tier-debug?user_id=...&email=...` — tier troubleshooting (header `x-cron-secret`; same secret as cron)
- `GET /api/threads` — list conversations (limit by tier)
- `POST /api/threads` — create conversation (`{ title? }`)
- `PATCH /api/threads/:threadId` — rename (`{ title }`)
- `DELETE /api/threads/:threadId` — delete conversation
- `GET /api/threads/:threadId` — thread + messages

## Render PostgreSQL

1. In Render: **New → PostgreSQL**, then link the database to your Omi Bot web service.
2. Render sets `DATABASE_URL` on the web service automatically.
3. Deploy — migrations run on startup (`src/db/migrations/`).
4. Health check: `GET /healthz` returns `database: "configured"` and `databaseOk: true` when connected.

Paid vs free thread and daily message limits are enforced on the server. **Paid memory** (user instructions + auto-generated summary across conversations) is injected into the system prompt for paid users. Configure Thinkific enrollment vars or `OMIBOT_PAID_USER_IDS` for testing.

Set `OMIBOT_CRON_SECRET` and schedule a daily cron (e.g. Render Cron Job) to `POST /internal/jobs/regenerate-memory` with header `x-cron-secret`. Default timezone is `America/Los_Angeles`. Optional `OMIBOT_MEMORY_USER_DELAY_MS` (default `3000`) pauses between users during the job to reduce Gemini burst 503s.

### Paid tier troubleshooting

If a paying Thinkific user still shows **FREE**:

1. **Redeploy** the API after env changes.
2. **Hard-refresh** the chat page (or close the tab) so bootstrap runs again — the session token stores tier from login.
3. Confirm Thinkific footer sets `external_id: String(Thinkific.current_user.id)` (numeric id), not email-only.
4. Set `THINKIFIC_PAID_PRODUCT_IDS` to comma-separated **numeric ids** and/or **exact** product/course names as shown in Thinkific admin/API.
5. Run tier debug (replace values):

```bash
curl -s "https://your-app.onrender.com/internal/tier-debug?user_id=THINKIFIC_USER_ID&email=user@example.com" \
  -H "x-cron-secret: YOUR_OMIBOT_CRON_SECRET"
```

Check `thinkificApiProbeOk`, `thinkific.enrollments`, `matchedPaidEnrollment`, and `nextSteps`.

6. Quick isolation: set `OMIBOT_PAID_USER_IDS` to that user id — if they become PAID, the widget path works and Thinkific matching/env is the issue.
7. Ensure `OMIBOT_FORCE_TIER` is not set to `free`.

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
    s.src = api + '/omi-chat-widget.js?v=72';
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

### Course media filenames (Phase 1 source labels)

Dropbox transcripts and guides can use any of these patterns (`.txt`, `.md`, or `.pdf`):

| Pattern | Example | Omi label |
|---------|---------|-----------|
| Level + Chapter + **Track #** + name | `L1-C1-T2-Clear Your Energy.txt` | Level 1, Chapter 1, Track 2 — "Clear Your Energy" |
| Level + Chapter + **Video** + name | `L1-C1-V-GroundingCord.txt` | Level 1, Chapter 1, Video — "GroundingCord" |
| Level + Chapter + **Session #** + title | `L1-C1-S4-Living Light Meditation.txt` | Level 1, Chapter 1, Session 4 — "…" |
| Level + **Session #** + name (no class) | `L2-S2-TFull.txt` | Level 2, Session 2 — "TFull" |
| **Book** (PDF, no `L#-` prefix) | `ACIMA-final.pdf` | Book — "ACIMA-final" |

- **L#** — Level  
- **C#** — Chapter within that level  
- **S#** — Session or chapter  
- **T#** — Audio track number within a class  
- **V** — Video track within a class  

On ingest, each chunk stores this metadata. Retrieved excerpts include a **Source:** line so Omi can point users to the right level, class, session, track, or video.

After changing ingest logic or filenames, run **`npm run ingest`** (full re-index). `ingest:new` only adds files not already in the manifest.
