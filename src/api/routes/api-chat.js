import { Router } from 'express';
import { check as rateLimitCheck } from '../../bot/rate-limit.js';
import { processWisdomMessage } from '../../services/chat-service.js';

export function createChatApiRouter() {
  const r = Router();

  r.post('/api/chat/send', async (req, res, next) => {
    try {
      const userId = req.angelUser.sub;
      if (!rateLimitCheck(userId)) {
        res.status(429).json({
          error: 'rate_limited',
          message: 'You’re pausing to breathe—that’s wise. when you\'re ready, try again.',
        });
        return;
      }
      const message = String(req.body?.message || '').trim();
      if (!message) {
        res.status(400).json({ error: 'message_required' });
        return;
      }
      const sessionKey = String(req.body?.sessionId || `web:${userId}:default`).slice(0, 200);
      const out = await processWisdomMessage({ userId, sessionKey, message });
      if (!out.ok) {
        res.status(500).json({ error: out.code || 'error', message: out.text });
        return;
      }
      if (out.kind === 'memory_saved') {
        res.json({ kind: 'memory_saved', text: out.text });
        return;
      }
      res.json({
        kind: 'reply',
        text: out.displayFull,
        sessionId: sessionKey,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
