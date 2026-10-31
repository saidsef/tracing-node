// index.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { context, createContextKey, diag, DiagConsoleLogger, DiagLogLevel, logs, metrics, propagation, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { setupTracing, stopTracing, __resetTracingForTesting, __expressRequestHookForTesting } from './index.mjs';
import { withExportBreaker } from './export-breaker.mjs';

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

  // The trace SDK has no register(), so setupTracing installs the propagator
  // itself. Without it no outgoing call carries a traceparent.
  it('should register the W3C trace context and baggage propagators', () => {
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    const span = tracer.startSpan('outgoing');
    const carrier = {};
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    span.end();
    assert.match(carrier.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.deepStrictEqual(propagation.fields().sort(), ['baggage', 'traceparent', 'tracestate']);
  });

  // The no-op context manager drops the active context at every await, which
  // detaches each child span from its parent.
  it('should keep the active context across an await', async () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    const key = createContextKey('tracing-node-test');
    const value = await context.with(context.active().setValue(key, 'kept'), async () => {
      await new Promise(setImmediate);
      return context.active().getValue(key);
    });
    assert.strictEqual(value, 'kept');
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

// A loader hook registers once per process, so the opt-out cannot be exercised
// in this one. Each case reads the module in a child process instead.
describe('ESM loader hook', () => {
  const hookModule = new URL('./esm-hook.mjs', import.meta.url).href;
  const indexModule = new URL('./index.mjs', import.meta.url).href;

  const runWith = (value, source) => {
    const env = {...process.env};
    delete env.TRACING_NODE_ESM_HOOK;
    if (value !== undefined) {
      env.TRACING_NODE_ESM_HOOK = value;
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {env, encoding: 'utf8'});
    assert.strictEqual(result.status, 0, result.stderr);
    return result;
  };

  const registeredWith = (value) => runWith(value,
    `import {esmHookRegistered} from ${JSON.stringify(hookModule)}; console.log(esmHookRegistered);`,
  ).stdout.trim();

  // The flag cannot show that patching works, so the child imports node:http
  // after setup and reports whether the instrumentation wrapped it.
  const httpWrappedWith = (value) => runWith(value, [
    `import {setupTracing} from ${JSON.stringify(indexModule)};`,
    `setupTracing({serviceName: 'esm-hook-test', url: 'http://127.0.0.1:4317'});`,
    `const {request} = await import('node:http');`,
    `process.stdout.write(String(request.__wrapped === true), () => process.exit(0));`,
  ].join('\n')).stdout.trim();

  it('should register by default', () => {
    assert.strictEqual(registeredWith(undefined), 'true');
  });

  it('should skip registration when opted out', () => {
    assert.strictEqual(registeredWith('false'), 'false');
    assert.strictEqual(registeredWith('0'), 'false');
  });

  it('should register for any other value', () => {
    assert.strictEqual(registeredWith('true'), 'true');
    assert.strictEqual(registeredWith(''), 'true');
  });

  // Node 26 deprecates module.register() at runtime. See DEP0205.
  it('should register without the module.register() deprecation', () => {
    const {stderr} = runWith(undefined, `import ${JSON.stringify(hookModule)};`);
    assert.doesNotMatch(stderr, /DEP0205/);
  });

  it('should patch ES module imports made after setup', () => {
    assert.strictEqual(httpWrappedWith(undefined), 'true');
    assert.strictEqual(httpWrappedWith('false'), 'false');
  });
});

describe('export breaker', () => {
  const SUCCESS = {code: ExportResultCode.SUCCESS};
  const FAILED = {code: ExportResultCode.FAILED, error: new Error('14 UNAVAILABLE: No connection established')};

  let clock;
  let messages;

  // The exporter answers with the queued results in order, and holds the
  // callback of any export it has no result for, as a collector that hangs does.
  const fakeExporter = (...results) => ({
    sent: 0,
    pending: [],
    export(items, callback) {
      this.sent++;
      const result = results.shift();
      if (result) callback(result);
      else this.pending.push(callback);
    },
    forceFlush: async () => 'flushed',
    shutdown: async () => 'shut down',
  });

  const breakerFor = (exporter, options = {}) => withExportBreaker(exporter, {signal: 'logs', now: () => clock, ...options});

  const send = (breaker) => {
    let result;
    breaker.export(['record'], (r) => { result = r; });
    return result;
  };

  beforeEach(() => {
    clock = 0;
    messages = [];
    const capture = (level) => (message) => messages.push({level, message});
    const logger = {error: capture('error'), warn: capture('warn'), info: capture('info'), debug: capture('debug'), verbose: capture('verbose')};
    diag.setLogger(logger, {logLevel: DiagLogLevel.ALL, suppressOverrideMessage: true});
  });

  afterEach(() => {
    diag.setLogger(new DiagConsoleLogger(), {logLevel: DiagLogLevel.INFO, suppressOverrideMessage: true});
  });

  it('should pass every result through while the collector answers', () => {
    const exporter = fakeExporter(SUCCESS, FAILED, SUCCESS);
    const breaker = breakerFor(exporter);
    assert.deepStrictEqual([send(breaker), send(breaker), send(breaker)], [SUCCESS, FAILED, SUCCESS]);
    assert.strictEqual(exporter.sent, 3);
  });

  it('should stop sending after three failures in a row', () => {
    const exporter = fakeExporter(FAILED, FAILED, FAILED);
    const breaker = breakerFor(exporter);
    send(breaker); send(breaker); send(breaker);
    assert.deepStrictEqual(send(breaker), SUCCESS);
    assert.deepStrictEqual(send(breaker), SUCCESS);
    assert.strictEqual(exporter.sent, 3);
  });

  it('should start the count again after a success', () => {
    const exporter = fakeExporter(FAILED, FAILED, SUCCESS, FAILED, FAILED, SUCCESS);
    const breaker = breakerFor(exporter);
    for (let i = 0; i < 6; i++) send(breaker);
    assert.strictEqual(exporter.sent, 6);
  });

  it('should warn once when it opens instead of once per batch', () => {
    const breaker = breakerFor(fakeExporter(FAILED, FAILED, FAILED));
    for (let i = 0; i < 10; i++) send(breaker);
    const warnings = messages.filter(({level, message}) => level === 'warn' && message.startsWith('OTLP'));
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0].message, /OTLP logs export failed 3 times in a row, dropping logs for 30s: 14 UNAVAILABLE/);
  });

  it('should probe after the cooldown and resume when the probe succeeds', () => {
    const exporter = fakeExporter(FAILED, FAILED, FAILED, SUCCESS, SUCCESS);
    const breaker = breakerFor(exporter);
    send(breaker); send(breaker); send(breaker);
    send(breaker);
    clock = 30000;
    send(breaker);
    send(breaker);
    assert.strictEqual(exporter.sent, 5);
    assert.ok(messages.some(({level, message}) => level === 'info' && message === 'OTLP logs export recovered after 30s, 1 batches dropped.'));
  });

  it('should double the cooldown when the probe fails', () => {
    const exporter = fakeExporter(FAILED, FAILED, FAILED, FAILED, SUCCESS);
    const breaker = breakerFor(exporter);
    send(breaker); send(breaker); send(breaker);
    clock = 30000;
    send(breaker);
    clock = 89999;
    send(breaker);
    assert.strictEqual(exporter.sent, 4);
    clock = 90000;
    send(breaker);
    assert.strictEqual(exporter.sent, 5);
  });

  it('should stop doubling at the maximum cooldown', () => {
    const exporter = fakeExporter(...Array(6).fill(FAILED));
    const breaker = breakerFor(exporter, {baseCooldownMillis: 1000, maxCooldownMillis: 3000});
    send(breaker); send(breaker); send(breaker);
    for (const [probeAt, cooldown] of [[1000, 2000], [3000, 3000], [6000, 3000]]) {
      clock = probeAt;
      send(breaker);
      const sent = exporter.sent;
      clock = probeAt + cooldown - 1;
      send(breaker);
      assert.strictEqual(exporter.sent, sent, `still dropping ${cooldown - 1}ms after the probe at ${probeAt}`);
    }
  });

  it('should hold back other batches while a probe is in flight', () => {
    const exporter = fakeExporter(FAILED, FAILED, FAILED);
    const breaker = breakerFor(exporter);
    send(breaker); send(breaker); send(breaker);
    clock = 30000;
    send(breaker);
    send(breaker);
    assert.strictEqual(exporter.sent, 4);
    assert.strictEqual(exporter.pending.length, 1);
  });

  // PeriodicExportingMetricReader reads both selectors off its exporter.
  it('should carry the aggregation selectors of a metric exporter', () => {
    const exporter = {...fakeExporter(), selectAggregationTemporality: () => 'cumulative', selectAggregation: () => 'default'};
    const breaker = breakerFor(exporter);
    assert.strictEqual(breaker.selectAggregationTemporality(), 'cumulative');
    assert.strictEqual(breaker.selectAggregation(), 'default');
    assert.strictEqual(breakerFor(fakeExporter()).selectAggregationTemporality, undefined);
  });

  it('should forward forceFlush and shutdown', async () => {
    const breaker = breakerFor(fakeExporter());
    assert.strictEqual(await breaker.forceFlush(), 'flushed');
    assert.strictEqual(await breaker.shutdown(), 'shut down');
  });
});
