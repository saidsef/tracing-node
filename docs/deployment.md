# Deployment

The library runs inside the application process, so deploying it means configuring the application: install the package, initialise tracing before the application loads, and give the process a service name and a collector endpoint.

## Configuration in a container

Both required values have an environment variable, so an image needs no code change between environments.

```dockerfile
FROM node:22-slim
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

`CONTAINER_NAME` comes from the downward API, so `container.name` carries the pod name and a span can be traced back to the replica that produced it. Without it the library falls back to `HOSTNAME`, which Kubernetes sets to the pod name as well.

!!! warning "Service links can break numeric environment variables"
    Kubernetes injects `<SERVICE>_PORT=tcp://<ip>:<port>` for every service in the namespace. An application reading a variable such as `REDIS_PORT` receives a URL rather than a port number. Set `enableServiceLinks: false` on the pod spec, as the [end to end manifests](testing.md#end-to-end-harness) do.

### Graceful shutdown

Spans are batched and exported every two seconds, so a pod that is killed immediately loses whatever is queued. Call `stopTracing` on `SIGTERM` and leave enough termination grace period for the flush.

```javascript
process.on('SIGTERM', async () => {
  await stopTracing();
  process.exit(0);
});
```

## Sending traces to Alloy and Tempo

The exporter speaks OTLP over gRPC, so `ENDPOINT` is the gRPC receiver of a collector, conventionally on port 4317. Any OpenTelemetry-compatible backend accepts the traces.

[grafana-loki-on-k8s](https://github.com/saidsef/grafana-loki-on-k8s) deploys the LGTM+ stack to Kubernetes with `kubectl apply -k ./deployment`, as small composable manifests rather than one chart. Traces sent to its Alloy OTLP receiver land in Tempo, and the metrics generator turns them into RED and service graph metrics in Mimir.

A service graph edge needs two things, both of which the library provides:

| Requirement | Provided by |
|-------------|-------------|
| A caller client span paired with a callee server span | W3C Trace Context propagation, registered on every HTTP and fetch call |
| A name for the node at the far end | The `peer.service` attribute, set in the request hooks |

[Architecture](architecture.md#service-graph-attributes) covers how `peer.service` is derived.

## In-cluster smoke test

`deployment/` holds a Kustomize overlay that runs the library's own test suite in a cluster.

```shell
kubectl apply -k ./deployment
kubectl logs -f pod/tracing-node
```

The pod mounts the repository through a `gitRepo` volume, then runs `npm install`, loads `libs/index.mjs` and runs the tests. The `revision` field in `deployment/base/job.yml` pins the branch that is cloned, so it has to be changed to test a different one.

!!! note
    `gitRepo` volumes are deprecated in Kubernetes. The overlay is a convenience for checking the library against a cluster's Node image, not a way to deploy an application.
