# tracing-node

`@saidsef/tracing-node` is a wrapper around the OpenTelemetry Node SDK. One call to `setupTracing` builds a tracer provider, registers it globally, and turns on a fixed set of instrumentations, so an application gets distributed tracing without assembling exporters, span processors, resource detectors and instrumentation packages itself.

The instrumentation is idempotent. A second call to `setupTracing` logs a warning and returns the tracer from the provider that already exists, so a library that initialises tracing does not fight with an application that does the same.

## Features

| Feature | Description |
|---------|-------------|
| HTTP/HTTPS instrumentation | Client and server spans, with health and metrics probes ignored |
| fetch/undici instrumentation | Outgoing `globalThis.fetch` calls |
| Express instrumentation | Route spans named `METHOD /route`, with params, query and user id |
| Connect instrumentation | Middleware spans for Connect applications |
| Elasticsearch client | Database spans |
| IORedis client | Cache spans named `redis.COMMAND` |
| AWS SDK | Cloud service spans, with SQS context propagation from the payload |
| Pino logger | Trace and span ids injected into log records |
| DNS and FS instrumentation | Off by default, enabled per option |
| Resource detection | Environment, host, OS, process and service instance id |
| Service graph attributes | `peer.service` set for HTTP, fetch, Redis, Elasticsearch and AWS calls |
| W3C Trace Context | Trace context and baggage propagation |

## Requirements

| Requirement | Value |
|-------------|-------|
| Node | >= 20.6.0 |
| Module system | ESM (`"type": "module"`), or CJS loaded behind an ESM preload |
| Collector | Any endpoint accepting OTLP over gRPC |

## Quick start

```shell
npm install @saidsef/tracing-node --save
```

```javascript
import {setupTracing} from '@saidsef/tracing-node';

setupTracing({serviceName: 'my-service', url: 'http://alloy:4317'});
```

`serviceName` and `url` are required. Both are read from the `SERVICE_NAME` and `ENDPOINT` environment variables when they are not passed. [Configuration](usage.md) covers the full option set and the order in which tracing has to be initialised.

## Where the traces go

The exporter speaks OTLP over gRPC, so any OpenTelemetry-compatible collector or backend accepts them. Point `url` at yours.

[grafana-loki-on-k8s](https://github.com/saidsef/grafana-loki-on-k8s) is a companion project that deploys the LGTM+ stack - Grafana, Prometheus, Mimir, Loki, Tempo, Pyroscope, Alloy and Beyla - to Kubernetes. [Deployment](deployment.md) covers pointing a service at its Alloy receiver, with the environment variables and manifests.

## Documentation

| Page | Contents |
|------|----------|
| [Architecture](architecture.md) | The pipeline `setupTracing` builds, and how the service graph is fed |
| [Configuration](usage.md) | Options, environment variables, initialisation order and shutdown |
| [Instrumentation](instrumentation.md) | Each instrumentation, and the attributes it emits |
| [Deployment](deployment.md) | Running instrumented services in containers and Kubernetes |
| [Testing](testing.md) | The unit tests and the end to end harness |
| [Troubleshooting](troubleshooting.md) | Symptoms, causes and fixes |

## Repository

Source code and releases: [github.com/saidsef/tracing-node](https://github.com/saidsef/tracing-node)
