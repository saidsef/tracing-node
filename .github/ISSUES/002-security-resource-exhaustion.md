# Security Fix: Potential Resource Exhaustion in Batch Span Processing

## Category
🔒 Security Fix

## Priority
Medium

## Problem Statement

The current implementation uses `BatchSpanProcessor` with default settings, which may not have appropriate limits configured. This can lead to resource exhaustion attacks where an attacker could:

1. **Memory Exhaustion**: Generate a large number of spans that accumulate in the batch processor's queue, consuming excessive memory
2. **CPU Exhaustion**: Force the processor to handle extremely large batches, causing CPU spikes
3. **Network Flooding**: Cause the exporter to send excessive data to the collector endpoint

The code currently doesn't set explicit limits on:
- Maximum queue size
- Maximum batch size
- Maximum export interval
- Span attribute size limits

## Current Code (Vulnerable)
```javascript
// libs/index.mjs
const exporter = new OTLPTraceExporter(exportOptions);
const spanProcessor = new BatchSpanProcessor(exporter);

tracerProvider = new NodeTracerProvider({
  spanProcessors: [spanProcessor],
  // No limits configured
});
```

## Security Risks

### Scenario 1: Memory Exhaustion
An attacker or misconfigured service could generate thousands of spans per second. Without queue size limits, these spans accumulate in memory, potentially causing:
- Out of Memory (OOM) errors
- Application crashes
- Degraded performance for legitimate operations

### Scenario 2: Slow Exporter Attack
If the collector endpoint is slow or unresponsive, spans accumulate indefinitely without being processed, leading to memory leaks.

### Scenario 3: Large Attribute Attack
Spans with extremely large attributes (e.g., huge JSON payloads, large strings) can consume excessive memory and bandwidth.

## Proposed Solution

Configure the `BatchSpanProcessor` with appropriate limits and implement safeguards:

```javascript
export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    // New security-focused options
    maxQueueSize = 2048,           // Maximum number of spans in queue
    maxExportBatchSize = 512,      // Maximum spans per batch
    scheduledDelayMillis = 5000,   // How often to export (ms)
    exportTimeoutMillis = 30000,   // Timeout for export operations
    maxAttributeLength = 4096,     // Maximum length for attribute values
  } = options;

  // Input validation (as per Issue #001)
  // ...

  // Configure exporter with timeouts and limits
  const exportOptions = {
    concurrencyLimit: parseInt(concurrencyLimit, 10),
    url: url,
    timeoutMillis: exportTimeoutMillis,
  };

  const exporter = new OTLPTraceExporter(exportOptions);
  
  // Configure batch processor with resource limits
  const spanProcessor = new BatchSpanProcessor(exporter, {
    maxQueueSize: maxQueueSize,           // Limit queue size to prevent unbounded memory growth
    maxExportBatchSize: maxExportBatchSize, // Limit batch size to prevent CPU spikes
    scheduledDelayMillis: scheduledDelayMillis, // Regular export interval
    exportTimeoutMillis: exportTimeoutMillis,   // Prevent hanging exports
  });

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
    // Add span limits to prevent attribute-based attacks
    spanLimits: {
      attributeValueLengthLimit: maxAttributeLength,  // Limit attribute value length
      attributeCountLimit: 128,                        // Limit number of attributes per span
      eventCountLimit: 128,                            // Limit number of events per span
      linkCountLimit: 128,                             // Limit number of links per span
      attributePerEventCountLimit: 32,                 // Limit attributes per event
      attributePerLinkCountLimit: 32,                  // Limit attributes per link
    },
  });

  // Add monitoring for queue size (optional but recommended)
  if (process.env.NODE_ENV !== 'production') {
    setInterval(() => {
      // Log queue metrics for monitoring (requires processor introspection)
      console.debug('Span processor metrics available via provider');
    }, 60000);
  }

  // Rest of setup...
}
```

## Additional Safeguards

### 1. Implement Circuit Breaker Pattern
```javascript
class ExporterWithCircuitBreaker {
  constructor(exporter, failureThreshold = 5, resetTimeout = 60000) {
    this.exporter = exporter;
    this.failureCount = 0;
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
  }

  async export(spans, resultCallback) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        // Drop spans when circuit is open
        console.warn('Circuit breaker OPEN, dropping spans');
        resultCallback({ code: 1 }); // ExportResultCode.FAILED
        return;
      }
      this.state = 'HALF_OPEN';
    }

    try {
      await this.exporter.export(spans, (result) => {
        if (result.code === 0) { // ExportResultCode.SUCCESS
          this.failureCount = 0;
          this.state = 'CLOSED';
        } else {
          this.failureCount++;
          if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            console.error('Circuit breaker OPEN due to repeated failures');
          }
        }
        resultCallback(result);
      });
    } catch (error) {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.resetTimeout;
      }
      resultCallback({ code: 1 });
    }
  }

  shutdown() {
    return this.exporter.shutdown();
  }
}

// Usage:
const exporter = new OTLPTraceExporter(exportOptions);
const protectedExporter = new ExporterWithCircuitBreaker(exporter);
const spanProcessor = new BatchSpanProcessor(protectedExporter, processorOptions);
```

### 2. Add Memory Monitoring
```javascript
function monitorMemoryUsage() {
  const usage = process.memoryUsage();
  const usedHeapMB = usage.heapUsed / 1024 / 1024;
  const maxHeapMB = usage.heapTotal / 1024 / 1024;
  
  if (usedHeapMB / maxHeapMB > 0.9) {
    console.warn(`High memory usage: ${usedHeapMB.toFixed(2)}MB / ${maxHeapMB.toFixed(2)}MB`);
    // Optionally force garbage collection (requires --expose-gc flag)
    if (global.gc) {
      global.gc();
    }
  }
}
```

## Configuration Recommendations

### Development Environment
```javascript
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  maxQueueSize: 1024,
  maxExportBatchSize: 256,
  scheduledDelayMillis: 10000,  // Export every 10 seconds
});
```

### Production Environment
```javascript
setupTracing({
  serviceName: 'my-service',
  url: 'https://otel-collector.production.example.com:4317',
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,   // Export every 5 seconds
  exportTimeoutMillis: 30000,
  maxAttributeLength: 2048,     // Stricter limits in production
});
```

## Testing Recommendations

```javascript
describe('Resource exhaustion protection', () => {
  it('should limit queue size', async () => {
    const tracer = setupTracing({
      serviceName: 'test',
      url: 'http://localhost:4317',
      maxQueueSize: 10,
    });
    
    // Generate more spans than queue can hold
    for (let i = 0; i < 100; i++) {
      const span = tracer.startSpan(`test-span-${i}`);
      span.end();
    }
    
    // Queue should not grow unbounded
    // Verify via memory usage or processor metrics
  });

  it('should enforce attribute length limits', () => {
    const tracer = setupTracing({
      serviceName: 'test',
      url: 'http://localhost:4317',
      maxAttributeLength: 100,
    });
    
    const span = tracer.startSpan('test');
    const longValue = 'x'.repeat(10000);
    span.setAttribute('test', longValue);
    
    // Attribute should be truncated to maxAttributeLength
  });

  it('should handle slow exporter gracefully', async () => {
    // Mock slow exporter
    const slowExporter = {
      export: (spans, callback) => {
        setTimeout(() => callback({ code: 0 }), 60000); // 1 minute delay
      }
    };
    
    // Should timeout according to exportTimeoutMillis
  });
});
```

## Resources

- [OpenTelemetry SDK Configuration](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)
- [BatchSpanProcessor Documentation](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-base#batchspanprocessor)
- [OWASP DoS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)
- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)

## Monitoring and Alerting

Consider adding metrics for:
- Queue size and utilization
- Export success/failure rate
- Export latency
- Memory usage trends
- Dropped span count

## Assignee
@saidsef
