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
| fetch/undici instrumentation | Outgoing `globalThis.fetch` calls |
| Express.js support | Framework instrumentation |
| Elasticsearch client | Database instrumentation |
| IORedis client | Cache instrumentation |
| AWS SDK | Cloud service instrumentation |
| Pino logger | Integration with trace/span IDs |
| DNS/FS instrumentation | Optional monitoring |
| Resource detection | Host, OS, process, container |
| W3C Trace Context | Standard propagation |

## Prerequisites
- NodeJS
- Observability
- ...
- Profit?

## Instalation

```
npm install @saidsef/tracing-node --save
```

## Upgrading to 4.0.0

**Breaking change: spans now carry the stable OpenTelemetry semantic conventions.**

The upstream instrumentations ([open-telemetry/opentelemetry-js-contrib#3585](https://github.com/open-telemetry/opentelemetry-js-contrib/pull/3585)) dropped the legacy attributes and removed the `OTEL_SEMCONV_STABILITY_OPT_IN` escape hatch, so there is no way to keep the old names. The public API of `setupTracing` / `stopTracing` is unchanged - no code changes are required - but any dashboard, alert or processor keyed on the old attribute names must be updated.

| Removed | Replacement | Affected spans |
|---------|-------------|----------------|
| `http.method` | `http.request.method` | HTTP |
| `http.status_code` | `http.response.status_code` | HTTP, AWS SDK |
| `http.url` | `url.full` | HTTP |
| `http.target` | `url.path` + `url.query` | HTTP |
| `http.scheme` | `url.scheme` | HTTP |
| `http.user_agent` | `user_agent.original` | HTTP |
| `http.client_ip` | `client.address` | HTTP |
| `http.flavor` | `network.protocol.version` | HTTP |
| `net.peer.name` | `server.address` | HTTP, IORedis |
| `net.peer.port` | `server.port` | HTTP, IORedis |
| `db.system` | `db.system.name` | IORedis, DynamoDB |
| `db.statement` | `db.query.text` | IORedis, DynamoDB |
| `db.operation` | `db.operation.name` | IORedis, DynamoDB |
| `db.connection_string` | none | IORedis |

Server-side HTTP metrics also move from `http.server.duration` (milliseconds) to `http.server.request.duration` (seconds), and the client equivalents likewise.

`peer.service` is unchanged, so Tempo/Grafana service graphs keep working as before. IORedis spans also gain `db.operation.name`, which distinguishes `MULTI`/`PIPELINE` commands.

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
| url | string | tracing endpoint i.e. `<schema>://<host>:<port>` | Yes | `n/a` |
| enableFsInstrumentation | boolean | enable FS instrumentation | No | `false` |
| enableDnsInstrumentation | boolean | enable DNS instrumentation | No | `false`  |

## Source

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-nodec/fork). Fork us!

## Contributing

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls).

Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
