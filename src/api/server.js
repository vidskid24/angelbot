/**
 * HTTP server for Thinkific-embedded chat (app session JWT).
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAuthBootstrapRouter } from './routes/auth-bootstrap.js';
import { createChatApiRouter } from './routes/api-chat.js';
import { createThreadsApiRouter } from './routes/api-threads.js';
import { requireSession } from './middleware/require-session.js';
import { isDbEnabled, pingDb } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = path.join(__dirname, '../../embed/omi-chat-widget.js');

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  if (!raw.trim()) return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function serveWidget(_req, res, next) {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(WIDGET_PATH, (err) => {
    if (err) next(err);
  });
}

export function startWebServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(
    cors({
      origin: parseCorsOrigins(),
      maxAge: 86400,
    })
  );

  app.get('/healthz', async (_req, res) => {
    const payload = { ok: true, database: isDbEnabled() ? 'configured' : 'disabled' };
    if (isDbEnabled()) {
      try {
        payload.databaseOk = await pingDb();
        if (!payload.databaseOk) payload.ok = false;
      } catch {
        payload.databaseOk = false;
        payload.ok = false;
      }
    }
    res.status(payload.ok ? 200 : 503).json(payload);
  });

  app.get('/omi-chat-widget.js', serveWidget);
  app.get('/angel-chat-widget.js', serveWidget);

  app.use(createAuthBootstrapRouter());

  const api = express.Router();
  api.use(requireSession);
  api.use(createChatApiRouter());
  api.use(createThreadsApiRouter());
  app.use(api);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error', message: err?.message || String(err) });
  });

  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  app.listen(port, () => {
    console.log(`Omi Bot web API listening on :${port}`);
    console.log('Bootstrap token route: POST /auth/bootstrap');
    console.log('Embed widget: GET /omi-chat-widget.js (legacy: /angel-chat-widget.js)');
  });
}
