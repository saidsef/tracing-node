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

- ✅ HTTP/HTTPS instrumentation with automatic service detection
- ✅ Express.js framework support
- ✅ Elasticsearch client instrumentation
- ✅ IORedis client instrumentation  
- ✅ AWS SDK instrumentation
- ✅ Pino logger integration with trace/span IDs
- ✅ Optional DNS and File System instrumentation
- ✅ Automatic resource detection (host, OS, process, container)
- ✅ W3C Trace Context propagation

## Prerequisites
- NodeJS
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
| url | string | tracing endpoint i.e. `<schema>://<host>:<port>` | Yes | `n/a` |
| enableFsInstrumentation | boolean | enable FS instrumentation | No | `false` |
| enableDnsInstrumentation | boolean | enable DNS instrumentation | No | `false`  |

## Source

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-nodec/fork). Fork us!

## Contributing

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls).

Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
