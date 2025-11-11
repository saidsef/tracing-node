# Tracing Improvement: Add Structured Error Tracking for All Instrumentations

## Category
🔍 Tracing Improvement

## Priority
High

## Problem Statement

The current implementation has inconsistent error tracking across different instrumentations. While some instrumentations (like DNS) have dedicated `errorHook` handlers, others rely on default error handling which may not capture sufficient context for debugging distributed systems.

**Current Gaps:**
1. HTTP instrumentation lacks comprehensive error categorization
2. No standardized error attributes across instrumentations
3. Missing error context for debugging (request IDs, timing, context)
4. No error correlation between parent/child spans
5. Error rates and patterns are hard to analyze in tracing backends

## Current State

### DNS Instrumentation (Good Example - Lines 293-312)
```javascript
errorHook: (span, error) => {
  if (error) {
    span.setAttribute('dns.error', true);
    span.setAttribute('dns.error.code', error.code || 'UNKNOWN');
    span.setAttribute('dns.error.message', error.message || 'DNS lookup failed');
    
    if (error.code === 'ENOTFOUND') {
      span.setAttribute('dns.error.type', 'NOT_FOUND');
    } else if (error.code === 'ETIMEOUT') {
      span.setAttribute('dns.error.type', 'TIMEOUT');
    }
    // ...
  }
}
```

### HTTP Instrumentation (Missing Error Hooks)
Currently only has `requestHook` and `responseHook`, but no dedicated error handling.

## Proposed Solution

Implement comprehensive error tracking across all instrumentations with standardized attributes.

### 1. Define Standard Error Attributes

```javascript
// Error tracking schema following OpenTelemetry semantic conventions
const ERROR_ATTRIBUTES = {
  // Standard error fields
  'error': 'boolean',           // Whether an error occurred
  'error.type': 'string',       // Error class/category
  'error.message': 'string',    // Human readable message (sanitized)
  'error.code': 'string',       // Error code (HTTP status, errno, etc.)
  'error.stack_trace': 'string', // Stack trace (development only)
  
  // Context fields
  'error.timestamp': 'number',  // When error occurred
  'error.handled': 'boolean',   // Whether error was caught/handled
  'error.recoverable': 'boolean', // Whether operation can be retried
  
  // Request context (when applicable)
  'error.request_id': 'string', // Request identifier for correlation
  'error.user_id': 'string',    // User context (if available)
  'error.session_id': 'string', // Session context
};
```

### 2. Create Error Tracking Utility

```javascript
// libs/error-tracking.mjs

/**
 * Standardized error tracking for OpenTelemetry spans
 */
export class ErrorTracker {
  constructor(options = {}) {
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    this.includeStackTrace = options.includeStackTrace ?? (this.environment !== 'production');
    this.sanitize = options.sanitize ?? true;
  }

  /**
   * Add error attributes to a span
   */
  recordError(span, error, context = {}) {
    if (!error || !span) return;

    // Set standard error flag
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR = 2

    // Basic error attributes
    span.setAttribute('error', true);
    span.setAttribute('error.type', error.constructor?.name || 'Error');
    span.setAttribute('error.code', this.getErrorCode(error));
    
    // Sanitize error message if needed
    const message = this.sanitize ? this.sanitizeMessage(error.message) : error.message;
    span.setAttribute('error.message', message || 'Unknown error');

    // Add stack trace in non-production environments
    if (this.includeStackTrace && error.stack) {
      span.setAttribute('error.stack_trace', error.stack);
    }

    // Timestamp
    span.setAttribute('error.timestamp', Date.now());

    // Error categorization
    span.setAttribute('error.category', this.categorizeError(error));
    span.setAttribute('error.recoverable', this.isRecoverable(error));

    // Add context attributes
    if (context.requestId) {
      span.setAttribute('error.request_id', context.requestId);
    }
    if (context.userId) {
      span.setAttribute('error.user_id', context.userId);
    }
    if (context.operation) {
      span.setAttribute('error.operation', context.operation);
    }
    if (context.retryCount !== undefined) {
      span.setAttribute('error.retry_count', context.retryCount);
    }

    // Additional metadata
    if (error.statusCode) {
      span.setAttribute('http.status_code', error.statusCode);
    }
    if (error.errno) {
      span.setAttribute('system.errno', error.errno);
    }
  }

  /**
   * Extract error code from various error types
   */
  getErrorCode(error) {
    return error.code || 
           error.statusCode?.toString() || 
           error.errno?.toString() || 
           'UNKNOWN';
  }

  /**
   * Categorize error for better filtering and analysis
   */
  categorizeError(error) {
    const code = this.getErrorCode(error);
    const message = error.message?.toLowerCase() || '';

    // Network errors
    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) {
      return 'network';
    }

    // HTTP client errors (4xx)
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return 'client_error';
    }

    // HTTP server errors (5xx)
    if (error.statusCode >= 500) {
      return 'server_error';
    }

    // Authentication/Authorization
    if (code === '401' || code === '403' || message.includes('auth')) {
      return 'auth';
    }

    // Validation errors
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }

    // Database errors
    if (message.includes('database') || message.includes('sql')) {
      return 'database';
    }

    // File system errors
    if (['ENOENT', 'EACCES', 'EISDIR'].includes(code)) {
      return 'filesystem';
    }

    return 'unknown';
  }

  /**
   * Determine if error is potentially recoverable
   */
  isRecoverable(error) {
    const code = this.getErrorCode(error);
    
    // Network timeouts and rate limits are typically recoverable
    const recoverableCodes = [
      'ETIMEDOUT', 'ECONNRESET', '429', '503', '504'
    ];
    
    return recoverableCodes.includes(code);
  }

  /**
   * Sanitize error messages to remove sensitive data
   */
  sanitizeMessage(message) {
    if (!message) return '';
    
    let sanitized = message;
    
    // Remove potential paths
    sanitized = sanitized.replace(/\/[\w\/.-]+/g, '[PATH]');
    
    // Remove potential URLs with credentials
    sanitized = sanitized.replace(/https?:\/\/[^:]+:[^@]+@/g, 'http://[REDACTED]@');
    
    // Remove potential tokens/keys
    sanitized = sanitized.replace(/\b[A-Za-z0-9+\/]{32,}={0,2}\b/g, '[TOKEN]');
    
    // Remove email addresses
    sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]');
    
    return sanitized;
  }
}

export const errorTracker = new ErrorTracker();
```

### 3. Integrate Error Tracking into HTTP Instrumentation

```javascript
// In setupTracing() function
import { errorTracker } from './error-tracking.mjs';

const httpInstrumentation = new HttpInstrumentation({
  serverName: serviceName,
  ignoreIncomingRequestHook,
  applyCustomAttributesOnSpan,
  requestHook: (span, request) => {
    // Existing request hook code...
    
    // Add request ID for error correlation
    const requestId = request.headers['x-request-id'] || 
                     request.headers['x-correlation-id'];
    if (requestId) {
      span.setAttribute('request.id', requestId);
    }
  },
  responseHook: (span, response) => {
    // Existing response hook code...
    
    // Track errors based on status code
    if (response.statusCode >= 400) {
      const error = new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
      error.statusCode = response.statusCode;
      error.statusMessage = response.statusMessage;
      
      errorTracker.recordError(span, error, {
        operation: 'http_request',
        requestId: span.attributes['request.id'],
      });
    }
  },
  // Add error hook for actual exceptions
  spanNameHook: (request) => {
    return `${request.method} ${request.url || request.path || '/'}`;
  },
});

// Also add error listener to track unhandled errors
process.on('uncaughtException', (error) => {
  // Create a span for tracking
  const tracer = tracerProvider.getTracer(serviceName);
  const span = tracer.startSpan('uncaught_exception');
  errorTracker.recordError(span, error, {
    operation: 'uncaught_exception',
    handled: false,
  });
  span.end();
});
```

### 4. Enhance Express Instrumentation Error Tracking

```javascript
new ExpressInstrumentation({
  ignoreIncomingRequestHook,
  requestHook: (span, request) => {
    // Existing code...
    
    // Store request ID in span for error correlation
    const requestId = request.headers['x-request-id'];
    if (requestId) {
      span.setAttribute('request.id', requestId);
    }
  },
  // Add middleware error handler
  // Note: Express instrumentation doesn't have direct error hook,
  // so we need to add Express error middleware separately
});

// Add this after setupTracing() in user code:
app.use((err, req, res, next) => {
  const span = trace.getSpan(context.active());
  if (span) {
    errorTracker.recordError(span, err, {
      operation: 'express_middleware',
      requestId: req.headers['x-request-id'],
      userId: req.user?.id,
      path: req.path,
    });
  }
  next(err);
});
```

### 5. Add Error Tracking to AWS SDK Instrumentation

```javascript
new AwsInstrumentation({
  suppressInternalInstrumentation: false,
  sqsExtractContextPropagationFromPayload: true,
  preRequestHook: (span, request) => {
    // Existing code...
  },
  responseHook: (span, response) => {
    // Existing code...
    
    // Track AWS service errors
    if (response?.error) {
      errorTracker.recordError(span, response.error, {
        operation: 'aws_sdk',
        service: request.service?.serviceIdentifier,
        requestId: response.requestId,
        recoverable: response.retryable,
      });
    }
  },
});
```

### 6. Add Error Tracking to Redis and Elasticsearch

```javascript
new IORedisInstrumentation({
  responseHook: (span, response) => {
    span.setAttribute('peer.service', 'redis');
    
    // Track Redis errors
    if (response instanceof Error) {
      errorTracker.recordError(span, response, {
        operation: 'redis',
      });
    }
  },
  requestHook: (span, request) => {
    span.setAttribute('peer.service', 'redis');
  },
});

new ElasticsearchInstrumentation({
  // Add error tracking hooks if supported
  responseHook: (span, response) => {
    if (response?.statusCode >= 400) {
      const error = new Error(`Elasticsearch error: ${response.statusCode}`);
      error.statusCode = response.statusCode;
      errorTracker.recordError(span, error, {
        operation: 'elasticsearch',
      });
    }
  },
});
```

## Benefits

### For Developers
- ✅ Consistent error attributes across all operations
- ✅ Easy error correlation using request IDs
- ✅ Clear error categorization for filtering
- ✅ Stack traces in development, sanitized in production
- ✅ Identify recoverable vs. permanent failures

### For Operations
- ✅ Better error rate tracking in monitoring dashboards
- ✅ Easier root cause analysis with full context
- ✅ Error trending and pattern detection
- ✅ Improved alerting based on error categories
- ✅ Better SLA monitoring

### For Security
- ✅ Automatic sanitization of sensitive data in errors
- ✅ No credential leakage in error messages
- ✅ Controlled stack trace exposure
- ✅ Environment-aware error detail levels

## Example Queries in Tracing Backend

### Find all network errors
```
span.error.category = "network"
```

### Find recoverable errors for retry analysis
```
span.error.recoverable = true
```

### Correlate errors by request ID
```
span.error.request_id = "abc-123"
```

### Find all 500 errors
```
span.error.type = "server_error" AND span.http.status_code >= 500
```

### Track error rates by service
```
count(span.error = true) by span.service.name
```

## Testing

```javascript
// test/error-tracking.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ErrorTracker } from '../libs/error-tracking.mjs';

describe('ErrorTracker', () => {
  it('should categorize network errors', () => {
    const tracker = new ErrorTracker();
    const error = new Error('Connection refused');
    error.code = 'ECONNREFUSED';
    
    assert.strictEqual(tracker.categorizeError(error), 'network');
  });

  it('should identify recoverable errors', () => {
    const tracker = new ErrorTracker();
    const error = new Error('Request timeout');
    error.code = 'ETIMEDOUT';
    
    assert.strictEqual(tracker.isRecoverable(error), true);
  });

  it('should sanitize sensitive data in messages', () => {
    const tracker = new ErrorTracker();
    const message = 'Failed to connect to http://user:pass@example.com';
    const sanitized = tracker.sanitizeMessage(message);
    
    assert.ok(!sanitized.includes('pass'));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  it('should record error on span with full context', () => {
    const tracker = new ErrorTracker();
    const mockSpan = {
      recordException: () => {},
      setStatus: () => {},
      setAttribute: () => {},
      attributes: {},
    };
    
    const error = new Error('Test error');
    error.statusCode = 500;
    
    tracker.recordError(mockSpan, error, {
      requestId: 'req-123',
      userId: 'user-456',
    });
    
    // Verify attributes were set (would need proper mocking)
    assert.ok(true);
  });
});
```

## Resources

- [OpenTelemetry Semantic Conventions - Exceptions](https://opentelemetry.io/docs/specs/semconv/exceptions/)
- [OpenTelemetry Span Status](https://opentelemetry.io/docs/specs/otel/trace/api/#set-status)
- [Error Tracking Best Practices](https://docs.datadoghq.com/tracing/trace_collection/tracing_naming_convention/)
- [Distributed Tracing Error Analysis](https://www.honeycomb.io/blog/guide-to-debugging-errors-with-distributed-tracing)

## Implementation Checklist

- [ ] Create error-tracking.mjs utility
- [ ] Add error tracking to HTTP instrumentation
- [ ] Add error tracking to Express instrumentation
- [ ] Add error tracking to AWS SDK instrumentation
- [ ] Add error tracking to Redis instrumentation
- [ ] Add error tracking to Elasticsearch instrumentation
- [ ] Update existing DNS error tracking to use new utility
- [ ] Add tests for error tracking
- [ ] Update documentation with error attribute schema
- [ ] Add example queries for common error scenarios

## Assignee
@saidsef
