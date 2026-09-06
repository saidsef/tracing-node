# Troubleshooting

The diagnostic logger is set to a console logger at `INFO` level, so exporter and instrumentation problems are reported on stdout. Read those first.

## No spans reach the collector

| Cause | Check | Fix |
|-------|-------|-----|
| Tracing initialised after the application loaded | Whether `setupTracing` runs before Express or IORedis is imported | Move it into a preload run with `node --import`, see [Initialisation order](usage.md#initialisation-order) |
| Endpoint not reachable | Exporter errors on stdout | Confirm the collector address and that the gRPC port, conventionally 4317, is open from the pod |
| Wrong protocol | Whether the endpoint is an OTLP HTTP receiver | The exporter speaks gRPC only |
| Process exits before the flush | Whether `stopTracing` runs on shutdown | Await `stopTracing` on `SIGTERM`, see [Shutdown](usage.md#shutdown) |

Spans are batched and exported every two seconds, so a short delay before the first trace appears is expected.

## setupTracing throws on startup

`serviceName is required` and `url is required` mean neither the option nor its environment variable supplied a value. `serviceName` falls back to `SERVICE_NAME` and `url` to `ENDPOINT`, and an empty string counts as missing.

## Only some libraries produce spans

Instrumentation patches a module as it loads. A library imported before `setupTracing` ran is never patched. This is the most common reason an Express or Redis application traces its inbound HTTP calls and nothing else, since the HTTP instrumentation patches a core module that is loaded later than the application's own dependencies.

## fetch calls are not traced

`globalThis.fetch` runs on undici rather than the `http` module. The undici instrumentation covers it and is always registered, so a missing fetch span points at the initialisation order rather than at configuration.

## No metrics reach the collector

| Cause | Check | Fix |
|-------|-------|-----|
| Metrics disabled | Whether `enableMetrics` is `false` | Leave it unset, since it defaults to `true` |
| Endpoint takes traces alone | Exporter errors naming the metrics service on stdout | Point `metricsUrl` at a receiver that accepts metrics, such as an OpenTelemetry Collector or Grafana Alloy |
| Nothing exported yet | How long the process has been running | Metrics are exported every 60 seconds by default, so the first export lags startup |

Delta temporality reaching a Prometheus backend produces gaps rather than errors. The exporter defaults to cumulative, so check `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` where the series look wrong.

## The trace stops at a service boundary

A callee starting a new trace instead of continuing the caller's one means the `traceparent` header was not propagated. Check that the outgoing call goes through an instrumented client, and that no proxy in between strips the header.

## The service graph has no edges

A graph edge needs a client span and a server span paired by trace context, plus a `peer.service` attribute naming the far end. Both come from this library, so an empty graph usually means the backend's metrics generator is not enabled, or that a hop in between is uninstrumented.

`peer.service` on an outgoing HTTP or fetch call is derived by matching the remote host against `elasticsearch` and `redis`. A call to any other host gets no `peer.service` from that hook.

## "Tracing is already initialized"

A second `setupTracing` call logs this warning and returns the tracer from the existing provider. It is harmless. The warning means two places initialise tracing, for example an application and a library it depends on, and the options passed to the second call are ignored.

## "Tracer provider is not initialized"

`stopTracing` was called when tracing had never been set up, or after a previous `stopTracing` cleared the provider. Nothing is shut down and no error is thrown.

## Probes and scrapes appear as traces

They should not. Incoming requests to paths starting with `/metrics` or `/healthz` are ignored. A probe on any other path produces a span, so either move the probe or expect it in the trace store.

## Traces and metrics disagree on request counts

They measure different populations. A metric is recorded for every request, and a trace is kept for a sampled fraction, so the two match only where sampling is off. Backend generated metrics such as Tempo's `traces_spanmetrics_calls_total` are built from the spans that arrived, and so follow the sampled fraction rather than the metrics this library exports.

## Too many spans

File system instrumentation is off by default because it produces a span per operation. Confirm `enableFsInstrumentation` is not set in production. DNS instrumentation is off by default as well.

## Wrong service name in the backend

Explicit attributes are merged over detected ones, so a `serviceName` passed to `setupTracing` wins over a `service.name` in `OTEL_RESOURCE_ATTRIBUTES`. A backend showing the wrong name means the wrong value was passed, not that detection overrode it.
