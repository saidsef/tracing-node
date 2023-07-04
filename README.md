# Opentelemetry Wrapper for Tracing Node Applications

Get telemetry for your app in less than 3 minutes!

A wrapper around opentelemetry and set of instrumentation applications. This is to make instrumentation (more) idempotent.

## Prerequisites
- NodeJS
- ...
- Profit!

## Instalation

```
npm install @saidsef/trace-node --save
```

## Usage

```
const { setupTracing } = require('@saidsef/tace-node');
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
