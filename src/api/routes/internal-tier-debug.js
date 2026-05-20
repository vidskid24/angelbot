import { Router } from 'express';
import { isDbEnabled } from '../../db/pool.js';
import * as users from '../../db/users.js';
import { diagnoseThinkificTier } from '../../lib/thinkific-enrollment.js';
import { ensureUserTier, getEnvTierOverride, resolveUserTier } from '../../lib/tier.js';

function getCronSecret() {
  return String(process.env.OMIBOT_CRON_SECRET || process.env.ANGELBOT_CRON_SECRET || '').trim();
}

export function createInternalTierDebugRouter() {
  const r = Router();

  /**
   * Tier troubleshooting for a Thinkific user (requires x-cron-secret).
   * GET /internal/tier-debug?user_id=123&email=user@example.com
   */
  r.get('/internal/tier-debug', async (req, res, next) => {
    try {
      const secret = getCronSecret();
      if (!secret) {
        res.status(503).json({ error: 'cron_not_configured' });
        return;
      }
      const provided =
        String(req.headers['x-cron-secret'] || req.headers['authorization'] || '')
          .replace(/^Bearer\s+/i, '')
          .trim() || String(req.query?.secret || '').trim();
      if (provided !== secret) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const userId = String(req.query?.user_id || req.query?.userId || '').trim();
      const email = req.query?.email ? String(req.query.email).trim().toLowerCase() : undefined;
      if (!userId) {
        res.status(400).json({ error: 'user_id_required' });
        return;
      }

      const envTierOverride = getEnvTierOverride(userId, email);
      const thinkific = await diagnoseThinkificTier(userId, email);
      const resolvedTier = await resolveUserTier(userId, email);
      const forcedTier = await ensureUserTier(userId, email, { force: true });
      const cachedTier = await ensureUserTier(userId, email);

      let dbTier = null;
      let dbTierCheckedAt = null;
      if (isDbEnabled()) {
        const profile = await users.getUserProfile(userId);
        dbTier = profile?.tier || null;
        dbTierCheckedAt = profile?.tier_checked_at || null;
      }

      res.json({
        userId,
        email: email || null,
        envTierOverride,
        resolvedTier,
        forcedTierAfterRefresh: forcedTier,
        tierReturnedByApi: cachedTier,
        dbTier,
        dbTierCheckedAt,
        thinkific,
        nextSteps: buildNextSteps({ thinkific, resolvedTier, forcedTier, userId, envTierOverride }),
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

/**
 * @param {{ thinkific: object; resolvedTier: string; forcedTier: string; userId: string }} ctx
 */
function buildNextSteps(ctx) {
  const steps = [];
  const { thinkific, resolvedTier, forcedTier, userId, envTierOverride } = ctx;

  if (envTierOverride === 'paid') {
    steps.push('OMIBOT_PAID_USER_IDS or OMIBOT_FORCE_TIER is active — user should be paid after redeploy and refresh.');
  } else if (envTierOverride === 'free') {
    steps.push('OMIBOT_FORCE_TIER=free is forcing free — remove it on Render.');
  }

  if (!thinkific.thinkificConfigured) {
    steps.push('Add THINKIFIC_API_KEY (API Access Token) and THINKIFIC_PAID_PRODUCT_IDS on Render, then redeploy.');
  } else if (thinkific.thinkificApiProbeOk === false) {
    steps.push(
      'Thinkific API token is set but auth failed — use API Access Token (Bearer), not SSO Signing Secret; redeploy after updating THINKIFIC_API_KEY.'
    );
  }
  if (!thinkific.userIdUsableForThinkific) {
    steps.push(
      'Ensure Thinkific footer sets OMIBOT_USER.external_id to String(Thinkific.current_user.id), not email-only.'
    );
  }
  if (thinkific.matchedPaidEnrollment && resolvedTier !== 'paid') {
    steps.push('Thinkific match works but tier is still free — check OMIBOT_FORCE_TIER=free or OMIBOT_PAID_USER_IDS overrides.');
  }
  if (!thinkific.matchedPaidEnrollment && thinkific.enrollmentCount > 0) {
    steps.push('Update THINKIFIC_PAID_PRODUCT_IDS to match course_name/product_name from enrollments in this response.');
  }
  if (!thinkific.matchedPaidEnrollment && thinkific.enrollmentCount === 0) {
    steps.push('Confirm the user has an active enrollment in Thinkific for a paid product.');
  }
  if (resolvedTier === 'paid' || forcedTier === 'paid') {
    steps.push('Server tier is paid — hard-refresh the chat page (clears session token) so bootstrap issues a new JWT.');
  } else {
    steps.push(`Temporary test: set OMIBOT_PAID_USER_IDS=${userId} on Render to confirm the rest of the stack shows PAID.`);
  }
  return steps;
}
