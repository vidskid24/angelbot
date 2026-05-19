import { Router } from 'express';
import { isDbEnabled } from '../../db/pool.js';
import { regenerateUserMemoriesForDate } from '../../jobs/regenerate-user-memory.js';
import { getMemoryCalendarDate } from '../../lib/memory-timezone.js';

function getCronSecret() {
  return String(process.env.OMIBOT_CRON_SECRET || process.env.ANGELBOT_CRON_SECRET || '').trim();
}

export function createInternalJobsRouter() {
  const r = Router();

  r.post('/internal/jobs/regenerate-memory', async (req, res, next) => {
    try {
      const secret = getCronSecret();
      if (!secret) {
        res.status(503).json({ error: 'cron_not_configured' });
        return;
      }
      const provided =
        String(req.headers['x-cron-secret'] || req.headers['authorization'] || '')
          .replace(/^Bearer\s+/i, '')
          .trim() || String(req.body?.secret || '').trim();
      if (provided !== secret) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }

      const calendarDate =
        String(req.body?.date || req.query?.date || '').trim() || getMemoryCalendarDate();
      const result = await regenerateUserMemoriesForDate(calendarDate);
      res.json({ ok: true, calendarDate, ...result });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
