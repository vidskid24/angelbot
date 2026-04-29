/**
 * Thinkific JWT SSO start + callback (Leg A), then redirect to WordPress with app token in hash (Leg B).
 */

import { Router } from 'express';
import { signHandoffPayload, verifyHandoffToken, newStateId } from '../../lib/handoff-token.js';
import { signThinkificLearnerJwt, buildThinkificSsoRedirectUrl } from '../../lib/thinkific-sso.js';
import { createAppSessionJwt } from '../../lib/app-session.js';

const STATE_TTL_SECONDS = 15 * 60;

function publicBase() {
  const u = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!u) throw new Error('Set PUBLIC_API_BASE_URL (e.g. https://api.yoursite.com)');
  return u;
}

function wpChatUrl() {
  const u = process.env.WORDPRESS_CHAT_URL?.trim();
  if (!u) throw new Error('Set WORDPRESS_CHAT_URL (page where the chat widget is embedded)');
  return u;
}

export function createAuthThinkificRouter() {
  const r = Router();

  /**
   * WordPress / IdP server redirects the browser here with a signed handoff token.
   * Query: handoff=<signHandoffPayload(...)>
   */
  r.get('/auth/thinkific/start', async (req, res, next) => {
    try {
      const handoff = String(req.query.handoff || '');
      const payload = verifyHandoffToken(handoff);
      if (!payload || !payload.email || !payload.first_name || !payload.last_name) {
        res.status(400).send('Invalid or expired handoff token.');
        return;
      }
      const externalId = String(payload.external_id || payload.sub || '').trim() || String(payload.email);
      const stateId = newStateId();
      const stateExp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
      const state = signHandoffPayload({
        sid: stateId,
        sub: externalId,
        email: String(payload.email),
        exp: stateExp,
      });

      const returnTo = `${publicBase()}/auth/thinkific/done?state=${encodeURIComponent(state)}`;
      const thinkificJwt = await signThinkificLearnerJwt({
        email: String(payload.email),
        first_name: String(payload.first_name),
        last_name: String(payload.last_name),
        external_id: externalId,
      });
      const url = buildThinkificSsoRedirectUrl(thinkificJwt, returnTo);
      res.redirect(302, url);
    } catch (e) {
      next(e);
    }
  });

  /**
   * Thinkific redirects here after successful SSO.
   */
  r.get('/auth/thinkific/done', async (req, res, next) => {
    try {
      const state = String(req.query.state || '');
      const row = verifyHandoffToken(state);
      if (!row?.sub || !row?.email) {
        res.status(400).send('Invalid or expired session. Please start again from your course.');
        return;
      }
      const appJwt = await createAppSessionJwt({ sub: String(row.sub), email: String(row.email) });
      const base = wpChatUrl();
      const url = new URL(base);
      url.hash = `angelbot_access_token=${encodeURIComponent(appJwt)}`;
      res.redirect(302, url.toString());
    } catch (e) {
      next(e);
    }
  });

  /**
   * Signed handoff helper for server-side callers (e.g. WordPress PHP) — returns the start URL to redirect the user.
   * Protected by THINKIFIC_HANDOFF_SECRET as Bearer (same secret used to verify handoff on start).
   * POST body JSON: { email, first_name, last_name, external_id?, exp_in_seconds? }
   */
  r.post('/auth/thinkific/handoff-url', (req, res) => {
    const hdr = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(hdr);
    const secret = process.env.THINKIFIC_HANDOFF_SECRET;
    if (!secret || m?.[1] !== secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const { email, first_name, last_name, external_id } = req.body || {};
    if (!email || !first_name || !last_name) {
      res.status(400).json({ error: 'email, first_name, last_name required' });
      return;
    }
    const ttl = Math.min(Number(req.body?.exp_in_seconds) || 600, 3600);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const handoff = signHandoffPayload({
      email: String(email),
      first_name: String(first_name),
      last_name: String(last_name),
      external_id: external_id ? String(external_id) : undefined,
      exp,
    });
    const startUrl = `${publicBase()}/auth/thinkific/start?handoff=${encodeURIComponent(handoff)}`;
    res.json({ url: startUrl, expires_at: exp });
  });

  return r;
}
