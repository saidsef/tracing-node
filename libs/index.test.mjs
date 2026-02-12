// index.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('setupTracing', () => {
  // Clear environment before each test
  beforeEach(() => {
    delete process.env.SERVICE_NAME;
    delete process.env.ENDPOINT;
    delete process.env.HOSTNAME;
    delete process.env.CONTAINER_NAME;
  });

  it('should throw error when serviceName is not provided', async () => {
    const { setupTracing } = await import('./index.mjs');
    assert.throws(() => {
      setupTracing({ url: 'http://localhost:4317' });
    }, /serviceName is required/);
  });

  it('should throw error when url is not provided', async () => {
    const { setupTracing } = await import('./index.mjs');
    assert.throws(() => {
      setupTracing({ serviceName: 'test-service' });
    }, /url is required/);
  });

  it('should create a tracer with required parameters', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should accept hostname parameter', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      hostname: 'test-host',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should accept optional instrumentations', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enableFsInstrumentation: true,
      enableDnsInstrumentation: true,
    });
    assert.ok(tracer, 'tracer should be defined');
  });
});
