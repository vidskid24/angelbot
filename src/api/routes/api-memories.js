import { Router } from 'express';
import { processRemember, processListMemories, processForget } from '../../services/chat-service.js';

export function createMemoriesApiRouter() {
  const r = Router();

  r.post('/api/memories', async (req, res, next) => {
    try {
      const userId = req.angelUser.sub;
      const content = String(req.body?.content || '').trim();
      if (!content) {
        res.status(400).json({ error: 'content_required' });
        return;
      }
      const nameOption = req.body?.name ? String(req.body.name) : null;
      const replaceOldest = Boolean(req.body?.replaceOldest);
      const out = await processRemember({ userId, content, nameOption, replaceOldest });
      res.json({ text: out.text, atLimit: out.atLimit });
    } catch (e) {
      next(e);
    }
  });

  r.get('/api/memories', async (req, res, next) => {
    try {
      const userId = req.angelUser.sub;
      const out = await processListMemories(userId);
      res.json({ text: out.text });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/api/memories', async (req, res, next) => {
    try {
      const userId = req.angelUser.sub;
      const name = String(req.query.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'name_required' });
        return;
      }
      const out = await processForget(userId, name);
      res.json({ text: out.text });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
