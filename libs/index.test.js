const assert = require('assert');
const sinon = require('sinon');

// Mocking OpenTelemetry and its dependencies
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } = require('@opentelemetry/core');

const { setupTracing } = require('./index');

// Mocking OpenTelemetry and its dependencies
sinon.stub(NodeTracerProvider.prototype, 'addSpanProcessor');
sinon.stub(NodeTracerProvider.prototype, 'register');
sinon.stub(CompositePropagator.prototype, 'constructor');
sinon.stub(W3CBaggagePropagator.prototype, 'constructor');
sinon.stub(W3CTraceContextPropagator.prototype, 'constructor');

// Test case for setupTracing function
function testSetupTracing() {
  const serviceName = 'test-service';
  const tracer = setupTracing(serviceName);

  // Ensure that setupTracing returns a valid tracer
  assert(tracer, 'Tracer should exist');

  console.log('Setup Tracing test passed successfully');
}

// Test case for setupTracing function with optional parameters
function testSetupTracingWithOptionalParams() {
  const serviceName = 'test-service';
  const appName = 'test-app';
  const endpoint = 'https://your-collector-endpoint'; // Provide your collector endpoint here

  const tracer = setupTracing(serviceName, appName, endpoint);

  // Ensure that setupTracing with optional parameters returns a valid tracer
  assert(tracer, 'Tracer should exist');

  console.log('Setup Tracing with optional params test passed successfully');
}

// Run the tests
testSetupTracing();
testSetupTracingWithOptionalParams();
