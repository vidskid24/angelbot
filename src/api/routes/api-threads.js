import { Router } from 'express';
import { isDbEnabled } from '../../db/pool.js';
import * as threadDb from '../../db/threads.js';
import * as dailyMessages from '../../db/daily-messages.js';
import { loadCourseCatalog } from '../../rag/course-catalog.js';
import { listMaterialScopeOptions, resolveMaterialScope } from '../../rag/material-scope.js';
import { listAccessibleLevelCodes } from '../../lib/course-access.js';
import {
  ensureUserTier,
  getDailyMessageLimitForTier,
  getThreadLimitForTier,
  getThreadLimitMessage,
} from '../../lib/tier.js';

function scopePayload(scopeKey, catalog) {
  const resolved = resolveMaterialScope(catalog, scopeKey);
  if (!resolved) return null;
  return { key: resolved.scopeKey, label: resolved.label };
}

export function createThreadsApiRouter() {
  const r = Router();

  r.get('/api/material-scope', async (req, res, next) => {
    try {
      const userId = req.omiUser.sub;
      const tier = await ensureUserTier(userId, req.omiUser.email);
      if (tier !== 'paid') {
        res.json({ courses: [] });
        return;
      }
      const catalog = await loadCourseCatalog();
      const allowed = await listAccessibleLevelCodes(userId, req.omiUser.email, catalog);
      const courses = listMaterialScopeOptions(catalog).filter((course) => allowed.has(course.code));
      res.json({ courses });
    } catch (e) {
      next(e);
    }
  });

  r.get('/api/threads', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const tier = await ensureUserTier(userId, req.omiUser.email);
      const threads = await threadDb.listThreads(userId);
      const dailyMessageLimit = getDailyMessageLimitForTier(tier);
      const dailyMessageCount = await dailyMessages.getDailyMessageCount(userId);
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
        dailyMessageLimit,
        dailyMessageCount,
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
          message: getThreadLimitMessage(result.limit, tier),
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
      const messages = await threadDb.getAllThreadMessages(threadId);
      const tier = await ensureUserTier(userId, req.omiUser.email);
      const sourcesVisible = tier === 'paid';
      const catalog = tier === 'paid' ? await loadCourseCatalog() : null;
      res.json({
        thread: {
          id: thread.id,
          title: thread.title,
          createdAt: thread.created_at,
          updatedAt: thread.updated_at,
          materialScope:
            tier === 'paid' ? scopePayload(thread.material_scope_key, catalog) : null,
        },
        tier: tier === 'paid' ? 'paid' : 'free',
        messages: sourcesVisible
          ? messages
          : messages.map((m) => {
              if (!m || m.role !== 'assistant') return m;
              const { sources, ...rest } = m;
              return rest;
            }),
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
