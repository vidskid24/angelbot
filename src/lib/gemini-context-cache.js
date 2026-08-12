/**
 * Explicit Gemini context cache for the stable Omi wisdom system instruction.
 * Variable RAG / prefs / memory stay outside the cache and are attached per turn.
 */

import { GoogleAICacheManager } from '@google/generative-ai/server';
import { getStaticSystemPrompt } from '../prompts/wisdom-companion.js';

const CACHE_TTL_SECONDS = Math.max(
  300,
  parseInt(process.env.GEMINI_CONTEXT_CACHE_TTL_SECONDS || '3600', 10) || 3600
);
/** Refresh before expiry so requests rarely miss. */
const REFRESH_MARGIN_MS = Math.min(5 * 60 * 1000, Math.floor(CACHE_TTL_SECONDS * 1000 * 0.2));

function contextCacheEnabled() {
  const raw = String(process.env.GEMINI_CONTEXT_CACHE ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** @type {Map<string, { cache: import('@google/generative-ai').CachedContent; expiresAtMs: number; systemInstruction: string }>} */
const cacheByModel = new Map();
/** @type {Map<string, Promise<import('@google/generative-ai').CachedContent | null>>} */
const inflightByModel = new Map();

let _cacheManager = null;

function getCacheManager() {
  if (!_cacheManager) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    _cacheManager = new GoogleAICacheManager(apiKey);
  }
  return _cacheManager;
}

function displayNameForModel(modelName) {
  const safe = String(modelName || 'model').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  return `omi-wisdom-${safe}`;
}

function parseExpireAtMs(cache) {
  if (cache?.expireTime) {
    const t = Date.parse(cache.expireTime);
    if (Number.isFinite(t)) return t;
  }
  return Date.now() + CACHE_TTL_SECONDS * 1000;
}

/**
 * @param {string} modelName
 * @param {string} [systemInstruction]
 * @returns {Promise<import('@google/generative-ai').CachedContent | null>}
 */
export async function ensureWisdomSystemCache(modelName, systemInstruction = getStaticSystemPrompt()) {
  if (!contextCacheEnabled()) return null;
  const model = String(modelName || '').trim();
  if (!model) return null;
  const instruction = String(systemInstruction || '').trim();
  if (!instruction) return null;

  const existing = cacheByModel.get(model);
  if (
    existing &&
    existing.systemInstruction === instruction &&
    existing.expiresAtMs - REFRESH_MARGIN_MS > Date.now() &&
    existing.cache?.name
  ) {
    return existing.cache;
  }

  const inflight = inflightByModel.get(model);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const manager = getCacheManager();
      const displayName = displayNameForModel(model);

      // Prefer extending an existing cache with the same display name when possible.
      try {
        const listed = await manager.list({ pageSize: 50 });
        const match = (listed?.cachedContents || []).find(
          (c) => c.displayName === displayName && String(c.model || '').includes(model)
        );
        if (match?.name) {
          const expiresAtMs = parseExpireAtMs(match);
          if (expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
            cacheByModel.set(model, {
              cache: match,
              expiresAtMs,
              systemInstruction: instruction,
            });
            return match;
          }
          const updated = await manager.update(match.name, {
            cachedContent: { ttlSeconds: CACHE_TTL_SECONDS },
          });
          cacheByModel.set(model, {
            cache: updated,
            expiresAtMs: parseExpireAtMs(updated),
            systemInstruction: instruction,
          });
          return updated;
        }
      } catch (listErr) {
        console.warn(
          '[gemini-cache] list/update existing cache failed; creating new cache:',
          listErr?.message || listErr
        );
      }

      // Cache systemInstruction only — do not put fake user/model turns in
      // `contents` (those would prepend to every chat when the cache is used).
      const created = await manager.create({
        model,
        displayName,
        systemInstruction: instruction,
        ttlSeconds: CACHE_TTL_SECONDS,
      });

      cacheByModel.set(model, {
        cache: created,
        expiresAtMs: parseExpireAtMs(created),
        systemInstruction: instruction,
      });
      console.info(`[gemini-cache] Created context cache for ${model}: ${created.name}`);
      return created;
    } catch (err) {
      console.warn(
        `[gemini-cache] Context cache unavailable for ${model}; using inline system instruction:`,
        err?.message || err
      );
      cacheByModel.delete(model);
      return null;
    } finally {
      inflightByModel.delete(model);
    }
  })();

  inflightByModel.set(model, task);
  return task;
}

/** @returns {boolean} */
export function isGeminiContextCacheEnabled() {
  return contextCacheEnabled();
}
