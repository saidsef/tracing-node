# Opentelemetry Wrapper for Tracing Node Applications 

[![CI](https://github.com/saidsef/tracing-node/actions/workflows/pr.yml/badge.svg)](#Instalation) [![Release](https://github.com/saidsef/tracing-node/actions/workflows/release.yml/badge.svg)](#Instalation) ![GitHub issues](https://img.shields.io/github/issues/saidsef/tracing-node)
 ![npm](https://img.shields.io/npm/v/%40saidsef%2Ftracing-node) ![npm](https://img.shields.io/npm/dt/%40saidsef/tracing-node)



Get telemetry for your app in less than 3 minutes!

A wrapper around opentelemetry and set of instrumentation applications. This is to make instrumentation (more) idempotent.

## Prerequisites
- NodeJS
- ...
- Profit!

## Instalation

```
npm install @saidsef/tracing-node --save
```

## Usage

```
const { setupTracing } = require('@saidsef/tacing-node');
setupTracing('hostname', 'application_name', 'endpoint')
```

### Required Parameters are

| Name | Type | Description|
|----- | ---- | ------------- |
| hostname | string | container / pod hostname | 
| application_name | string | service / application name |
| endpoint | string | tracing endpoint i.e. `<schema>://<host>:<port>` |

## Source

Our latest and greatest source of `tracing-node` can be found on [GitHub](https://github.com/saidsef/tracing-nodec/fork). Fork us!

## Contributing

We would :heart: you to contribute by making a [pull request](https://github.com/saidsef/tracing-node/pulls).

Please read the official [Contribution Guide](./CONTRIBUTING.md) for more information on how you can contribute.
