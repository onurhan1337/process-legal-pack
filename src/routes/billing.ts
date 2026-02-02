import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
  checkUserAccess,
  getPlans,
  getCustomer,
  getActiveSubscription,
  initializeUserTrial,
  calculateUsageInfo,
} from '../services/billing';
import { logger } from '../utils/logger';

const router = Router();

router.get(
  '/status',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const [access, customer, subscription] = await Promise.all([
        checkUserAccess(userId),
        getCustomer(userId),
        getActiveSubscription(userId),
      ]);

      const trial = access.isTrial && customer ? {
        endsAt: customer.trial_ends_at,
        usageCount: customer.trial_usage_count ?? 0,
        usageLimit: customer.trial_usage_limit ?? 3,
        usageRemaining: access.creditsRemaining,
        daysRemaining: customer.trial_ends_at
          ? Math.max(0, Math.ceil((new Date(customer.trial_ends_at).getTime() - Date.now()) / 86400000))
          : 0,
      } : null;

      const usage = calculateUsageInfo(access);

      res.json({
        access: {
          hasAccess: access.hasAccess,
          isTrial: access.isTrial,
          isUnlimited: access.isUnlimited,
          creditsRemaining: access.creditsRemaining,
          planId: access.planId,
          trialEndsAt: access.trialEndsAt?.toISOString() || null,
          usageCount: access.usageCount,
          usageLimit: access.usageLimit,
          periodEndsAt: access.periodEndsAt?.toISOString() || null,
        },
        trial,
        subscription: subscription ? {
          id: subscription.id,
          status: subscription.status,
          planId: subscription.plan_id,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          canceledAt: subscription.canceled_at ?? null,
          usageCount: subscription.usage_count ?? 0,
          usageLimit: subscription.usage_limit ?? null,
        } : null,
        usage,
      });
    } catch (error) {
      logger.error('Failed to get billing status', error);
      res.status(500).json({
        error: 'Failed to get billing status',
      });
    }
  }
);

router.get('/plans', async (_req, res: Response) => {
  try {
    const plans = await getPlans();
    const filteredPlans = plans.filter(p => p.id !== 'trial');
    res.json({ plans: filteredPlans });
  } catch (error) {
    logger.error('Failed to fetch plans', error);
    res.status(500).json({
      error: 'Failed to fetch plans',
    });
  }
});

router.post(
  '/initialize-trial',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      await initializeUserTrial(userId);

      const access = await checkUserAccess(userId);

      res.json({
        success: true,
        access: {
          hasAccess: access.hasAccess,
          isTrial: access.isTrial,
          isUnlimited: access.isUnlimited,
          creditsRemaining: access.creditsRemaining,
          planId: access.planId,
          trialEndsAt: access.trialEndsAt?.toISOString() || null,
        },
      });
    } catch (error) {
      logger.error('Failed to initialize trial', error);
      res.status(500).json({
        error: 'Failed to initialize trial',
      });
    }
  }
);

export default router;
