import express, { Request, Response, NextFunction } from 'express';
import { config } from './config/env';
import { logger } from './utils/logger';
import { authMiddleware, AuthenticatedRequest } from './middleware/auth';
import { processRoute } from './routes/process';
import { startJobProcessor, getJob } from './workers/job-processor';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'legal-pack-processor',
  });
});

app.get('/jobs/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  res.json(job);
});

app.post('/process', authMiddleware, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.body.userId && req.body.userId !== req.userId) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'User ID mismatch',
    });
    return;
  }
  
  if (!req.body.userId) {
    req.body.userId = req.userId;
  }
  
  processRoute(req, res, next).catch(next);
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err, {
    path: req.path,
    method: req.method,
  });
  
  const statusCode = (err as { statusCode?: number }).statusCode || 500;
  const message = process.env.NODE_ENV === 'development'
    ? err.message
    : 'Internal Server Error';
  
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    nodeEnv: config.nodeEnv,
    port: PORT,
  });
  
  startJobProcessor();
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
