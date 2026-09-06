/**
 * Google Gemini client for chat, summaries/titles, and embeddings.
 */

import { GoogleGenerativeAI, FinishReason } from '@google/generative-ai';
import { finalizeAssistantText } from './chat-reply.js';
import { ensureWisdomSystemCache } from './gemini-context-cache.js';
import { getStaticSystemPrompt } from '../prompts/wisdom-companion.js';

let _genAI = null;
let _embedInFlight = 0;
const _embedQueue = [];
const _embedCache = new Map();
const _embedPendingByKey = new Map();
const _embedStats = {
  cacheHit: 0,
  cacheMiss: 0,
  dedupeJoin: 0,
  retries: 0,
  requestOk: 0,
  requestFail: 0,
};

const EMBED_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.GEMINI_EMBED_MAX_CONCURRENCY || '2', 10) || 2);
const EMBED_RETRY_MAX = Math.max(0, parseInt(process.env.GEMINI_EMBED_RETRY_MAX || '3', 10) || 3);
const EMBED_RETRY_BASE_MS = Math.max(50, parseInt(process.env.GEMINI_EMBED_RETRY_BASE_MS || '400', 10) || 400);
const EMBED_CACHE_TTL_MS = Math.max(0, parseInt(process.env.GEMINI_EMBED_CACHE_TTL_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000);
const EMBED_CACHE_MAX_ENTRIES = Math.max(1, parseInt(process.env.GEMINI_EMBED_CACHE_MAX_ENTRIES || '500', 10) || 500);
const EMBED_METRICS_LOG = String(process.env.GEMINI_EMBED_METRICS_LOG || '').toLowerCase() === 'true';
const EMBED_METRICS_LOG_INTERVAL_MS = Math.max(5000, parseInt(process.env.GEMINI_EMBED_METRICS_LOG_INTERVAL_MS || '30000', 10) || 30000);
const CHAT_TEMPERATURE = 0.7;
let _embedLastMetricsLogAt = 0;

export function getGeminiClient() {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

/** Effective Gemini chat model (env or default). */
export function getGeminiChatModel() {
  return process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
}

/** Effective Gemini fallback chat model for transient overloads. */
export function getGeminiFallbackChatModel() {
  return process.env.GEMINI_FALLBACK_CHAT_MODEL || 'gemini-3.5-flash-lite';
}

/** Effective Gemini embedding model (env or default). */
export function getGeminiEmbeddingModel() {
  return process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
}

/**
 * Normalize prior turns so Gemini startChat history starts with user and alternates user/model.
 * @param {Array<{ role: string; content: string; thoughtSignature?: string | null }>} priorTurns
 * @returns {Array<{ role: 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>}
 */
function sanitizePriorTurns(priorTurns) {
  let list = priorTurns.filter((m) => m.role === 'user' || m.role === 'assistant');

  while (list.length > 0 && list[0].role === 'assistant') {
    list = list.slice(1);
  }

  const normalized = [];
  for (const m of list) {
    const content = String(m.content || '');
    if (!content.trim()) continue;
    const thoughtSignature = m.thoughtSignature != null ? String(m.thoughtSignature) : null;

    if (m.role === 'user') {
      const prev = normalized[normalized.length - 1];
      if (prev?.role === 'user') {
        normalized[normalized.length - 1] = { role: 'user', content };
      } else {
        normalized.push({ role: 'user', content });
      }
    } else if (m.role === 'assistant') {
      const prev = normalized[normalized.length - 1];
      if (prev?.role === 'user') {
        normalized.push({ role: 'assistant', content, thoughtSignature });
      } else if (prev?.role === 'assistant') {
        normalized[normalized.length - 1] = { role: 'assistant', content, thoughtSignature };
      }
    }
  }

  while (normalized.length > 0 && normalized[normalized.length - 1].role === 'user') {
    normalized.pop();
  }

  return normalized;
}

/**
 * Build a model history part, preserving thought signatures for Gemini 3.x multi-turn.
 * @param {string} text
 * @param {string | null | undefined} thoughtSignature
 */
function modelHistoryPart(text, thoughtSignature) {
  /** @type {{ text: string; thoughtSignature?: string }} */
  const part = { text: String(text) };
  const sig = String(thoughtSignature || '').trim();
  if (sig) part.thoughtSignature = sig;
  return part;
}

/**
 * @param {Array<{ role: 'system' | 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>} messages
 */
function chatMessagesToGemini(messages) {
  const systemParts = messages.filter((m) => m.role === 'system');
  const systemInstruction = systemParts.map((m) => String(m.content)).join('\n\n').trim() || undefined;
  const rest = messages.filter((m) => m.role !== 'system');
  if (!rest.length) throw new Error('No messages for Gemini after removing system role');
  const last = rest[rest.length - 1];
  if (last.role !== 'user') {
    throw new Error('Expected last non-system message to be from user for Gemini chat');
  }
  const history = [];
  for (const m of sanitizePriorTurns(rest.slice(0, -1))) {
    if (m.role === 'user') {
      history.push({ role: 'user', parts: [{ text: String(m.content) }] });
    } else {
      history.push({
        role: 'model',
        parts: [modelHistoryPart(m.content, m.thoughtSignature)],
      });
    }
  }
  return { systemInstruction, history, lastUserText: String(last.content) };
}

/**
 * True when the model stopped because output hit the configured max tokens.
 * @param {string | undefined} finishReason
 */
function isMaxTokensFinish(finishReason) {
  return finishReason === FinishReason.MAX_TOKENS || String(finishReason) === 'MAX_TOKENS';
}

/**
 * Extract concatenated text from a Gemini candidate (fallback when response.text() fails).
 * Skips internal thought summary parts when present.
 * @param {*} response
 */
function textFromCandidate(response) {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!parts?.length) return '';
  return parts
    .map((p) => {
      if (!p || typeof p !== 'object') return '';
      if (p.thought === true) return '';
      return 'text' in p ? String(p.text || '') : '';
    })
    .join('');
}

/**
 * Pull the encrypted thought signature from a Gemini response for multi-turn circulation.
 * @param {*} response
 * @returns {string | null}
 */
function extractThoughtSignature(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const sig = parts[i]?.thoughtSignature ?? parts[i]?.thought_signature;
    if (sig != null && String(sig).trim()) return String(sig);
  }
  return null;
}

/**
 * Generation config for chat / long-form replies.
 * Gemini 3.x uses thinkingLevel (not thinkingBudget). Prefer minimal for Flash-Lite cost/latency.
 * @param {{ maxOutputTokens?: number; temperature?: number; modelName?: string }} [opts]
 */
function chatGenerationConfig({
  maxOutputTokens = 4096,
  temperature = CHAT_TEMPERATURE,
  modelName = getGeminiChatModel(),
} = {}) {
  /** @type {Record<string, unknown>} */
  const config = { maxOutputTokens, temperature };
  if (/gemini-3/i.test(modelName)) {
    config.thinkingConfig = { thinkingLevel: 'minimal' };
  } else if (/gemini-2\.5/i.test(modelName)) {
    // Legacy 2.5 path if someone still points env at 2.5.
    config.thinkingConfig = { thinkingBudget: 1024 };
  }
  return config;
}

/**
 * Build a chat model, preferring an explicit context cache for the stable wisdom system prompt.
 * @param {string} modelName
 * @param {string | undefined} systemInstruction
 * @param {Record<string, unknown>} generationConfig
 */
async function createChatGenerativeModel(modelName, systemInstruction, generationConfig) {
  const genAI = getGeminiClient();
  const instruction = String(systemInstruction || '').trim();
  const staticPrompt = getStaticSystemPrompt().trim();

  if (instruction && instruction === staticPrompt) {
    const cached = await ensureWisdomSystemCache(modelName, instruction);
    if (cached?.name) {
      return genAI.getGenerativeModelFromCachedContent(cached, {
        generationConfig,
      });
    }
  }

  return genAI.getGenerativeModel({
    model: modelName,
    ...(instruction ? { systemInstruction: instruction } : {}),
    generationConfig,
  });
}

/**
 * Best-effort text extraction from Gemini response.
 * @param {*} response
 * @returns {string}
 */
function extractText(response) {
  try {
    const direct = response.text();
    // response.text() may include thought summaries on some SDK versions; prefer filtered parts when mixed.
    const fromParts = textFromCandidate(response);
    if (fromParts && fromParts !== direct && /thought/i.test(String(direct))) {
      return fromParts;
    }
    return fromParts || direct;
  } catch {
    return textFromCandidate(response);
  }
}

/**
 * Diagnostic fields when Gemini returns no usable text (safety, max tokens, empty parts).
 * @param {*} response
 * @returns {{
 *   finishReason: string | null;
 *   blockReason: string | null;
 *   candidateCount: number;
 *   partsCount: number;
 * }}
 */
function describeEmptyGeminiResponse(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const candidate = candidates[0];
  const parts = candidate?.content?.parts;
  return {
    finishReason: candidate?.finishReason != null ? String(candidate.finishReason) : null,
    blockReason:
      response?.promptFeedback?.blockReason != null
        ? String(response.promptFeedback.blockReason)
        : null,
    candidateCount: candidates.length,
    partsCount: Array.isArray(parts) ? parts.length : 0,
  };
}

/**
 * @param {*} response
 * @returns {Error}
 */
function emptyGeminiResponseError(response) {
  const d = describeEmptyGeminiResponse(response);
  const bits = [];
  if (d.finishReason) bits.push(`finishReason=${d.finishReason}`);
  if (d.blockReason) bits.push(`blockReason=${d.blockReason}`);
  bits.push(`candidates=${d.candidateCount}`);
  bits.push(`parts=${d.partsCount}`);
  const err = new Error(`Empty Gemini response (${bits.join(', ')})`);
  err.code = 'empty_gemini_response';
  err.finishReason = d.finishReason;
  err.blockReason = d.blockReason;
  return err;
}

/**
 * Gemini generateContent without chat fallbacks. Throws on API or empty response.
 * Used for memory cron and other server-side jobs that must not save user-facing errors.
 * @param {{
 *   model?: string;
 *   systemInstruction?: string;
 *   userPrompt: string;
 *   maxOutputTokens?: number;
 *   temperature?: number;
 * }} opts
 * @returns {Promise<string>}
 */
export async function generateTextStrict({
  model: modelName = getGeminiChatModel(),
  systemInstruction,
  userPrompt,
  maxOutputTokens = 4096,
  temperature = 0.4,
}) {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction } : {}),
    generationConfig: chatGenerationConfig({
      maxOutputTokens,
      temperature,
      modelName,
    }),
  });
  const result = await model.generateContent(userPrompt);
  const text = String(extractText(result.response) || '').trim();
  if (!text) throw emptyGeminiResponseError(result.response);
  return text;
}

/**
 * True when Gemini API error is transient/overload.
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransientGeminiError(err) {
  const status = Number(err?.status);
  return status === 429 || status === 500 || status === 503;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logEmbedEvent(event, details) {
  if (!EMBED_METRICS_LOG) return;
  const payload = {
    event,
    at: new Date().toISOString(),
    queueDepth: _embedQueue.length,
    inFlight: _embedInFlight,
    ...details,
  };
  console.info('[embed-metrics]', JSON.stringify(payload));
}

function maybeLogEmbedSnapshot(reason = 'periodic') {
  if (!EMBED_METRICS_LOG) return;
  const now = Date.now();
  if (now - _embedLastMetricsLogAt < EMBED_METRICS_LOG_INTERVAL_MS) return;
  _embedLastMetricsLogAt = now;
  logEmbedEvent('snapshot', {
    reason,
    stats: { ..._embedStats },
    pendingUnique: _embedPendingByKey.size,
    cacheSize: _embedCache.size,
  });
}

function normalizeEmbeddingInput(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').slice(0, 8191);
}

function evictExpiredEmbeddingCache(now = Date.now()) {
  for (const [key, value] of _embedCache.entries()) {
    if (value.expiresAt <= now) _embedCache.delete(key);
  }
}

function getCachedEmbedding(key) {
  if (!EMBED_CACHE_TTL_MS) return null;
  const hit = _embedCache.get(key);
  if (!hit) {
    _embedStats.cacheMiss += 1;
    maybeLogEmbedSnapshot('cache_miss');
    return null;
  }
  if (hit.expiresAt <= Date.now()) {
    _embedCache.delete(key);
    _embedStats.cacheMiss += 1;
    maybeLogEmbedSnapshot('cache_expired');
    return null;
  }
  _embedStats.cacheHit += 1;
  maybeLogEmbedSnapshot('cache_hit');
  return hit.values;
}

function setCachedEmbedding(key, values) {
  if (!EMBED_CACHE_TTL_MS) return;
  evictExpiredEmbeddingCache();
  if (_embedCache.size >= EMBED_CACHE_MAX_ENTRIES) {
    const firstKey = _embedCache.keys().next().value;
    if (firstKey) _embedCache.delete(firstKey);
  }
  _embedCache.set(key, { values, expiresAt: Date.now() + EMBED_CACHE_TTL_MS });
}

function runEmbeddedQueue() {
  while (_embedInFlight < EMBED_MAX_CONCURRENCY && _embedQueue.length > 0) {
    const next = _embedQueue.shift();
    _embedInFlight += 1;
    Promise.resolve()
      .then(next.fn)
      .then(next.resolve, next.reject)
      .finally(() => {
        _embedInFlight = Math.max(0, _embedInFlight - 1);
        runEmbeddedQueue();
      });
  }
}

function withEmbeddingThrottle(fn) {
  return new Promise((resolve, reject) => {
    _embedQueue.push({ fn, resolve, reject });
    maybeLogEmbedSnapshot('enqueue');
    runEmbeddedQueue();
  });
}

async function embedWithRetry(model, text) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await model.embedContent(text);
      _embedStats.requestOk += 1;
      maybeLogEmbedSnapshot('request_ok');
      return res;
    } catch (err) {
      const transient = isTransientGeminiError(err);
      if (!transient || attempt >= EMBED_RETRY_MAX) {
        _embedStats.requestFail += 1;
        logEmbedEvent('request_fail', {
          status: Number(err?.status) || null,
          statusText: String(err?.statusText || ''),
          attempt,
          transient,
          message: String(err?.message || err),
        });
        throw err;
      }
      const expBackoff = EMBED_RETRY_BASE_MS * (2 ** attempt);
      const jitter = Math.floor(Math.random() * Math.max(50, EMBED_RETRY_BASE_MS));
      _embedStats.retries += 1;
      logEmbedEvent('retry_scheduled', {
        attempt,
        status: Number(err?.status) || null,
        waitMs: expBackoff + jitter,
      });
      await sleep(expBackoff + jitter);
      attempt += 1;
    }
  }
}

/**
 * True when Gemini API reports temporary service-side availability issues.
 * @param {unknown} err
 * @returns {boolean}
 */
function isServiceUnavailableError(err) {
  const status = Number(err?.status);
  return status === 500 || status === 503;
}

/**
 * Explicit user-facing message for temporary service outages.
 * @returns {string}
 */
function serviceUnavailableFallbackText() {
  return 'Oops! There was a **hiccup** connecting just now. Please take a moment and ask again.';
}

/**
 * Explicit user-facing message for temporary rate limiting.
 * @returns {string}
 */
function rateLimitFallbackText() {
  return 'Oops! I bumped into a limit on my side. Please ask again in a few seconds and we can continue.';
}

/**
 * Deterministic summary-style fallback when Gemini returns empty text.
 * Uses a short extract of the user's message so fallback stays context-aware.
 * @param {string} userText
 * @returns {string}
 */
function summaryFallbackText(userText) {
  const topic = String(userText || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  const topicLine = topic
    ? `I hear you're exploring this thread: "${topic}${topic.length === 140 ? '...' : ''}"\n`
    : '';
  return (
    "Here's a brief **summary** so we can keep moving:\n" +
    topicLine +
    '- We can map the pattern behind what kept repeating.\n' +
    '- We can name the emotional tone under that pattern.\n' +
    '- We can choose one grounded experiment from **presence** in the **lab**.\n' +
    'Which part would you like first: pattern, feeling, or practical experiment?'
  );
}

/**
 * Deterministic warm fallback for simple greetings.
 * @returns {string}
 */
function greetingFallbackText() {
  return "Hi friend - I'm glad you're here in **presence**. How are you arriving in your **space** right now?";
}

/**
 * Detect simple greeting/small-talk inputs.
 * @param {string} userText
 * @returns {boolean}
 */
function isGreetingOrSmallTalk(userText) {
  const text = String(userText || '').trim().toLowerCase();
  if (!text) return false;
  if (text.length > 80) return false;
  const patterns = [
    /\b(hi|hello|hey|howdy|yo)\b/,
    /\b(how are you|how're you|hows it going|how is it going)\b/,
    /\b(good morning|good afternoon|good evening)\b/,
    /\b(what's up|whats up)\b/,
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * Choose deterministic fallback based on input shape.
 * @param {string} userText
 * @returns {string}
 */
function chooseFallbackText(userText) {
  return isGreetingOrSmallTalk(userText) ? greetingFallbackText() : summaryFallbackText(userText);
}

/**
 * Heuristic: treat text as complete if it ends with terminal punctuation.
 * @param {string} text
 * @returns {boolean}
 */
function looksCompleteText(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return /[.!?]["')\]]?$/.test(s);
}

/**
 * For long truncated outputs, keep content up to the last sentence boundary.
 * @param {string} text
 * @returns {string}
 */
function salvageToSentenceBoundary(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const lastBoundary = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?'));
  if (lastBoundary < 0) return '';
  return s.slice(0, lastBoundary + 1).trim();
}

/**
 * @param {string} userText
 * @returns {'greeting' | 'summary'}
 */
function getFallbackKind(userText) {
  return isGreetingOrSmallTalk(userText) ? 'greeting' : 'summary';
}

/**
 * One short retry for the "truncated + empty text" edge case.
 * @param {ReturnType<GoogleGenerativeAI['getGenerativeModel']>} model
 * @param {*} history
 * @param {string} userText
 * @returns {Promise<string>}
 */
async function retrySummaryReply(model, history, userText) {
  const chat = model.startChat({ history });
  const retryPrompt =
    `The previous response was empty due to truncation. Recover with a concise structured summary.\n` +
    `Requirements:\n` +
    `- 3-5 bullet points only.\n` +
    `- Total length must be 120 words or less.\n` +
    `- Include exactly one follow-up question at the end.\n` +
    `- Include 2-3 key terms in bold using **double asterisks**.\n` +
    `- Keep tone warm, grounded, and clear.\n\n` +
    `User message: ${userText}`;
  const retry = await chat.sendMessage(retryPrompt);
  return extractText(retry.response);
}

/**
 * Attempt one response from a fallback Gemini model when primary is overloaded.
 * @param {GoogleGenerativeAI} genAI
 * @param {string} modelName
 * @param {string | undefined} systemInstruction
 * @param {*} history
 * @param {string} userText
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
async function tryFallbackModelReply(genAI, modelName, systemInstruction, history, userText) {
  const model = await createChatGenerativeModel(
    modelName,
    systemInstruction,
    chatGenerationConfig({
      maxOutputTokens: 900,
      temperature: CHAT_TEMPERATURE,
      modelName,
    })
  );
  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userText);
  const response = result.response;
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  return {
    text: extractText(response),
    truncated: isMaxTokensFinish(finishReason),
    thoughtSignature: extractThoughtSignature(response),
  };
}

/**
 * When the primary model is overloaded, try flash (or configured fallback) with repair/rescue paths.
 * @returns {Promise<{ text: string; thoughtSignature: string | null } | null>}
 */
async function attemptFallbackModelChat(genAI, fallbackModelName, systemInstruction, history, userText) {
  try {
    const fb = await tryFallbackModelReply(genAI, fallbackModelName, systemInstruction, history, userText);
    if (!fb.text.trim()) return null;

    const fbTrimmed = fb.text.trim();
    if (fbTrimmed.length >= 140 && (!fb.truncated || looksCompleteText(fbTrimmed))) {
      return {
        text: finalizeAssistantText(fbTrimmed, false),
        thoughtSignature: fb.thoughtSignature,
      };
    }
    if (fb.truncated && fbTrimmed.length >= 140) {
      const salvaged = salvageToSentenceBoundary(fbTrimmed);
      if (salvaged.length >= 120) {
        return {
          text: finalizeAssistantText(salvaged, false),
          thoughtSignature: fb.thoughtSignature,
        };
      }
    }
    if (fb.truncated || fb.text.trim().length < 140) {
      try {
        const repaired = await repairFallbackFragment(
          genAI,
          fallbackModelName,
          systemInstruction,
          history,
          userText
        );
        if (
          repaired.text.trim().length >= 80 ||
          (repaired.text.trim().length >= 50 && looksCompleteText(repaired.text))
        ) {
          return {
            text: finalizeAssistantText(repaired.text, false),
            thoughtSignature: repaired.thoughtSignature,
          };
        }
        try {
          const rescued = await rescueDirectReply(
            genAI,
            fallbackModelName,
            systemInstruction,
            userText
          );
          if (
            rescued.text.trim().length >= 80 ||
            (rescued.text.trim().length >= 50 && looksCompleteText(rescued.text))
          ) {
            return {
              text: finalizeAssistantText(rescued.text, false),
              thoughtSignature: rescued.thoughtSignature,
            };
          }
        } catch {
          /* rescue failed */
        }
      } catch {
        /* repair failed */
      }
      return { text: chooseFallbackText(userText), thoughtSignature: null };
    }
    return {
      text: finalizeAssistantText(fb.text, fb.truncated),
      thoughtSignature: fb.thoughtSignature,
    };
  } catch {
    return null;
  }
}

/**
 * Try flash when primary hits 500/503; show hiccup only if fallback also fails.
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
async function recoverFromServiceUnavailable(
  genAI,
  primaryModelName,
  systemInstruction,
  history,
  userText
) {
  const fallbackModelName = getGeminiFallbackChatModel();
  if (fallbackModelName && fallbackModelName !== primaryModelName) {
    const fbReply = await attemptFallbackModelChat(
      genAI,
      fallbackModelName,
      systemInstruction,
      history,
      userText
    );
    if (fbReply) return fbReply;
  }
  return { text: serviceUnavailableFallbackText(), thoughtSignature: null };
}

/**
 * Repair a short/truncated fallback fragment into one complete concise answer.
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
async function repairFallbackFragment(genAI, modelName, systemInstruction, history, userText) {
  const model = await createChatGenerativeModel(
    modelName,
    systemInstruction,
    chatGenerationConfig({
      maxOutputTokens: 300,
      temperature: CHAT_TEMPERATURE,
      modelName,
    })
  );
  const chatSession = model.startChat({ history });
  const prompt =
    `Return one complete concise reply (2 short paragraphs max) to the user's message. ` +
    `Do not include ellipses or an unfinished sentence. Include 2-3 bold terms and end with one follow-up question.\n\n` +
    `User message: ${userText}`;
  const result = await chatSession.sendMessage(prompt);
  return {
    text: extractText(result.response),
    thoughtSignature: extractThoughtSignature(result.response),
  };
}

/**
 * Last-resort rescue: ask fallback model directly with a minimal prompt to ensure
 * a complete short response when full-context paths keep truncating.
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
async function rescueDirectReply(genAI, modelName, systemInstruction, userText) {
  const model = await createChatGenerativeModel(
    modelName,
    systemInstruction,
    chatGenerationConfig({
      maxOutputTokens: 260,
      temperature: CHAT_TEMPERATURE,
      modelName,
    })
  );
  const prompt =
    `Reply with one complete concise response (2 short paragraphs max) to this user message. ` +
    `Include 2-3 bold terms and end with one follow-up question. Do not end mid-sentence.\n\n` +
    `User message: ${userText}`;
  const result = await model.generateContent(prompt);
  return {
    text: extractText(result.response),
    thoughtSignature: extractThoughtSignature(result.response),
  };
}

/**
 * Second pass when primary generation hit MAX_TOKENS but returned partial text.
 * Asks the model for a continuation only (no repetition of the partial body).
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
async function completeTruncatedContinuation(
  genAI,
  modelName,
  systemInstruction,
  userText,
  partialAssistantText
) {
  const partial = String(partialAssistantText || '').trim();
  const tail = partial.length > 2800 ? partial.slice(-2800) : partial;
  const model = await createChatGenerativeModel(
    modelName,
    systemInstruction,
    chatGenerationConfig({
      maxOutputTokens: 600,
      temperature: CHAT_TEMPERATURE,
      modelName,
    })
  );
  const prompt =
    `The assistant reply below was cut off by an output length limit.\n` +
    `Write ONLY the continuation: finish any incomplete bullet, sentence, or step. ` +
    `Do not repeat or rephrase what is already written. ` +
    `Add at most one short closing paragraph if needed, then end with exactly ONE follow-up question.\n\n` +
    `User message:\n${String(userText || '').trim()}\n\n` +
    `Partial assistant reply (may be truncated at the end):\n${tail}`;
  const result = await model.generateContent(prompt);
  return {
    text: extractText(result.response).trim(),
    thoughtSignature: extractThoughtSignature(result.response),
  };
}

/**
 * @param {Array<{ role: 'system' | 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>} messages
 * @returns {Promise<{ text: string; thoughtSignature: string | null }>}
 */
export async function chat(messages) {
  const genAI = getGeminiClient();
  const modelName = getGeminiChatModel();
  const { systemInstruction, history, lastUserText } = chatMessagesToGemini(messages);

  const model = await createChatGenerativeModel(
    modelName,
    systemInstruction,
    chatGenerationConfig({
      maxOutputTokens: 4096,
      temperature: CHAT_TEMPERATURE,
      modelName,
    })
  );

  const chatSession = model.startChat({ history });
  let result;
  try {
    result = await chatSession.sendMessage(lastUserText);
  } catch (err) {
    if (Number(err?.status) === 429) {
      return { text: rateLimitFallbackText(), thoughtSignature: null };
    }
    if (isServiceUnavailableError(err)) {
      return recoverFromServiceUnavailable(genAI, modelName, systemInstruction, history, lastUserText);
    }
    throw err;
  }
  const response = result.response;
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const truncated = isMaxTokensFinish(finishReason);
  const text = extractText(response);
  const thoughtSignature = extractThoughtSignature(response);

  if (truncated && text.trim()) {
    const partial = text.trim();
    const completionModel = getGeminiFallbackChatModel() || modelName;
    try {
      const cont = await completeTruncatedContinuation(
        genAI,
        completionModel,
        systemInstruction,
        lastUserText,
        partial
      );
      if (cont.text.length >= 25) {
        const merged = `${partial}\n\n${cont.text}`.trim();
        return {
          text: finalizeAssistantText(merged, false),
          thoughtSignature: cont.thoughtSignature || thoughtSignature,
        };
      }
    } catch (e) {
    }
    return {
      text: finalizeAssistantText(partial, true),
      thoughtSignature,
    };
  }

  if (truncated && !text.trim()) {
    const shortModel = await createChatGenerativeModel(
      modelName,
      systemInstruction,
      chatGenerationConfig({
        maxOutputTokens: 320,
        temperature: CHAT_TEMPERATURE,
        modelName,
      })
    );
    let retryText = '';
    try {
      retryText = await retrySummaryReply(shortModel, history, lastUserText);
    } catch (err) {
      if (Number(err?.status) === 429) {
        return { text: rateLimitFallbackText(), thoughtSignature: null };
      }
      if (isServiceUnavailableError(err)) {
        return recoverFromServiceUnavailable(genAI, modelName, systemInstruction, history, lastUserText);
      }
      if (isTransientGeminiError(err)) {
        return { text: chooseFallbackText(lastUserText), thoughtSignature: null };
      }
      throw err;
    }
    if (retryText.trim()) {
      return { text: finalizeAssistantText(retryText, false), thoughtSignature: null };
    }
    const fallbackModelName = getGeminiFallbackChatModel();
    if (fallbackModelName && fallbackModelName !== modelName) {
      const fbReply = await attemptFallbackModelChat(
        genAI,
        fallbackModelName,
        systemInstruction,
        history,
        lastUserText
      );
      if (fbReply) return fbReply;
    }
    return { text: chooseFallbackText(lastUserText), thoughtSignature: null };
  }

  return {
    text: finalizeAssistantText(text, truncated),
    thoughtSignature,
  };
}

/** Backward compatibility export name. */
export const chatWithGemini = chat;

const MAX_THREAD_TITLE_WORDS = 4;

/**
 * @param {string} title
 * @param {number} [maxWords]
 * @returns {string}
 */
function capThreadTitleWords(title, maxWords = MAX_THREAD_TITLE_WORDS) {
  const words = String(title || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Conversation';
  return words.slice(0, Math.max(1, maxWords)).join(' ');
}

/**
 * @param {string} text
 * @returns {string}
 */
function fallbackThreadTitleFromText(text) {
  const cleaned = String(text || '')
    .replace(/\*\*/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) return 'Conversation';
  const line = cleaned.split('\n')[0].trim();
  const sentence = (line.split(/[.!?]/)[0] || line).trim() || line;
  return capThreadTitleWords(sentence);
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeGeneratedThreadTitle(raw) {
  let title = String(raw || '').trim();
  if (!title) return null;
  title = title.replace(/^(title:\s*)/i, '').replace(/^["']|["']$/g, '').trim();
  title = title.split('\n')[0].trim();
  if (!title || title.length > 80) return null;
  if (/^saved\s+space$/i.test(title)) return null;
  return capThreadTitleWords(title);
}

/**
 * Reject truncated or incomplete model titles (e.g. "O", "Observ" from token limits).
 * @param {string} title
 * @returns {boolean}
 */
function isUsableGeneratedThreadTitle(title) {
  const t = String(title || '').trim();
  if (t.length < 4) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > MAX_THREAD_TITLE_WORDS) return false;
  if (words.length >= 2) {
    return !words.some((w) => w.length < 2);
  }
  return t.length >= 4;
}

/** Generation config for short labels — keep thinking minimal on Gemini 3.x. */
function shortLabelGenerationConfig(maxOutputTokens = 256) {
  const model = getGeminiFallbackChatModel();
  return chatGenerationConfig({
    maxOutputTokens,
    temperature: 0.2,
    modelName: model,
  });
}

const THREAD_TITLE_MAX_ATTEMPTS = 3;
const THREAD_TITLE_RETRY_DELAYS_MS = [2000, 5000];

/**
 * Generate a short conversation title from the assistant's first reply.
 * @param {string} reply
 * @returns {Promise<string>}
 */
export async function generateThreadTitleFromReply(reply) {
  const text = String(reply || '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 2000);
  const fallback = fallbackThreadTitleFromText(text);
  if (!text) return fallback;

  const genAI = getGeminiClient();
  const modelName = getGeminiFallbackChatModel();
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: shortLabelGenerationConfig(256),
  });
  const prompt =
    'The assistant just gave the first reply in a new chat. Write a very short conversation title ' +
    '(4 words or fewer) that summarizes the main topic of this reply. Use title case. ' +
    'No quotes, no trailing punctuation, no prefix like "Title:". Reply with only the title.\n\n' +
    `Assistant reply:\n${text}`;

  for (let attempt = 0; attempt < THREAD_TITLE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(THREAD_TITLE_RETRY_DELAYS_MS[attempt - 1] ?? 5000);
    }
    try {
      const res = await model.generateContent(prompt);
      const response = res.response;
      const finishReason = response.candidates?.[0]?.finishReason;
      if (isMaxTokensFinish(finishReason)) {
        return fallback;
      }
      const normalized = normalizeGeneratedThreadTitle(extractText(response));
      if (normalized && isUsableGeneratedThreadTitle(normalized)) return normalized;
      return fallback;
    } catch (err) {
      const canRetry = isTransientGeminiError(err) && attempt < THREAD_TITLE_MAX_ATTEMPTS - 1;
      if (canRetry) {
        console.warn(
          `generateThreadTitleFromReply transient error (attempt ${attempt + 1}/${THREAD_TITLE_MAX_ATTEMPTS}, model=${modelName}):`,
          err?.message || err
        );
        continue;
      }
      console.error('generateThreadTitleFromReply error:', err);
    }
  }
  return fallback;
}

/**
 * Generate a short title (3-6 words) for content.
 * @param {string} content
 * @returns {Promise<string>}
 */
export async function generateTitleForContent(content) {
  const text = String(content).trim().slice(0, 4000);
  if (!text) return 'Saved space';
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: getGeminiChatModel(),
    generationConfig: chatGenerationConfig({
      maxOutputTokens: 40,
      temperature: 0.3,
      modelName: getGeminiChatModel(),
    }),
  });
  const prompt =
    'Suggest a very short title (3-6 words) that captures the main theme or topic of the given text. ' +
    'Reply with only the title, no quotes or extra text.\n\n' +
    text;
  const res = await model.generateContent(prompt);
  const raw = extractText(res.response).trim().replace(/^["']|["']$/g, '');
  return raw && raw.length <= 80 ? raw : 'Saved space';
}

/**
 * Summarize a conversation (array of {role, content}) in 2-4 sentences.
 * @param {Array<{ role: string; content: string }>} messages
 * @returns {Promise<string>}
 */
export async function summarizeConversation(messages) {
  if (!messages?.length) return '';
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: getGeminiChatModel(),
    generationConfig: chatGenerationConfig({
      maxOutputTokens: 256,
      temperature: 0.4,
      modelName: getGeminiChatModel(),
    }),
  });
  const thread = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n').slice(0, 6000);
  const prompt =
    'Summarize this conversation in 2-4 sentences. Capture the main themes, key terms or practices explored, and what was shared. ' +
    'Reply with only the summary, no preamble.\n\n' + thread;
  const res = await model.generateContent(prompt);
  return extractText(res.response).trim();
}

/**
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const normalizedText = normalizeEmbeddingInput(text);
  if (!normalizedText) throw new Error('Cannot embed empty text');

  const cacheKey = `${getGeminiEmbeddingModel()}::${normalizedText.toLowerCase()}`;
  const cached = getCachedEmbedding(cacheKey);
  if (cached) return cached;

  const pending = _embedPendingByKey.get(cacheKey);
  if (pending) {
    _embedStats.dedupeJoin += 1;
    maybeLogEmbedSnapshot('dedupe_join');
    return pending;
  }

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: getGeminiEmbeddingModel() });
  const task = withEmbeddingThrottle(async () => {
    const res = await embedWithRetry(model, normalizedText);
    const values = res?.embedding?.values;
    if (!values?.length) throw new Error('Empty or missing embedding');
    setCachedEmbedding(cacheKey, values);
    maybeLogEmbedSnapshot('embed_complete');
    return values;
  }).finally(() => {
    _embedPendingByKey.delete(cacheKey);
    maybeLogEmbedSnapshot('task_finished');
  });

  _embedPendingByKey.set(cacheKey, task);
  return task;
}
