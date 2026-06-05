import { Router } from 'express';
import { isDbEnabled } from '../../db/pool.js';
import * as users from '../../db/users.js';
import { isValidMaExperience, isValidTone } from '../../lib/user-preferences.js';
import { ensureUserTier } from '../../lib/tier.js';
import { shouldSetMemorySummaryEdited } from '../../lib/memory-edit-lock.js';

export function createUserPreferencesApiRouter() {
  const r = Router();

  r.get('/api/user/preferences', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const tier = await ensureUserTier(userId, req.omiUser.email);
      const settings = await users.getUserSettings(userId);
      res.json({ ...settings, tier });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/api/user/preferences', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      const tier = await ensureUserTier(userId, req.omiUser.email);

      const tone = req.body?.tone;
      const maExperience = req.body?.maExperience;
      if (tone != null && !isValidTone(tone)) {
        res.status(400).json({ error: 'invalid_tone' });
        return;
      }
      if (maExperience != null && !isValidMaExperience(maExperience)) {
        res.status(400).json({ error: 'invalid_ma_experience' });
        return;
      }

      const existing = await users.getUserSettings(userId);
      const patch = {
        tone: tone != null ? tone : existing.tone,
        maExperience: maExperience != null ? maExperience : existing.maExperience,
        markCompleted: true,
      };

      if (tier === 'paid') {
        if (req.body?.memoryInstructions !== undefined) {
          patch.memoryInstructions = req.body.memoryInstructions;
        }
        if (req.body?.memorySummary !== undefined) {
          patch.memorySummary = req.body.memorySummary;
          if (shouldSetMemorySummaryEdited(existing.memorySummary, req.body.memorySummary)) {
            patch.memorySummaryEdited = true;
          }
        }
        if (req.body?.memoryAutoUpdateEnabled !== undefined) {
          patch.memoryAutoUpdateEnabled = Boolean(req.body.memoryAutoUpdateEnabled);
        }
      }

      await users.updateUserSettings(userId, patch);
      const settings = await users.getUserSettings(userId);
      res.json({ ...settings, tier });
    } catch (e) {
      next(e);
    }
  });

  r.delete('/api/user/data', async (req, res, next) => {
    try {
      if (!isDbEnabled()) {
        res.status(503).json({ error: 'database_not_configured' });
        return;
      }
      const userId = req.omiUser.sub;
      await users.deleteUserData(userId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
