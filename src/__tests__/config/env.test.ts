import { test } from 'node:test';
import assert from 'node:assert';

const envPath = require.resolve('../../config/env');

test('config should have required structure', () => {
  const originalEnv = { ...process.env };
  
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.SUPABASE_WEBHOOK_URL = 'https://test.supabase.co/webhook';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.PORT = '3001';
  process.env.NODE_ENV = 'test';

  delete require.cache[envPath];
  const { config } = require('../../config/env');

  assert.strictEqual(config.port, 3001);
  assert.strictEqual(config.nodeEnv, 'test');
  assert.strictEqual(config.supabase.url, 'https://test.supabase.co');
  assert.strictEqual(config.openai.apiKey, 'test-openai-key');
  assert.strictEqual(config.webhook.secret, 'test-webhook-secret');

  Object.assign(process.env, originalEnv);
  delete require.cache[envPath];
});

test('config should throw on missing required env var', () => {
  const originalEnv = { ...process.env };
  const originalSupabaseUrl = process.env.SUPABASE_URL;

  // A local .env file would put the variable straight back when the config
  // module re-runs dotenv.config(), so stub dotenv out for this test.
  const dotenvPath = require.resolve('dotenv');
  const originalDotenv = require.cache[dotenvPath];
  require.cache[dotenvPath] = {
    ...(originalDotenv as NodeModule),
    exports: { config: () => ({ parsed: {} }) },
  } as NodeModule;

  delete process.env.SUPABASE_URL;
  delete require.cache[envPath];

  assert.throws(() => {
    require('../../config/env');
  }, /Missing required environment variable: SUPABASE_URL/);

  if (originalDotenv) {
    require.cache[dotenvPath] = originalDotenv;
  } else {
    delete require.cache[dotenvPath];
  }

  Object.assign(process.env, originalEnv);
  if (originalSupabaseUrl) {
    process.env.SUPABASE_URL = originalSupabaseUrl;
  }
  delete require.cache[envPath];
});
