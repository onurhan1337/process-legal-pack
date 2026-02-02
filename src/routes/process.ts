import { Response, NextFunction } from 'express';
import { ProcessRequest, ProcessResponse } from '../types/job';
import { createJob, processJob } from '../workers/job-processor';
import { logger } from '../utils/logger';
import { BillingRequest } from '../middleware/billing';
import { consumeCredit, consumeTrialCredit, consumeUsage } from '../services/billing';

export async function processRoute(
  req: BillingRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { reportId, userId, url } = req.body as ProcessRequest;
    
    if (!reportId || !userId) {
      res.status(400).json({
        error: 'Missing required fields: reportId and userId are required',
      });
      return;
    }

    const userAccess = req.userAccess;

    if (userAccess?.isTrial && !userAccess?.isUnlimited) {
      const creditConsumed = await consumeTrialCredit(userId, reportId);
      if (!creditConsumed) {
        res.status(402).json({
          error: 'Failed to consume trial credit',
          code: 'TRIAL_CREDIT_CONSUMPTION_FAILED',
        });
        return;
      }
      logger.info('Trial credit consumed for report processing', {
        userId,
        reportId,
        creditsRemaining: (userAccess.creditsRemaining || 1) - 1,
      });
    } else if (userAccess?.isUnlimited) {
      logger.info('Unlimited plan - no credit consumption needed', {
        userId,
        reportId,
        planId: userAccess.planId,
      });
    } else if (userAccess && userAccess.usageLimit > 0 && !userAccess.isTrial) {
      const usageConsumed = await consumeUsage(userId, reportId);
      if (!usageConsumed) {
        res.status(402).json({
          error: 'Failed to consume usage',
          code: 'USAGE_CONSUMPTION_FAILED',
        });
        return;
      }
      logger.info('Usage consumed for report processing', {
        userId,
        reportId,
        planId: userAccess.planId,
        usageCount: userAccess.usageCount + 1,
        usageLimit: userAccess.usageLimit,
        usageRemaining: userAccess.usageLimit - userAccess.usageCount - 1,
      });
    } else if (req.hasSubscription && req.creditsRemaining && req.creditsRemaining > 0) {
      const creditConsumed = await consumeCredit(userId, reportId);
      if (!creditConsumed) {
        res.status(402).json({
          error: 'Failed to consume credit',
          code: 'CREDIT_CONSUMPTION_FAILED',
        });
        return;
      }
      logger.info('Credit consumed for report processing', {
        userId,
        reportId,
        creditsRemaining: req.creditsRemaining - 1,
      });
    }
    
    const job = createJob(reportId, userId, url);
    
    processJob(job).catch(error => {
      logger.error('Background job processing failed', error, {
        jobId: job.jobId,
        reportId,
      });
    });
    
    const response: ProcessResponse = {
      jobId: job.jobId,
      status: job.status,
      message: 'Job queued for processing',
    };
    
    res.status(202).json(response);
  } catch (error) {
    next(error);
  }
}
