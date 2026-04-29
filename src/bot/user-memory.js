/**
 * Platform-agnostic per-user persistent memory (saved context / "hold this space").
 * Keys by userId (string); persistence to data/user-memories.json.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MEMORIES_PATH = join(ROOT, 'data', 'user-memories.json');

const MAX_MEMORIES_PER_USER = parseInt(process.env.MAX_MEMORIES_PER_USER || '30', 10) || 30;

/** @typedef {{ id: string; name: string; content: string; createdAt: number }} UserMemory */
/** @typedef {{ added: true; memory: UserMemory; overwroteOldest?: boolean }} AddMemorySuccess */
/** @typedef {{ added: false; atLimit: true; count: number }} AddMemoryAtLimit */

/**
 * @returns {Promise<Record<string, { memories: UserMemory[] }>>}
 */
async function loadStore() {
  try {
    const raw = await readFile(MEMORIES_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function saveStore(store) {
  await mkdir(pathDirname(MEMORIES_PATH), { recursive: true });
  await writeFile(MEMORIES_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Get all saved memories for a user.
 * @param {string} userId
 * @returns {Promise<UserMemory[]>}
 */
export async function getMemories(userId) {
  const store = await loadStore();
  const user = store[userId];
  if (!user || !Array.isArray(user.memories)) return [];
  return [...user.memories];
}

/**
 * Remove the oldest memory (by createdAt) for a user. Used when at limit and overwriteOldest is true.
 * @param {string} userId
 * @returns {Promise<boolean>} true if one was removed
 */
export async function deleteOldestMemory(userId) {
  const store = await loadStore();
  const user = store[userId];
  if (!user || !Array.isArray(user.memories) || user.memories.length === 0) return false;
  const sorted = [...user.memories].sort((a, b) => a.createdAt - b.createdAt);
  const oldest = sorted[0];
  user.memories = user.memories.filter((m) => m.id !== oldest.id);
  await saveStore(store);
  return true;
}

/**
 * Add a memory for a user. Enforces MAX_MEMORIES_PER_USER; when at limit, returns atLimit or overwrites oldest if requested.
 * @param {string} userId
 * @param {string} name
 * @param {string} content
 * @param {{ overwriteOldest?: boolean }} [options]
 * @returns {Promise<AddMemorySuccess | AddMemoryAtLimit>}
 */
export async function addMemory(userId, name, content, options = {}) {
  const store = await loadStore();
  if (!store[userId]) store[userId] = { memories: [] };
  const list = store[userId].memories;
  const atLimit = list.length >= MAX_MEMORIES_PER_USER;

  if (atLimit && options.overwriteOldest) {
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    const oldestId = sorted[0].id;
    store[userId].memories = list.filter((m) => m.id !== oldestId);
  } else if (atLimit) {
    return { added: false, atLimit: true, count: MAX_MEMORIES_PER_USER };
  }

  const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const mem = { id, name: String(name).trim(), content: String(content).trim(), createdAt: Date.now() };
  store[userId].memories.push(mem);
  await saveStore(store);
  return { added: true, memory: mem, overwroteOldest: atLimit && options.overwriteOldest };
}

/**
 * Remove a memory by id for a user.
 * @param {string} userId
 * @param {string} memoryId
 * @returns {Promise<boolean>} true if removed
 */
export async function deleteMemory(userId, memoryId) {
  const store = await loadStore();
  const user = store[userId];
  if (!user || !Array.isArray(user.memories)) return false;
  const before = user.memories.length;
  user.memories = user.memories.filter((m) => m.id !== memoryId);
  if (user.memories.length === before) return false;
  await saveStore(store);
  return true;
}

/**
 * Delete a memory by name (first match) for a user.
 * @param {string} userId
 * @param {string} name
 * @returns {Promise<boolean>} true if removed
 */
export async function deleteMemoryByName(userId, name) {
  const store = await loadStore();
  const user = store[userId];
  if (!user || !Array.isArray(user.memories)) return false;
  const normalized = String(name).trim().toLowerCase();
  const idx = user.memories.findIndex((m) => m.name.trim().toLowerCase() === normalized);
  if (idx === -1) return false;
  user.memories.splice(idx, 1);
  await saveStore(store);
  return true;
}
