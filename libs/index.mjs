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
import {B3Propagator, B3InjectEncoding} from '@opentelemetry/propagator-b3';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator} from '@opentelemetry/core';
import {ConnectInstrumentation} from '@opentelemetry/instrumentation-connect';
import {diag, DiagConsoleLogger, DiagLogLevel} from '@opentelemetry/api';
import {DnsInstrumentation} from '@opentelemetry/instrumentation-dns';
import {ExpressInstrumentation} from '@opentelemetry/instrumentation-express';
import {FastifyInstrumentation} from '@opentelemetry/instrumentation-fastify';
import {HttpInstrumentation} from '@opentelemetry/instrumentation-http';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {IORedisInstrumentation} from '@opentelemetry/instrumentation-ioredis';
import {registerInstrumentations} from '@opentelemetry/instrumentation';
import {Resource} from '@opentelemetry/resources';
import {ATTR_SERVICE_NAME} from '@opentelemetry/semantic-conventions';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

/**
* Sets up tracing for the application using OpenTelemetry.
*
* This function configures a NodeTracerProvider with various instrumentations
* and span processors to enable tracing for the application. It supports
* tracing for HTTP, Express, AWS, Pino, and DNS.
*
* @param {Object} options - Configuration options for tracing.
* @param {string} [options.hostname=process.env.HOSTNAME] - The hostname of the service.
* @param {string} [options.serviceName=process.env.SERVICE_NAME] - The name of the service.
* @param {string} [options.url=process.env.ENDPOINT] - The endpoint URL for the tracing collector.
* @param {number} [options.concurrencyLimit=10] - The concurrency limit for the exporter.
*
* @returns {Tracer} - The tracer for the service.
*/
let tracerProvider = null; // Declare provider in module scope for access in stopTracing

export function setupTracing(options = {}) {
  const {
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
  } = options;

  // Configure exporter with the Collector endpoint - uses gRPC
  const exportOptions = {
    concurrencyLimit: concurrencyLimit,
    url: url,
    timeoutMillis: 1000,
  };

  // Register the span processor with the tracer provider
  const exporter = new OTLPTraceExporter(exportOptions);
  const spanProcessor = new BatchSpanProcessor(exporter);

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
  });

  // Initialize the tracer provider with propagators
  tracerProvider.register({
    propagator: new CompositePropagator({
    propagators: [
      new W3CBaggagePropagator(),
      new W3CTraceContextPropagator(),
      new B3Propagator({ injectEncoding: B3InjectEncoding.MULTI_HEADER }),
      ],
    }),
  });

  // Ignore spans from static assets.
  const ignoreIncomingRequestHook = (req) => {
    const isStaticAsset = !!req.url.match(/^\/metrics|\/healthz.*$/);
    return isStaticAsset;
  };

  // Register instrumentations
  registerInstrumentations({
  tracerProvider: tracerProvider,
  instrumentations: [
    new PinoInstrumentation(),
    new HttpInstrumentation({ requireParentforOutgoingSpans: false, requireParentforIncomingSpans: false, ignoreIncomingRequestHook, }),
    new FastifyInstrumentation(),
    new ExpressInstrumentation({ ignoreIncomingRequestHook, }),
    new ConnectInstrumentation(),
    new AwsInstrumentation({ sqsExtractContextPropagationFromPayload: true, }),
    new DnsInstrumentation(),
    new IORedisInstrumentation(),
    ],
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
