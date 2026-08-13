import { randomUUID } from 'crypto';
import { getPool } from './pool.js';
import { getThreadLimitForTier } from '../lib/tier.js';

const maxTurns = parseInt(process.env.MAX_HISTORY_TURNS || '10', 10) || 10;

const DEFAULT_THREAD_TITLES = new Set([
  'conversation',
  'new conversation',
]);

/**
 * @param {string} [title]
 */
export function isDefaultThreadTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  return !normalized || DEFAULT_THREAD_TITLES.has(normalized);
}

/**
 * @param {string} userId
 * @returns {Promise<Array<{ id: string; title: string; created_at: Date; updated_at: Date }>>}
 */
export async function listThreads(userId) {
  const { rows } = await getPool().query(
    `SELECT id, title, created_at, updated_at
     FROM threads WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * @param {string} threadId
 * @param {string} userId
 */
export async function getThreadForUser(threadId, userId) {
  const { rows } = await getPool().query(
    `SELECT id, title, created_at, updated_at FROM threads
     WHERE id = $1 AND user_id = $2`,
    [threadId, userId]
  );
  return rows[0] || null;
}

/**
 * @param {string} userId
 */
export async function countThreads(userId) {
  const { rows } = await getPool().query(
    'SELECT COUNT(*)::int AS count FROM threads WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.count ?? 0;
}

/**
 * @param {string} userId
 * @param {'free' | 'paid'} tier
 * @param {string} [title]
 * @returns {Promise<{ ok: true; thread: object } | { ok: false; error: 'thread_limit'; limit: number }>}
 */
export async function createThread(userId, tier, title = 'New conversation') {
  const limit = getThreadLimitForTier(tier);
  const count = await countThreads(userId);
  if (count >= limit) {
    return { ok: false, error: 'thread_limit', limit };
  }

  const id = randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO threads (id, user_id, title) VALUES ($1, $2, $3)
     RETURNING id, title, created_at, updated_at`,
    [id, userId, title.slice(0, 200)]
  );
  return { ok: true, thread: rows[0] };
}

/**
 * @param {string} threadId
 */
export async function touchThread(threadId) {
  await getPool().query(
    'UPDATE threads SET updated_at = NOW() WHERE id = $1',
    [threadId]
  );
}

/**
 * @param {string} threadId
 * @param {string} userId
 * @param {string} title
 */
export async function updateThreadTitle(threadId, userId, title) {
  const safeTitle = String(title || '').trim().slice(0, 200) || 'Conversation';
  const { rows } = await getPool().query(
    `UPDATE threads SET title = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, title, created_at, updated_at`,
    [threadId, userId, safeTitle]
  );
  return rows[0] || null;
}

/**
 * @param {string} threadId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function deleteThread(threadId, userId) {
  const { rowCount } = await getPool().query(
    'DELETE FROM threads WHERE id = $1 AND user_id = $2',
    [threadId, userId]
  );
  return rowCount > 0;
}

/**
 * @param {string} threadId
 * @returns {Promise<Array<{ role: 'user' | 'assistant'; content: string }>>}
 */
async function fetchAllThreadMessages(threadId) {
  const { rows } = await getPool().query(
    `SELECT role, content, thought_signature, sources
     FROM thread_messages
     WHERE thread_id = $1
     ORDER BY created_at ASC, id ASC`,
    [threadId]
  );
  return rows.map((r) => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.content,
    thoughtSignature: r.thought_signature != null ? String(r.thought_signature) : null,
    sources: normalizeMessageSources(r.sources),
  }));
}

/**
 * Full message history for UI display when a user opens a saved conversation.
 * @param {string} threadId
 * @returns {Promise<Array<{ role: 'user' | 'assistant'; content: string; sources?: Array<{ title: string; url: string; detail: string; access: string }> }>>}
 */
export async function getAllThreadMessages(threadId) {
  const list = await fetchAllThreadMessages(threadId);
  return list.map(({ role, content, sources }) => ({
    role,
    content,
    ...(role === 'assistant' && sources.length ? { sources } : {}),
  }));
}

/**
 * Recent turns only — for LLM context (MAX_HISTORY_TURNS, default 10).
 * Includes thought signatures for Gemini 3.x multi-turn continuity.
 * @param {string} threadId
 * @returns {Promise<Array<{ role: 'user' | 'assistant'; content: string; thoughtSignature?: string | null }>>}
 */
export async function getThreadMessages(threadId) {
  const list = await fetchAllThreadMessages(threadId);
  const maxMessages = maxTurns * 2;
  if (list.length > maxMessages) {
    return list.slice(-maxMessages);
  }
  return list;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ title: string; url: string; detail: string; access: string }>}
 */
function normalizeMessageSources(raw) {
  let data = raw;
  if (!data) return [];
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((s) => ({
      title: String(s?.title || '').trim(),
      url: String(s?.url || '').trim(),
      detail: String(s?.detail || '').trim(),
      access: String(s?.access || '').trim(),
    }))
    .filter((s) => s.title && s.url);
}

/**
 * @param {string} threadId
 * @param {string} userContent
 * @param {string} assistantContent
 * @param {string | null} [thoughtSignature]
 * @param {Array<{ title: string; url: string; detail?: string; access?: string }> | null} [sources]
 */
export async function appendThreadTurn(
  threadId,
  userContent,
  assistantContent,
  thoughtSignature = null,
  sources = null
) {
  const pool = getPool();
  const sourceJson = normalizeMessageSources(sources);
  await pool.query(
    `INSERT INTO thread_messages (thread_id, role, content, thought_signature, sources) VALUES
     ($1, 'user', $2, NULL, NULL),
     ($1, 'assistant', $3, $4, $5::jsonb)`,
    [
      threadId,
      userContent,
      assistantContent,
      thoughtSignature,
      sourceJson.length ? JSON.stringify(sourceJson) : null,
    ]
  );
  await touchThread(threadId);
}

const MAX_SOURCE_EXCERPTS_CHARS = 20000;

/**
 * RAG excerpts from the last teaching turn (used to cite on follow-up asks).
 * @param {string} threadId
 * @returns {Promise<string | null>}
 */
export async function getThreadSourceExcerpts(threadId) {
  try {
    const { rows } = await getPool().query(
      'SELECT last_source_excerpts FROM threads WHERE id = $1',
      [threadId]
    );
    const text = String(rows[0]?.last_source_excerpts || '').trim();
    return text || null;
  } catch (err) {
    console.warn('getThreadSourceExcerpts failed:', err?.message || err);
    return null;
  }
}

/**
 * @param {string} threadId
 * @param {string} excerpts
 */
export async function setThreadSourceExcerpts(threadId, excerpts) {
  const text = String(excerpts || '').trim().slice(0, MAX_SOURCE_EXCERPTS_CHARS);
  if (!text) return;
  try {
    await getPool().query(
      `UPDATE threads SET last_source_excerpts = $2, updated_at = NOW() WHERE id = $1`,
      [threadId, text]
    );
  } catch (err) {
    console.warn('setThreadSourceExcerpts failed:', err?.message || err);
  }
}

/**
 * @param {string} userId
 * @param {'free' | 'paid'} tier
 * @param {string} [preferredThreadId]
 * @returns {Promise<{ ok: true; threadId: string; created: boolean } | { ok: false; error: 'thread_limit'; limit: number }>}
 */
export async function resolveThreadForChat(userId, tier, preferredThreadId) {
  if (preferredThreadId) {
    const existing = await getThreadForUser(preferredThreadId, userId);
    if (existing) {
      return { ok: true, threadId: existing.id, created: false };
    }
  }

  const created = await createThread(userId, tier, 'Conversation');
  if (!created.ok) return created;
  return { ok: true, threadId: created.thread.id, created: true };
}
