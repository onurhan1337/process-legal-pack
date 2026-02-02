import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { logger } from '../utils/logger';
import { checkUserAccess, checkReportPaymentStatus, consumeUsage, consumeTrialCredit } from '../services/billing';
import type { UserAccess } from '../types/billing';

export interface BillingRequest extends AuthenticatedRequest {
  hasSubscription?: boolean;
  creditsRemaining?: number;
  userAccess?: UserAccess;
}

export async function billingMiddleware(
  req: BillingRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;
  const reportId = req.body.reportId;

  if (!userId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'User ID not found',
    });
    return;
  }

  try {
    if (reportId) {
      const isPaid = await checkReportPaymentStatus(reportId);
      if (isPaid) {
        logger.info('Report already paid, proceeding', { reportId });
        next();
        return;
      }
    }

    const access = await checkUserAccess(userId);
    req.userAccess = access;
    req.hasSubscription = access.isUnlimited || (access.isTrial && access.hasAccess);
    req.creditsRemaining = access.creditsRemaining;

    if (!access.hasAccess) {
      let errorCode: string;
      let errorMessage: string;

      if (access.planId === 'expired') {
        errorCode = 'TRIAL_EXPIRED';
        errorMessage = 'Trial expired';
      } else if (access.isTrial && access.creditsRemaining <= 0) {
        errorCode = 'TRIAL_CREDITS_EXHAUSTED';
        errorMessage = 'Trial credits exhausted';
      } else {
        errorCode = 'PAYMENT_REQUIRED';
        errorMessage = 'Payment required';
      }

      logger.warn('User access denied', {
        userId,
        errorCode,
        planId: access.planId,
        creditsRemaining: access.creditsRemaining,
      });

      res.status(402).json({
        error: errorMessage,
        code: errorCode,
        creditsRemaining: access.creditsRemaining,
        trialEndsAt: access.trialEndsAt,
        planId: access.planId,
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Billing validation error', error);
    res.status(500).json({
      error: 'Failed to validate billing status',
    });
  }
}

export async function optionalBillingCheck(
  req: BillingRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;

  if (!userId) {
    next();
    return;
  }

  try {
    const access = await checkUserAccess(userId);
    req.userAccess = access;
    req.hasSubscription = access.isUnlimited || (access.isTrial && access.hasAccess);
    req.creditsRemaining = access.creditsRemaining;

    next();
  } catch {
    next();
  }
}

export async function consumeUserCredit(
  userId: string,
  reportId: string,
  isTrial: boolean
): Promise<boolean> {
  try {
    if (isTrial) {
      return await consumeTrialCredit(userId, reportId);
    }
    return await consumeUsage(userId, reportId);
  } catch (error) {
    logger.error('Failed to consume user credit', error, { userId, reportId, isTrial });
    return false;
  }
}
