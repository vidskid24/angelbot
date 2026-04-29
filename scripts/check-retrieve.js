/**
 * One-off script to inspect what retrieve(query, 7) returns for a given query.
 * Run from repo root: node scripts/check-retrieve.js
 * Requires .env with GEMINI_API_KEY and data/embeddings.json.
 */
import 'dotenv/config';
import { retrieve } from '../src/rag/retrieve.js';

const query = 'How can I keep centered during times of war?';
const result = await retrieve(query, 7);
console.log('--- RAG result length (chars) ---');
console.log(result?.length ?? 0);
console.log('--- RAG result (full text) ---');
console.log(result || '(empty string)');
