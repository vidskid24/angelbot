import { randomUUID } from 'crypto';
import { getPool } from './pool.js';
import { getThreadLimitForTier } from '../lib/tier.js';

const maxTurns = parseInt(process.env.MAX_HISTORY_TURNS || '10', 10) || 10;

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
export async function getThreadMessages(threadId) {
  const { rows } = await getPool().query(
    `SELECT role, content FROM thread_messages
     WHERE thread_id = $1
     ORDER BY created_at ASC`,
    [threadId]
  );
  const list = rows.map((r) => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.content,
  }));
  const maxMessages = maxTurns * 2;
  if (list.length > maxMessages) {
    return list.slice(-maxMessages);
  }
  return list;
}

/**
 * @param {string} threadId
 * @param {string} userContent
 * @param {string} assistantContent
 */
export async function appendThreadTurn(threadId, userContent, assistantContent) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO thread_messages (thread_id, role, content) VALUES
     ($1, 'user', $2),
     ($1, 'assistant', $3)`,
    [threadId, userContent, assistantContent]
  );
  await touchThread(threadId);
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
