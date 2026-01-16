import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { logger } from './logger';

export interface JWTPayload {
  sub: string;
  email?: string;
  aud?: string;
  role?: string;
  [key: string]: unknown;
}

export function verifySupabaseJWT(token: string): {
  userId: string;
  email?: string;
} {
  try {
    const cleanToken = token.replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(cleanToken, config.supabase.jwtSecret) as JWTPayload;
    
    if (!decoded.sub) {
      throw new Error('Invalid token: missing subject');
    }
    
    return {
      userId: decoded.sub,
      email: decoded.email,
    };
  } catch (error) {
    logger.error('JWT verification failed', error);
    throw new Error('Invalid or expired token');
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }
  
  const bearerPrefix = 'Bearer ';
  if (!authHeader.toLowerCase().startsWith(bearerPrefix.toLowerCase())) {
    throw new Error('Invalid Authorization header format');
  }
  
  return authHeader.substring(bearerPrefix.length);
}
