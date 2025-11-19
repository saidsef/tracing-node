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

import {AwsInstrumentation} from '@opentelemetry/instrumentation-aws-sdk';
import {AsyncHooksContextManager} from '@opentelemetry/context-async-hooks';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator} from '@opentelemetry/core';
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
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
  } = options;

  // Configure exporter with the Collector endpoint - uses gRPC
  const exportOptions = {
    concurrencyLimit: parseInt(concurrencyLimit, 10),
    url: url,
    timeoutMillis: 1000,
  };

  // Register the span processor with the tracer provider
  const exporter = new OTLPTraceExporter(exportOptions);
  const spanProcessor = new BatchSpanProcessor(exporter);

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
    resource: new resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_CONTAINER_NAME]: hostname,
    }).merge(
      detectResources({
        detectors: [envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector],
      })
    ),
    autoDetectResources: true,
  });

  // Initialize the tracer provider with propagators
  tracerProvider.register({
    contextManager: new AsyncHooksContextManager().enable(),
    propagator: new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
      ],
    }),
  });

  // Ignore spans from static assets.
  const ignoreIncomingRequestHook = (req) => {
    return req.url.startsWith('/metrics') || req.url.startsWith('/healthz');
  };

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
      ignoreIncomingRequestHook,
      applyCustomAttributesOnSpan,
      requestHook: (span, request) => {
        // Enrich spans with additional HTTP request attributes
        if (request.headers) {
          const userAgent = request.headers['user-agent'];
          const contentType = request.headers['content-type'];
          const contentLength = request.headers['content-length'];

          if (userAgent) span.setAttribute('http.user_agent', userAgent);
          if (contentType) span.setAttribute('http.request.content_type', contentType);
          if (contentLength) span.setAttribute('http.request.content_length', parseInt(contentLength, 10));
        }
      },
      responseHook: (span, response) => {
        // Add response attributes for better observability
        if (response.headers) {
          const contentType = response.headers['content-type'];
          const contentLength = response.headers['content-length'];

          if (contentType) span.setAttribute('http.response.content_type', contentType);
          if (contentLength) span.setAttribute('http.response.content_length', parseInt(contentLength, 10));
        }
      },
      headersToSpanAttributes: {
        server: {
          requestHeaders: ['x-request-id', 'x-correlation-id', 'x-trace-id'],
          responseHeaders: ['x-request-id', 'x-correlation-id'],
        },
        client: {
          requestHeaders: ['x-request-id', 'x-correlation-id', 'x-trace-id'],
          responseHeaders: ['x-request-id', 'x-correlation-id'],
        },
      },
    }),
    new ExpressInstrumentation({
      ignoreIncomingRequestHook,
      requestHook: (span, request) => {
        // Add Express-specific attributes
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
        // Add user context if available
        if (request.user?.id) {
          span.setAttribute('user.id', request.user.id);
        }
      },
    }),
    new PinoInstrumentation({
      logHook: (span, record) => {
        // Inject trace context into log records
        const spanContext = span.spanContext();
        record['trace_id'] = spanContext.traceId;
        record['span_id'] = spanContext.spanId;
        record['trace_flags'] = `0${spanContext.traceFlags.toString(16)}`;

        // Add service name for better log correlation
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
    new ConnectInstrumentation({
      ignoreIncomingRequestHook,
      requestHook: (span, request) => {
        // Add Connect middleware attributes
        if (request.url) {
          span.setAttribute('connect.url', request.url);
        }
        if (request.method) {
          span.setAttribute('connect.method', request.method);
        }
      },
    }),
    new AwsInstrumentation({
      suppressInternalInstrumentation: false,
      sqsExtractContextPropagationFromPayload: true,
      preRequestHook: (span, request) => {
        // Add peer.service attribute for better service map visualization
        const serviceName = request.serviceName || request.service?.serviceIdentifier;
        if (serviceName) {
          span.setAttribute('peer.service', serviceName.toLowerCase());
          span.setAttribute('aws.service', serviceName.toLowerCase());
        }
      },
      responseHook: (span, response) => {
        // Add additional attributes from response if available
        if (response?.requestId) {
          span.setAttribute('aws.request_id', response.requestId);
        }
      },
    }),
    new IORedisInstrumentation({
      requireParentSpan: false,
      requestHook: (span, cmdName, cmdArgs) => {
        // Set peer.service for service graph visualization - CRITICAL for Tempo
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
        // Ensure peer.service persists through response
        span.setAttribute('peer.service', 'redis');

        // Add command details for better observability
        if (cmdName) {
          span.setAttribute('db.operation', cmdName.toUpperCase());
        }

        // Log response size if available
        if (response !== undefined && response !== null) {
          const responseType = typeof response;
          span.setAttribute('db.response.type', responseType);

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
    instrumentations.push(new DnsInstrumentation({
      ignoreHostnames: ['localhost', '127.0.0.1', '::1'],
      requestHook: (span, request) => {
        // Add DNS query details for better observability
        if (request.hostname) {
          span.setAttribute('dns.hostname', request.hostname);
          span.updateName(`DNS ${request.hostname}`);
        }
        if (request.rrtype) {
          span.setAttribute('dns.record_type', request.rrtype);
        }
        // Add additional context
        span.setAttribute('peer.service', 'dns');
        span.setAttribute('dns.query_count', 1);
      },
      responseHook: (span, response) => {
        // Add DNS response details
        if (Array.isArray(response)) {
          span.setAttribute('dns.result_count', response.length);
          // Log first few results for debugging (limit to avoid overwhelming spans)
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
        // Enhanced error tracking for DNS failures
        if (error) {
          span.setAttribute('dns.error', true);
          span.setAttribute('dns.error.code', error.code || 'UNKNOWN');
          span.setAttribute('dns.error.message', error.message || 'DNS lookup failed');

          // Categorize common DNS errors
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
      console.info('Tracing has been successfully shut down.');
    } catch (error) {
      console.error('Error during tracing shutdown:', error);
    }
  } else {
    console.warn('Tracer provider is not initialized.');
  }
}
