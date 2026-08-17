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

## Where the traces go

`setupTracing` exports OTLP over gRPC, so any OpenTelemetry-compatible collector or backend will take it - point `url` at yours.

If you do not have one yet, [grafana-loki-on-k8s](https://github.com/saidsef/grafana-loki-on-k8s) is a companion project that deploys the full LGTM+ stack - Grafana, Prometheus, Mimir, Loki, Tempo, Pyroscope, Alloy and Beyla - to Kubernetes with `kubectl apply -k ./deployment`, broken into small composable manifests rather than a single opaque chart. Send traces to its Alloy OTLP receiver and they land in Tempo, with the metrics-generator turning them into RED and service-graph metrics in Mimir:

```javascript
setupTracing({serviceName: 'my-service', url: 'http://alloy:4317'});
```

The W3C Trace Context propagation this library registers is what lets Tempo pair a caller's client span with the callee's server span, which is what a service graph is built from.

## Instalation

```
npm install @saidsef/tracing-node --save
```

## Upgrading

Breaking changes and the attribute renames they bring are recorded in the [release notes](https://github.com/saidsef/tracing-node/releases) for the version concerned.

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

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-node/fork). Fork us!

## Contributing

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls).

Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
