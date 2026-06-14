# Opentelemetry Wrapper for Tracing Node Applications 

[![CI](https://github.com/saidsef/tracing-node/actions/workflows/pr.yml/badge.svg)](#Instalation)
[![Release](https://github.com/saidsef/tracing-node/actions/workflows/release.yml/badge.svg)](#Instalation)
![GitHub issues](https://img.shields.io/github/issues/saidsef/tracing-node)
![npm](https://img.shields.io/npm/v/%40saidsef%2Ftracing-node) ![npm](https://img.shields.io/npm/dt/%40saidsef/tracing-node)
![GitHub release(latest by date)](https://img.shields.io/github/v/release/saidsef/tracing-node)
![Commits](https://img.shields.io/github/commits-since/saidsef/tracing-node/latest.svg)

Get telemetry for your app in less than 3 minutes!

Effortlessly supercharge your applications with world-class distributed tracing! This OpenTelemetry wrapper delivers seamless, lightning-fast observability, empowering developers to monitor, debug, and optimise microservices with ease. Designed for modern cloud-native environments, it's the smart choice for engineers who demand reliability, scalability, and actionable insights. Get started in minutes and unlock the full potential of your service architecture—no fuss, just results.  This is to make instrumentation (more) idempotent.

## Features
| Feature | Description |
|---------|-------------|
| HTTP/HTTPS instrumentation | Automatic service detection |
| undici (native fetch) instrumentation | Covers Node 18+ `fetch()` and undici clients |
| Express.js support | Framework instrumentation |
| IORedis client | Cache instrumentation |
| AWS SDK | Cloud service instrumentation |
| Pino logger | Integration with trace/span IDs |
| DNS/FS instrumentation | Optional monitoring |
| Resource detection | Host, OS, process, service instance, container/cgroup |
| W3C Trace Context | Standard propagation |
| OTLP gRPC and HTTP/protobuf exporters | Selectable via `exporterProtocol` |
| Configurable head-based sampling | ParentBased + TraceIdRatio |
| Optional SIGTERM/SIGINT shutdown | Flush spans on signal |
| Metrics (RED + Node runtime) | OTLP metrics exporter + runtime-node instrumentation, default on |
| Auto-detected DB / messaging / gRPC instrumentations | Postgres, MongoDB, KafkaJS, amqplib, gRPC — enabled only if the target lib is installed in the consuming app |
| `NodeSDK` bootstrap | Built on `@opentelemetry/sdk-node`; honours standard `OTEL_*` env vars |

## Prerequisites
- NodeJS
- Observability
- ...
- Profit?

## Instalation

```
npm install @saidsef/tracing-node --save
```

## Usage

You can set required params via env variables or function:

Env vars:
| Environment Variable   | Description                | Required |
|-----------------------|----------------------------| --------- |
| CONTAINER_NAME/HOSTNAME| Container or pod hostname  | No |
| ENDPOINT              | Tracing collector endpoint | Yes |
| SERVICE_NAME          | Service/application name   | Yes |

Function args
```
import { setupTracing } from '@saidsef/tracing-node';
setupTracing({hostname: 'hostname', serviceName: 'service_name', url: 'endpoint'});
```

### Required Parameters are

| Name | Type | Description| Required | Default |
|----- | ---- | ------------- | ----- | ---- |
| hostname | string | container / pod hostname | No | `hostname` |
| serviceName | string | service / application name | Yes | `n/a` |
| url | string | tracing endpoint i.e. `<schema>://<host>:<port>` (with `exporterProtocol: 'http/protobuf'` a missing `/v1/traces` path is auto-appended; with `metricsUrl` the same applies for `/v1/metrics`) | Yes | `n/a` |
| enableFsInstrumentation | boolean | enable FS instrumentation | No | `false` |
| enableDnsInstrumentation | boolean | enable DNS instrumentation | No | `false`  |
| exporterProtocol | `'grpc' \| 'http/protobuf'` | OTLP transport protocol | No | `'grpc'` |
| samplingRatio | number (0.0-1.0) | head-based sampling ratio for root spans; child spans follow parent | No | `1.0` |
| installSignalHandlers | boolean | register SIGTERM/SIGINT handlers that flush spans and exit | No | `false` |
| enableDiagLogging | boolean | enable OTel diagnostic console logger (also honoured via `OTEL_LOG_LEVEL` env) | No | `false` |
| enableMetrics | boolean | configure a global MeterProvider so instrumentations emit RED-method metrics + Node runtime metrics | No | `true` |
| metricsUrl | string | OTLP metrics endpoint override | No | `url` |
| metricExportIntervalMillis | number | periodic metrics export interval | No | `60000` |
| enableGrpcInstrumentation | boolean | force on/off; omit for auto-detect via `@grpc/grpc-js` probe | No | auto |
| enablePgInstrumentation | boolean | force on/off; omit for auto-detect via `pg` probe | No | auto |
| enableMongoDBInstrumentation | boolean | force on/off; omit for auto-detect via `mongodb` probe | No | auto |
| enableKafkaJsInstrumentation | boolean | force on/off; omit for auto-detect via `kafkajs` probe | No | auto |
| enableAmqplibInstrumentation | boolean | force on/off; omit for auto-detect via `amqplib` probe | No | auto |

## Metrics

When `enableMetrics` is true (default), a `MeterProvider` is registered globally with a `PeriodicExportingMetricReader` pointing at `metricsUrl` (or `url`). All existing instrumentations that emit OTel metrics will start producing them automatically:

- `http.server.duration`, `http.client.duration` histograms from `instrumentation-http` and `instrumentation-undici`
- AWS SDK / IORedis / Express durations
- Node runtime: `nodejs.eventloop.delay.*`, `nodejs.gc.duration`, `nodejs.heap.*` from `instrumentation-runtime-node`

Disable with `enableMetrics: false` if your collector pipeline does not accept metrics.

## Auto-detected instrumentations

The library bundles Postgres, MongoDB, KafkaJS, amqplib and gRPC instrumentations as dependencies, but only **registers** them when the corresponding target library is actually installed in the consuming application (resolved via `require.resolve` from the consumer's `node_modules`). Pass the matching `enable<X>Instrumentation: true|false` flag to override the probe.

## Startup mode (ESM consumers)

For consumers whose `package.json` sets `"type": "module"` (ESM), prefer `--import` over `--require` to load the bootstrap. Node 20.6+ supports `--import`:

```
node --import ./libs/tracing.mjs app.js
```

`--require` only patches modules loaded via CJS `require()`. When an ESM caller does `import express from 'express'`, the ESM-to-CJS bridge bypasses `require-in-the-middle`, and instrumentations that target third-party libraries (Express, IORedis, Pino, Postgres, MongoDB, KafkaJS, amqplib, gRPC) silently no-op. The built-in `http` / `https` instrumentation still works because it patches the module object directly, but you lose route names, the middleware-layer span, and any downstream-library spans. The library emits a `console.warn` and sets `startup_mode_degraded: true` in the banner when it detects `--require` without `--import` so this misconfiguration is visible at process start.

CJS consumers can keep using `--require` without consequence.

## Startup banner

Each successful `setupTracing` call emits a single `console.info` line of the form:

```
[@saidsef/tracing-node] started {"service.name":"...","exporter.protocol":"...","traces.url":"...","metrics.url":"...","instrumentations":[...],"otel_env_overrides":[...]}
```

It is grep-friendly, ungated, and shows the post-normalisation OTLP URLs plus the names of any `OTEL_*` env vars that were detected as conflicting with the programmatic options (each such conflict also fires its own `console.warn`). Use this to confirm in production logs that the resolved configuration matches the intended one before debugging "no spans reach the collector"-shaped issues.

## Environment variable support

Bootstrap is performed by `NodeSDK` from `@opentelemetry/sdk-node`. The standard `OTEL_*` environment variables are honoured automatically; programmatic options take precedence for `serviceName`, `url`, `metricsUrl`, `exporterProtocol`, and `samplingRatio`, with a `console.warn` emitted when a conflicting env var is set so the override is visible. The resource is built by running the configured detectors and then merging the programmatic `serviceName`/`hostname` over the detected attributes, so `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` cannot silently overwrite the programmatic `serviceName`.

Relevant vars:

| Variable | Effect |
|---|---|
| `OTEL_SDK_DISABLED=true` | Disables the SDK entirely |
| `OTEL_LOG_LEVEL` | Diagnostic log level (`NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `VERBOSE`, `ALL`) |
| `OTEL_SERVICE_NAME` | Service name fallback if `serviceName` option / `SERVICE_NAME` env are unset |
| `OTEL_RESOURCE_ATTRIBUTES` | Comma-separated `key=value` pairs merged into the resource |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint fallback if `url` option / `ENDPOINT` env are unset |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | Protocol selection fallback |
| `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_METRIC_EXPORT_TIMEOUT` | Metric reader timing fallbacks |
| `OTEL_PROPAGATORS` | Comma-separated propagator list; if unset, defaults to W3C TraceContext + Baggage |
| `OTEL_NODE_RESOURCE_DETECTORS` | Subset of detectors to run (`env`, `host`, `os`, `process`, `serviceinstance`, `all`, `none`) |

## Roadmap

- Logs SDK (`@opentelemetry/sdk-logs`) + OTLP logs exporter

## Source

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-nodec/fork). Fork us!

## Contributing

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls).

Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
