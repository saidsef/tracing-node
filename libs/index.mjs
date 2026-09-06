/*
 * Copyright Said Sef
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {AwsInstrumentation} from '@opentelemetry/instrumentation-aws-sdk';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {ConnectInstrumentation} from '@opentelemetry/instrumentation-connect';
import {diag, DiagConsoleLogger, DiagLogLevel, metrics} from '@opentelemetry/api';
import {HttpInstrumentation} from '@opentelemetry/instrumentation-http';
import {DnsInstrumentation} from '@opentelemetry/instrumentation-dns';
import {ElasticsearchInstrumentation} from 'opentelemetry-instrumentation-elasticsearch';
import {ExpressInstrumentation, ExpressLayerType} from '@opentelemetry/instrumentation-express';
import {logs} from '@opentelemetry/api-logs';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {OTLPLogExporter} from '@opentelemetry/exporter-logs-otlp-grpc';
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-grpc';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {UndiciInstrumentation} from '@opentelemetry/instrumentation-undici';
import {IORedisInstrumentation} from '@opentelemetry/instrumentation-ioredis';
import {registerInstrumentations} from '@opentelemetry/instrumentation';
import {RuntimeNodeInstrumentation} from '@opentelemetry/instrumentation-runtime-node';
import {MeterProvider, PeriodicExportingMetricReader} from '@opentelemetry/sdk-metrics';
import {BatchLogRecordProcessor, LoggerProvider} from '@opentelemetry/sdk-logs';
import {FsInstrumentation} from '@opentelemetry/instrumentation-fs';
import {resourceFromAttributes, detectResources, envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector} from '@opentelemetry/resources';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {ATTR_CONTAINER_NAME} from '@opentelemetry/semantic-conventions/incubating';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Set a non-negative integer span attribute from a header value; ignore invalid input.
const setIntAttribute = (span, name, value) => {
  if (!value) return;
  const parsed = parseInt(value, 10);
  if (!Number.isNaN(parsed) && parsed >= 0) {
    span.setAttribute(name, parsed);
  }
};

// Slice before converting: String(buf) decodes a whole 1MB Buffer only to throw
// it away. 4 bytes per UTF-16 unit plus slack keeps the result byte-identical.
const truncateArg = (value, limit) => {
  const str = Buffer.isBuffer(value) ? value.subarray(0, limit * 4 + 8).toString() : String(value);
  return str.length > limit ? `${str.substring(0, limit)}...` : str;
};

// Tempo names a service-graph node from peer.service, which no instrumentation
// emits, so both the http and undici hooks below derive it from the remote host.
const PEER_SERVICES = ['elasticsearch', 'redis'];

const setPeerService = (span, host) => {
  if (!host) return;
  for (const service of PEER_SERVICES) {
    if (host.includes(service)) {
      span.setAttribute('peer.service', service);
      span.setAttribute('db.system.name', service);
      return;
    }
  }
};

// The express hook runs once per layer span - every middleware, every router,
// and the request handler. Only the request handler carries the matched route,
// so the rest return before serialising anything.
const expressRequestHook = (span, info) => {
  // info is ExpressRequestInfo: { request, route, layerType }
  if (info?.layerType !== ExpressLayerType.REQUEST_HANDLER) return;

  const request = info.request;
  if (info.route) {
    span.setAttribute('express.route', info.route);
  }
  if (request?.params && Object.keys(request.params).length > 0) {
    span.setAttribute('express.params', JSON.stringify(request.params));
  }
  // Names only. Query values carry tokens and personal data, and the span
  // attribute value length limit defaults to unbounded.
  const queryKeys = request?.query ? Object.keys(request.query) : [];
  if (queryKeys.length > 0) {
    span.setAttribute('express.query_keys', queryKeys.sort());
  }
  // Add user context if available
  if (request?.user?.id) {
    span.setAttribute('user.id', request.user.id);
  }
};

let tracerProvider = null; // Declare provider in module scope for access in stopTracing
let meterProvider = null;
let loggerProvider = null;

/**
* Sets up tracing for the application using OpenTelemetry.
*
* This function configures a NodeTracerProvider with various instrumentations
* and span processors to enable tracing for the application. It supports
* tracing for HTTP, Express, AWS, Pino, DNS, Elasticsearch, and IORedis.
* The IORedis instrumentation includes peer.service attributes for proper
* service map visualization in distributed tracing tools like Tempo.
*
* A MeterProvider is registered alongside it, which is what makes the
* instrumentations record the request duration histograms they already
* compute, and adds the Node runtime metrics.
*
* @param {Object} options - Configuration options for tracing.
* @param {string} [options.hostname=process.env.CONTAINER_NAME || process.env.HOSTNAME] - The hostname of the service.
* @param {string} [options.serviceName=process.env.SERVICE_NAME] - The name of the service.
* @param {string} [options.url=process.env.ENDPOINT] - The endpoint URL for the tracing collector.
* @param {number} [options.concurrencyLimit=10] - The concurrency limit for the exporter.
* @param {boolean} [options.enableFsInstrumentation=false] - Enable file system instrumentation.
* @param {boolean} [options.enableDnsInstrumentation=false] - Enable DNS instrumentation.
* @param {boolean} [options.enableMetrics=true] - Export metrics as well as traces.
* @param {string} [options.metricsUrl=options.url] - Endpoint for metrics, when it differs from the trace endpoint.
* @param {number} [options.metricExportIntervalMillis=60000] - How often metrics are exported.
* @param {boolean} [options.enableLogs=true] - Send Pino log records over OTLP.
* @param {string} [options.logsUrl=options.url] - Endpoint for logs, when it differs from the trace endpoint.
*
* @returns {Tracer} - The tracer for the service.
*/
export function setupTracing(options = {}) {
  // Prevent multiple initializations - return existing provider if already set up
  if (tracerProvider) {
    diag.warn('Tracing is already initialized. Returning existing tracer.');
    return tracerProvider.getTracer(options.serviceName || process.env.SERVICE_NAME);
  }

  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    enableMetrics = true,
    metricsUrl = url,
    metricExportIntervalMillis = 60000,
    enableLogs = true,
    logsUrl = url,
  } = options;

  // Validate required parameters
  if (!serviceName) {
    throw new Error('serviceName is required');
  }
  if (!url) {
    throw new Error('url is required');
  }

  // Configure exporter with the Collector endpoint - uses gRPC
  const exportOptions = {
    concurrencyLimit,
    url,
    timeoutMillis: 10000,
  };

  const exporter = new OTLPTraceExporter(exportOptions);

  const spanProcessor = new BatchSpanProcessor(exporter, {
    maxQueueSize: 4096,
    maxExportBatchSize: 1024,
    scheduledDelayMillis: 2000,
    exportTimeoutMillis: 10000,
  });

  // Explicit attributes (service/container) must win over env detection, so
  // detect first and merge the explicit resource on top. Only include defined
  // keys so an undefined hostname does not write container.name: undefined.
  const explicitAttributes = {[ATTR_SERVICE_NAME]: serviceName};
  if (hostname) {
    explicitAttributes[ATTR_CONTAINER_NAME] = hostname;
  }

  // One resource for every signal. Grafana pairs a metric and a log line with
  // a trace on service.name, so the providers carry an identical resource.
  const resource = detectResources({
    detectors: [envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector],
  }).merge(resourceFromAttributes(explicitAttributes));

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
    resource,
  });

  if (enableMetrics) {
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({...exportOptions, url: metricsUrl}),
          exportIntervalMillis: metricExportIntervalMillis,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  }

  if (enableLogs) {
    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({...exportOptions, url: logsUrl}),
          maxQueueSize: 4096,
          maxExportBatchSize: 1024,
          scheduledDelayMillis: 2000,
          exportTimeoutMillis: 10000,
        }),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  }

  // Register globally. With no overrides, register() installs the modern
  // AsyncLocalStorageContextManager and a CompositePropagator of
  // W3CTraceContext + W3CBaggage - identical propagation to the previous
  // explicit config, with the recommended context manager.
  tracerProvider.register();

  // Only an outgoing ClientRequest carries .host, so bailing without it keeps
  // server spans out: peer.service must name the remote service being called.
  const applyCustomAttributesOnSpan = (span, request) => setPeerService(span, request?.host);

  const instrumentations = [
    new HttpInstrumentation({
      // Ignore spans from static assets (metrics/health probes).
      ignoreIncomingRequestHook: (req) => req.url.startsWith('/metrics') || req.url.startsWith('/healthz'),
      applyCustomAttributesOnSpan,
      requestHook: (span, request) => {
        // Outgoing ClientRequest exposes getHeaders(); incoming IncomingMessage has .headers.
        const headers = request.getHeaders?.() ?? request.headers;
        if (!headers) return;

        const contentType = headers['content-type'];
        const requestId = headers['x-request-id'];
        const correlationId = headers['x-correlation-id'];

        if (contentType) span.setAttribute('http.request.content_type', contentType);
        setIntAttribute(span, 'http.request.content_length', headers['content-length']);
        if (requestId) span.setAttribute('http.request_id', requestId);
        if (correlationId) span.setAttribute('http.correlation_id', correlationId);
      },
      responseHook: (span, response) => {
        if (!response.headers) return;

        const headers = response.headers;
        const contentType = headers['content-type'];
        const requestId = headers['x-request-id'];

        if (contentType) span.setAttribute('http.response.content_type', contentType);
        setIntAttribute(span, 'http.response.content_length', headers['content-length']);
        if (requestId) span.setAttribute('http.request_id', requestId);
      },
    }),
    // globalThis.fetch runs on undici, which never touches the http/https
    // modules HttpInstrumentation patches. Without this, fetch calls produce no
    // client span and inject no traceparent, so the callee starts a new trace
    // and the two services can never be paired into a service-graph edge.
    new UndiciInstrumentation({
      // UndiciRequest exposes origin, not the .host the http hook reads.
      requestHook: (span, request) => setPeerService(span, request?.origin),
    }),
    new ExpressInstrumentation({
      requestHook: expressRequestHook,
    }),
    new PinoInstrumentation({
      // Log sending is on by default, and every record is parsed and rebuilt as
      // a LogRecord before it reaches a logger. With no logger provider that
      // work is done for a no-op, so turn it off rather than pay for nothing.
      disableLogSending: !enableLogs,
      logHook: (span, record) => {
        // trace_id/span_id/trace_flags are injected by the instrumentation by
        // default; only add service name for better log correlation.
        if (serviceName) {
          record['service.name'] = serviceName;
        }
      },
    }),
    // ConnectInstrumentation accepts only the base InstrumentationConfig; it has
    // no request/ignore hooks, so configure it with defaults.
    new ConnectInstrumentation(),
    new AwsInstrumentation({
      suppressInternalInstrumentation: false,
      sqsExtractContextPropagationFromPayload: true,
      preRequestHook: (span, requestInfo) => {
        // requestInfo is AwsSdkRequestHookInformation: { request: NormalizedRequest }
        const awsServiceName = requestInfo.request?.serviceName;
        if (awsServiceName) {
          span.setAttribute('peer.service', awsServiceName.toLowerCase());
          span.setAttribute('aws.service', awsServiceName.toLowerCase());
        }
      },
      responseHook: (span, responseInfo) => {
        // responseInfo is AwsSdkResponseHookInformation: { response: NormalizedResponse }
        const requestId = responseInfo.response?.requestId;
        if (requestId) {
          span.setAttribute('aws.request_id', requestId);
        }
      },
    }),
    new IORedisInstrumentation({
      requireParentSpan: false,
      requestHook: (span, {cmdName, cmdArgs}) => {
        // peer.service drives the Tempo service graph and is never emitted by
        // the instrumentation, so it has to be set here. db.system.name,
        // db.operation.name and server.* already come from the instrumentation.
        span.setAttribute('peer.service', 'redis');

        if (cmdName) {
          span.updateName(`redis.${cmdName.toUpperCase()}`);
        }

        // Add key information (first argument is usually the key)
        if (cmdArgs && cmdArgs.length > 0) {
          span.setAttribute('db.redis.key', String(cmdArgs[0]));

          // For operations with multiple keys or complex args
          if (cmdArgs.length > 1) {
            span.setAttribute('db.redis.args_count', cmdArgs.length);
          }
        }
      },
      responseHook: (span, cmdName, cmdArgs, response) => {
        // peer.service is already set by requestHook and persists for the
        // span's lifetime, so only the response shape is recorded here.
        if (response !== undefined && response !== null) {
          span.setAttribute('db.response.type', typeof response);
          if (Array.isArray(response)) {
            span.setAttribute('db.response.count', response.length);
          }
        }
      },
      dbStatementSerializer: (cmdName, cmdArgs) => {
        const args = cmdArgs.map(arg => truncateArg(arg, 100));
        return `${cmdName} ${args.join(' ')}`;
      },
    }),
    new ElasticsearchInstrumentation(),
    // Event loop delay, GC pauses and heap occupancy are metric-only, and they
    // are what explains a whole service slowing at once. Constructed only with
    // metrics on, since the collectors start sampling on construction.
    ...(enableMetrics ? [new RuntimeNodeInstrumentation()] : []),
    // Spread so the optional instrumentations are constructed only when enabled:
    // FsInstrumentation patches fs on construction.
    ...(enableFsInstrumentation ? [new FsInstrumentation()] : []),
    // DnsInstrumentationConfig accepts only ignoreHostnames; it has no hooks.
    ...(enableDnsInstrumentation ? [new DnsInstrumentation({ignoreHostnames: ['localhost', '127.0.0.1', '::1']})] : []),
  ];

  // Register instrumentations. Without meterProvider the instrumentations get
  // the no-op meter, and the histograms they already record are discarded.
  registerInstrumentations({
    tracerProvider,
    meterProvider,
    loggerProvider,
    instrumentations,
  });

  // Return the tracer for the service
  return tracerProvider.getTracer(serviceName);
}

/**
* Gracefully stops the tracing by shutting down every provider it registered.
*
* This function ensures that all pending spans, metrics and log records are
* exported and resources are cleaned up properly. It is recommended to call
* this function during the application's shutdown process.
*
* @returns {Promise<void>} - A promise that resolves when shutdown is complete.
*/
export async function stopTracing() {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      tracerProvider = null;
      diag.info('Tracing has been successfully shut down.');
    } catch (error) {
      diag.error('Error during tracing shutdown:', error);
    }
  } else {
    diag.warn('Tracer provider is not initialized.');
  }

  // Separate from the trace shutdown, so a failing exporter on one signal
  // still lets the other flush.
  if (meterProvider) {
    try {
      await meterProvider.shutdown();
      meterProvider = null;
      // The API refuses a second setGlobalMeterProvider, so unregister here or
      // a later setupTracing leaves the global pointing at a dead provider.
      metrics.disable();
      diag.info('Metrics have been successfully shut down.');
    } catch (error) {
      diag.error('Error during metrics shutdown:', error);
    }
  }

  if (loggerProvider) {
    try {
      await loggerProvider.shutdown();
      diag.info('Logs have been successfully shut down.');
    } catch (error) {
      diag.error('Error during logs shutdown:', error);
    } finally {
      // A second setGlobalLoggerProvider is ignored, so unregister whatever the
      // flush did, or a later setupTracing keeps writing to a dead provider.
      loggerProvider = null;
      logs.disable();
    }
  }
}

/**
 * @internal
 * The express request hook, exposed so it can be driven without Express.
 * DO NOT use in production code.
 */
export const __expressRequestHookForTesting = expressRequestHook;

/**
 * @internal
 * Resets the tracer provider for testing purposes.
 * DO NOT use in production code.
 */
export function __resetTracingForTesting() {
  tracerProvider = null;
  meterProvider = null;
  loggerProvider = null;
}
