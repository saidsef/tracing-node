# Instrumentation

`setupTracing` registers every instrumentation below, apart from the three that wait on an option. Each entry lists what this library adds on top of the attributes the instrumentation already emits.

Some instrumentations record metrics alongside their spans. A meter provider has to be registered before those measurements leave the process, and `setupTracing` registers one unless `enableMetrics` is `false`.

| Metric | Emitted by |
|--------|------------|
| `http.server.request.duration` | HTTP |
| `http.client.request.duration` | HTTP, Undici |
| `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` | AWS SDK, for Bedrock calls |

| Instrumentation | Package | Enabled |
|-----------------|---------|---------|
| HTTP | `@opentelemetry/instrumentation-http` | Always |
| Undici (fetch) | `@opentelemetry/instrumentation-undici` | Always |
| Express | `@opentelemetry/instrumentation-express` | Always |
| Connect | `@opentelemetry/instrumentation-connect` | Always |
| Pino | `@opentelemetry/instrumentation-pino` | Always |
| AWS SDK | `@opentelemetry/instrumentation-aws-sdk` | Always |
| IORedis | `@opentelemetry/instrumentation-ioredis` | Always |
| Elasticsearch | `opentelemetry-instrumentation-elasticsearch` | When the package is installed |
| Node runtime | `@opentelemetry/instrumentation-runtime-node` | `enableMetrics` |
| File system | `@opentelemetry/instrumentation-fs` | `enableFsInstrumentation` |
| DNS | `@opentelemetry/instrumentation-dns` | `enableDnsInstrumentation` |

## HTTP

An incoming request to a path starting with `/metrics` or `/healthz` produces no span. Scrape and probe traffic stays out of the trace store.

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

The hook parses a content length header as an integer and writes it only when the result is a non-negative number. A malformed header is ignored, never recorded as text.

Outgoing and incoming requests expose their headers differently: `getHeaders()` on a `ClientRequest`, `.headers` on an `IncomingMessage`. The hook reads both, which is why the same attributes appear on each side of a call.

## Undici (fetch)

`globalThis.fetch` runs on undici. Undici never touches the `http` and `https` modules that the HTTP instrumentation patches, so without this instrumentation a fetch call produces no client span and injects no `traceparent`. The callee then starts a fresh trace. Nothing pairs the two services into a service graph edge.

| Attribute | Source |
|-----------|--------|
| `peer.service` | The request origin, matched against the known peer list |
| `db.system.name` | The request origin, matched against the known peer list |

## Express

The instrumentation creates one span per layer: every middleware, every router, and the request handler. It calls the request hook on each. Only the request handler layer carries the matched route, so the hook records attributes there and returns early everywhere else. Middleware and router spans keep the names the instrumentation gives them, `middleware - expressInit` and `router - /work` among them. Those names show where time inside a request went.

| Attribute | Source |
|-----------|--------|
| `express.route` | The matched route, when there is one |
| `express.params` | Route parameters, JSON encoded, when the object is not empty |
| `express.query_keys` | The names of the query string parameters, sorted |
| `user.id` | `request.user.id`, when the application sets one |

Query values are never recorded. A query string carries access tokens and personal data, and `OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` is unbounded by default, which means a value written to a span attribute is exported in full. The key names describe the shape of a request. The contents stay out.

The server span is named `METHOD /route`, for example `GET /work/:id`. That name comes from the HTTP instrumentation, which reads `http.route` as the response finishes. The Express instrumentation supplies the route it reads.

## Connect

The library registers this one with defaults. Its configuration accepts the base options alone, with no request or ignore hooks, so the middleware spans it emits reach the collector untouched.

## Pino

The instrumentation injects `trace_id`, `span_id` and `trace_flags` into every log record by default. Grafana needs those ids in the record before it can correlate a log line with its trace. The log hook adds `service.name`, and a log line then carries the same service identity as the span it belongs to.

It also sends a copy of each record to the OpenTelemetry logs API. `setupTracing` exports those over OTLP unless `enableLogs` is `false`. The application's own stream still receives every record, so the export adds to container logs without changing them.

| Field | Source |
|-------|--------|
| Severity | The Pino level, mapped onto the OpenTelemetry severity numbers |
| Timestamp | The record `time`, converted according to the logger's timestamp function |
| Body | The record message |
| Trace context | The active span, so a record written inside a request carries its trace |

Log sending goes through `pino.multistream`, which arrived in Pino 7. On an older version the instrumentation skips it.

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

`requireParentSpan` is `false`. A Redis command issued outside a request still produces a span.

| Attribute | Source |
|-----------|--------|
| `peer.service` | Always `redis` |
| `db.redis.key` | The first command argument |
| `db.redis.args_count` | The argument count, when there is more than one |
| `db.response.type` | The JavaScript type of the response |
| `db.response.count` | The response length, when it is an array |

The library renames each span to `redis.COMMAND`, for example `redis.SET`. `db.system.name`, `db.operation.name` and the `server.*` attributes come from the instrumentation itself.

The statement serialiser truncates each argument to 100 characters and appends an ellipsis. It slices a `Buffer` argument before decoding it, which avoids converting a large value in full only to discard most of it.

## Node runtime

The library registers this one when `enableMetrics` is set, the default. It produces no spans at all. Its collectors begin sampling the moment it is constructed, so construction waits on the option.

| Metric | Description |
|--------|-------------|
| `nodejs.eventloop.delay.min`, `.max`, `.mean`, `.stddev`, `.p50`, `.p90`, `.p99` | Event loop delay distribution |
| `nodejs.eventloop.utilization` | Fraction of the loop spent active |
| `nodejs.eventloop.time` | Time in the loop, split by `nodejs.eventloop.state` of `active` or `idle` |
| `v8js.gc.duration` | Garbage collection pause duration, by `v8js.gc.type` |
| `v8js.memory.heap.used`, `v8js.memory.heap.space.available_size`, `v8js.memory.heap.space.physical_size` | Heap occupancy per heap space |
| `v8js.resource.active` | Active handles and requests, by `v8js.resource.type` |

Event loop saturation slows every operation in a process at once. No span attribute carries it. These metrics exist to make it visible.

## Elasticsearch

`opentelemetry-instrumentation-elasticsearch` is an optional peer dependency. Install it alongside the library to register it:

```shell
npm install opentelemetry-instrumentation-elasticsearch --save
```

It stays optional because it pins `@opentelemetry/core` to the 1.x line, which carries [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf). Installing it resolves a second copy of `@opentelemetry/core` under the instrumentation, and a security audit of the resulting tree reports that advisory.

With the package installed, the library registers it with defaults and each call produces a span named `elasticsearch.request`.

| Attribute | Value |
|-----------|-------|
| `db.system` | `elasticsearch` |
| `db.operation` | The client method called |
| `db.statement` | The serialised query |
| `elasticsearch.request.indices` | The index the request targets |
| `net.transport`, `net.peer.name`, `net.peer.port` | The connection to the cluster |

Those are the superseded 1.x semantic conventions. They differ from the stable names the rest of this library emits.

Without the package, an Elasticsearch call still produces a client span from the HTTP or undici instrumentation, carrying the HTTP attributes and the request timing. The peer service hook matches `elasticsearch` in the remote host and sets both `peer.service` and `db.system.name` to it, so the service graph keeps its edge to the cluster. The query, the operation and the index name are not recorded.

## File system

The library leaves this one off by default, and `enableFsInstrumentation` turns it on. The instrumentation patches `fs` the moment it is constructed, so construction waits on the option.

## DNS

`enableDnsInstrumentation` turns this one on, and it stays off otherwise. Lookups of `localhost`, `127.0.0.1` and `::1` are ignored. Its configuration accepts an ignore list alone, with no hooks, so nothing is added to its spans.
