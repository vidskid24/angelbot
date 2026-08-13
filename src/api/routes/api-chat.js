import { Router } from 'express';
import { check as rateLimitCheck } from '../../bot/rate-limit.js';
import { formatChatTextHtml } from '../../lib/format-chat-text.js';
import { processWisdomMessage } from '../../services/chat-service.js';
import { isDbEnabled } from '../../db/pool.js';
import * as threadDb from '../../db/threads.js';
import * as dailyMessages from '../../db/daily-messages.js';
import {
  ensureUserTier,
  getDailyMessageLimitForTier,
  getDailyMessageLimitMessage,
  getThreadLimitMessage,
} from '../../lib/tier.js';

export function createChatApiRouter() {
  const r = Router();

  r.post('/api/chat/send', async (req, res, next) => {
    try {
      const userId = req.omiUser.sub;
      if (!rateLimitCheck(userId)) {
        res.status(429).json({
          error: 'rate_limited',
          message: 'You are pausing to breathe-that is wise. When you are ready, try again.',
        });
        return;
      }
      const message = String(req.body?.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'message_required' });
        return;
      }

      const rawThreadId = String(req.body?.threadId || req.body?.sessionId || '').trim();
      let threadId = rawThreadId || undefined;
      let useDb = false;

      if (isDbEnabled()) {
        const tier = await ensureUserTier(userId, req.omiUser.email);
        const dailyLimit = getDailyMessageLimitForTier(tier);
        const dailyCount = await dailyMessages.getDailyMessageCount(userId);
        if (dailyCount >= dailyLimit) {
          res.status(403).json({
            error: 'daily_message_limit',
            message: getDailyMessageLimitMessage(dailyLimit, tier),
            dailyMessageLimit: dailyLimit,
            dailyMessageCount: dailyCount,
            tier,
          });
          return;
        }
        const resolved = await threadDb.resolveThreadForChat(userId, tier, threadId);
        if (!resolved.ok) {
          res.status(403).json({
            error: 'thread_limit',
            message: getThreadLimitMessage(resolved.limit, tier),
            limit: resolved.limit,
            tier,
          });
          return;
        }
        threadId = resolved.threadId;
        useDb = true;
      } else {
        threadId = threadId || 'default';
      }

      const sessionKey = `web:${userId}:${threadId}`;
      const out = await processWisdomMessage({
        userId,
        email: req.omiUser.email,
        sessionKey,
        message,
        threadId: useDb ? threadId : undefined,
        useDb,
      });
      if (!out.ok) {
        res.status(500).json({ error: out.code || 'error', message: out.text });
        return;
      }
      let dailyMessageCount;
      let dailyMessageLimit;
      if (useDb) {
        const tier = await ensureUserTier(userId, req.omiUser.email);
        dailyMessageLimit = getDailyMessageLimitForTier(tier);
        await dailyMessages.incrementDailyMessageCount(userId);
        dailyMessageCount = await dailyMessages.getDailyMessageCount(userId);
      }
      res.json({
        kind: 'reply',
        text: out.assistantReply,
        html: formatChatTextHtml(out.assistantReply),
        sources: Array.isArray(out.sources) ? out.sources : [],
        sessionId: threadId,
        threadId,
        ...(out.threadTitle ? { threadTitle: out.threadTitle } : {}),
        ...(useDb ? { dailyMessageLimit, dailyMessageCount } : {}),
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
