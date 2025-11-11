# Tracing Improvement: Implement Configurable Span Sampling

## Category
🔍 Tracing Improvement

## Priority
High

## Problem Statement

The current implementation traces **all** requests without any sampling configuration. This leads to:

1. **High Volume & Cost**: In high-traffic production systems, tracing every single request generates massive data volumes, leading to:
   - Expensive storage costs in tracing backends
   - Increased network bandwidth usage
   - Higher processing load on collectors
   - Performance overhead on application

2. **Missing Sampling Strategy**: No way to:
   - Sample based on traffic volume (e.g., trace 10% of requests)
   - Always sample errors and slow requests (head-based sampling)
   - Sample based on trace ID (tail-based sampling compatibility)
   - Different sampling rates for different endpoints

3. **No Production Flexibility**: Cannot adjust sampling rates without code changes or redeployment

## Current Implementation

The code currently uses default OpenTelemetry sampling behavior without explicit configuration:

```javascript
tracerProvider = new NodeTracerProvider({
  spanProcessors: [spanProcessor],
  resource: // ...
  autoDetectResources: true,
  // No sampler configured - defaults to AlwaysOn
});
```

## Proposed Solution

Implement flexible, configurable sampling strategies.

### 1. Add Sampling Configuration Options

```javascript
export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
    
    // New sampling options
    samplingStrategy = process.env.OTEL_SAMPLING_STRATEGY || 'always_on',
    samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE || '1.0'),
    alwaysSampleErrors = process.env.OTEL_ALWAYS_SAMPLE_ERRORS !== 'false',
    alwaysSampleSlowRequests = process.env.OTEL_ALWAYS_SAMPLE_SLOW !== 'false',
    slowRequestThresholdMs = parseInt(process.env.OTEL_SLOW_THRESHOLD_MS || '3000', 10),
  } = options;
  
  // Create sampler based on strategy
  const sampler = createSampler({
    strategy: samplingStrategy,
    rate: samplingRate,
    alwaysSampleErrors,
    alwaysSampleSlowRequests,
    slowRequestThresholdMs,
  });
  
  tracerProvider = new NodeTracerProvider({
    sampler: sampler,  // Add sampler
    spanProcessors: [spanProcessor],
    // ... rest of config
  });
  
  // ...
}
```

### 2. Create Sampler Factory

```javascript
// libs/sampling.mjs
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

/**
 * Custom sampler that always samples errors and slow requests
 */
class ErrorAndSlowSampler {
  constructor(baseSampler, options = {}) {
    this.baseSampler = baseSampler;
    this.alwaysSampleErrors = options.alwaysSampleErrors ?? true;
    this.alwaysSampleSlowRequests = options.alwaysSampleSlowRequests ?? true;
    this.slowThresholdMs = options.slowRequestThresholdMs ?? 3000;
    this.startTimes = new Map(); // Track span start times
  }

  shouldSample(context, traceId, spanName, spanKind, attributes, links) {
    // First, check base sampler decision
    const baseSamplingResult = this.baseSampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links
    );

    // If base sampler says record, keep that decision
    if (baseSamplingResult.decision === 1) { // SamplingDecision.RECORD_AND_SAMPLE
      return baseSamplingResult;
    }

    // Check if this is an error (would be set by instrumentation)
    if (this.alwaysSampleErrors) {
      if (attributes['http.status_code'] >= 400 || 
          attributes['error'] === true ||
          attributes['error.type']) {
        return {
          decision: 1, // SamplingDecision.RECORD_AND_SAMPLE
          attributes: { ...baseSamplingResult.attributes, 'sampling.reason': 'error' },
        };
      }
    }

    // Check for slow requests
    // Note: Duration is not available at sampling time for head-based sampling
    // This is a limitation - we'd need tail-based sampling for accurate slow request detection
    // However, we can use span attributes if set by custom instrumentation

    return baseSamplingResult;
  }

  toString() {
    return `ErrorAndSlowSampler{base=${this.baseSampler.toString()}}`;
  }
}

/**
 * Custom sampler that can adjust rates based on URL patterns
 */
class UrlPatternSampler {
  constructor(patterns) {
    this.patterns = patterns; // { pattern: /regex/, rate: 0.1 }
    this.defaultSampler = new TraceIdRatioBasedSampler(1.0);
  }

  shouldSample(context, traceId, spanName, spanKind, attributes, links) {
    const url = attributes['http.url'] || attributes['http.target'] || '';
    
    // Find matching pattern
    for (const { pattern, rate } of this.patterns) {
      if (pattern.test(url)) {
        const sampler = new TraceIdRatioBasedSampler(rate);
        return sampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
      }
    }
    
    // Use default if no pattern matches
    return this.defaultSampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString() {
    return 'UrlPatternSampler';
  }
}

/**
 * Create sampler based on configuration
 */
export function createSampler(options = {}) {
  const {
    strategy = 'always_on',
    rate = 1.0,
    alwaysSampleErrors = true,
    alwaysSampleSlowRequests = true,
    slowRequestThresholdMs = 3000,
    urlPatterns = null,
  } = options;

  let baseSampler;

  switch (strategy.toLowerCase()) {
    case 'always_on':
      baseSampler = new AlwaysOnSampler();
      break;
      
    case 'always_off':
      baseSampler = new AlwaysOffSampler();
      break;
      
    case 'ratio':
    case 'probabilistic':
      // Validate rate
      const validRate = Math.max(0, Math.min(1, rate));
      baseSampler = new TraceIdRatioBasedSampler(validRate);
      break;
      
    case 'parent_based':
      // Sample based on parent span decision
      baseSampler = new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(rate),
      });
      break;

    case 'url_pattern':
      if (!urlPatterns) {
        throw new Error('urlPatterns required for url_pattern strategy');
      }
      baseSampler = new UrlPatternSampler(urlPatterns);
      break;
      
    default:
      console.warn(`Unknown sampling strategy: ${strategy}, using always_on`);
      baseSampler = new AlwaysOnSampler();
  }

  // Wrap with error and slow request sampler if enabled
  if (alwaysSampleErrors || alwaysSampleSlowRequests) {
    baseSampler = new ErrorAndSlowSampler(baseSampler, {
      alwaysSampleErrors,
      alwaysSampleSlowRequests,
      slowRequestThresholdMs,
    });
  }

  return baseSampler;
}

/**
 * Pre-configured sampling strategies for common scenarios
 */
export const SAMPLING_PRESETS = {
  // Development: trace everything
  DEVELOPMENT: {
    strategy: 'always_on',
  },
  
  // Production low traffic: trace everything
  PRODUCTION_LOW: {
    strategy: 'always_on',
    alwaysSampleErrors: true,
  },
  
  // Production medium traffic: 10% sampling + all errors
  PRODUCTION_MEDIUM: {
    strategy: 'ratio',
    rate: 0.1,
    alwaysSampleErrors: true,
  },
  
  // Production high traffic: 1% sampling + all errors
  PRODUCTION_HIGH: {
    strategy: 'ratio',
    rate: 0.01,
    alwaysSampleErrors: true,
  },
  
  // Production very high traffic: 0.1% sampling + all errors
  PRODUCTION_VERY_HIGH: {
    strategy: 'ratio',
    rate: 0.001,
    alwaysSampleErrors: true,
  },
};
```

### 3. Usage Examples

#### Example 1: Simple Ratio Sampling
```javascript
// Sample 10% of all traces
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  samplingStrategy: 'ratio',
  samplingRate: 0.1,
});
```

#### Example 2: Sample All Errors, 5% of Success
```javascript
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  samplingStrategy: 'ratio',
  samplingRate: 0.05,
  alwaysSampleErrors: true,  // Always trace errors regardless of sampling rate
});
```

#### Example 3: Environment-Based Configuration
```javascript
// Set via environment variables
// OTEL_SAMPLING_STRATEGY=ratio
// OTEL_SAMPLING_RATE=0.01
// OTEL_ALWAYS_SAMPLE_ERRORS=true

setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  // Will use env vars automatically
});
```

#### Example 4: URL Pattern-Based Sampling
```javascript
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  samplingStrategy: 'url_pattern',
  urlPatterns: [
    // High importance endpoints - always sample
    { pattern: /\/api\/payment/, rate: 1.0 },
    { pattern: /\/api\/checkout/, rate: 1.0 },
    
    // Medium importance - 10% sampling
    { pattern: /\/api\/user/, rate: 0.1 },
    
    // Low importance - 1% sampling
    { pattern: /\/api\/metrics/, rate: 0.01 },
    { pattern: /\/healthz/, rate: 0.01 },
  ],
});
```

#### Example 5: Using Presets
```javascript
import { setupTracing } from '@saidsef/tracing-node';
import { SAMPLING_PRESETS } from '@saidsef/tracing-node/sampling';

// For production high traffic
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  ...SAMPLING_PRESETS.PRODUCTION_HIGH,
});
```

### 4. Update Package Dependencies

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    // All existing dependencies remain
  }
}
```

No new dependencies needed - sampling is built into SDK!

### 5. Add Monitoring for Sampling

```javascript
// Add span processor that tracks sampling decisions
class SamplingStatsProcessor {
  constructor() {
    this.sampled = 0;
    this.notSampled = 0;
  }

  onStart(span) {
    if (span.spanContext().traceFlags & 0x1) {
      this.sampled++;
    } else {
      this.notSampled++;
    }
  }

  onEnd() {}
  
  async shutdown() {}
  
  async forceFlush() {}
  
  getStats() {
    const total = this.sampled + this.notSampled;
    return {
      sampled: this.sampled,
      notSampled: this.notSampled,
      total,
      rate: total > 0 ? this.sampled / total : 0,
    };
  }
}

// Add to tracer provider
const statsProcessor = new SamplingStatsProcessor();
tracerProvider.addSpanProcessor(statsProcessor);

// Log stats periodically
setInterval(() => {
  const stats = statsProcessor.getStats();
  console.log('Sampling stats:', stats);
}, 60000);
```

## Cost Savings Example

### Before (Tracing Everything)
- Requests per day: 10 million
- Average trace size: 5KB
- Daily data: 10M × 5KB = 50GB
- Monthly data: 50GB × 30 = 1,500GB = **1.5TB**
- Cost at $0.50/GB: **$750/month**

### After (1% Sampling + All Errors, 2% error rate)
- Sampled success traces: 9.8M × 1% = 98K
- Sampled error traces: 200K × 100% = 200K
- Total sampled: 298K
- Daily data: 298K × 5KB = 1.49GB
- Monthly data: 1.49GB × 30 = 44.7GB
- Cost at $0.50/GB: **$22.35/month**
- **Savings: 97% ($727.65/month)**

## Implementation Checklist

- [ ] Create sampling.mjs module
- [ ] Add sampling configuration to setupTracing
- [ ] Implement ErrorAndSlowSampler
- [ ] Implement UrlPatternSampler
- [ ] Add sampling presets
- [ ] Add sampling statistics tracking
- [ ] Update documentation with sampling examples
- [ ] Add tests for all sampling strategies
- [ ] Add environment variable support
- [ ] Update README with cost savings examples

## Testing

```javascript
// test/sampling.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSampler, SAMPLING_PRESETS } from '../libs/sampling.mjs';

describe('Sampling', () => {
  it('should create AlwaysOnSampler', () => {
    const sampler = createSampler({ strategy: 'always_on' });
    assert.ok(sampler);
  });

  it('should create ratio sampler with correct rate', () => {
    const sampler = createSampler({ strategy: 'ratio', rate: 0.5 });
    assert.ok(sampler);
  });

  it('should clamp rate to valid range', () => {
    const sampler1 = createSampler({ strategy: 'ratio', rate: 1.5 });
    const sampler2 = createSampler({ strategy: 'ratio', rate: -0.5 });
    assert.ok(sampler1);
    assert.ok(sampler2);
  });

  it('should have all presets defined', () => {
    assert.ok(SAMPLING_PRESETS.DEVELOPMENT);
    assert.ok(SAMPLING_PRESETS.PRODUCTION_HIGH);
  });
});
```

## Resources

- [OpenTelemetry Sampling Specification](https://opentelemetry.io/docs/specs/otel/trace/sdk/#sampling)
- [Head-based vs Tail-based Sampling](https://www.honeycomb.io/blog/tail-based-sampling-opentelemetry)
- [Sampling Best Practices](https://docs.datadoghq.com/tracing/trace_pipeline/ingestion_mechanisms/)
- [TraceIdRatioBased Sampler](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-base#traceidratiobasedsample)

## Migration Guide

### For Existing Users
Current behavior is preserved by default (always_on). To enable sampling:

```javascript
// Add environment variable
OTEL_SAMPLING_STRATEGY=ratio
OTEL_SAMPLING_RATE=0.1

// Or in code
setupTracing({
  serviceName: 'my-service',
  url: 'http://localhost:4317',
  samplingStrategy: 'ratio',
  samplingRate: 0.1,
});
```

## Assignee
@saidsef
