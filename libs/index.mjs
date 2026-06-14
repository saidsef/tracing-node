'use strict';

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

import {createRequire} from 'node:module';
import {AmqplibInstrumentation} from '@opentelemetry/instrumentation-amqplib';
import {AwsInstrumentation} from '@opentelemetry/instrumentation-aws-sdk';
import {AsyncLocalStorageContextManager} from '@opentelemetry/context-async-hooks';
import {BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler} from '@opentelemetry/sdk-trace-base';
import {CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator} from '@opentelemetry/core';
import {containerDetector} from '@opentelemetry/resource-detector-container';
import {diag, DiagConsoleLogger, DiagLogLevel, metrics, trace} from '@opentelemetry/api';
import {GrpcInstrumentation} from '@opentelemetry/instrumentation-grpc';
import {HttpInstrumentation} from '@opentelemetry/instrumentation-http';
import {DnsInstrumentation} from '@opentelemetry/instrumentation-dns';
import {ExpressInstrumentation} from '@opentelemetry/instrumentation-express';
import {KafkaJsInstrumentation} from '@opentelemetry/instrumentation-kafkajs';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {MongoDBInstrumentation} from '@opentelemetry/instrumentation-mongodb';
import {OTLPMetricExporter as OTLPGrpcMetricExporter} from '@opentelemetry/exporter-metrics-otlp-grpc';
import {OTLPMetricExporter as OTLPHttpProtoMetricExporter} from '@opentelemetry/exporter-metrics-otlp-proto';
import {OTLPTraceExporter as OTLPGrpcTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';
import {OTLPTraceExporter as OTLPHttpProtoTraceExporter} from '@opentelemetry/exporter-trace-otlp-proto';
import {PeriodicExportingMetricReader} from '@opentelemetry/sdk-metrics';
import {PgInstrumentation} from '@opentelemetry/instrumentation-pg';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {IORedisInstrumentation} from '@opentelemetry/instrumentation-ioredis';
import {RuntimeNodeInstrumentation} from '@opentelemetry/instrumentation-runtime-node';
import {UndiciInstrumentation} from '@opentelemetry/instrumentation-undici';
import {FsInstrumentation} from '@opentelemetry/instrumentation-fs';
import {resourceFromAttributes, envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector} from '@opentelemetry/resources';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';
import {ATTR_CONTAINER_NAME} from '@opentelemetry/semantic-conventions/incubating';

const requireFromConsumer = createRequire(import.meta.url);
const targetInstalled = (name) => {
  try { requireFromConsumer.resolve(name); return true; } catch { return false; }
};

const DIAG_LEVELS = {
  NONE: DiagLogLevel.NONE,
  ERROR: DiagLogLevel.ERROR,
  WARN: DiagLogLevel.WARN,
  INFO: DiagLogLevel.INFO,
  DEBUG: DiagLogLevel.DEBUG,
  VERBOSE: DiagLogLevel.VERBOSE,
  ALL: DiagLogLevel.ALL,
};

/**
* Sets up tracing for the application using OpenTelemetry's NodeSDK.
*
* Bootstraps `@opentelemetry/sdk-node` `NodeSDK` with traces (BatchSpanProcessor),
* optional metrics (PeriodicExportingMetricReader + Node runtime metrics),
* ParentBased TraceIdRatio sampling, AsyncLocalStorage context, W3C TraceContext
* + Baggage propagation, and instrumentations for HTTP, undici (native fetch),
* Express, AWS SDK, IORedis, Pino, plus auto-detected gRPC / Postgres / MongoDB
* / KafkaJS / amqplib when their target libraries are installed in the consumer.
*
* The full set of standard `OTEL_*` environment variables is honoured via
* NodeSDK (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`,
* `OTEL_PROPAGATORS`, `OTEL_SDK_DISABLED`). Programmatic options take
* precedence over environment variables.
*
* @param {Object} options - Configuration options for tracing.
* @param {string} [options.hostname=process.env.HOSTNAME] - The hostname of the service.
* @param {string} [options.serviceName=process.env.SERVICE_NAME] - The name of the service.
* @param {string} [options.url=process.env.ENDPOINT] - The endpoint URL for the tracing collector.
* @param {number} [options.concurrencyLimit=10] - The concurrency limit for the exporter.
* @param {boolean} [options.enableFsInstrumentation=false] - Enable file system instrumentation.
* @param {boolean} [options.enableDnsInstrumentation=false] - Enable DNS instrumentation.
* @param {('grpc'|'http/protobuf')} [options.exporterProtocol='grpc'] - OTLP exporter protocol.
* @param {number} [options.samplingRatio=1.0] - Head-based sampling ratio for root spans (0.0-1.0). Inherits parent decision via ParentBasedSampler.
* @param {boolean} [options.installSignalHandlers=false] - Register SIGTERM/SIGINT handlers that flush spans and exit.
* @param {boolean} [options.enableDiagLogging=false] - Enable OpenTelemetry diagnostic console logger. Also enabled if OTEL_LOG_LEVEL env var is set.
* @param {boolean} [options.enableMetrics=true] - Configure a MeterProvider so existing instrumentations emit RED-method metrics, plus Node runtime metrics.
* @param {string} [options.metricsUrl] - OTLP metrics endpoint. Defaults to `url`.
* @param {number} [options.metricExportIntervalMillis=60000] - Periodic metric reader export interval.
* @param {boolean} [options.enableGrpcInstrumentation] - Force on/off; undefined = auto-detect by probing `@grpc/grpc-js`.
* @param {boolean} [options.enablePgInstrumentation] - Force on/off; undefined = auto-detect by probing `pg`.
* @param {boolean} [options.enableMongoDBInstrumentation] - Force on/off; undefined = auto-detect by probing `mongodb`.
* @param {boolean} [options.enableKafkaJsInstrumentation] - Force on/off; undefined = auto-detect by probing `kafkajs`.
* @param {boolean} [options.enableAmqplibInstrumentation] - Force on/off; undefined = auto-detect by probing `amqplib`.
*
* @returns {Tracer} - The tracer for the service.
*/
let sdk = null;
let signalHandlers = null;

export function setupTracing(options = {}) {
  if (sdk) {
    console.warn('Tracing is already initialized. Returning existing tracer.');
    return trace.getTracer(options.serviceName || process.env.SERVICE_NAME);
  }

  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    exporterProtocol = 'grpc',
    samplingRatio = 1.0,
    installSignalHandlers = false,
    enableDiagLogging = false,
    enableMetrics = true,
    metricsUrl,
    metricExportIntervalMillis = 60000,
    enableGrpcInstrumentation,
    enablePgInstrumentation,
    enableMongoDBInstrumentation,
    enableKafkaJsInstrumentation,
    enableAmqplibInstrumentation,
  } = options;

  if (!serviceName) {
    throw new Error('serviceName is required');
  }
  if (!url) {
    throw new Error('url is required');
  }
  if (exporterProtocol !== 'grpc' && exporterProtocol !== 'http/protobuf') {
    throw new Error(`exporterProtocol must be 'grpc' or 'http/protobuf', got: ${exporterProtocol}`);
  }
  if (typeof samplingRatio !== 'number' || samplingRatio < 0 || samplingRatio > 1) {
    throw new Error(`samplingRatio must be a number between 0 and 1, got: ${samplingRatio}`);
  }

  const envLevel = process.env.OTEL_LOG_LEVEL && DIAG_LEVELS[process.env.OTEL_LOG_LEVEL.toUpperCase()];
  if (enableDiagLogging || envLevel !== undefined) {
    diag.setLogger(new DiagConsoleLogger(), envLevel ?? DiagLogLevel.INFO);
  }

  const exportOptions = {
    concurrencyLimit,
    url,
    timeoutMillis: 10000,
  };
  const TraceExporterCtor = exporterProtocol === 'http/protobuf' ? OTLPHttpProtoTraceExporter : OTLPGrpcTraceExporter;
  const traceExporter = new TraceExporterCtor(exportOptions);

  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 4096,
    maxExportBatchSize: 1024,
    scheduledDelayMillis: 2000,
    exportTimeoutMillis: 10000,
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_CONTAINER_NAME]: hostname,
  });

  let metricReaders = [];
  if (enableMetrics) {
    const MetricExporterCtor = exporterProtocol === 'http/protobuf' ? OTLPHttpProtoMetricExporter : OTLPGrpcMetricExporter;
    const metricExporter = new MetricExporterCtor({
      url: metricsUrl || url,
      concurrencyLimit,
      timeoutMillis: 10000,
    });
    metricReaders = [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: metricExportIntervalMillis,
      }),
    ];
  }

  const ignoreIncomingRequestHook = (req) => {
    return req.url.startsWith('/metrics') || req.url.startsWith('/healthz');
  };

  const applyCustomAttributesOnSpan = (span, request) => {
    const reqUrl = request?.url || request?.uri || '';
    const reqHostname = request?.hostname || request?.host || '';

    if (reqHostname.includes('elasticsearch') || reqUrl.includes('elasticsearch') ||
        reqHostname.includes(':9200') || reqUrl.includes(':9200')) {
      span.setAttribute('peer.service', 'elasticsearch');
      span.setAttribute('db.system', 'elasticsearch');
    }

    if (reqHostname.includes('redis') || reqUrl.includes('redis') ||
        reqHostname.includes(':6379') || reqUrl.includes(':6379')) {
      span.setAttribute('peer.service', 'redis');
      span.setAttribute('db.system', 'redis');
    }
  };

  const instrumentations = [
    new HttpInstrumentation({
      serverName: serviceName,
      ignoreIncomingRequestHook,
      applyCustomAttributesOnSpan,
      requestHook: (span, request) => {
        if (!request.headers) return;

        const headers = request.headers;

        const userAgent = headers['user-agent'] || headers['User-Agent'];
        const contentType = headers['content-type'] || headers['Content-Type'];
        const contentLength = headers['content-length'] || headers['Content-Length'];
        const requestId = headers['x-request-id'] || headers['X-Request-ID'];
        const correlationId = headers['x-correlation-id'] || headers['X-Correlation-ID'];

        if (userAgent) span.setAttribute('http.user_agent', userAgent);
        if (contentType) span.setAttribute('http.request.content_type', contentType);

        if (contentLength) {
          const length = parseInt(contentLength, 10);
          if (!Number.isNaN(length) && length >= 0) {
            span.setAttribute('http.request.content_length', length);
          }
        }

        if (requestId) span.setAttribute('http.request_id', requestId);
        if (correlationId) span.setAttribute('http.correlation_id', correlationId);
      },
      responseHook: (span, response) => {
        if (!response.headers) return;

        const headers = response.headers;
        const contentType = headers['content-type'] || headers['Content-Type'];
        const contentLength = headers['content-length'] || headers['Content-Length'];
        const requestId = headers['x-request-id'] || headers['X-Request-ID'];

        if (contentType) span.setAttribute('http.response.content_type', contentType);

        if (contentLength) {
          const length = parseInt(contentLength, 10);
          if (!Number.isNaN(length) && length >= 0) {
            span.setAttribute('http.response.content_length', length);
          }
        }

        if (requestId) span.setAttribute('http.request_id', requestId);
      },
    }),
    new UndiciInstrumentation({
      ignoreRequestHook: (request) => {
        const path = request?.path || '';
        return path.startsWith('/metrics') || path.startsWith('/healthz');
      },
      requestHook: (span, request) => {
        const headers = request?.headers;
        if (!headers) return;
        const headerMap = Array.isArray(headers)
          ? Object.fromEntries(
              headers
                .map((line) => typeof line === 'string' ? line.split(':') : null)
                .filter((kv) => kv && kv.length >= 2)
                .map(([k, ...rest]) => [k.trim().toLowerCase(), rest.join(':').trim()])
            )
          : headers;
        const requestId = headerMap['x-request-id'];
        const correlationId = headerMap['x-correlation-id'];
        if (requestId) span.setAttribute('http.request_id', requestId);
        if (correlationId) span.setAttribute('http.correlation_id', correlationId);
      },
    }),
    new ExpressInstrumentation({
      ignoreIncomingRequestHook,
      requestHook: (span, request) => {
        if (request.route?.path) {
          span.setAttribute('express.route', request.route.path);
          span.updateName(`${request.method} ${request.route.path}`);
        }
        if (request.params && Object.keys(request.params).length > 0) {
          span.setAttribute('express.params', JSON.stringify(request.params));
        }
        if (request.query && Object.keys(request.query).length > 0) {
          span.setAttribute('express.query', JSON.stringify(request.query));
        }
        if (request.user?.id) {
          span.setAttribute('user.id', request.user.id);
        }
      },
    }),
    new PinoInstrumentation({
      logHook: (span, record) => {
        const spanContext = span.spanContext();
        record['trace_id'] = spanContext.traceId;
        record['span_id'] = spanContext.spanId;
        record['trace_flags'] = `0${spanContext.traceFlags.toString(16)}`;

        if (serviceName) {
          record['service.name'] = serviceName;
        }
      },
      logSeverity: {
        error: 'ERROR',
        warn: 'WARN',
        info: 'INFO',
        debug: 'DEBUG',
        trace: 'TRACE',
      },
    }),
    new AwsInstrumentation({
      suppressInternalInstrumentation: false,
      sqsExtractContextPropagationFromPayload: true,
      preRequestHook: (span, request) => {
        const awsServiceName = request.serviceName || request.service?.serviceIdentifier;
        if (awsServiceName) {
          span.setAttribute('peer.service', awsServiceName.toLowerCase());
          span.setAttribute('aws.service', awsServiceName.toLowerCase());
        }
      },
      responseHook: (span, response) => {
        if (response?.requestId) {
          span.setAttribute('aws.request_id', response.requestId);
        }
      },
    }),
    new IORedisInstrumentation({
      requireParentSpan: false,
      requestHook: (span, cmdName, cmdArgs) => {
        span.setAttribute('peer.service', 'redis');
        span.setAttribute('db.system', 'redis');

        span.setAttribute('span.kind', 'CLIENT');

        span.setAttribute('net.peer.name', 'redis');
        span.setAttribute('db.connection_string', 'redis');

        if (cmdName) {
          span.setAttribute('db.operation', cmdName.toUpperCase());
          span.updateName(`redis.${cmdName.toUpperCase()}`);
        }

        if (cmdArgs && cmdArgs.length > 0) {
          span.setAttribute('db.redis.key', String(cmdArgs[0]));

          if (cmdArgs.length > 1) {
            span.setAttribute('db.redis.args_count', cmdArgs.length);
          }
        }
      },
      responseHook: (span, cmdName, cmdArgs, response) => {
        span.setAttribute('peer.service', 'redis');
        span.setAttribute('db.system', 'redis');

        if (cmdName) {
          span.setAttribute('db.operation', cmdName.toUpperCase());
        }

        if (response !== undefined && response !== null) {
          const responseType = typeof response;
          span.setAttribute('db.response.type', responseType);

          if (Array.isArray(response)) {
            span.setAttribute('db.response.count', response.length);
          }
        }
      },
      dbStatementSerializer: (cmdName, cmdArgs) => {
        const args = cmdArgs.map(arg => {
          const str = String(arg);
          return str.length > 100 ? `${str.substring(0, 100)}...` : str;
        });
        return `${cmdName} ${args.join(' ')}`;
      },
    }),
  ];

  const shouldEnable = (override, target) => {
    if (override === true) return true;
    if (override === false) return false;
    return targetInstalled(target);
  };

  if (enableMetrics) {
    instrumentations.push(new RuntimeNodeInstrumentation());
  }

  if (shouldEnable(enableGrpcInstrumentation, '@grpc/grpc-js')) {
    instrumentations.push(new GrpcInstrumentation());
  }
  if (shouldEnable(enablePgInstrumentation, 'pg')) {
    instrumentations.push(new PgInstrumentation({
      requireParentSpan: false,
      enhancedDatabaseReporting: true,
      requestHook: (span) => {
        span.setAttribute('peer.service', 'postgres');
        span.setAttribute('db.system', 'postgresql');
      },
    }));
  }
  if (shouldEnable(enableMongoDBInstrumentation, 'mongodb')) {
    instrumentations.push(new MongoDBInstrumentation({
      enhancedDatabaseReporting: false,
      responseHook: (span) => {
        span.setAttribute('peer.service', 'mongodb');
        span.setAttribute('db.system', 'mongodb');
      },
    }));
  }
  if (shouldEnable(enableKafkaJsInstrumentation, 'kafkajs')) {
    instrumentations.push(new KafkaJsInstrumentation({
      producerHook: (span) => {
        span.setAttribute('peer.service', 'kafka');
        span.setAttribute('messaging.system', 'kafka');
      },
      consumerHook: (span) => {
        span.setAttribute('peer.service', 'kafka');
        span.setAttribute('messaging.system', 'kafka');
      },
    }));
  }
  if (shouldEnable(enableAmqplibInstrumentation, 'amqplib')) {
    instrumentations.push(new AmqplibInstrumentation({
      publishHook: (span) => {
        span.setAttribute('peer.service', 'rabbitmq');
        span.setAttribute('messaging.system', 'rabbitmq');
      },
      consumeHook: (span) => {
        span.setAttribute('peer.service', 'rabbitmq');
        span.setAttribute('messaging.system', 'rabbitmq');
      },
    }));
  }

  if (enableFsInstrumentation) {
    instrumentations.push(new FsInstrumentation());
  }

  if (enableDnsInstrumentation) {
    instrumentations.push(new DnsInstrumentation({
      ignoreHostnames: ['localhost', '127.0.0.1', '::1'],
      requestHook: (span, request) => {
        if (request.hostname) {
          span.setAttribute('dns.hostname', request.hostname);
          span.updateName(`DNS ${request.hostname}`);
        }
        if (request.rrtype) {
          span.setAttribute('dns.record_type', request.rrtype);
        }
        span.setAttribute('peer.service', 'dns');
        span.setAttribute('dns.query_count', 1);
      },
      responseHook: (span, response) => {
        if (Array.isArray(response)) {
          span.setAttribute('dns.result_count', response.length);
          const resultSample = response.slice(0, 3).map(r =>
            typeof r === 'string' ? r : JSON.stringify(r)
          );
          if (resultSample.length > 0) {
            span.setAttribute('dns.results', JSON.stringify(resultSample));
          }
        } else if (response) {
          span.setAttribute('dns.result_count', 1);
          span.setAttribute('dns.result', typeof response === 'string' ? response : JSON.stringify(response));
        }
      },
      errorHook: (span, error) => {
        if (error) {
          span.setAttribute('dns.error', true);
          span.setAttribute('dns.error.code', error.code || 'UNKNOWN');
          span.setAttribute('dns.error.message', error.message || 'DNS lookup failed');

          if (error.code === 'ENOTFOUND') {
            span.setAttribute('dns.error.type', 'NOT_FOUND');
          } else if (error.code === 'ETIMEOUT') {
            span.setAttribute('dns.error.type', 'TIMEOUT');
          } else if (error.code === 'ECONNREFUSED') {
            span.setAttribute('dns.error.type', 'CONNECTION_REFUSED');
          } else {
            span.setAttribute('dns.error.type', 'OTHER');
          }
        }
      },
    }));
  }

  sdk = new NodeSDK({
    serviceName,
    resource,
    autoDetectResources: true,
    resourceDetectors: [envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector, containerDetector],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRatio),
    }),
    contextManager: new AsyncLocalStorageContextManager(),
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    spanProcessors: [spanProcessor],
    metricReaders,
    instrumentations,
  });
  sdk.start();

  if (installSignalHandlers && !signalHandlers) {
    const handler = () => {
      stopTracing().finally(() => process.exit(0));
    };
    signalHandlers = {SIGTERM: handler, SIGINT: handler};
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
  }

  return trace.getTracer(serviceName);
}

/**
* Gracefully stops the tracing by shutting down the NodeSDK.
*
* Flushes pending spans and metrics via `sdk.shutdown()`, then releases the
* global tracer / meter provider registrations on the OpenTelemetry API so a
* subsequent `setupTracing()` call can register fresh providers (the API's
* `setGlobalMeterProvider` and `setGlobalTracerProvider` are lock-once
* without an explicit `disable()` call).
*
* @returns {Promise<void>} - A promise that resolves when shutdown is complete.
*/
export async function stopTracing() {
  if (signalHandlers) {
    process.removeListener('SIGTERM', signalHandlers.SIGTERM);
    process.removeListener('SIGINT', signalHandlers.SIGINT);
    signalHandlers = null;
  }
  if (!sdk) {
    console.warn('Tracer provider is not initialized.');
    return;
  }
  try {
    await sdk.shutdown();
    console.info('Tracing has been successfully shut down.');
  } catch (error) {
    console.error('Error during tracing shutdown:', error);
  } finally {
    metrics.disable();
    trace.disable();
    sdk = null;
  }
}

/**
 * @internal
 * Resets the SDK for testing purposes.
 * DO NOT use in production code.
 */
export function __resetTracingForTesting() {
  if (signalHandlers) {
    process.removeListener('SIGTERM', signalHandlers.SIGTERM);
    process.removeListener('SIGINT', signalHandlers.SIGINT);
    signalHandlers = null;
  }
  metrics.disable();
  trace.disable();
  sdk = null;
}
