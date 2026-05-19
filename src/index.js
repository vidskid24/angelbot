/**
 * Omi Bot web API entrypoint.
 */

import 'dotenv/config';
import { runMigrations } from './db/migrate.js';
import { isDbEnabled } from './db/pool.js';
import { startWebServer } from './api/server.js';

async function main() {
  if (isDbEnabled()) {
    await runMigrations();
    console.log('PostgreSQL migrations complete');
  } else {
    console.warn(
      'DATABASE_URL not set — durable threads and chat history are disabled (in-memory fallback)'
    );
  }
  startWebServer();
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});