/**
 * Run style-guide ingestion. Use: npm run ingest (full) or npm run ingest:new (new files only).
 */
import 'dotenv/config';
import { ingest, ingestIncremental } from './ingest.js';

const useNewOnly = process.argv.includes('--new');
const result = useNewOnly ? await ingestIncremental() : await ingest();

if (useNewOnly) {
  if (result.added === 0) {
    console.log('No new files.');
  } else if (result.added !== undefined) {
    console.log(`Ingested ${result.added} new file(s) (${result.chunks} chunks total).`);
  } else {
    console.log('No manifest found; ran full ingest. Ingested chunks:', result.chunks);
  }
} else {
  console.log('Ingested chunks:', result.chunks);
}
