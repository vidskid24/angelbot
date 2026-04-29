/**
 * HTTP server for WordPress/Thinkific-embedded chat (app session JWT).
 */

import express from 'express';
import cors from 'cors';
import { createAuthBootstrapRouter } from './routes/auth-bootstrap.js';
import { createChatApiRouter } from './routes/api-chat.js';
import { createMemoriesApiRouter } from './routes/api-memories.js';
import { requireSession } from './middleware/require-session.js';

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
  });
}