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
import {diag, DiagConsoleLogger, DiagLogLevel} from '@opentelemetry/api';
import {HttpInstrumentation} from '@opentelemetry/instrumentation-http';
import {DnsInstrumentation} from '@opentelemetry/instrumentation-dns';
import {ElasticsearchInstrumentation} from 'opentelemetry-instrumentation-elasticsearch';
import {ExpressInstrumentation} from '@opentelemetry/instrumentation-express';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {IORedisInstrumentation} from '@opentelemetry/instrumentation-ioredis';
import {registerInstrumentations} from '@opentelemetry/instrumentation';
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

/**
* Sets up tracing for the application using OpenTelemetry.
*
* This function configures a NodeTracerProvider with various instrumentations
* and span processors to enable tracing for the application. It supports
* tracing for HTTP, Express, AWS, Pino, DNS, Elasticsearch, and IORedis.
* The IORedis instrumentation includes peer.service attributes for proper
* service map visualization in distributed tracing tools like Tempo.
*
* @param {Object} options - Configuration options for tracing.
* @param {string} [options.hostname=process.env.HOSTNAME] - The hostname of the service.
* @param {string} [options.serviceName=process.env.SERVICE_NAME] - The name of the service.
* @param {string} [options.url=process.env.ENDPOINT] - The endpoint URL for the tracing collector.
* @param {number} [options.concurrencyLimit=10] - The concurrency limit for the exporter.
* @param {boolean} [options.enableFsInstrumentation=false] - Enable file system instrumentation.
* @param {boolean} [options.enableDnsInstrumentation=false] - Enable DNS instrumentation.
*
* @returns {Tracer} - The tracer for the service.
*/
let tracerProvider = null; // Declare provider in module scope for access in stopTracing

export function setupTracing(options = {}) {
  // Prevent multiple initializations - return existing provider if already set up
  if (tracerProvider) {
    console.warn('Tracing is already initialized. Returning existing tracer.');
    return tracerProvider.getTracer(options.serviceName || process.env.SERVICE_NAME);
  }

  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
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

  // Register the span processor with the tracer provider
  const exporter = new OTLPTraceExporter(exportOptions);

  // Configure BatchSpanProcessor for production workloads
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

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
    resource: detectResources({
      detectors: [envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector],
    }).merge(resourceFromAttributes(explicitAttributes)),
  });

  // Register globally. With no overrides, register() installs the modern
  // AsyncLocalStorageContextManager and a CompositePropagator of
  // W3CTraceContext + W3CBaggage - identical propagation to the previous
  // explicit config, with the recommended context manager.
  tracerProvider.register();

  // Hook to set peer service name for outgoing requests
  const applyCustomAttributesOnSpan = (span, request) => {
    const url = request?.url || request?.uri || '';
    const hostname = request?.hostname || request?.host || '';
    
    // Detect Elasticsearch endpoints
    if (hostname.includes('elasticsearch') || url.includes('elasticsearch') || 
        hostname.includes(':9200') || url.includes(':9200')) {
      span.setAttribute('peer.service', 'elasticsearch');
      span.setAttribute('db.system', 'elasticsearch');
    }

    // Detect Redis endpoints
    if (hostname.includes('redis') || url.includes('redis') || 
        hostname.includes(':6379') || url.includes(':6379')) {
      span.setAttribute('peer.service', 'redis');
      span.setAttribute('db.system', 'redis');
    }
  };

  // Register instrumentations
  const instrumentations = [
    new HttpInstrumentation({
      serverName: serviceName,
      // Ignore spans from static assets (metrics/health probes).
      ignoreIncomingRequestHook: (req) => req.url.startsWith('/metrics') || req.url.startsWith('/healthz'),
      applyCustomAttributesOnSpan,
      requestHook: (span, request) => {
        // Enrich spans with additional HTTP request attributes
        if (!request.headers) return;

        const headers = request.headers;

        // Safe header extraction with case-insensitive fallback
        const userAgent = headers['user-agent'] || headers['User-Agent'];
        const contentType = headers['content-type'] || headers['Content-Type'];
        const contentLength = headers['content-length'] || headers['Content-Length'];
        const requestId = headers['x-request-id'] || headers['X-Request-ID'];
        const correlationId = headers['x-correlation-id'] || headers['X-Correlation-ID'];

        // Only set attributes if values exist
        if (userAgent) span.setAttribute('http.user_agent', userAgent);
        if (contentType) span.setAttribute('http.request.content_type', contentType);

        setIntAttribute(span, 'http.request.content_length', contentLength);

        // Correlation headers for distributed tracing
        if (requestId) span.setAttribute('http.request_id', requestId);
        if (correlationId) span.setAttribute('http.correlation_id', correlationId);
      },
      responseHook: (span, response) => {
        // Add response attributes for better observability
        if (!response.headers) return;

        const headers = response.headers;
        const contentType = headers['content-type'] || headers['Content-Type'];
        const contentLength = headers['content-length'] || headers['Content-Length'];
        const requestId = headers['x-request-id'] || headers['X-Request-ID'];

        if (contentType) span.setAttribute('http.response.content_type', contentType);

        setIntAttribute(span, 'http.response.content_length', contentLength);

        if (requestId) span.setAttribute('http.request_id', requestId);
      },
    }),
    new ExpressInstrumentation({
      requestHook: (span, info) => {
        // info is ExpressRequestInfo: { request, route, layerType }
        const request = info.request;
        if (info.route) {
          span.setAttribute('express.route', info.route);
          if (request?.method) {
            span.updateName(`${request.method} ${info.route}`);
          }
        }
        if (request?.params && Object.keys(request.params).length > 0) {
          span.setAttribute('express.params', JSON.stringify(request.params));
        }
        if (request?.query && Object.keys(request.query).length > 0) {
          span.setAttribute('express.query', JSON.stringify(request.query));
        }
        // Add user context if available
        if (request?.user?.id) {
          span.setAttribute('user.id', request.user.id);
        }
      },
    }),
    new PinoInstrumentation({
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
        // requestInfo is IORedisRequestHookInformation: { cmdName, cmdArgs }.
        // Set peer.service for service graph visualization - CRITICAL for Tempo.
        // The span is already created with SpanKind.CLIENT and net.peer.name is
        // already set to the real host by the instrumentation, so we do not
        // override those here.
        span.setAttribute('peer.service', 'redis');
        span.setAttribute('db.system', 'redis');

        // Add command details for better observability
        if (cmdName) {
          span.setAttribute('db.operation', cmdName.toUpperCase());
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
        // peer.service, db.system and db.operation are already set on this span
        // by requestHook and persist for the span's lifetime, so they are not
        // re-set here. Record only the response shape for observability.
        if (response !== undefined && response !== null) {
          span.setAttribute('db.response.type', typeof response);
          if (Array.isArray(response)) {
            span.setAttribute('db.response.count', response.length);
          }
        }
      },
      dbStatementSerializer: (cmdName, cmdArgs) => {
        // Serialize command for better observability (limit arg length to avoid huge spans)
        const args = cmdArgs.map(arg => {
          const str = String(arg);
          return str.length > 100 ? `${str.substring(0, 100)}...` : str;
        });
        return `${cmdName} ${args.join(' ')}`;
      },
    }),
    new ElasticsearchInstrumentation(),
  ];

  if (enableFsInstrumentation) {
    // Enable fs instrumentation if specified
    // This instrumentation is useful for tracing file system operations.
    instrumentations.push(new FsInstrumentation());
  }

  if (enableDnsInstrumentation) {
    // Enable DNS instrumentation if specified
    // This instrumentation is useful for tracing DNS operations.
    // DnsInstrumentationConfig only supports ignoreHostnames; it has no
    // request/response/error hooks.
    instrumentations.push(new DnsInstrumentation({
      ignoreHostnames: ['localhost', '127.0.0.1', '::1'],
    }));
  }

  // Register instrumentations
  registerInstrumentations({
    tracerProvider: tracerProvider,
    instrumentations: instrumentations,
  });

  // Return the tracer for the service
  return tracerProvider.getTracer(serviceName);
}

/**
* Gracefully stops the tracing by shutting down the tracer provider.
*
* This function ensures that all pending spans are exported and resources are
* cleaned up properly. It is recommended to call this function during the
* application's shutdown process.
*
* @returns {Promise<void>} - A promise that resolves when shutdown is complete.
*/
export async function stopTracing() {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      tracerProvider = null;
      console.info('Tracing has been successfully shut down.');
    } catch (error) {
      console.error('Error during tracing shutdown:', error);
    }
  } else {
    console.warn('Tracer provider is not initialized.');
  }
}

/**
 * @internal
 * Resets the tracer provider for testing purposes.
 * DO NOT use in production code.
 */
export function __resetTracingForTesting() {
  tracerProvider = null;
}
