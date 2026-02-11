/**
 * Run style-guide ingestion. Use: npm run ingest
 */
import 'dotenv/config';
import { ingest } from './ingest.js';

const result = await ingest();
console.log('Ingested chunks:', result.chunks);
