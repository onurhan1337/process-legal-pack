import { Request, Response, NextFunction } from 'express';
import { verifySupabaseJWT, extractTokenFromHeader } from '../utils/auth';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    const { userId, email } = verifySupabaseJWT(
      extractTokenFromHeader(authHeader)
    );
    
    req.userId = userId;
    req.userEmail = email;
    
    next();
  } catch (error) {
    logger.warn('Authentication failed', error, { path: req.path });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token',
    });
  }
}
