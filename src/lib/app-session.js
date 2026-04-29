/**
 * App session JWT for WordPress / browser clients (from bootstrap auth flow).
 */

import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';

function getSecret() {
  const raw = process.env.APP_SESSION_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error('Set APP_SESSION_SECRET (min 16 chars) for web mode');
  }
  return new TextEncoder().encode(raw);
}

/**
 * @param {{ sub: string; email?: string }} claims
 * @param {number} [ttlSeconds]
 * @returns {Promise<string>}
 */
export async function createAppSessionJwt(claims, ttlSeconds = 60 * 60 * 24 * 7) {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: claims.email ?? '' })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secret);
}

/**
 * @param {string} token
 * @returns {Promise<{ sub: string; email?: string }>}
 */
export async function verifyAppSessionJwt(token) {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  const sub = payload.sub;
  if (!sub) throw new Error('Invalid token: missing sub');
  return { sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}
