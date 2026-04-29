/**
 * Thinkific Custom SSO (JWT) — sign payload and build redirect URL.
 * @see https://support.thinkific.dev/hc/en-us/articles/4423909018135-Custom-SSO-Using-JWT
 */

import { SignJWT } from 'jose';

const ALG = 'HS256';

function getSigningSecret() {
  const raw = process.env.THINKIFIC_SSO_SIGNING_SECRET;
  if (!raw || raw.length < 8) {
    throw new Error('Set THINKIFIC_SSO_SIGNING_SECRET (Thinkific Code & Analytics SSO signing secret)');
  }
  return new TextEncoder().encode(raw);
}

function getSubdomain() {
  const s = process.env.THINKIFIC_SUBDOMAIN;
  if (!s) throw new Error('Set THINKIFIC_SUBDOMAIN (school subdomain, no .thinkific.com)');
  return s.replace(/\.thinkific\.com$/i, '').trim();
}

/**
 * @param {{ email: string; first_name: string; last_name: string; external_id?: string }} user
 * @returns {Promise<string>} compact JWT string for query param
 */
export async function signThinkificLearnerJwt(user) {
  const secret = getSigningSecret();
  const now = Math.floor(Date.now() / 1000);
  /** @type {Record<string, string>} */
  const claims = {
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
  };
  if (user.external_id) claims.external_id = user.external_id;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(now)
    .sign(secret);
}

/**
 * @param {string} jwt
 * @param {string} returnTo - absolute URL Thinkific redirects to after sign-in
 * @returns {string} full Thinkific SSO URL
 */
export function buildThinkificSsoRedirectUrl(jwt, returnTo) {
  const subdomain = getSubdomain();
  const base = `https://${subdomain}.thinkific.com/api/sso/v2/sso/jwt`;
  const params = new URLSearchParams();
  params.set('jwt', jwt);
  if (returnTo) params.set('return_to', returnTo);
  const errorUrl = process.env.THINKIFIC_SSO_ERROR_URL;
  if (errorUrl) params.set('error_url', errorUrl);
  return `${base}?${params.toString()}`;
}
