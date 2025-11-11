# Security Fix: Missing Input Validation for Critical Parameters

## Category
🔒 Security Fix

## Priority
High

## Problem Statement

The `setupTracing()` function in `libs/index.mjs` accepts critical parameters (`serviceName`, `url`, `concurrencyLimit`) without proper validation. This can lead to several security vulnerabilities:

1. **Service Name Injection**: The `serviceName` parameter is used directly in trace attributes and resource detection without sanitization, potentially allowing malicious values to be injected into telemetry data.

2. **URL Injection**: The `url` parameter is passed directly to the OTLP exporter without validation, which could lead to:
   - Connection to malicious endpoints
   - Server-Side Request Forgery (SSRF) attacks
   - Credential leakage if the URL is logged

3. **Integer Overflow**: The `concurrencyLimit` is parsed with `parseInt()` but lacks bounds checking, potentially allowing extremely large values that could cause resource exhaustion.

4. **Missing Required Parameters**: The function doesn't validate that required parameters (`serviceName`, `url`) are provided and non-empty, leading to runtime errors or undefined behavior.

## Current Code (Vulnerable)
```javascript
export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
  } = options;

  // No validation here - directly used
  const exportOptions = {
    concurrencyLimit: parseInt(concurrencyLimit, 10),
    url: url,
    timeoutMillis: 1000,
  };
}
```

## Proposed Solution

Add comprehensive input validation at the beginning of the `setupTracing()` function:

```javascript
export function setupTracing(options = {}) {
  const {
    hostname = process.env.CONTAINER_NAME || process.env.HOSTNAME,
    serviceName = process.env.SERVICE_NAME,
    url = process.env.ENDPOINT,
    concurrencyLimit = 10,
    enableFsInstrumentation = false,
    enableDnsInstrumentation = false,
  } = options;

  // Validate required parameters
  if (!serviceName || typeof serviceName !== 'string' || serviceName.trim() === '') {
    throw new Error('serviceName is required and must be a non-empty string');
  }

  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('url is required and must be a non-empty string');
  }

  // Validate and sanitize serviceName (alphanumeric, hyphens, underscores, dots only)
  const sanitizedServiceName = serviceName.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(sanitizedServiceName)) {
    throw new Error('serviceName contains invalid characters. Only alphanumeric characters, dots, hyphens, and underscores are allowed');
  }

  // Validate URL format
  try {
    const parsedUrl = new URL(url);
    // Only allow specific protocols for security
    if (!['http:', 'https:', 'grpc:', 'grpcs:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL protocol. Only http, https, grpc, and grpcs are allowed');
    }
  } catch (error) {
    throw new Error(`Invalid url format: ${error.message}`);
  }

  // Validate concurrencyLimit bounds
  const parsedConcurrency = parseInt(concurrencyLimit, 10);
  if (isNaN(parsedConcurrency) || parsedConcurrency < 1 || parsedConcurrency > 100) {
    throw new Error('concurrencyLimit must be a number between 1 and 100');
  }

  // Validate hostname if provided
  if (hostname && typeof hostname !== 'string') {
    throw new Error('hostname must be a string');
  }

  // Validate boolean flags
  if (typeof enableFsInstrumentation !== 'boolean') {
    throw new Error('enableFsInstrumentation must be a boolean');
  }

  if (typeof enableDnsInstrumentation !== 'boolean') {
    throw new Error('enableDnsInstrumentation must be a boolean');
  }

  // Continue with validated parameters...
  const exportOptions = {
    concurrencyLimit: parsedConcurrency,
    url: url.trim(),
    timeoutMillis: 1000,
  };
  
  // Use sanitizedServiceName in resource attributes
  // ...
}
```

## Security Impact

### Before Fix
- ⚠️ Arbitrary values can be injected into telemetry
- ⚠️ Potential SSRF vulnerabilities
- ⚠️ Resource exhaustion attacks possible
- ⚠️ Application crashes on invalid input

### After Fix
- ✅ Strict input validation prevents injection attacks
- ✅ URL validation prevents SSRF
- ✅ Bounded concurrency prevents resource exhaustion
- ✅ Clear error messages for debugging
- ✅ Type safety for all parameters

## Testing Recommendations

Add comprehensive tests for input validation:

```javascript
describe('setupTracing input validation', () => {
  it('should throw error when serviceName is missing', () => {
    expect(() => setupTracing({ url: 'http://localhost:4317' }))
      .toThrow('serviceName is required');
  });

  it('should throw error when url is missing', () => {
    expect(() => setupTracing({ serviceName: 'test' }))
      .toThrow('url is required');
  });

  it('should throw error for invalid serviceName characters', () => {
    expect(() => setupTracing({ 
      serviceName: 'test@service!', 
      url: 'http://localhost:4317' 
    })).toThrow('serviceName contains invalid characters');
  });

  it('should throw error for invalid URL protocol', () => {
    expect(() => setupTracing({ 
      serviceName: 'test', 
      url: 'file:///etc/passwd' 
    })).toThrow('Invalid URL protocol');
  });

  it('should throw error for concurrencyLimit out of bounds', () => {
    expect(() => setupTracing({ 
      serviceName: 'test', 
      url: 'http://localhost:4317',
      concurrencyLimit: 1000
    })).toThrow('concurrencyLimit must be a number between 1 and 100');
  });
});
```

## Resources

- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OpenTelemetry Security Considerations](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)

## Additional Considerations

1. Consider adding rate limiting for tracer initialization to prevent DoS
2. Implement configuration schema validation using a library like `ajv` or `joi`
3. Add logging (with sanitized values) for security auditing
4. Consider implementing a configuration whitelist for allowed URLs

## Assignee
@saidsef
