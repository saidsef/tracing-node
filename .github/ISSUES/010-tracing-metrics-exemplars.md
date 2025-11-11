# Tracing Improvement: Add Custom Metrics and Exemplars Support

## Category
🔍 Tracing Improvement

## Priority
Medium

## Problem Statement

The current implementation focuses solely on distributed tracing without integration with OpenTelemetry Metrics. This limits observability because:

1. **Missing Metrics Layer**: No built-in metrics for:
   - Request rates and throughput
   - Error rates and patterns
   - Latency distributions (histograms)
   - Active span counts
   - Queue sizes and processing times

2. **No Exemplars**: Cannot link metrics to traces (exemplars), making it hard to:
   - Jump from a high latency data point to its trace
   - Investigate specific instances of anomalies
   - Correlate metrics spikes with trace details

3. **Limited Observability**: Three pillars of observability (logs, metrics, traces) are not fully connected

## Proposed Solution

Add OpenTelemetry Metrics SDK integration with exemplar support, providing automatic instrumentation metrics and custom metric capabilities.

### 1. Add Metrics Dependencies

Update `package.json`:
```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-metrics": "^0.52.0",
    "@opentelemetry/sdk-metrics": "^1.26.0",
    "@opentelemetry/exporter-metrics-otlp-grpc": "^0.52.0",
    // All existing dependencies...
  }
}
```

### 2. Create Metrics Module

```javascript
// libs/metrics.mjs
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { Resource } from '@opentelemetry/resources';

/**
 * Sets up OpenTelemetry metrics with exemplar support
 */
export function setupMetrics(options = {}) {
  const {
    url,
    serviceName,
    resource,
    exportIntervalMillis = 60000, // Export every 60 seconds
    exportTimeoutMillis = 30000,
  } = options;

  // Configure OTLP metrics exporter
  const metricExporter = new OTLPMetricExporter({
    url: url,
    timeoutMillis: exportTimeoutMillis,
  });

  // Create metric reader with exemplar configuration
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: exportIntervalMillis,
    exportTimeoutMillis: exportTimeoutMillis,
  });

  // Create meter provider
  const meterProvider = new MeterProvider({
    resource: resource,
    readers: [metricReader],
  });

  // Register as global meter provider
  const { metrics } = await import('@opentelemetry/api');
  metrics.setGlobalMeterProvider(meterProvider);

  return meterProvider;
}

/**
 * Built-in instrumentation metrics
 */
export class InstrumentationMetrics {
  constructor(meter, options = {}) {
    this.meter = meter;
    this.options = options;
    
    // Create instruments
    this.httpRequestCounter = meter.createCounter('http.server.request.count', {
      description: 'Total number of HTTP requests',
      unit: '1',
    });

    this.httpRequestDuration = meter.createHistogram('http.server.request.duration', {
      description: 'HTTP request duration',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      },
    });

    this.httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
      description: 'Number of active HTTP requests',
      unit: '1',
    });

    this.errorCounter = meter.createCounter('error.count', {
      description: 'Total number of errors',
      unit: '1',
    });

    this.spanQueueSize = meter.createObservableGauge('tracing.span_queue.size', {
      description: 'Current span processor queue size',
      unit: '1',
    });

    this.dbOperationDuration = meter.createHistogram('db.operation.duration', {
      description: 'Database operation duration',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      },
    });

    this.cacheHitCounter = meter.createCounter('cache.hit', {
      description: 'Number of cache hits',
      unit: '1',
    });

    this.cacheMissCounter = meter.createCounter('cache.miss', {
      description: 'Number of cache misses',
      unit: '1',
    });
  }

  /**
   * Record HTTP request with exemplar linking to trace
   */
  recordHttpRequest(attributes, traceContext) {
    this.httpRequestCounter.add(1, attributes, traceContext);
  }

  /**
   * Record HTTP request duration with exemplar
   */
  recordHttpDuration(duration, attributes, traceContext) {
    this.httpRequestDuration.record(duration, attributes, traceContext);
  }

  /**
   * Track active requests
   */
  incrementActiveRequests(attributes) {
    this.httpActiveRequests.add(1, attributes);
  }

  decrementActiveRequests(attributes) {
    this.httpActiveRequests.add(-1, attributes);
  }

  /**
   * Record error with exemplar
   */
  recordError(attributes, traceContext) {
    this.errorCounter.add(1, attributes, traceContext);
  }

  /**
   * Record database operation duration
   */
  recordDbOperation(duration, attributes, traceContext) {
    this.dbOperationDuration.record(duration, attributes, traceContext);
  }

  /**
   * Record cache operations
   */
  recordCacheHit(attributes) {
    this.cacheHitCounter.add(1, attributes);
  }

  recordCacheMiss(attributes) {
    this.cacheMissCounter.add(1, attributes);
  }
}
```

### 3. Integrate Metrics with Tracing

Update `libs/index.mjs`:

```javascript
import { setupMetrics, InstrumentationMetrics } from './metrics.mjs';
import { trace, context } from '@opentelemetry/api';

let tracerProvider = null;
let meterProvider = null;
let instrumentationMetrics = null;

export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    enableMetrics = process.env.OTEL_METRICS_ENABLED !== 'false', // Default: true
    metricsExportIntervalMillis = 60000,
  } = options;

  // Existing tracing setup...
  const resource = new resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_CONTAINER_NAME]: hostname,
  }).merge(
    detectResources({
      detectors: [envDetector, hostDetector, osDetector, processDetector, serviceInstanceIdDetector],
    })
  );

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
    resource: resource,
    autoDetectResources: true,
  });

  // Setup metrics if enabled
  if (enableMetrics) {
    meterProvider = setupMetrics({
      url: url,
      serviceName: serviceName,
      resource: resource,
      exportIntervalMillis: metricsExportIntervalMillis,
    });

    const meter = meterProvider.getMeter(serviceName);
    instrumentationMetrics = new InstrumentationMetrics(meter);
  }

  // Enhanced HTTP instrumentation with metrics
  const httpInstrumentation = new HttpInstrumentation({
    serverName: serviceName,
    ignoreIncomingRequestHook,
    applyCustomAttributesOnSpan,
    requestHook: (span, request) => {
      // Existing code...
      
      // Track active requests
      if (instrumentationMetrics) {
        const attributes = {
          'http.method': request.method,
          'http.route': request.url || '/',
        };
        instrumentationMetrics.incrementActiveRequests(attributes);
        
        // Store start time for duration calculation
        span.setAttribute('__startTime', Date.now());
      }
    },
    responseHook: (span, response) => {
      // Existing code...
      
      if (instrumentationMetrics) {
        const attributes = {
          'http.method': span.attributes['http.method'],
          'http.status_code': response.statusCode,
          'http.route': span.attributes['http.route'] || '/',
        };
        
        // Get trace context for exemplar
        const traceContext = span.spanContext();
        
        // Record request count with exemplar
        instrumentationMetrics.recordHttpRequest(attributes, traceContext);
        
        // Calculate and record duration with exemplar
        const startTime = span.attributes['__startTime'];
        if (startTime) {
          const duration = Date.now() - startTime;
          instrumentationMetrics.recordHttpDuration(duration, attributes, traceContext);
        }
        
        // Decrement active requests
        instrumentationMetrics.decrementActiveRequests(attributes);
        
        // Record errors
        if (response.statusCode >= 400) {
          instrumentationMetrics.recordError({
            ...attributes,
            'error.type': response.statusCode >= 500 ? 'server_error' : 'client_error',
          }, traceContext);
        }
      }
    },
  });

  // Register instrumentations...
  
  return tracerProvider.getTracer(serviceName);
}

/**
 * Get instrumentation metrics instance for custom metrics
 */
export function getMetrics() {
  return instrumentationMetrics;
}

/**
 * Shutdown both tracing and metrics
 */
export async function stopTracing() {
  const promises = [];
  
  if (tracerProvider) {
    promises.push(tracerProvider.shutdown());
  }
  
  if (meterProvider) {
    promises.push(meterProvider.shutdown());
  }
  
  try {
    await Promise.all(promises);
    console.info('Tracing and metrics shut down successfully.');
  } catch (error) {
    console.error('Error during shutdown:', error);
    throw error;
  } finally {
    tracerProvider = null;
    meterProvider = null;
    instrumentationMetrics = null;
  }
}
```

### 4. Usage Examples

#### Example 1: Automatic Metrics
```javascript
import { setupTracing } from '@saidsef/tracing-node';

// Metrics are enabled by default
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
});

// HTTP requests automatically generate metrics:
// - http.server.request.count
// - http.server.request.duration (histogram with exemplars)
// - http.server.active_requests
// - error.count (for 4xx/5xx responses)
```

#### Example 2: Custom Application Metrics
```javascript
import { setupTracing, getMetrics } from '@saidsef/tracing-node';
import { trace, context } from '@opentelemetry/api';

setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
});

const metrics = getMetrics();

// In your application code
app.get('/api/users', async (req, res) => {
  const span = trace.getActiveSpan();
  const traceContext = span?.spanContext();
  
  try {
    // Database operation
    const startTime = Date.now();
    const users = await db.query('SELECT * FROM users');
    const duration = Date.now() - startTime;
    
    // Record database operation metric with exemplar
    metrics.recordDbOperation(duration, {
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'db.table': 'users',
    }, traceContext);
    
    res.json(users);
  } catch (error) {
    // Record error metric with exemplar
    metrics.recordError({
      'error.type': 'database_error',
      'db.system': 'postgresql',
    }, traceContext);
    
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

#### Example 3: Cache Metrics
```javascript
import { getMetrics } from '@saidsef/tracing-node';

const metrics = getMetrics();

async function getCachedData(key) {
  const cached = await cache.get(key);
  
  const attributes = {
    'cache.type': 'redis',
    'cache.key.type': getKeyType(key),
  };
  
  if (cached) {
    metrics.recordCacheHit(attributes);
    return cached;
  }
  
  metrics.recordCacheMiss(attributes);
  
  const data = await fetchData(key);
  await cache.set(key, data);
  return data;
}
```

#### Example 4: Custom Business Metrics
```javascript
import { metrics } from '@opentelemetry/api';

// Get meter from global meter provider
const meter = metrics.getMeter('my-service');

// Create custom business metrics
const orderCounter = meter.createCounter('order.created', {
  description: 'Number of orders created',
  unit: '1',
});

const revenueCounter = meter.createCounter('order.revenue', {
  description: 'Total revenue from orders',
  unit: 'USD',
});

const inventoryGauge = meter.createObservableGauge('inventory.level', {
  description: 'Current inventory levels',
  unit: '1',
});

// Use in application
app.post('/api/orders', async (req, res) => {
  const span = trace.getActiveSpan();
  const traceContext = span?.spanContext();
  
  const order = await createOrder(req.body);
  
  // Record business metrics with exemplars linking to traces
  orderCounter.add(1, {
    'order.type': order.type,
    'order.status': order.status,
  }, traceContext);
  
  revenueCounter.add(order.total, {
    'order.currency': order.currency,
    'order.region': order.region,
  }, traceContext);
  
  res.json(order);
});
```

## Benefits

### For Developers
- ✅ Automatic HTTP request metrics without code changes
- ✅ Easy custom metrics with simple API
- ✅ Exemplars link metrics to traces for debugging
- ✅ Standard metric naming conventions

### For Operations
- ✅ Request rate monitoring (RED metrics)
- ✅ Error rate tracking and alerting
- ✅ Latency distribution (p50, p95, p99)
- ✅ Jump from metric anomaly to specific trace
- ✅ Complete observability (logs + metrics + traces)

### For Business
- ✅ Business metrics alongside technical metrics
- ✅ Revenue and order tracking
- ✅ User behavior metrics
- ✅ Custom KPIs integrated with tracing

## Example Queries

### Prometheus/Grafana Queries

```promql
# Request rate
rate(http_server_request_count[5m])

# Error rate
rate(http_server_request_count{http_status_code=~"5.."}[5m])

# Latency p95
histogram_quantile(0.95, rate(http_server_request_duration_bucket[5m]))

# Active requests
http_server_active_requests

# Database operation latency by table
histogram_quantile(0.99, rate(db_operation_duration_bucket[5m])) by (db_table)

# Cache hit rate
rate(cache_hit[5m]) / (rate(cache_hit[5m]) + rate(cache_miss[5m]))
```

### Exemplar Queries
When you see a spike in latency:
1. Click on the data point in Grafana
2. View exemplar trace ID
3. Jump directly to trace for that request
4. See full distributed trace context

## Testing

```javascript
// test/metrics.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setupMetrics, InstrumentationMetrics } from '../libs/metrics.mjs';

describe('Metrics', () => {
  it('should create meter provider', () => {
    const provider = setupMetrics({
      url: 'http://localhost:4317',
      serviceName: 'test',
    });
    
    assert.ok(provider);
  });

  it('should create instrumentation metrics', () => {
    const provider = setupMetrics({
      url: 'http://localhost:4317',
      serviceName: 'test',
    });
    
    const meter = provider.getMeter('test');
    const metrics = new InstrumentationMetrics(meter);
    
    assert.ok(metrics.httpRequestCounter);
    assert.ok(metrics.httpRequestDuration);
  });

  it('should record metrics with exemplars', () => {
    const provider = setupMetrics({
      url: 'http://localhost:4317',
      serviceName: 'test',
    });
    
    const meter = provider.getMeter('test');
    const metrics = new InstrumentationMetrics(meter);
    
    const traceContext = {
      traceId: '1234567890abcdef',
      spanId: 'abcdef123456',
    };
    
    // Should not throw
    metrics.recordHttpRequest({ 'http.method': 'GET' }, traceContext);
    metrics.recordHttpDuration(100, { 'http.method': 'GET' }, traceContext);
  });
});
```

## Resources

- [OpenTelemetry Metrics Specification](https://opentelemetry.io/docs/specs/otel/metrics/)
- [Exemplars Specification](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars)
- [RED Method](https://www.weave.works/blog/the-red-method-key-metrics-for-microservices-architecture/)
- [OpenTelemetry Metrics SDK](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-metrics)
- [Prometheus Exemplars](https://prometheus.io/docs/prometheus/latest/querying/examples/#querying-exemplars)

## Implementation Checklist

- [ ] Add metrics dependencies
- [ ] Create metrics.mjs module
- [ ] Implement InstrumentationMetrics class
- [ ] Integrate with HTTP instrumentation
- [ ] Add metrics to Express instrumentation
- [ ] Add metrics to database instrumentations
- [ ] Export getMetrics() function
- [ ] Update stopTracing() to shutdown metrics
- [ ] Add tests for metrics
- [ ] Update documentation
- [ ] Add Grafana dashboard examples

## Assignee
@saidsef
