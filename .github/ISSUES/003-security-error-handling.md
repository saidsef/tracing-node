# Security Fix: Error Handling Exposes Internal Implementation Details

## Category
🔒 Security Fix

## Priority
Medium

## Problem Statement

The `stopTracing()` function and other error handling code in `libs/index.mjs` may expose sensitive internal implementation details through error messages and console output. This violates security best practices and can aid attackers in:

1. **Information Disclosure**: Error messages reveal internal state, configurations, and implementation details
2. **Stack Trace Leakage**: Unhandled errors may expose file paths, dependency versions, and code structure
3. **Credential Leakage**: URL configurations containing credentials might be logged during errors

## Current Code (Vulnerable)
```javascript
// libs/index.mjs
export async function stopTracing() {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      console.info('Tracing has been successfully shut down.');
    } catch (error) {
      console.error('Error during tracing shutdown:', error); // Exposes full error object
    }
  } else {
    console.warn('Tracer provider is not initialized.'); // Internal state disclosure
  }
}
```

Additionally, the setup code doesn't properly handle initialization errors:
```javascript
// If exporter connection fails, error is not caught
const exporter = new OTLPTraceExporter(exportOptions); // May throw or fail silently
const spanProcessor = new BatchSpanProcessor(exporter);
```

## Security Risks

### 1. Information Leakage via Error Messages
Error objects may contain:
- Full stack traces with file paths
- Dependency versions and library names
- Configuration values (URLs, ports, credentials)
- Internal variable names and code structure

### 2. Debugging Information in Production
Console logs in production environments can:
- Be captured by log aggregation systems
- Expose sensitive data to unauthorized personnel
- Provide attackers with reconnaissance information

### 3. No Error Sanitization
URLs and configurations are logged without sanitization, potentially exposing:
- Authentication credentials in URLs
- Internal network topology
- Service endpoints and ports

## Proposed Solution

Implement secure error handling with proper sanitization and environment-aware logging:

```javascript
/**
 * Sanitizes error objects to remove sensitive information
 * @private
 */
function sanitizeError(error) {
  if (!error) return 'Unknown error';
  
  // In production, only return generic error info
  if (process.env.NODE_ENV === 'production') {
    return {
      message: 'An error occurred during tracing operation',
      code: error.code || 'UNKNOWN',
      type: error.constructor?.name || 'Error',
    };
  }
  
  // In development, provide more details but still sanitize
  return {
    message: error.message || 'Unknown error',
    code: error.code || 'UNKNOWN',
    type: error.constructor?.name || 'Error',
    // Include stack trace only in development
    stack: process.env.DEBUG ? error.stack : undefined,
  };
}

/**
 * Sanitizes URLs to remove credentials
 * @private
 */
function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Remove username and password
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Secure logging wrapper
 * @private
 */
function secureLog(level, message, details = {}) {
  // Sanitize all details
  const sanitized = {};
  for (const [key, value] of Object.entries(details)) {
    if (key.toLowerCase().includes('url') || key.toLowerCase().includes('endpoint')) {
      sanitized[key] = sanitizeUrl(value);
    } else if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = '[object]';
    } else {
      sanitized[key] = value;
    }
  }
  
  const logMessage = process.env.NODE_ENV === 'production' 
    ? message 
    : `${message} ${Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : ''}`;
  
  switch (level) {
    case 'error':
      console.error(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'info':
      console.info(logMessage);
      break;
    case 'debug':
      if (process.env.DEBUG) console.debug(logMessage);
      break;
    default:
      console.log(logMessage);
  }
}

export function setupTracing(options = {}) {
  try {
    const {
      hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
      serviceName = process.env.SERVICE_NAME,
      url = process.env.ENDPOINT,
      concurrencyLimit = 10,
      enableFsInstrumentation = false,
      enableDnsInstrumentation = false,
    } = options;

    // Input validation with secure error messages
    if (!serviceName || typeof serviceName !== 'string' || serviceName.trim() === '') {
      const error = new Error('Invalid configuration: serviceName is required');
      secureLog('error', 'Tracing setup failed', { reason: 'missing_service_name' });
      throw error;
    }

    if (!url || typeof url !== 'string' || url.trim() === '') {
      const error = new Error('Invalid configuration: url is required');
      secureLog('error', 'Tracing setup failed', { reason: 'missing_url' });
      throw error;
    }

    // Validate URL without exposing the actual URL in error
    try {
      new URL(url);
    } catch (error) {
      secureLog('error', 'Tracing setup failed', { reason: 'invalid_url_format' });
      throw new Error('Invalid configuration: url format is invalid');
    }

    secureLog('info', 'Initializing tracing', { 
      serviceName, 
      url: sanitizeUrl(url),
      fsInstrumentation: enableFsInstrumentation,
      dnsInstrumentation: enableDnsInstrumentation,
    });

    // Wrap exporter creation with error handling
    let exporter;
    try {
      const exportOptions = {
        concurrencyLimit: parseInt(concurrencyLimit, 10),
        url: url,
        timeoutMillis: 1000,
      };
      exporter = new OTLPTraceExporter(exportOptions);
    } catch (error) {
      const sanitized = sanitizeError(error);
      secureLog('error', 'Failed to create OTLP exporter', sanitized);
      throw new Error('Failed to initialize tracing exporter');
    }

    // Continue with setup...
    const spanProcessor = new BatchSpanProcessor(exporter);
    
    // More setup code...

    secureLog('info', 'Tracing initialized successfully', { serviceName });
    return tracerProvider.getTracer(serviceName);

  } catch (error) {
    // Top-level error handling
    const sanitized = sanitizeError(error);
    secureLog('error', 'Tracing setup failed', sanitized);
    
    // Re-throw with generic message in production
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Failed to initialize tracing');
    }
    throw error;
  }
}

/**
 * Gracefully stops the tracing by shutting down the tracer provider.
 * Enhanced with secure error handling.
 */
export async function stopTracing() {
  if (!tracerProvider) {
    secureLog('warn', 'Tracing shutdown skipped: not initialized');
    return;
  }

  try {
    await tracerProvider.shutdown();
    secureLog('info', 'Tracing shutdown completed successfully');
  } catch (error) {
    const sanitized = sanitizeError(error);
    secureLog('error', 'Tracing shutdown failed', sanitized);
    
    // Don't re-throw - shutdown should be best-effort
    // But track the failure for monitoring
    if (process.env.NODE_ENV !== 'production') {
      console.error('Shutdown error details:', error);
    }
  } finally {
    tracerProvider = null;
  }
}
```

## Additional Security Measures

### 1. Environment-Specific Logging Configuration
```javascript
// config/logging.mjs
export const loggingConfig = {
  production: {
    level: 'error',
    includeStackTraces: false,
    sanitizeUrls: true,
    redactSecrets: true,
  },
  staging: {
    level: 'warn',
    includeStackTraces: false,
    sanitizeUrls: true,
    redactSecrets: true,
  },
  development: {
    level: 'debug',
    includeStackTraces: true,
    sanitizeUrls: false,
    redactSecrets: false,
  },
};
```

### 2. Structured Error Codes
Instead of exposing error messages, use error codes:
```javascript
const ERROR_CODES = {
  INVALID_CONFIG: 'E001',
  EXPORTER_INIT_FAILED: 'E002',
  PROVIDER_INIT_FAILED: 'E003',
  SHUTDOWN_FAILED: 'E004',
  INVALID_URL: 'E005',
  INVALID_SERVICE_NAME: 'E006',
};

class TracingError extends Error {
  constructor(code, publicMessage, internalMessage = null) {
    super(publicMessage);
    this.code = code;
    this.internalMessage = internalMessage;
    this.name = 'TracingError';
  }
}

// Usage:
throw new TracingError(
  ERROR_CODES.INVALID_CONFIG,
  'Configuration validation failed',
  `Invalid serviceName: ${serviceName}` // Only logged in development
);
```

### 3. Security Headers for Log Transport
If logs are exported to external systems:
```javascript
const logExporter = {
  export: (logs) => {
    // Ensure logs don't contain sensitive headers
    const sanitizedLogs = logs.map(log => ({
      ...log,
      headers: undefined, // Never export request headers
      environment: process.env.NODE_ENV,
    }));
    
    // Export sanitized logs
    sendToLogAggregator(sanitizedLogs);
  }
};
```

## Testing Recommendations

```javascript
describe('Secure error handling', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('should not expose URL credentials in errors', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error');
    
    expect(() => {
      setupTracing({
        serviceName: 'test',
        url: 'http://user:password@example.com:4317'
      });
    }).toThrow();
    
    // Ensure password is not in error message
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('password')
    );
  });

  it('should sanitize error details in production', () => {
    const error = new Error('Internal error with /path/to/file.js');
    const sanitized = sanitizeError(error);
    
    expect(sanitized.message).toBe('An error occurred during tracing operation');
    expect(sanitized.stack).toBeUndefined();
  });

  it('should include debug info in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEBUG = 'true';
    
    const error = new Error('Debug error');
    const sanitized = sanitizeError(error);
    
    expect(sanitized.stack).toBeDefined();
  });
});
```

## Resources

- [OWASP Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [CWE-209: Generation of Error Message Containing Sensitive Information](https://cwe.mitre.org/data/definitions/209.html)
- [Node.js Security Best Practices - Error Handling](https://nodejs.org/en/docs/guides/security/#error-handling)

## Migration Path

1. Add sanitization functions without changing existing behavior
2. Update setupTracing() to use secure logging
3. Update stopTracing() to use secure logging
4. Add tests for all error scenarios
5. Update documentation with environment-specific logging behavior
6. Enable secure logging in production deployments

## Assignee
@saidsef
