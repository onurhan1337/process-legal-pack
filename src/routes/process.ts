import { Request, Response, NextFunction } from 'express';
import { ProcessRequest, ProcessResponse } from '../types/job';
import { createJob, processJob } from '../workers/job-processor';
import { logger } from '../utils/logger';

export async function processRoute(
  req: Request,
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
