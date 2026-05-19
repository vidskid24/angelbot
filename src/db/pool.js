/**
 * PostgreSQL connection pool (Render Postgres via DATABASE_URL).
 */

import pg from 'pg';

/** @type {pg.Pool | null} */
let pool = null;

export function isDbEnabled() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!isDbEnabled()) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    const ssl =
      process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false };
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10) || 10,
    });
    pool.on('error', (err) => {
      console.error('Postgres pool error:', err);
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function pingDb() {
  if (!isDbEnabled()) return false;
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}
