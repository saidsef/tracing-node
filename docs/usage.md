# Configuration

## Installation

```shell
npm install @saidsef/tracing-node --save
```

The package is ESM only and declares `"type": "module"`. It needs Node 24.0.0 or later.

## Initialisation order

Instrumentation patches modules as they load, which puts a hard constraint on when `setupTracing` runs: before the application requires or imports the libraries being traced. Call it after Express or IORedis has loaded and those modules stay unpatched. They produce no spans.

Each module system is patched by a different mechanism. `require-in-the-middle` handles a CommonJS module as each `require` runs. An ES module needs a loader hook, which this library registers on first import. That hook reaches only the modules loaded after it. Node loads a whole module graph before evaluating any of it, so an instrumented package imported statically alongside the library has already loaded by the time the hook registers.

### Preload

```javascript
// instrument.mjs
import {setupTracing} from '@saidsef/tracing-node';

setupTracing();
```

```shell
node --import ./instrument.mjs ./app.mjs
```

`--import` runs the module to completion before the application entry point loads, covering both module systems. This is the recommended form. The [end to end harness](testing.md#end-to-end-harness) uses it.

### Dynamic import

Where a preload is impractical, the entry point imports the library statically and the application dynamically. The application then loads with the hook already in place.

```javascript
import {setupTracing} from '@saidsef/tracing-node';

setupTracing({serviceName: 'my-service', url: 'http://alloy:4317'});

const {default: app} = await import('./app.mjs');
```

Static imports in a single file never work for this, whatever order they are written in.

```javascript
import {setupTracing} from '@saidsef/tracing-node';
import express from 'express'; // loaded before the hook registers, so never patched
```

### ESM loader hook

The hook is `import-in-the-middle`, registered ahead of every instrumentation when the library is imported. Set `TRACING_NODE_ESM_HOOK` to `false` or `0` to skip registration. That suits an application registering `import-in-the-middle` itself, through `@opentelemetry/auto-instrumentations-node/register` for instance, where registering the hook twice risks patching a module twice.

A registration failure becomes a warning on the diagnostic logger. CommonJS patching carries on working.

## Options

```javascript
setupTracing({
  hostname: 'pod-abc123',
  serviceName: 'my-service',
  url: 'http://alloy:4317',
  concurrencyLimit: 10,
  enableFsInstrumentation: false,
  enableDnsInstrumentation: false,
  enableMetrics: true,
  metricsUrl: 'http://alloy:4317',
  metricExportIntervalMillis: 60000,
  enableLogs: true,
  logsUrl: 'http://alloy:4317',
});
```

| Option | Type | Description | Required | Default |
|--------|------|-------------|----------|---------|
| `hostname` | string | Container or pod hostname, recorded as `container.name` | No | `CONTAINER_NAME`, then `HOSTNAME` |
| `serviceName` | string | Service name, recorded as `service.name` | Yes | `SERVICE_NAME` |
| `url` | string | Collector endpoint, `<scheme>://<host>:<port>` | Yes | `ENDPOINT` |
| `concurrencyLimit` | number | Concurrent exports the exporter allows | No | `10` |
| `enableFsInstrumentation` | boolean | Enable file system instrumentation | No | `false` |
| `enableDnsInstrumentation` | boolean | Enable DNS instrumentation | No | `false` |
| `enableMetrics` | boolean | Register a meter provider and export metrics | No | `true` |
| `metricsUrl` | string | Metrics endpoint, when it differs from the trace endpoint | No | `url` |
| `metricExportIntervalMillis` | number | Interval between metric exports | No | `60000` |
| `enableLogs` | boolean | Register a logger provider and export Pino log records | No | `true` |
| `logsUrl` | string | Logs endpoint, when it differs from the trace endpoint | No | `url` |

`setupTracing` throws `Error: serviceName is required` or `Error: url is required` when neither the option nor its environment variable supplies a value.

## Environment variables

| Variable | Maps to | Required |
|----------|---------|----------|
| `SERVICE_NAME` | `serviceName` | Yes, unless the option is passed |
| `ENDPOINT` | `url` | Yes, unless the option is passed |
| `CONTAINER_NAME` | `hostname` | No |
| `HOSTNAME` | `hostname`, when `CONTAINER_NAME` is unset | No |
| `TRACING_NODE_ESM_HOOK` | ESM loader hook registration, skipped on `false` or `0` | No |

An option passed to `setupTracing` beats the matching environment variable. The environment resource detector reads `OTEL_RESOURCE_ATTRIBUTES`, and the explicit service name overrides any `service.name` it carries.

## Metrics

The library exports metrics by default, over OTLP gRPC, to the same endpoint as traces. An OpenTelemetry Collector or Grafana Alloy accepts every signal on port 4317, so one endpoint covers both. Point `metricsUrl` somewhere else where the trace endpoint takes traces alone, a Tempo OTLP receiver for instance. Set `enableMetrics` to `false` where metrics are not wanted at all.

Aggregation temporality is cumulative, which Prometheus and Mimir both expect. `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` overrides it.

The export interval is 60 seconds. A shorter interval raises resolution and the volume written to the backend in equal measure.

Sampling never reaches the metrics, so `OTEL_TRACES_SAMPLER` can be turned down without losing accuracy. [Metrics](architecture.md#metrics) covers why.

## Logs

The library exports Pino log records by default, over OTLP gRPC, to the same endpoint as traces. Each record carries the trace id and span id of the request that wrote it, and Grafana needs both to link a log line to its trace. The application keeps writing to its own stream, so container logs are unchanged.

Setting `enableLogs` to `false` disables log sending at the instrumentation itself. Each record is then never built in the first place, instead of being built and discarded. [Logs](architecture.md#logs) covers that path.

Point `logsUrl` somewhere else where the trace endpoint does not accept logs.

Log export covers Pino alone. These options do nothing for an application logging through anything else.

## Optional instrumentations

`enableFsInstrumentation` and `enableDnsInstrumentation` are off by default. Both instrumentations patch on construction, so the library constructs each one only when its option is set. File system tracing produces a large number of spans and earns its keep only while file access is under investigation. [Instrumentation](instrumentation.md#file-system) covers what each emits.

## Using the returned tracer

`setupTracing` returns a tracer for the service. Use it for manual spans over work no instrumentation covers.

```javascript
const tracer = setupTracing({serviceName: 'my-service', url: 'http://alloy:4317'});

await tracer.startActiveSpan('reconcile', async (span) => {
  try {
    await reconcile();
  } finally {
    span.end();
  }
});
```

A span created this way becomes a child of whatever span is active in the current context. A manual span inside a request handler joins that request's trace.

## Shutdown

```javascript
import {setupTracing, stopTracing} from '@saidsef/tracing-node';

process.on('SIGTERM', async () => {
  await stopTracing();
  process.exit(0);
});
```

`stopTracing` awaits three shutdowns in turn. The tracer provider flushes the batch span processor, the meter provider flushes a final metric export, and the logger provider flushes queued log records. Each is awaited separately, which leaves the other two signals free to flush when one exporter fails. The providers are then cleared, so a later `setupTracing` call builds a fresh pipeline.

Called when tracing was never initialised, `stopTracing` logs a warning and returns. A failed shutdown produces an error on the log rather than a thrown exception.

Spans and log records are batched, and metrics are exported on an interval. A process that exits without this loses whatever is still queued.

## Repeated initialisation

A second `setupTracing` call logs `Tracing is already initialized. Returning existing tracer.` and returns a tracer from the existing provider. It ignores the options passed to it, `serviceName` excepted, which names the returned tracer.
