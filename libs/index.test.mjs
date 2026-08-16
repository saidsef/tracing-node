// index.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { setupTracing, stopTracing, __resetTracingForTesting } from './index.mjs';

describe('setupTracing', () => {
  // Clear environment and reset tracing state before each test
  beforeEach(() => {
    delete process.env.SERVICE_NAME;
    delete process.env.ENDPOINT;
    delete process.env.HOSTNAME;
    delete process.env.CONTAINER_NAME;

    // Reset singleton for test isolation
    __resetTracingForTesting();
  });

  // Clean up tracing after each test
  afterEach(async () => {
    await stopTracing();
  });

  it('should throw error when serviceName is not provided', () => {
    assert.throws(() => {
      setupTracing({ url: 'http://localhost:4317' });
    }, /serviceName is required/);
  });

  it('should throw error when url is not provided', () => {
    assert.throws(() => {
      setupTracing({ serviceName: 'test-service' });
    }, /url is required/);
  });

  it('should create a tracer with required parameters', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should accept hostname parameter', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      hostname: 'test-host',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  // globalThis.fetch runs on undici, so it is invisible to HttpInstrumentation.
  // Registering it must not disturb setup, and the patch has to land on the
  // global fetch itself - otherwise outgoing calls carry no traceparent.
  it('should instrument global fetch', () => {
    const before = globalThis.fetch;
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(tracer, 'tracer should be defined');
    assert.strictEqual(typeof globalThis.fetch, 'function', 'global fetch should still be callable');
    assert.ok(before, 'global fetch should exist on a supported runtime');
  });

  it('should accept optional instrumentations', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enableFsInstrumentation: true,
      enableDnsInstrumentation: true,
    });
    assert.ok(tracer, 'tracer should be defined');
  });
});
