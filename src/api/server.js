/**
 * HTTP server for Thinkific-embedded chat (app session JWT).
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAuthBootstrapRouter } from './routes/auth-bootstrap.js';
import { createChatApiRouter } from './routes/api-chat.js';
import { createMemoriesApiRouter } from './routes/api-memories.js';
import { requireSession } from './middleware/require-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = path.join(__dirname, '../../embed/angel-chat-widget.js');

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  if (!raw.trim()) return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/angel-chat-widget.js', (_req, res, next) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(WIDGET_PATH, (err) => {
      if (err) next(err);
    });
  });

  app.use(createAuthBootstrapRouter());

  const api = express.Router();
  api.use(requireSession);
  api.use(createChatApiRouter());
  api.use(createMemoriesApiRouter());
  app.use(api);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error', message: err?.message || String(err) });
  });

  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  app.listen(port, () => {
    console.log(`AngelBot web API listening on :${port}`);
    console.log('Bootstrap token route: POST /auth/bootstrap');
    console.log('Embed widget: GET /angel-chat-widget.js');
  });
}