# Testing

## Unit tests

```shell
npm test
```

The suite runs on the Node test runner against `libs/index.test.mjs`, with `--trace-warnings` and `--report-uncaught-exception`. It covers the contract of `setupTracing`:

| Case | Expectation |
|------|-------------|
| No `serviceName` | Throws `serviceName is required` |
| No `url` | Throws `url is required` |
| Required parameters given | Returns a tracer |
| `hostname` given | Accepted and recorded |
| Global fetch | Instrumented by the undici instrumentation |
| Optional instrumentations | `enableFsInstrumentation` and `enableDnsInstrumentation` accepted |
| Metrics enabled | A meter provider is registered globally |
| `enableMetrics: false` | No meter provider is registered |
| `metricsUrl` given | Accepted, and the provider is still registered |
| Meter shutdown | The meter provider is unregistered, so a later setup registers again |
| Logs enabled | A logger provider is registered globally |
| `enableLogs: false` | No logger provider is registered |
| `logsUrl` given | Accepted, and the provider is still registered |
| Logger shutdown | The logger provider is unregistered, so a later setup registers again |

The providers live in module scope, so tests reset them between cases through the internal `__resetTracingForTesting` export. That export exists for the test suite and is not part of the public interface.

## Linting

```shell
npm run lint
```

ESLint runs over `libs/**` with the rule set in `eslint.config.mjs`.

## Continuous integration

The `CI` workflow runs on every pull request against `main`, over a matrix of Node 24, 25 and 26. Each job installs with `npm ci`, then runs the lint and test scripts. A pull request whose matrix passes is approved automatically by a following job.

## End to end harness

`test/e2e/` holds a demo application that exercises the instrumentations against real services and sends the spans to a collector. A single request to `/work/:id` produces an HTTP server span, an Express route span, Redis `SET` and `GET` spans, and log lines carrying the trace and span ids.

| File | Purpose |
|------|---------|
| `test/e2e/app.cjs` | Express application using IORedis and Pino, in CommonJS so modules are patched on `require` |
| `test/e2e/instrument.mjs` | Preload that calls `setupTracing()` against the local `libs/index.mjs` |
| `test/e2e/Dockerfile` | Image built from the repository root |
| `test/e2e/k8s/demo.yml` | Demo deployment and service |
| `test/e2e/k8s/redis.yml` | Redis deployment and service |

### Build and run

The build context is the repository root, so that the library source and its production dependencies are installed into the image alongside the demo application.

```shell
docker build -t tracing-e2e-demo:local -f test/e2e/Dockerfile .
```

The manifests deploy into the `monitoring` namespace and send traces to `alloy.monitoring.svc.cluster.local:4317`, which is where [grafana-loki-on-k8s](https://github.com/saidsef/grafana-loki-on-k8s) puts its OTLP receiver. Load the image into the cluster first, since `imagePullPolicy` is `IfNotPresent` and the tag is local.

```shell
kind load docker-image tracing-e2e-demo:local
kubectl apply -f test/e2e/k8s/redis.yml -f test/e2e/k8s/demo.yml
kubectl -n monitoring port-forward svc/demo 8080:8080
curl localhost:8080/work/1
```

### What to look for

| Signal | Where |
|--------|-------|
| One trace per request, spanning HTTP, Express and Redis | Tempo search for `tracing-e2e-demo` |
| Span names `GET /work/:id`, `redis.SET`, `redis.GET` | The trace view |
| `peer.service: redis` on the Redis spans | Span attributes |
| `trace_id` and `span_id` in the application logs | `kubectl -n monitoring logs deploy/demo` |
| The same log lines, queryable by `service_name` | Loki |
| A `tracing-e2e-demo` to `redis` edge | The Tempo service graph, once the metrics generator has run |

No span appears for `/healthz`, because the HTTP instrumentation ignores it. The readiness probe therefore adds nothing to the trace store.
