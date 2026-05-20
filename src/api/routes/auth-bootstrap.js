import { Router } from 'express';
import { createAppSessionJwt } from '../../lib/app-session.js';
import { ensureUserTier } from '../../lib/tier.js';

function parseAllowedOrigins() {
  const raw = process.env.BOOTSTRAP_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(req, allowed) {
  if (!allowed.length) return true;
  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (origin && allowed.includes(origin)) return true;
  if (referer) {
    try {
      const u = new URL(referer);
      const refOrigin = `${u.protocol}//${u.host}`;
      if (allowed.includes(refOrigin)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeSub({ external_id, email }) {
  const fromExternal = String(external_id || '').trim();
  if (fromExternal) return fromExternal;
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  return `email:${e}`;
}

export function createAuthBootstrapRouter() {
  const r = Router();

  /**
   * Issues a short-lived app bearer token for web widgets.
   * Intended for authenticated page contexts (e.g. Thinkific page with user variables).
   * Body: { external_id?, email?, first_name?, last_name? }
   */
  r.post('/auth/bootstrap', async (req, res, next) => {
    try {
      const allowedOrigins = parseAllowedOrigins();
      if (!originAllowed(req, allowedOrigins)) {
        res.status(403).json({ error: 'origin_not_allowed' });
        return;
      }

      const body = req.body || {};
      const sub = normalizeSub(body);
      if (!sub) {
        res.status(400).json({ error: 'external_id_or_email_required' });
        return;
      }

      const email = body.email ? String(body.email).trim().toLowerCase() : undefined;
      const tier = await ensureUserTier(sub, email, { force: true });
      const ttl = Math.max(60, Math.min(86400, Number(process.env.APP_BOOTSTRAP_TOKEN_TTL_SECONDS) || 3600));
      const token = await createAppSessionJwt({ sub, email, tier }, ttl);

      res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: ttl,
        sub,
        tier,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}