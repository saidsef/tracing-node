// index.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { metrics, trace } from '@opentelemetry/api';

describe('setupTracing', () => {
  let stopTracing;

  // Clear environment and reset tracing state before each test
  beforeEach(async () => {
    delete process.env.SERVICE_NAME;
    delete process.env.ENDPOINT;
    delete process.env.HOSTNAME;
    delete process.env.CONTAINER_NAME;
    delete process.env.OTEL_SDK_DISABLED;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
    delete process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;
    delete process.env.OTEL_TRACES_SAMPLER;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;

    // Import and store stopTracing for cleanup
    const tracing = await import('./index.mjs');
    stopTracing = tracing.stopTracing;

    // Reset singleton for test isolation
    tracing.__resetTracingForTesting();
  });

  // Clean up tracing after each test
  afterEach(async () => {
    if (stopTracing) {
      await stopTracing();
    }
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

  it('should accept samplingRatio option', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      samplingRatio: 0.1,
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should throw on invalid samplingRatio', async () => {
    const { setupTracing } = await import('./index.mjs');
    assert.throws(() => {
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        samplingRatio: 1.5,
      });
    }, /samplingRatio must be a number between 0 and 1/);
  });

  it('should accept http/protobuf exporter protocol', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4318/v1/traces',
      exporterProtocol: 'http/protobuf',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should throw on invalid exporterProtocol', async () => {
    const { setupTracing } = await import('./index.mjs');
    assert.throws(() => {
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        exporterProtocol: 'thrift',
      });
    }, /exporterProtocol must be 'grpc' or 'http\/protobuf'/);
  });

  it('should accept enableMetrics: false and skip MeterProvider', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enableMetrics: false,
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should register a global MeterProvider by default (not NoOp)', async () => {
    const { setupTracing } = await import('./index.mjs');
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    const provider = metrics.getMeterProvider();
    assert.ok(provider, 'a global meter provider should be set');
    assert.notStrictEqual(
      provider.constructor.name,
      'NoopMeterProvider',
      'global provider should be the SDK MeterProvider, not the NoOp fallback'
    );
    assert.strictEqual(
      provider.constructor.name,
      'MeterProvider',
      'global provider should be @opentelemetry/sdk-metrics MeterProvider'
    );
  });

  it('should release the global MeterProvider after stopTracing so a subsequent setupTracing can re-register', async () => {
    const { setupTracing } = await import('./index.mjs');
    setupTracing({
      serviceName: 'svc-1',
      url: 'http://localhost:4317',
    });
    const first = metrics.getMeterProvider();
    assert.strictEqual(first.constructor.name, 'MeterProvider');
    await stopTracing();
    assert.strictEqual(
      metrics.getMeterProvider().constructor.name,
      'NoopMeterProvider',
      'after stopTracing the global should be released back to NoOp'
    );
    setupTracing({
      serviceName: 'svc-2',
      url: 'http://localhost:4317',
    });
    const second = metrics.getMeterProvider();
    assert.strictEqual(second.constructor.name, 'MeterProvider', 'a fresh setupTracing should register a new global MeterProvider');
    assert.notStrictEqual(first, second, 'second provider instance should be distinct from the first');
  });

  it('should accept metricsUrl override', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      metricsUrl: 'http://localhost:14317',
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should skip pg instrumentation when explicitly disabled', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      enablePgInstrumentation: false,
    });
    assert.ok(tracer, 'tracer should be defined');
  });

  it('should not crash when auto-detect targets are not installed', async () => {
    const { setupTracing } = await import('./index.mjs');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    assert.ok(tracer, 'tracer should be defined despite pg/mongodb/kafkajs/amqplib/grpc being absent');
  });

  it('should bootstrap via @opentelemetry/sdk-node so tracer.startSpan produces recording spans', async () => {
    const { setupTracing } = await import('./index.mjs');
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('check');
    assert.strictEqual(span.isRecording(), true, 'with NodeSDK wired and sampler at 1.0, spans must be recording');
    span.end();
  });

  it('should release the global tracer provider after stopTracing so subsequent tracers are NoOp until re-init', async () => {
    const { setupTracing } = await import('./index.mjs');
    setupTracing({
      serviceName: 'svc-1',
      url: 'http://localhost:4317',
    });
    const recordingSpan = trace.getTracer('t').startSpan('first');
    assert.strictEqual(recordingSpan.isRecording(), true);
    recordingSpan.end();

    await stopTracing();

    const noopSpan = trace.getTracer('t').startSpan('after-shutdown');
    assert.strictEqual(noopSpan.isRecording(), false, 'after stopTracing, the global proxy must have no delegate so spans are non-recording');
    noopSpan.end();

    setupTracing({
      serviceName: 'svc-2',
      url: 'http://localhost:4317',
    });
    const reinitSpan = trace.getTracer('t').startSpan('second');
    assert.strictEqual(reinitSpan.isRecording(), true, 'a fresh setupTracing must produce recording spans again');
    reinitSpan.end();
  });

  it('should respect enableMetrics: false even when OTEL_METRICS_EXPORTER is set in env', async () => {
    process.env.OTEL_METRICS_EXPORTER = 'otlp';
    try {
      const { setupTracing } = await import('./index.mjs');
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        enableMetrics: false,
      });
      assert.strictEqual(
        metrics.getMeterProvider().constructor.name,
        'NoopMeterProvider',
        'enableMetrics: false must not be overridden by OTEL_METRICS_EXPORTER env'
      );
    } finally {
      delete process.env.OTEL_METRICS_EXPORTER;
    }
  });

  it('should append /v1/traces and /v1/metrics to a bare base URL when exporterProtocol is http/protobuf', async () => {
    const { setupTracing } = await import('./index.mjs');
    const infoLines = [];
    const origInfo = console.info;
    console.info = (msg) => infoLines.push(String(msg));
    try {
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4318',
        exporterProtocol: 'http/protobuf',
      });
    } finally {
      console.info = origInfo;
    }
    const tracesRewrite = infoLines.find((l) => l.includes("traces url 'http://localhost:4318'") && l.includes('http://localhost:4318/v1/traces'));
    const metricsRewrite = infoLines.find((l) => l.includes("metrics url 'http://localhost:4318'") && l.includes('http://localhost:4318/v1/metrics'));
    assert.ok(tracesRewrite, 'expected an info line announcing the trace url rewrite');
    assert.ok(metricsRewrite, 'expected an info line announcing the metrics url rewrite');
    const banner = infoLines.find((l) => l.includes('[@saidsef/tracing-node] started'));
    assert.ok(banner, 'expected the startup banner');
    assert.ok(banner.includes('"traces.url":"http://localhost:4318/v1/traces"'), 'banner must show the rewritten traces url');
    assert.ok(banner.includes('"metrics.url":"http://localhost:4318/v1/metrics"'), 'banner must show the rewritten metrics url');
    assert.ok(banner.includes('"traces.url.rewritten":true'), 'banner must flag that the trace url was rewritten');
  });

  it('should leave http/protobuf URLs untouched when the signal path is already present', async () => {
    const { setupTracing } = await import('./index.mjs');
    const infoLines = [];
    const origInfo = console.info;
    console.info = (msg) => infoLines.push(String(msg));
    try {
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4318/v1/traces',
        metricsUrl: 'http://localhost:4318/v1/metrics',
        exporterProtocol: 'http/protobuf',
      });
    } finally {
      console.info = origInfo;
    }
    const anyRewrite = infoLines.find((l) => l.includes('rewritten to'));
    assert.strictEqual(anyRewrite, undefined, 'no rewrite should happen when the path is already correct');
    const banner = infoLines.find((l) => l.includes('[@saidsef/tracing-node] started'));
    assert.ok(banner.includes('"traces.url.rewritten":false'));
  });

  it('should warn and prefer programmatic serviceName when OTEL_SERVICE_NAME is set in env', async () => {
    process.env.OTEL_SERVICE_NAME = 'hijacked-by-env';
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const { setupTracing } = await import('./index.mjs');
      setupTracing({
        serviceName: 'programmatic-wins',
        url: 'http://localhost:4317',
      });
      const conflictWarning = warnings.find((w) =>
        w.includes("OTEL_SERVICE_NAME='hijacked-by-env'") &&
        w.includes("programmatic serviceName='programmatic-wins'")
      );
      assert.ok(conflictWarning, `expected a console.warn about OTEL_SERVICE_NAME conflict, got: ${warnings.join('\n')}`);
    } finally {
      console.warn = origWarn;
      delete process.env.OTEL_SERVICE_NAME;
    }
  });

  it('should emit a single startup banner line containing the resolved service.name and trace url', async () => {
    const { setupTracing } = await import('./index.mjs');
    const infoLines = [];
    const origInfo = console.info;
    console.info = (msg) => infoLines.push(String(msg));
    try {
      setupTracing({
        serviceName: 'banner-svc',
        url: 'http://localhost:4317',
      });
    } finally {
      console.info = origInfo;
    }
    const banners = infoLines.filter((l) => l.includes('[@saidsef/tracing-node] started'));
    assert.strictEqual(banners.length, 1, 'exactly one startup banner per setupTracing call');
    assert.ok(banners[0].includes('"service.name":"banner-svc"'));
    assert.ok(banners[0].includes('"traces.url":"http://localhost:4317"'));
    assert.ok(banners[0].includes('"otel_env_overrides":[]'));
    assert.ok(banners[0].includes('"exporter.protocol":"grpc"'));
  });

  it('should warn when started via --require without --import (ESM consumers should use --import)', async () => {
    const originalExecArgv = process.execArgv;
    process.execArgv = [...originalExecArgv.filter((a) => !a.includes('--require') && !a.includes('--import')), '--require', './bootstrap.mjs'];
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const { setupTracing } = await import('./index.mjs');
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
      });
      const warn = warnings.find((w) => w.includes('startup uses --require but not --import'));
      assert.ok(warn, `expected a console.warn about degraded startup mode, got: ${warnings.join('\n')}`);
    } finally {
      console.warn = origWarn;
      process.execArgv = originalExecArgv;
    }
  });

  it('should NOT warn about startup mode when --import is used', async () => {
    const originalExecArgv = process.execArgv;
    process.execArgv = [...originalExecArgv.filter((a) => !a.includes('--require') && !a.includes('--import')), '--import', './bootstrap.mjs'];
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const { setupTracing } = await import('./index.mjs');
      setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
      });
      const warn = warnings.find((w) => w.includes('startup uses --require'));
      assert.strictEqual(warn, undefined, '--import should not trigger the startup-mode warning');
    } finally {
      console.warn = origWarn;
      process.execArgv = originalExecArgv;
    }
  });

  it('should register and clean up signal handlers when requested', async () => {
    const { setupTracing } = await import('./index.mjs');
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    const tracer = setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
      installSignalHandlers: true,
    });
    assert.ok(tracer, 'tracer should be defined');
    assert.strictEqual(process.listenerCount('SIGTERM'), beforeSigterm + 1, 'SIGTERM listener should be added');
    assert.strictEqual(process.listenerCount('SIGINT'), beforeSigint + 1, 'SIGINT listener should be added');
    await stopTracing();
    assert.strictEqual(process.listenerCount('SIGTERM'), beforeSigterm, 'SIGTERM listener should be removed');
    assert.strictEqual(process.listenerCount('SIGINT'), beforeSigint, 'SIGINT listener should be removed');
  });
});
