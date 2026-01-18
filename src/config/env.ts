import dotenv from 'dotenv';

dotenv.config();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  supabase: {
    url: getEnvVar('SUPABASE_URL'),
    serviceRoleKey: getEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret: getEnvVar('SUPABASE_JWT_SECRET'),
    webhookUrl: process.env.SUPABASE_WEBHOOK_URL || '',
  },
  
  openai: {
    apiKey: getEnvVar('OPENAI_API_KEY'),
  },
  
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY || '',
  },
  
  webhook: {
    secret: process.env.WEBHOOK_SECRET || '',
  },
} as const;
