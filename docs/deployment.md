# Deployment

The library runs inside the application process, which makes deploying it a matter of configuring the application: install the package, initialise tracing before the application loads, and give the process a service name and a collector endpoint.

## Configuration in a container

Both required values have an environment variable behind them, so one image serves every environment without a code change.

```dockerfile
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY instrument.mjs app.cjs ./

ENV NODE_ENV=production
EXPOSE 8080

# --import runs the ESM tracing preload to completion before the app loads.
CMD ["node", "--import", "./instrument.mjs", "./app.cjs"]
```

```javascript
// instrument.mjs
import {setupTracing} from '@saidsef/tracing-node';

setupTracing();
```

## Kubernetes

```yaml
env:
  - name: SERVICE_NAME
    value: my-service
  - name: ENDPOINT
    value: "http://alloy.monitoring.svc.cluster.local:4317"
  - name: CONTAINER_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

`CONTAINER_NAME` comes from the downward API. `container.name` then carries the pod name, and a span can be traced back to the replica that produced it. Without it the library falls back to `HOSTNAME`, which Kubernetes sets to the pod name as well.

!!! warning "Service links can break numeric environment variables"
    Kubernetes injects `<SERVICE>_PORT=tcp://<ip>:<port>` for every service in the namespace. An application reading a variable such as `REDIS_PORT` receives a URL where it expects a port number. Set `enableServiceLinks: false` on the pod spec, as the [end to end manifests](testing.md#end-to-end-harness) do.

### Graceful shutdown

Spans are batched and exported every two seconds. A pod killed immediately loses whatever is queued. Call `stopTracing` on `SIGTERM` and leave enough termination grace period for the flush.

```javascript
process.on('SIGTERM', async () => {
  await stopTracing();
  process.exit(0);
});
```

## Sending traces to Alloy and Tempo

The exporter speaks OTLP over gRPC, which makes `ENDPOINT` the gRPC receiver of a collector, conventionally on port 4317. Any OpenTelemetry-compatible backend accepts the traces.

[grafana-loki-on-k8s](https://github.com/saidsef/grafana-loki-on-k8s) deploys the LGTM+ stack to Kubernetes with `kubectl apply -k ./deployment`, as small composable manifests instead of one chart. Traces sent to its Alloy OTLP receiver land in Tempo, and the metrics generator turns them into RED and service graph metrics in Mimir.

A service graph edge needs a caller client span paired with a callee server span, plus a name for the node at the far end. The library provides both. [Architecture](architecture.md#service-graph-attributes) covers the trace context propagation and the `peer.service` attribute behind them.

## In-cluster smoke test

`deployment/` holds a Kustomize overlay that runs the library's own test suite in a cluster.

```shell
kubectl apply -k ./deployment
kubectl logs -f pod/tracing-node
```

The pod mounts the repository through a `gitRepo` volume, then runs `npm install`, loads `libs/index.mjs` and runs the tests. The `revision` field in `deployment/base/job.yml` pins the branch that gets cloned. Change it to test a different one.

!!! note
    `gitRepo` volumes are deprecated in Kubernetes. The overlay is a convenience for checking the library against a cluster's Node image. Use a real manifest to deploy an application.
