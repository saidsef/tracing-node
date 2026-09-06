# Architecture

`setupTracing` assembles a tracer provider, registers it as the global provider, and registers the instrumentations against it. Everything the OpenTelemetry Node SDK needs is configured in one place, so a caller passes a service name and an endpoint rather than a pipeline.

## The pipeline

```mermaid
flowchart LR
  A[Application] --> B[Instrumentations]
  B --> C[NodeTracerProvider]
  C --> D[BatchSpanProcessor]
  D --> E[OTLPTraceExporter<br/>gRPC]
  E --> F[Collector]
  B --> G[MeterProvider]
  G --> H[PeriodicExportingMetricReader]
  H --> I[OTLPMetricExporter<br/>gRPC]
  I --> F
  B --> J[LoggerProvider]
  J --> K[BatchLogRecordProcessor]
  K --> L[OTLPLogExporter<br/>gRPC]
  L --> F
  R[Resource detectors] --> C
  R --> G
  R --> J
```

| Stage | Component | Configuration |
|-------|-----------|---------------|
| Provider | `NodeTracerProvider` | Resource from detectors, merged with the explicit service and container attributes |
| Processor | `BatchSpanProcessor` | `maxQueueSize` 4096, `maxExportBatchSize` 1024, `scheduledDelayMillis` 2000, `exportTimeoutMillis` 10000 |
| Exporter | `OTLPTraceExporter` | OTLP over gRPC, `timeoutMillis` 10000, `concurrencyLimit` from the options (default 10) |
| Registration | `tracerProvider.register()` | Installs the async local storage context manager and a composite W3C Trace Context and baggage propagator |
| Meter provider | `MeterProvider` | Same resource as the tracer provider, registered as the global meter provider |
| Metric reader | `PeriodicExportingMetricReader` | `exportIntervalMillis` from the options (default 60000) |
| Metric exporter | `OTLPMetricExporter` | OTLP over gRPC, cumulative temporality, `metricsUrl` from the options (default the trace endpoint) |
| Logger provider | `LoggerProvider` | Same resource as the tracer provider, registered as the global logger provider |
| Log processor | `BatchLogRecordProcessor` | `maxQueueSize` 4096, `maxExportBatchSize` 1024, `scheduledDelayMillis` 2000, `exportTimeoutMillis` 10000 |
| Log exporter | `OTLPLogExporter` | OTLP over gRPC, `logsUrl` from the options (default the trace endpoint) |

Spans are batched rather than exported one at a time. A span is therefore visible in the backend up to `scheduledDelayMillis` after it ends, and a process that exits without calling [`stopTracing`](usage.md#shutdown) drops whatever is still queued.

## Metrics

The instrumentations record their measurements against whichever meter provider is registered when `registerInstrumentations` runs. The HTTP and undici instrumentations record request duration histograms, and the AWS SDK instrumentation records Bedrock token usage and operation duration. Where no meter provider is registered, those instruments come from the no-op meter and every measurement is discarded.

`setupTracing` registers a `MeterProvider` and passes it to `registerInstrumentations`, which is what turns those measurements into exported metrics. `RuntimeNodeInstrumentation` is registered alongside them for the metrics no span can carry: event loop delay and utilisation, garbage collection duration, and heap occupancy.

Recording happens outside the sampler. The HTTP instrumentation records the duration after the span ends, without consulting the sampling decision, so metrics describe every request while traces describe a sampled subset.

## Logs

The Pino instrumentation does two separate things. Log correlation adds `trace_id`, `span_id` and `trace_flags` to each record written to the application's own stream. Log sending routes a copy of each record to the OpenTelemetry logs API, and it is on by default.

Log sending reaches a backend only when a logger provider is registered. Where none is, the record is parsed and rebuilt as a `LogRecord` and then handed to a no-op logger, so the cost is paid on every log line and nothing arrives. `setupTracing` registers a `LoggerProvider`, which turns that work into records delivered over OTLP, and sets `disableLogSending` when `enableLogs` is `false`, so the work stops rather than continuing for nothing.

## Shared resource

The resource is built once and passed to all three providers. Grafana pairs a metric and a log line with a trace on `service.name`, which requires them to be identical.

## Resource attributes

The resource is built in two steps. Detection runs first, then the explicit attributes are merged on top, so an explicitly passed service name wins over one found by the environment detector.

| Source | Attributes |
|--------|------------|
| `envDetector` | Anything set in `OTEL_RESOURCE_ATTRIBUTES` |
| `hostDetector` | `host.name`, `host.arch` |
| `osDetector` | `os.type`, `os.version` |
| `processDetector` | `process.pid`, `process.command`, `process.runtime.*` |
| `serviceInstanceIdDetector` | `service.instance.id` |
| Explicit | `service.name`, and `container.name` when a hostname is resolved |

`container.name` is omitted entirely when no hostname is passed and neither `CONTAINER_NAME` nor `HOSTNAME` is set, rather than written as an undefined value.

## Propagation

`register()` is called without overrides, which installs the `AsyncLocalStorageContextManager` and a composite propagator of W3C Trace Context and W3C Baggage. An incoming request carrying `traceparent` continues the caller's trace, and every outgoing HTTP or fetch call injects one.

This is what pairs a caller's client span with the callee's server span. A service graph is built from those pairs, so propagation is the prerequisite for one.

## Service graph attributes

Tempo names a service graph node from `peer.service`, and no instrumentation emits that attribute. The library sets it in the request hooks instead.

| Call | Where `peer.service` comes from |
|------|---------------------------------|
| Outgoing HTTP | The `host` of the outgoing `ClientRequest`, matched against the known peer list |
| Outgoing fetch | The `origin` of the undici request, matched against the same list |
| IORedis | Set to `redis` unconditionally |
| AWS SDK | The AWS service name from the request, lower cased |

The known peer list holds `elasticsearch` and `redis`. A host containing either substring sets both `peer.service` and `db.system.name` to that value.

Only outgoing requests carry `host`, so the HTTP hook returns without setting anything when there is none. That keeps server spans out of the graph as peers, where `peer.service` has to name the remote service being called rather than the local one.

## Idempotency

The provider is held in module scope. `setupTracing` returns early when it is already set, logging a warning and returning a tracer from the existing provider, so repeated initialisation cannot register a second set of instrumentations or a second exporter against the same process.

`stopTracing` awaits the tracer provider shutdown, which flushes queued spans, then the meter provider shutdown, which flushes a final metric export, then the logger provider shutdown, which flushes queued log records. It clears every module scope reference and unregisters the global meter and logger providers, since the API will not replace either while one is in place. A later `setupTracing` call therefore builds a fresh pipeline.

## Diagnostics

The OpenTelemetry diagnostic logger is set to a console logger at `INFO` level when the module is imported, before `setupTracing` runs. Exporter failures, instrumentation warnings and the messages this library emits are all written to the console through it.
