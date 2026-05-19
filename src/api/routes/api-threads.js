import { Router } from 'express';
import { isDbEnabled } from '../../db/pool.js';
import * as threadDb from '../../db/threads.js';
import { ensureUserTier, getThreadLimitForTier } from '../../lib/tier.js';

export function createThreadsApiRouter() {
  const r = Router();

  r.get('/api/threads', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const tier = req.omiUser.tier || (await ensureUserTier(userId, req.omiUser.email));
      const threads = await threadDb.listThreads(userId);
      res.json({
        threads: threads.map((t) => ({
          id: t.id,
          title: t.title,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
        })),
        tier,
        threadLimit: getThreadLimitForTier(tier),
        threadCount: threads.length,
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/api/threads', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const tier = await ensureUserTier(userId, req.omiUser.email);
      const title = String(req.body?.title || 'New conversation').trim() || 'New conversation';
      const result = await threadDb.createThread(userId, tier, title);
      if (!result.ok) {
        res.status(403).json({
          error: 'thread_limit',
          message: `You can save up to ${result.limit} conversations on your plan.`,
          limit: result.limit,
          tier,
        });
        return;
      }
      res.status(201).json({
        thread: {
          id: result.thread.id,
          title: result.thread.title,
          createdAt: result.thread.created_at,
          updatedAt: result.thread.updated_at,
        },
        tier,
        threadLimit: getThreadLimitForTier(tier),
      });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/api/threads/:threadId', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const threadId = String(req.params.threadId || '').trim();
      const title = String(req.body?.title || '').trim();
      if (!title) {
        res.status(400).json({ error: 'title_required' });
        return;
      }
      const thread = await threadDb.updateThreadTitle(threadId, userId, title);
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' });
        return;
      }
      res.json({
        thread: {
          id: thread.id,
          title: thread.title,
          createdAt: thread.created_at,
          updatedAt: thread.updated_at,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/api/threads/:threadId', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const threadId = String(req.params.threadId || '').trim();
      const removed = await threadDb.deleteThread(threadId, userId);
      if (!removed) {
        res.status(404).json({ error: 'thread_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/api/threads/:threadId', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const threadId = String(req.params.threadId || '').trim();
      const thread = await threadDb.getThreadForUser(threadId, userId);
      if (!thread) {
        res.status(404).json({ error: 'thread_not_found' });
        return;
      }
      const messages = await threadDb.getThreadMessages(threadId);
      res.json({
        thread: {
          id: thread.id,
          title: thread.title,
          createdAt: thread.created_at,
          updatedAt: thread.updated_at,
        },
        messages,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
