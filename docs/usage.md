# Configuration

## Installation

```shell
npm install @saidsef/tracing-node --save
```

The package is ESM only and declares `"type": "module"`. Node 20.6.0 or later is required.

## Initialisation order

Instrumentation works by patching modules as they are loaded, so `setupTracing` has to run before the application requires or imports the libraries being traced. Calling it after Express or IORedis has been loaded leaves those modules unpatched and produces no spans for them.

### ESM application

```javascript
import {setupTracing} from '@saidsef/tracing-node';

setupTracing({serviceName: 'my-service', url: 'http://alloy:4317'});

const {default: app} = await import('./app.mjs');
```

### Preload

```javascript
// instrument.mjs
import {setupTracing} from '@saidsef/tracing-node';

setupTracing();
```

```shell
node --import ./instrument.mjs ./app.cjs
```

The preload form is the reliable one. `--import` runs the module to completion before the application entry point loads, and it works for a CommonJS application, where `require-in-the-middle` patches each module on `require`. The [end to end harness](testing.md#end-to-end-harness) uses this form.

## Options

```javascript
setupTracing({
  hostname: 'pod-abc123',
  serviceName: 'my-service',
  url: 'http://alloy:4317',
  concurrencyLimit: 10,
  enableFsInstrumentation: false,
  enableDnsInstrumentation: false,
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

An option passed to `setupTracing` takes precedence over the matching environment variable. `OTEL_RESOURCE_ATTRIBUTES` is read by the environment resource detector, and any `service.name` it carries is overridden by the explicit one.

## Logs

Pino log records are exported by default, over OTLP gRPC, to the same endpoint as traces. Each record carries the trace id and span id of the request that wrote it, which is what links a log line to its trace in Grafana. The application keeps writing to its own stream as well, so container logs are unchanged.

The Pino instrumentation sends records to the OpenTelemetry logs API whether or not a logger provider is registered. Where no provider exists, each record is still parsed and rebuilt before being handed to a no-op logger. Setting `enableLogs` to `false` disables log sending at the instrumentation, so that work is not done at all.

Point `logsUrl` elsewhere where the trace endpoint does not accept logs.

Log export covers Pino alone. An application logging through anything else is unaffected by these options.

## Optional instrumentations

`FsInstrumentation` patches the `fs` module on construction, so it is constructed only when `enableFsInstrumentation` is set. File system tracing produces a large number of spans and is worth enabling only while investigating file access.

`DnsInstrumentation` is constructed only when `enableDnsInstrumentation` is set, and it ignores `localhost`, `127.0.0.1` and `::1`.

## Using the returned tracer

`setupTracing` returns a tracer for the service, which creates manual spans for work no instrumentation covers.

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

A span created this way is a child of whatever span is active in the current context, so a manual span inside a request handler joins that request's trace.

## Shutdown

```javascript
import {setupTracing, stopTracing} from '@saidsef/tracing-node';

process.on('SIGTERM', async () => {
  await stopTracing();
  process.exit(0);
});
```

`stopTracing` awaits the tracer provider shutdown, which flushes the batch span processor, then the logger provider shutdown, which flushes queued log records. Each is awaited separately, so a failing exporter on one signal still lets the other flush. The providers are then cleared, so a later `setupTracing` call builds a fresh pipeline. `stopTracing` logs a warning and returns when tracing was never initialised, and logs an error rather than throwing when shutdown fails.

Spans and log records are both batched, so a process that exits without this loses whatever is still queued.

## Repeated initialisation

A second `setupTracing` call logs `Tracing is already initialized. Returning existing tracer.` and returns a tracer from the existing provider. The options passed to the second call are ignored, apart from `serviceName`, which names the returned tracer.
