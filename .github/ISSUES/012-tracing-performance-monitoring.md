# Tracing Improvement: Add Performance Monitoring for Slow Operations

## Category
🔍 Tracing Improvement

## Priority
Medium

## Problem Statement

The current implementation captures all operations uniformly without specific focus on performance issues. This makes it difficult to:

1. **Identify Slow Operations**: No automatic detection of:
   - Slow HTTP requests
   - Slow database queries
   - Slow external API calls
   - N+1 query problems
   - Memory leaks

2. **Missing Performance Context**: When slowness occurs:
   - No CPU/memory metrics at time of slowness
   - No automatic annotation of slow spans
   - No performance profiling data
   - No comparison to baseline performance

3. **Limited Alerting Data**: Cannot easily:
   - Alert on operations exceeding thresholds
   - Track performance regressions
   - Identify performance trends
   - Generate performance reports

4. **No Automatic Profiling**: No integration with Node.js profiling tools for slow operations

## Proposed Solution

Add comprehensive performance monitoring with automatic detection, profiling, and analysis of slow operations.

### 1. Create Performance Monitoring Module

```javascript
// libs/performance-monitoring.mjs
import { trace, context } from '@opentelemetry/api';
import v8 from 'v8';
import { performance } from 'perf_hooks';

/**
 * Performance monitoring and slow operation detection
 */
export class PerformanceMonitor {
  constructor(options = {}) {
    this.thresholds = {
      http: options.httpThresholdMs || 1000,
      database: options.databaseThresholdMs || 500,
      cache: options.cacheThresholdMs || 100,
      external: options.externalThresholdMs || 2000,
      ...options.customThresholds,
    };
    
    this.enableProfiling = options.enableProfiling ?? false;
    this.profileSlowOperations = options.profileSlowOperations ?? false;
    this.slowOperationsCount = 0;
    this.operationStats = new Map();
    
    // Start resource monitoring
    this.startResourceMonitoring();
  }

  /**
   * Start monitoring system resources
   */
  startResourceMonitoring() {
    this.lastCpuUsage = process.cpuUsage();
    this.resourceIntervalId = setInterval(() => {
      this.captureResourceSnapshot();
    }, 1000); // Every second
  }

  /**
   * Capture current resource usage
   */
  captureResourceSnapshot() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    
    this.currentResources = {
      timestamp: Date.now(),
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
        heapUsedMB: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2),
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        userMs: (cpuUsage.user / 1000).toFixed(2),
        systemMs: (cpuUsage.system / 1000).toFixed(2),
      },
    };
  }

  /**
   * Check if operation is slow and add performance attributes
   */
  checkAndAnnotateSlowOperation(span, duration, operationType) {
    const threshold = this.thresholds[operationType] || this.thresholds.external;
    
    if (duration > threshold) {
      this.slowOperationsCount++;
      
      // Mark as slow operation
      span.setAttribute('performance.slow', true);
      span.setAttribute('performance.threshold', threshold);
      span.setAttribute('performance.duration', duration);
      span.setAttribute('performance.slowness_ratio', (duration / threshold).toFixed(2));
      
      // Add resource usage at time of slow operation
      if (this.currentResources) {
        span.setAttribute('performance.memory.heap_used_mb', this.currentResources.memory.heapUsedMB);
        span.setAttribute('performance.memory.heap_total_mb', this.currentResources.memory.heapTotalMB);
        span.setAttribute('performance.cpu.user_ms', this.currentResources.cpu.userMs);
        span.setAttribute('performance.cpu.system_ms', this.currentResources.cpu.systemMs);
      }
      
      // Update statistics
      this.updateOperationStats(operationType, duration, threshold);
      
      // Trigger profiling if enabled
      if (this.profileSlowOperations) {
        this.triggerProfiling(span, operationType, duration);
      }
      
      console.warn(`Slow ${operationType} operation detected: ${duration}ms (threshold: ${threshold}ms)`);
    }
    
    return duration > threshold;
  }

  /**
   * Update operation statistics
   */
  updateOperationStats(operationType, duration, threshold) {
    if (!this.operationStats.has(operationType)) {
      this.operationStats.set(operationType, {
        count: 0,
        slowCount: 0,
        totalDuration: 0,
        maxDuration: 0,
        minDuration: Infinity,
      });
    }
    
    const stats = this.operationStats.get(operationType);
    stats.count++;
    stats.slowCount++;
    stats.totalDuration += duration;
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.minDuration = Math.min(stats.minDuration, duration);
    
    // Calculate percentages
    stats.slowPercentage = ((stats.slowCount / stats.count) * 100).toFixed(2);
    stats.avgDuration = (stats.totalDuration / stats.count).toFixed(2);
  }

  /**
   * Trigger CPU and heap profiling for slow operation
   */
  async triggerProfiling(span, operationType, duration) {
    if (!this.enableProfiling) return;
    
    try {
      // Take heap snapshot
      const heapSnapshot = v8.writeHeapSnapshot();
      span.setAttribute('performance.heap_snapshot', heapSnapshot);
      
      // Add event for profiling
      span.addEvent('performance.profile_captured', {
        'profile.type': 'heap',
        'profile.path': heapSnapshot,
        'profile.reason': 'slow_operation',
      });
      
      console.log(`Heap snapshot captured for slow ${operationType}: ${heapSnapshot}`);
    } catch (error) {
      console.error('Failed to capture profile:', error);
    }
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const stats = {};
    for (const [type, data] of this.operationStats.entries()) {
      stats[type] = { ...data };
    }
    return {
      totalSlowOperations: this.slowOperationsCount,
      byType: stats,
      currentResources: this.currentResources,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.slowOperationsCount = 0;
    this.operationStats.clear();
  }

  /**
   * Cleanup
   */
  shutdown() {
    if (this.resourceIntervalId) {
      clearInterval(this.resourceIntervalId);
    }
  }
}

/**
 * Span processor that monitors for slow operations
 */
export class SlowOperationProcessor {
  constructor(performanceMonitor) {
    this.monitor = performanceMonitor;
  }

  onStart(span) {
    // Record start time
    span.setAttribute('__start_time', Date.now());
  }

  onEnd(span) {
    const startTime = span.attributes['__start_time'];
    if (!startTime) return;
    
    const duration = Date.now() - startTime;
    
    // Determine operation type from span attributes
    const operationType = this.getOperationType(span);
    
    // Check if slow and annotate
    this.monitor.checkAndAnnotateSlowOperation(span, duration, operationType);
  }

  getOperationType(span) {
    const attrs = span.attributes;
    
    if (attrs['http.method']) return 'http';
    if (attrs['db.system']) return 'database';
    if (attrs['cache.type'] || attrs['peer.service'] === 'redis') return 'cache';
    if (attrs['messaging.system']) return 'messaging';
    if (attrs['rpc.system']) return 'rpc';
    
    return 'internal';
  }

  async forceFlush() {
    // No-op
  }

  async shutdown() {
    this.monitor.shutdown();
  }
}

/**
 * Create wrapper for timed operations
 */
export function withPerformanceTracking(operationType, operation, options = {}) {
  const span = trace.getActiveSpan();
  if (!span) {
    return operation();
  }
  
  const startTime = Date.now();
  
  return Promise.resolve(operation()).then(
    (result) => {
      const duration = Date.now() - startTime;
      span.setAttribute(`${operationType}.duration`, duration);
      
      if (options.threshold && duration > options.threshold) {
        span.setAttribute(`${operationType}.slow`, true);
        span.addEvent(`${operationType}.slow_operation`, {
          duration,
          threshold: options.threshold,
        });
      }
      
      return result;
    },
    (error) => {
      const duration = Date.now() - startTime;
      span.setAttribute(`${operationType}.duration`, duration);
      span.setAttribute(`${operationType}.error`, true);
      throw error;
    }
  );
}
```

### 2. Integrate with Tracing Setup

```javascript
// Update libs/index.mjs
import { PerformanceMonitor, SlowOperationProcessor } from './performance-monitoring.mjs';

let tracerProvider = null;
let performanceMonitor = null;

export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    
    // Performance monitoring options
    enablePerformanceMonitoring = process.env.OTEL_PERF_MONITORING !== 'false',
    httpThresholdMs = parseInt(process.env.OTEL_HTTP_THRESHOLD_MS || '1000', 10),
    databaseThresholdMs = parseInt(process.env.OTEL_DB_THRESHOLD_MS || '500', 10),
    cacheThresholdMs = parseInt(process.env.OTEL_CACHE_THRESHOLD_MS || '100', 10),
    enableProfiling = process.env.OTEL_ENABLE_PROFILING === 'true',
    profileSlowOperations = process.env.OTEL_PROFILE_SLOW === 'true',
  } = options;

  // Create performance monitor
  if (enablePerformanceMonitoring) {
    performanceMonitor = new PerformanceMonitor({
      httpThresholdMs,
      databaseThresholdMs,
      cacheThresholdMs,
      enableProfiling,
      profileSlowOperations,
    });
  }

  // Existing setup...
  const exporter = new OTLPTraceExporter(exportOptions);
  const spanProcessor = new BatchSpanProcessor(exporter);
  
  // Add slow operation processor if performance monitoring is enabled
  const spanProcessors = [spanProcessor];
  if (performanceMonitor) {
    spanProcessors.push(new SlowOperationProcessor(performanceMonitor));
  }

  tracerProvider = new NodeTracerProvider({
    spanProcessors: spanProcessors,
    // ... rest of config
  });

  // ...
}

/**
 * Get performance statistics
 */
export function getPerformanceStats() {
  if (!performanceMonitor) {
    throw new Error('Performance monitoring is not enabled');
  }
  return performanceMonitor.getStats();
}

/**
 * Export performance monitor for custom use
 */
export function getPerformanceMonitor() {
  return performanceMonitor;
}
```

### 3. Usage Examples

#### Example 1: Automatic Slow Operation Detection
```javascript
import { setupTracing } from '@saidsef/tracing-node';

// Setup with performance monitoring
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  enablePerformanceMonitoring: true,
  httpThresholdMs: 1000,      // Alert on HTTP > 1s
  databaseThresholdMs: 500,   // Alert on DB > 500ms
  cacheThresholdMs: 100,      // Alert on cache > 100ms
});

// Slow operations are automatically detected and annotated
app.get('/api/users', async (req, res) => {
  // If this takes > 1000ms, it's automatically marked as slow
  const users = await db.query('SELECT * FROM users');
  res.json(users);
});
```

#### Example 2: Custom Operation Tracking
```javascript
import { withPerformanceTracking } from '@saidsef/tracing-node/performance-monitoring';

async function complexCalculation() {
  return await withPerformanceTracking(
    'calculation',
    async () => {
      // Your complex operation
      const result = await heavyComputation();
      return result;
    },
    { threshold: 5000 } // Alert if > 5s
  );
}
```

#### Example 3: Performance Statistics Dashboard
```javascript
import express from 'express';
import { getPerformanceStats } from '@saidsef/tracing-node';

const app = express();

app.get('/performance/stats', (req, res) => {
  const stats = getPerformanceStats();
  res.json(stats);
});

// Example response:
// {
//   "totalSlowOperations": 42,
//   "byType": {
//     "http": {
//       "count": 1000,
//       "slowCount": 25,
//       "slowPercentage": "2.50",
//       "avgDuration": "245.32",
//       "maxDuration": 3421,
//       "minDuration": 12
//     },
//     "database": {
//       "count": 500,
//       "slowCount": 15,
//       "slowPercentage": "3.00",
//       "avgDuration": "123.45",
//       "maxDuration": 1234,
//       "minDuration": 5
//     }
//   },
//   "currentResources": {
//     "memory": {
//       "heapUsedMB": "45.23",
//       "heapTotalMB": "128.00"
//     },
//     "cpu": {
//       "userMs": "1234.56",
//       "systemMs": "234.56"
//     }
//   }
// }
```

#### Example 4: Profiling Slow Operations
```javascript
import { setupTracing } from '@saidsef/tracing-node';

// Enable automatic profiling for slow operations
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  enablePerformanceMonitoring: true,
  enableProfiling: true,
  profileSlowOperations: true,  // Capture heap snapshots for slow ops
  httpThresholdMs: 2000,
});

// When an operation exceeds threshold, a heap snapshot is automatically captured
```

#### Example 5: Monitoring Alerts
```javascript
import { getPerformanceMonitor } from '@saidsef/tracing-node';

const monitor = getPerformanceMonitor();

// Check stats periodically
setInterval(() => {
  const stats = monitor.getStats();
  
  // Alert if slow operation percentage is high
  Object.entries(stats.byType).forEach(([type, data]) => {
    if (parseFloat(data.slowPercentage) > 5) {
      console.error(`⚠️ High slow operation rate for ${type}: ${data.slowPercentage}%`);
      // Send alert to monitoring system
      alerting.send({
        severity: 'warning',
        message: `Slow ${type} operations: ${data.slowPercentage}%`,
        context: data,
      });
    }
  });
  
  // Alert on high memory usage
  const heapUsedPercent = (stats.currentResources.memory.heapUsed / stats.currentResources.memory.heapTotal) * 100;
  if (heapUsedPercent > 90) {
    console.error(`⚠️ High memory usage: ${heapUsedPercent.toFixed(2)}%`);
  }
}, 60000); // Every minute
```

## Benefits

### For Developers
- ✅ Automatic detection of slow operations
- ✅ No code changes required for basic monitoring
- ✅ Easy custom thresholds per operation type
- ✅ Integrated with existing tracing

### For Operations
- ✅ Real-time performance statistics
- ✅ Automatic profiling of problem operations
- ✅ Resource usage correlation with slowness
- ✅ Trend analysis capabilities
- ✅ Alert on performance degradation

### For Debugging
- ✅ Quickly identify slow operations in traces
- ✅ See CPU/memory state during slow operations
- ✅ Heap snapshots for memory analysis
- ✅ Baseline comparison data

## Query Examples

### Find all slow HTTP operations
```
span.performance.slow = true AND span.http.method = *
```

### Find operations using excessive memory
```
span.performance.memory.heap_used_mb > 500
```

### Find operations with high slowness ratio
```
span.performance.slowness_ratio > 3
```

## Implementation Checklist

- [ ] Create performance-monitoring.mjs
- [ ] Implement PerformanceMonitor class
- [ ] Implement SlowOperationProcessor
- [ ] Integrate with setupTracing()
- [ ] Add getPerformanceStats() function
- [ ] Add withPerformanceTracking() helper
- [ ] Add tests for performance monitoring
- [ ] Add environment variable support
- [ ] Update documentation with examples
- [ ] Add Grafana dashboard for performance stats

## Testing

```javascript
// test/performance-monitoring.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PerformanceMonitor } from '../libs/performance-monitoring.mjs';

describe('PerformanceMonitor', () => {
  it('should detect slow operations', () => {
    const monitor = new PerformanceMonitor({
      httpThresholdMs: 1000,
    });
    
    const mockSpan = {
      setAttribute: () => {},
      addEvent: () => {},
      attributes: {},
    };
    
    const isSlow = monitor.checkAndAnnotateSlowOperation(mockSpan, 1500, 'http');
    assert.strictEqual(isSlow, true);
  });

  it('should not flag fast operations', () => {
    const monitor = new PerformanceMonitor({
      httpThresholdMs: 1000,
    });
    
    const mockSpan = {
      setAttribute: () => {},
      attributes: {},
    };
    
    const isSlow = monitor.checkAndAnnotateSlowOperation(mockSpan, 500, 'http');
    assert.strictEqual(isSlow, false);
  });

  it('should track operation statistics', () => {
    const monitor = new PerformanceMonitor();
    
    const mockSpan = {
      setAttribute: () => {},
      attributes: {},
    };
    
    monitor.checkAndAnnotateSlowOperation(mockSpan, 1500, 'http');
    monitor.checkAndAnnotateSlowOperation(mockSpan, 2000, 'http');
    
    const stats = monitor.getStats();
    assert.strictEqual(stats.totalSlowOperations, 2);
  });
});
```

## Resources

- [Node.js Performance Hooks](https://nodejs.org/api/perf_hooks.html)
- [V8 Heap Profiling](https://nodejs.org/api/v8.html#v8_writeheapsnapshot_filename)
- [OpenTelemetry Performance](https://opentelemetry.io/docs/specs/otel/performance/)
- [Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)

## Assignee
@saidsef
