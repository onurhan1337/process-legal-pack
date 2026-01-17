import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { logger } from './logger';

const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

export async function verifySupabaseJWT(token: string): Promise<{
  userId: string;
  email?: string;
}> {
  try {
    const cleanToken = token.replace(/^Bearer\s+/i, '');
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(cleanToken);
    
    if (error || !user) {
      throw new Error(`Invalid or expired token: ${error?.message || 'User not found'}`);
    }
    
    return {
      userId: user.id,
      email: user.email,
    };
  } catch (error) {
    logger.error('JWT verification failed', error);
    if (error instanceof Error) {
      throw error;
    }
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
