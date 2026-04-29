import { verifyAppSessionJwt } from '../../lib/app-session.js';

/**
 * Expect `Authorization: Bearer <app_jwt>`.
 * Sets `req.angelUser = { sub, email? }`.
 */
export async function requireSession(req, res, next) {
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (!m) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return;
  }
  try {
    req.angelUser = await verifyAppSessionJwt(m[1].trim());
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}
