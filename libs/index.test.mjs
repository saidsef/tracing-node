// tracing.test.mjs
import { setupTracing } from './index.mjs';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

// Mocking external dependencies
jest.mock('@opentelemetry/sdk-trace-node', () => {
  const originalModule = jest.requireActual('@opentelemetry/sdk-trace-node');
  return {
    ...originalModule,
    NodeTracerProvider: jest.fn().mockImplementation(() => ({
      addSpanProcessor: jest.fn(),
      register: jest.fn(),
      getTracer: jest.fn().mockReturnValue({}),
      resource: {
        attributes: {},
      },
    })),
  };
});

jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn(),
  SpanProcessor: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPTraceExporter: jest.fn(),
}));

describe('setupTracing', () => {
  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    NodeTracerProvider.mockClear();
    BatchSpanProcessor.mockClear();
    OTLPTraceExporter.mockClear();
  });

  it('should create a tracer with default parameters', () => {
    const tracer = setupTracing('test-service');
    expect(NodeTracerProvider).toHaveBeenCalledTimes(1);
    expect(BatchSpanProcessor).toHaveBeenCalledTimes(1);
    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      serviceName: 'test-service',
      url: null,
    });
    expect(tracer).toBeDefined();
  });

  it('should create a tracer with custom application name and endpoint', () => {
    const tracer = setupTracing('test-service', 'custom-app', 'custom-endpoint');
    expect(NodeTracerProvider).toHaveBeenCalledTimes(1);
    expect(BatchSpanProcessor).toHaveBeenCalledTimes(1);
    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      serviceName: 'test-service',
      url: 'custom-endpoint',
    });
    expect(tracer).toBeDefined();
  });

});
