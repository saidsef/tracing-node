# Instrumentation

Every instrumentation below is registered by `setupTracing`, apart from those that are enabled per option. Each entry lists the attributes this library adds on top of what the instrumentation already emits.

Several instrumentations record metrics as well as spans. Those measurements reach the backend only when a meter provider is registered, which `setupTracing` does unless `enableMetrics` is `false`.

| Metric | Emitted by |
|--------|------------|
| `http.server.request.duration` | HTTP |
| `http.client.request.duration` | HTTP, Undici |
| `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` | AWS SDK, for Bedrock calls |

The Pino instrumentation sends log records over the same pipeline, which `setupTracing` exports unless `enableLogs` is `false`.

| Instrumentation | Package | Enabled |
|-----------------|---------|---------|
| HTTP | `@opentelemetry/instrumentation-http` | Always |
| Undici (fetch) | `@opentelemetry/instrumentation-undici` | Always |
| Express | `@opentelemetry/instrumentation-express` | Always |
| Connect | `@opentelemetry/instrumentation-connect` | Always |
| Pino | `@opentelemetry/instrumentation-pino` | Always |
| AWS SDK | `@opentelemetry/instrumentation-aws-sdk` | Always |
| IORedis | `@opentelemetry/instrumentation-ioredis` | Always |
| Elasticsearch | `opentelemetry-instrumentation-elasticsearch` | Always |
| Node runtime | `@opentelemetry/instrumentation-runtime-node` | `enableMetrics` |
| File system | `@opentelemetry/instrumentation-fs` | `enableFsInstrumentation` |
| DNS | `@opentelemetry/instrumentation-dns` | `enableDnsInstrumentation` |

## HTTP

Incoming requests to a path starting with `/metrics` or `/healthz` produce no span, which keeps scrape and probe traffic out of the trace store.

| Attribute | Source | Set on |
|-----------|--------|--------|
| `http.request.content_type` | `content-type` request header | Client and server spans |
| `http.request.content_length` | `content-length` request header | Client and server spans |
| `http.request_id` | `x-request-id` request or response header | Client and server spans |
| `http.correlation_id` | `x-correlation-id` request header | Client and server spans |
| `http.response.content_type` | `content-type` response header | Client and server spans |
| `http.response.content_length` | `content-length` response header | Client and server spans |
| `peer.service` | Remote host of an outgoing request | Client spans only |
| `db.system.name` | Remote host of an outgoing request | Client spans only |

A content length header is parsed as an integer and written only when it is a non-negative number, so a malformed header is ignored rather than recorded as text.

The request hook reads `getHeaders()` on an outgoing `ClientRequest` and `.headers` on an incoming `IncomingMessage`, so the same attributes appear on both sides of a call.

## Undici (fetch)

`globalThis.fetch` runs on undici, which never touches the `http` and `https` modules the HTTP instrumentation patches. Without this instrumentation a fetch call produces no client span and injects no `traceparent`, the callee starts a new trace, and the two services can never be paired into a service graph edge.

| Attribute | Source |
|-----------|--------|
| `peer.service` | The request origin, matched against the known peer list |
| `db.system.name` | The request origin, matched against the known peer list |

## Express

| Attribute | Source |
|-----------|--------|
| `express.route` | The matched route, when there is one |
| `express.params` | Route parameters, JSON encoded, when the object is not empty |
| `express.query` | Query string parameters, JSON encoded, when the object is not empty |
| `user.id` | `request.user.id`, when the application sets one |

A span with a matched route and a request method is renamed to `METHOD /route`, for example `GET /work/:id`. Naming by route rather than by path keeps the cardinality of span names bounded when the path carries an id.

## Connect

Registered with defaults. The instrumentation configuration accepts only the base options, with no request or ignore hooks, so nothing is added on top of the middleware spans it emits.

## Pino

The instrumentation injects `trace_id`, `span_id` and `trace_flags` into every log record by default. The log hook adds `service.name`, so a log line carries the same service identity as the span it belongs to.

Correlating logs with traces in Grafana relies on those ids being in the log record.

It also sends a copy of each record to the OpenTelemetry logs API, which `setupTracing` exports over OTLP unless `enableLogs` is `false`. The application's own stream still receives every record, so container logs are unchanged and the export is an addition to them.

| Field | Source |
|-------|--------|
| Severity | The Pino level, mapped onto the OpenTelemetry severity numbers |
| Timestamp | The record `time`, converted according to the logger's timestamp function |
| Body | The record message |
| Trace context | The active span, so a record written inside a request carries its trace |

A record is sent through `pino.multistream`, which needs Pino 7 or later. Log sending is skipped on an older version.

## AWS SDK

| Setting | Value |
|---------|-------|
| `suppressInternalInstrumentation` | `false`, so the underlying HTTP calls are still traced |
| `sqsExtractContextPropagationFromPayload` | `true`, so a trace continues across an SQS message |

| Attribute | Source |
|-----------|--------|
| `peer.service` | The AWS service name, lower cased |
| `aws.service` | The AWS service name, lower cased |
| `aws.request_id` | The request id from the response |

## IORedis

`requireParentSpan` is `false`, so a Redis command issued outside a request still produces a span.

| Attribute | Source |
|-----------|--------|
| `peer.service` | Always `redis` |
| `db.redis.key` | The first command argument |
| `db.redis.args_count` | The argument count, when there is more than one |
| `db.response.type` | The JavaScript type of the response |
| `db.response.count` | The response length, when it is an array |

Spans are renamed to `redis.COMMAND`, for example `redis.SET`. `db.system.name`, `db.operation.name` and the `server.*` attributes come from the instrumentation itself.

The statement serialiser truncates each argument to 100 characters and appends an ellipsis. A `Buffer` argument is sliced before it is decoded, so a large value is not converted in full only to be discarded.

## Node runtime

Registered when `enableMetrics` is set, which is the default. It produces metrics alone, with no spans, and it is constructed only when metrics are enabled because its collectors begin sampling on construction.

| Metric | Description |
|--------|-------------|
| `nodejs.eventloop.delay.min`, `.max`, `.mean`, `.stddev`, `.p50`, `.p90`, `.p99` | Event loop delay distribution |
| `nodejs.eventloop.utilization` | Fraction of the loop spent active |
| `nodejs.eventloop.time` | Time in the loop, split by `nodejs.eventloop.state` of `active` or `idle` |
| `v8js.gc.duration` | Garbage collection pause duration, by `v8js.gc.type` |
| `v8js.memory.heap.used`, `v8js.memory.heap.space.available_size`, `v8js.memory.heap.space.physical_size` | Heap occupancy per heap space |
| `v8js.resource.active` | Active handles and requests, by `v8js.resource.type` |

Event loop saturation slows every operation in a process at once. No span attribute carries it, which is what these metrics are for.

## Elasticsearch

Registered with defaults. `peer.service` for an Elasticsearch call comes from the HTTP or undici hook, which matches `elasticsearch` in the remote host.

## File system

Off by default, enabled with `enableFsInstrumentation`. The instrumentation patches `fs` on construction, so it is constructed only when the option is set.

## DNS

Off by default, enabled with `enableDnsInstrumentation`. Lookups of `localhost`, `127.0.0.1` and `::1` are ignored. The configuration accepts only an ignore list, with no hooks, so nothing is added to its spans.
