import dotenv from 'dotenv';

dotenv.config();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptionalEnvVar(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

export type LLMProvider = 'openai' | 'kimi';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
  
  supabase: {
    url: getEnvVar('SUPABASE_URL'),
    serviceRoleKey: getEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret: getEnvVar('SUPABASE_JWT_SECRET'),
    webhookUrl: process.env.SUPABASE_WEBHOOK_URL || '',
  },
  
  llm: {
    provider: (process.env.LLM_PROVIDER || 'kimi') as LLMProvider,
    batchSize: parseInt(process.env.LLM_BATCH_SIZE || '5', 10),
    concurrency: parseInt(process.env.LLM_CONCURRENCY || '2', 10),
    useFastModelForKeyFindings: process.env.LLM_USE_FAST_MODEL !== 'false',
  },
  
  openai: {
    apiKey: getEnvVar('OPENAI_API_KEY'),
  },
  
  moonshot: {
    apiKey: process.env.MOONSHOT_API_KEY || '',
  },
  
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY || '',
  },
  
  webhook: {
    secret: process.env.WEBHOOK_SECRET || '',
  },
  
  report: {
    baseUrl: process.env.REPORT_BASE_URL || 'https://app.useasta.com',
  },
  
  stripe: {
    secretKey: getOptionalEnvVar('STRIPE_SECRET_KEY'),
    webhookSecret: getOptionalEnvVar('STRIPE_WEBHOOK_SECRET'),
    priceSingleReport: getOptionalEnvVar('STRIPE_PRICE_SINGLE_REPORT'),
    priceProMonthly: getOptionalEnvVar('STRIPE_PRICE_PRO_MONTHLY'),
    prices: {
      starter: getOptionalEnvVar('STRIPE_PRICE_STARTER_MONTHLY'),
      professional: getOptionalEnvVar('STRIPE_PRICE_PROFESSIONAL_MONTHLY'),
    },
  },
  
  frontend: {
    url: getOptionalEnvVar('FRONTEND_URL', 'https://app.useasta.com'),
  },
} as const;
