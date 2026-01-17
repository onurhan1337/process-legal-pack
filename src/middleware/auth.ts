import { Request, Response, NextFunction } from 'express';
import { verifySupabaseJWT, extractTokenFromHeader } from '../utils/auth';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const { userId, email } = await verifySupabaseJWT(
      extractTokenFromHeader(authHeader)
    );
    
    req.userId = userId;
    req.userEmail = email;
    
    next();
  } catch (error) {
    logger.warn('Authentication failed', error, { path: req.path });
    
    if (!res.headersSent) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing authentication token',
      });
      return;
    } else {
      logger.error('Authentication failed but headers already sent - blocking request', { 
        path: req.path,
        message: 'Request handler will not proceed due to authentication failure'
      });
      return;
    }
  }
}
