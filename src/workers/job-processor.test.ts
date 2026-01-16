import { test } from 'node:test';
import assert from 'node:assert';
import { createJob, getJob } from './job-processor';

test('createJob should create a job with correct properties', () => {
  const reportId = 'test-report-id';
  const userId = 'test-user-id';
  const url = 'https://example.com';

  const job = createJob(reportId, userId, url);

  assert.strictEqual(job.reportId, reportId);
  assert.strictEqual(job.userId, userId);
  assert.strictEqual(job.url, url);
  assert.strictEqual(job.status, 'pending');
  assert.ok(job.jobId);
  assert.ok(job.createdAt instanceof Date);
  assert.ok(job.updatedAt instanceof Date);
});

test('createJob should create job without URL', () => {
  const job = createJob('report-id', 'user-id');

  assert.strictEqual(job.reportId, 'report-id');
  assert.strictEqual(job.userId, 'user-id');
  assert.strictEqual(job.url, undefined);
});

test('getJob should return job if exists', () => {
  const job = createJob('report-1', 'user-1');
  const retrieved = getJob(job.jobId);

  assert.ok(retrieved);
  assert.strictEqual(retrieved?.jobId, job.jobId);
  assert.strictEqual(retrieved?.reportId, 'report-1');
});

test('getJob should return undefined if job does not exist', () => {
  const retrieved = getJob('non-existent-job-id');
  assert.strictEqual(retrieved, undefined);
});
