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

const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { CollectorTraceExporter } = require('@opentelemetry/exporter-collector-grpc');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { AwsInstrumentation } = require('@opentelemetry/instrumentation-aws-sdk');
const { PeriodicExportingMetricReader, ConsoleMetricExporter } = require('@opentelemetry/sdk-metrics');
const { AWSXRayPropagator } = require('@opentelemetry/propagator-aws-xray');

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

function setupTracing(serviceName, appName="application", endpoint=null) {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: appName,
      [SemanticResourceAttributes.CONTAINER_NAME]: serviceName,
      [SemanticResourceAttributes.HOST_NAME]: serviceName,
      instrumentationLibrarySemanticConvention: true,
    }),
  });

  // Configure exporter with the Collector endpoint - uses gRPC
  const exporter = new CollectorTraceExporter({
    serviceName: serviceName,
    url: endpoint,
  });

  // Register the span processor with the tracer provider
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));

  // Register instrumentations
  registerInstrumentations({
    tracerProvider: provider,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter()
    }),
    instrumentations: [
      new ExpressInstrumentation({
        ignoreIncomingRequestHook(req) {
          // Ignore spans from static assets.
          const isStaticAsset = !!req.url.match(/^\/metrics.*$/);
          return isStaticAsset;
        }
      }),
      new HttpInstrumentation({
        requireParentforOutgoingSpans: false,
        requireParentforIncomingSpans: false,
        ignoreIncomingRequestHook(req) {
          // Ignore spans from static assets.
          const isStaticAsset = !!req.url.match(/^\/metrics.*$/);
          return isStaticAsset;
        }
      }),
      new AwsInstrumentation({
        sqsExtractContextPropagationFromPayload: true
      }),
    ],
  });

  // Initialize the tracer provider
  provider.register({propagator: new AWSXRayPropagator()});

  // Return the tracer for the service
  return provider.getTracer(serviceName);
}

module.exports.setupTracing = setupTracing;
