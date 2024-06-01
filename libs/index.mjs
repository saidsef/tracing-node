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

import {CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator} from '@opentelemetry/core';
import {registerInstrumentations} from '@opentelemetry/instrumentation';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-grpc';
import {HttpInstrumentation} from '@opentelemetry/instrumentation-http';
import {ExpressInstrumentation} from '@opentelemetry/instrumentation-express';
import {diag, DiagConsoleLogger, DiagLogLevel} from '@opentelemetry/api';
import {Resource} from '@opentelemetry/resources';
import {SemanticResourceAttributes} from '@opentelemetry/semantic-conventions';
import {AwsInstrumentation} from '@opentelemetry/instrumentation-aws-sdk';
import {PinoInstrumentation} from '@opentelemetry/instrumentation-pino';
import {DnsInstrumentation} from '@opentelemetry/instrumentation-dns';
import {B3Propagator, B3InjectEncoding} from '@opentelemetry/propagator-b3';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

/**
* Sets up tracing for a given service, allowing for the collection and export of trace data.
* This function configures a NodeTracerProvider with specific resource attributes, including
* service name, namespace, and host. It also configures an exporter using the OTLP protocol
* over gRPC, with the option to specify an endpoint. Instrumentations for HTTP, Express,
* AWS, Pino, and DNS are registered to capture relevant spans. The function finally returns
* a tracer specific to the service for initiating and exporting spans.
*
* @param {string} serviceName - The name of the service to be traced. This will be used to
* label traces and is essential for identifying traces belonging
* to this service.
* @param {string} [appName="application"] - The namespace or application name the service
* belongs to. This helps in grouping services under
* a common namespace for better trace organization.
* @param {string|null} [endpoint=null] - The endpoint URL for the OTLP gRPC exporter. If not
* provided, the exporter will default to its standard
* configuration, which might not be suitable for all
* deployments.
* @returns {Tracer} - Returns a Tracer instance configured for the service. This tracer can
* be used to create and export spans for tracing various operations within
* the service.
*/
export function setupTracing (serviceName, appName='application', endpoint=null) {
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
  const exportOptions = {
    serviceName: serviceName,
    url: endpoint,
  };

  // Register the span processor with the tracer provider
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter(exportOptions)));

  // Ignore spans from static assets.
  const ignoreIncomingRequestHook = (req) => {
    const isStaticAsset = !!req.url.match(/^\/metrics|\/healthz.*$/);
    return isStaticAsset;
  };

  // Register instrumentations
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation({
        requireParentforOutgoingSpans: false,
        requireParentforIncomingSpans: false,
        ignoreIncomingRequestHook,
      }),
      new ExpressInstrumentation({
        ignoreIncomingRequestHook,
      }),
      new AwsInstrumentation({
        sqsExtractContextPropagationFromPayload: true
      }),
      new PinoInstrumentation({
        logHook: (span, record) => {
          record['resource.service.name'] = provider.resource.attributes['service.name'];
        },
      }),
      new DnsInstrumentation(),
    ],
  });

  // Initialize the tracer provider
  provider.register({
    propagator: new CompositePropagator({
      propagators: [new W3CBaggagePropagator(), new W3CTraceContextPropagator(), new B3Propagator({injectEncoding: B3InjectEncoding.MULTI_HEADER})],
  })});

  // Return the tracer for the service
  return provider.getTracer(serviceName);
}
