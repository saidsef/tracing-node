# OpenTelemetry Wrapper for Tracing Node Applications

[![CI](https://github.com/saidsef/tracing-node/actions/workflows/pr.yml/badge.svg)](https://github.com/saidsef/tracing-node/actions/workflows/pr.yml)
[![Release](https://github.com/saidsef/tracing-node/actions/workflows/release.yml/badge.svg)](https://github.com/saidsef/tracing-node/actions/workflows/release.yml)
[![Documentation](https://readthedocs.org/projects/tracing-node/badge/?version=latest)](https://tracing-node.readthedocs.io/en/latest/)
![GitHub issues](https://img.shields.io/github/issues/saidsef/tracing-node)
![npm](https://img.shields.io/npm/v/%40saidsef%2Ftracing-node) ![npm](https://img.shields.io/npm/dt/%40saidsef/tracing-node)
![GitHub release(latest by date)](https://img.shields.io/github/v/release/saidsef/tracing-node)
![Commits](https://img.shields.io/github/commits-since/saidsef/tracing-node/latest.svg)

**Traces, metrics and logs from one function call.** Add two lines to a service, and its requests, its calls to Redis, Elasticsearch, AWS and other services, its runtime counters and its Pino log records all arrive at your collector, already correlated by trace id and stitched into a service graph.

`@saidsef/tracing-node` wraps the OpenTelemetry Node SDK. One call to `setupTracing` builds the tracer, meter and logger providers, registers them globally, and turns on a fixed set of instrumentations, so an application gets all three signals without assembling exporters, span processors, resource detectors and instrumentation packages itself. A second call logs a warning and returns the tracer that already exists, which makes initialisation idempotent.

Full documentation: [tracing-node.readthedocs.io](https://tracing-node.readthedocs.io/).

## Prerequisites
- NodeJS >= 24.0.0
- Observability
- ...
- Profit?

## Installation

```shell
npm install @saidsef/tracing-node --save
```

## Usage

```javascript
import { setupTracing } from '@saidsef/tracing-node';

setupTracing({hostname: 'hostname', serviceName: 'service_name', url: 'endpoint'});
```

`serviceName` and `url` are required, and both fall back to the `SERVICE_NAME` and `ENDPOINT` environment variables. `setupTracing` has to run before the application imports the libraries being traced.

## Collector and backend

The exporter speaks OTLP over gRPC, so any OpenTelemetry-compatible collector accepts all three signals. Point `url` at yours.

[**grafana-loki-on-k8s**](https://github.com/saidsef/grafana-loki-on-k8s) is the companion stack, and the one the end to end harness in [`test/e2e/`](./test/e2e) targets. It deploys Grafana, Prometheus, Mimir, Loki, Tempo, Pyroscope, Alloy and Beyla to Kubernetes as small composable manifests.

```shell
git clone https://github.com/saidsef/grafana-loki-on-k8s
kubectl apply -k grafana-loki-on-k8s/deployment
```

Traces sent to its Alloy OTLP receiver on port 4317 land in Tempo, log records in Loki and metrics in Mimir. Tempo's metrics generator turns the spans into RED and service graph metrics, which is what the `peer.service` attribute this library sets exists to feed.

## Documentation

The pages below are the manual. Their sources are in [`docs/`](./docs), and `npm run build-docs` renders the site into `site/`.

| Page | Contents |
|------|----------|
| [Overview](https://tracing-node.readthedocs.io/en/latest/) | What the library does, the feature set and the requirements |
| [Architecture](https://tracing-node.readthedocs.io/en/latest/architecture/) | The pipeline `setupTracing` builds, and how the service graph is fed |
| [Configuration](https://tracing-node.readthedocs.io/en/latest/usage/) | Every option, the environment variables, initialisation order and shutdown |
| [Instrumentation](https://tracing-node.readthedocs.io/en/latest/instrumentation/) | Each instrumentation, and the attributes it emits |
| [Deployment](https://tracing-node.readthedocs.io/en/latest/deployment/) | Running instrumented services in containers and Kubernetes |
| [Testing](https://tracing-node.readthedocs.io/en/latest/testing/) | The unit tests and the end to end harness |
| [Troubleshooting](https://tracing-node.readthedocs.io/en/latest/troubleshooting/) | Symptoms, causes and fixes |

## Upgrading

Breaking changes and the attribute renames they bring are recorded in the [release notes](https://github.com/saidsef/tracing-node/releases) for the version concerned.

## Contributing

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-node/fork). Fork us!

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls). Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
