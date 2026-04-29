/**
 * HMAC-signed handoff payload so WordPress (or your IdP) can start Thinkific SSO without exposing Thinkific secrets.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

function getSecret() {
  const raw = process.env.THINKIFIC_HANDOFF_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error('Set THINKIFIC_HANDOFF_SECRET (shared secret between trusted server and AngelBot, min 16 chars)');
  }
  return raw;
}

/**
 * @param {object} payload - must include exp (unix seconds)
 * @returns {string} token for query param
 */
export function signHandoffPayload(payload) {
  const secret = getSecret();
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = createHmac('sha256', secret).update(body).digest();
  return `${body.toString('base64url')}.${sig.toString('base64url')}`;
}

/**
 * @param {string} token
 * @returns {object|null} parsed payload or null
 */
export function verifyHandoffToken(token) {
  try {
    const secret = getSecret();
    const idx = token.lastIndexOf('.');
    if (idx <= 0) return null;
    const bodyB64 = token.slice(0, idx);
    const sigB64 = token.slice(idx + 1);
    const body = Buffer.from(bodyB64, 'base64url');
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(body.toString('utf8'));
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newStateId() {
  return randomBytes(24).toString('base64url');
}
