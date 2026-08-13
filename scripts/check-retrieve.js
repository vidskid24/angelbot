/**
 * One-off script to inspect what retrieve(query, 7) returns for a given query.
 * Run from repo root: node scripts/check-retrieve.js
 * Requires .env with GEMINI_API_KEY and data/embeddings.json.
 */
import 'dotenv/config';
import { retrieve } from '../src/rag/retrieve.js';

const query = 'How can I keep centered during times of war?';
const result = await retrieve(query, 7);
const text = typeof result === 'string' ? result : String(result?.text || '');
console.log('--- RAG result length (chars) ---');
console.log(text.length);
console.log('--- RAG sources ---');
console.log(typeof result === 'object' ? result.sources : '(legacy string return)');
console.log('--- RAG result (full text) ---');
console.log(text || '(empty string)');
