import { test } from 'node:test';
import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
process.env.SUPABASE_WEBHOOK_URL = 'https://test.supabase.co/webhook';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';

delete require.cache[require.resolve('../../config/env')];
const { extractTokenFromHeader } = require('../../utils/auth');

test('extractTokenFromHeader should extract token from Bearer header', () => {
  const token = extractTokenFromHeader('Bearer test-token-123');
  assert.strictEqual(token, 'test-token-123');
});

test('extractTokenFromHeader should throw on missing header', () => {
  assert.throws(() => {
    extractTokenFromHeader(undefined);
  }, /Missing Authorization header/);
});

test('extractTokenFromHeader should throw on invalid format', () => {
  assert.throws(() => {
    extractTokenFromHeader('Invalid token');
  }, /Invalid Authorization header format/);
});

test('extractTokenFromHeader should handle case insensitive Bearer', () => {
  const token = extractTokenFromHeader('bearer test-token');
  assert.strictEqual(token, 'test-token');
});
