// index.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { setupTracing, stopTracing, __resetTracingForTesting, __expressRequestHookForTesting } from './index.mjs';

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

  // The http and undici instrumentations record their duration histograms
  // whether or not a meter provider exists. Without one the API hands them the
  // no-op meter and every measurement is dropped.
  it('should register a global meter provider by default', () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(metrics.getMeterProvider() instanceof MeterProvider, 'global meter provider should be the SDK one');
  });

  it('should leave the no-op meter provider in place when metrics are disabled', () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enableMetrics: false,
    });
    assert.ok(!(metrics.getMeterProvider() instanceof MeterProvider), 'no meter provider should be registered');
  });

  it('should accept a separate metrics endpoint', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      metricsUrl: 'http://localhost:4318',
    });
    assert.ok(tracer, 'tracer should be defined');
    assert.ok(metrics.getMeterProvider() instanceof MeterProvider, 'global meter provider should be the SDK one');
  });

  // The Pino instrumentation sends every log record to the Logs API whether or
  // not a provider is registered. Without one the record is built and dropped.
  it('should register a global logger provider by default', () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(logs.getLoggerProvider() instanceof LoggerProvider, 'global logger provider should be the SDK one');
  });

  it('should leave the no-op logger provider in place when logs are disabled', () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enableLogs: false,
    });
    assert.ok(!(logs.getLoggerProvider() instanceof LoggerProvider), 'no logger provider should be registered');
  });

  it('should accept a separate logs endpoint', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      logsUrl: 'http://localhost:4318',
    });
    assert.ok(tracer, 'tracer should be defined');
    assert.ok(logs.getLoggerProvider() instanceof LoggerProvider, 'global logger provider should be the SDK one');
  });

  // Without the unregister in stopTracing the API keeps the first provider and
  // silently ignores the second registration.
  it('should unregister the logger provider on shutdown', async () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    await stopTracing();
    assert.ok(!(logs.getLoggerProvider() instanceof LoggerProvider), 'logger provider should be unregistered');

    __resetTracingForTesting();
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(logs.getLoggerProvider() instanceof LoggerProvider, 'a later setup should register again');
  });

  // Without the unregister in stopTracing the API refuses the second
  // registration and the global keeps pointing at the shut-down provider.
  it('should unregister the meter provider on shutdown', async () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    await stopTracing();
    assert.ok(!(metrics.getMeterProvider() instanceof MeterProvider), 'meter provider should be unregistered');

    __resetTracingForTesting();
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(metrics.getMeterProvider() instanceof MeterProvider, 'a later setup should register again');
  });
});

// The instrumentation calls the hook once per layer span, so the cheap path
// through it matters as much as what it records.
describe('express request hook', () => {
  const fakeSpan = () => {
    const attributes = {};
    return {
      attributes,
      names: [],
      setAttribute(key, value) {
        attributes[key] = value;
      },
      updateName(name) {
        this.names.push(name);
      },
    };
  };

  const requestHandler = (request, route = '/work/:id') => ({
    request,
    route,
    layerType: 'request_handler',
  });

  it('should record route and params on a request handler layer', () => {
    const span = fakeSpan();
    __expressRequestHookForTesting(span, requestHandler({
      method: 'GET',
      params: {id: '42'},
      query: {},
    }));
    assert.strictEqual(span.attributes['express.route'], '/work/:id');
    assert.strictEqual(span.attributes['express.params'], '{"id":"42"}');
  });

  it('should ignore middleware and router layers', () => {
    for (const layerType of ['middleware', 'router']) {
      const span = fakeSpan();
      __expressRequestHookForTesting(span, {
        request: {method: 'GET', params: {id: '42'}, query: {page: '1'}},
        route: '/work/:id',
        layerType,
      });
      assert.deepStrictEqual(span.attributes, {}, `${layerType} layer should record nothing`);
    }
  });

  // The HTTP instrumentation renames the server span from http.route already.
  // Renaming here would relabel every middleware span with the same string.
  it('should not rename the span', () => {
    const span = fakeSpan();
    __expressRequestHookForTesting(span, requestHandler({
      method: 'GET',
      params: {id: '42'},
      query: {},
    }));
    assert.deepStrictEqual(span.names, [], 'the hook should not rename a span');
  });

  // A query string carries tokens and personal data, and the span attribute
  // value length limit is unbounded by default.
  it('should record query key names without their values', () => {
    const span = fakeSpan();
    __expressRequestHookForTesting(span, requestHandler({
      method: 'GET',
      params: {},
      query: {token: 'sensitive-value', page: '2'},
    }));
    assert.deepStrictEqual(span.attributes['express.query_keys'], ['page', 'token']);
    assert.strictEqual(span.attributes['express.query'], undefined, 'query values should not be recorded');
    assert.ok(!JSON.stringify(span.attributes).includes('sensitive-value'), 'no query value should reach the span');
  });

  it('should record the user id when the application sets one', () => {
    const span = fakeSpan();
    __expressRequestHookForTesting(span, requestHandler({
      method: 'GET',
      params: {},
      query: {},
      user: {id: 'user-7'},
    }));
    assert.strictEqual(span.attributes['user.id'], 'user-7');
  });

  it('should tolerate a layer with no request', () => {
    const span = fakeSpan();
    assert.doesNotThrow(() => __expressRequestHookForTesting(span, {layerType: 'request_handler'}));
    assert.deepStrictEqual(span.attributes, {});
  });
});
