# Bug Fix: Test Suite Doesn't Match Actual Function Signature

## Category
🐛 Bug Fix

## Priority
High

## Problem Statement

The test file `libs/index.test.mjs` contains tests that don't match the actual implementation of the `setupTracing()` function. The tests are written for an older API signature that no longer exists.

## Current Issues

### 1. Function Signature Mismatch
**Test Code (lines 40-49)**:
```javascript
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
```

**Actual Implementation**:
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
  // ...
}
```

The function now accepts an **options object**, not positional parameters.

### 2. Mock Implementation Issues
The mocked `NodeTracerProvider` doesn't reflect the actual provider's behavior:
```javascript
NodeTracerProvider: jest.fn().mockImplementation(() => ({
  addSpanProcessor: jest.fn(),  // Not used in actual code
  register: jest.fn(),
  getTracer: jest.fn().mockReturnValue({}),
  resource: { attributes: {} },
}))
```

The actual code uses:
- `spanProcessors` in constructor (not `addSpanProcessor`)
- `shutdown()` method (not present in mock)
- Returns a proper Tracer instance (not an empty object)

### 3. Missing Test Coverage
The test file doesn't cover:
- ✗ Required parameter validation (serviceName, url)
- ✗ Optional parameters (enableFsInstrumentation, enableDnsInstrumentation)
- ✗ Environment variable fallbacks
- ✗ Instrumentation registration
- ✗ `stopTracing()` function
- ✗ Error handling scenarios
- ✗ Resource detection and attributes
- ✗ Context propagation setup

## Proposed Solution

Completely rewrite the test file to match the current implementation:

```javascript
// libs/index.test.mjs
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { setupTracing, stopTracing } from './index.mjs';

describe('setupTracing', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should create a tracer with required parameters', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
      });
      
      assert.ok(tracer, 'Tracer should be created');
    });

    it('should use environment variables as fallback', () => {
      process.env.SERVICE_NAME = 'env-service';
      process.env.ENDPOINT = 'http://localhost:4317';
      process.env.HOSTNAME = 'test-host';

      const tracer = setupTracing();
      
      assert.ok(tracer, 'Tracer should be created from env vars');
    });

    it('should accept all optional parameters', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        hostname: 'custom-host',
        concurrencyLimit: 20,
        enableFsInstrumentation: true,
        enableDnsInstrumentation: true,
      });
      
      assert.ok(tracer, 'Tracer should be created with all options');
    });

    it('should throw error when serviceName is missing', () => {
      assert.throws(
        () => setupTracing({ url: 'http://localhost:4317' }),
        /serviceName/,
        'Should require serviceName'
      );
    });

    it('should throw error when url is missing', () => {
      assert.throws(
        () => setupTracing({ serviceName: 'test-service' }),
        /url|ENDPOINT/,
        'Should require url'
      );
    });
  });

  describe('instrumentation configuration', () => {
    it('should enable FS instrumentation when requested', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        enableFsInstrumentation: true,
      });
      
      assert.ok(tracer, 'Should create tracer with FS instrumentation');
    });

    it('should enable DNS instrumentation when requested', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        enableDnsInstrumentation: true,
      });
      
      assert.ok(tracer, 'Should create tracer with DNS instrumentation');
    });

    it('should not enable optional instrumentations by default', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
      });
      
      assert.ok(tracer, 'Should create tracer without optional instrumentations');
    });
  });

  describe('concurrency limit configuration', () => {
    it('should parse concurrency limit as integer', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
        concurrencyLimit: '15', // String should be parsed
      });
      
      assert.ok(tracer, 'Should handle string concurrencyLimit');
    });

    it('should use default concurrency limit of 10', () => {
      const tracer = setupTracing({
        serviceName: 'test-service',
        url: 'http://localhost:4317',
      });
      
      assert.ok(tracer, 'Should use default concurrency limit');
    });
  });
});

describe('stopTracing', () => {
  beforeEach(() => {
    // Setup a tracer before each test
    process.env.SERVICE_NAME = 'test-service';
    process.env.ENDPOINT = 'http://localhost:4317';
  });

  it('should successfully shutdown initialized tracer', async () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    
    await assert.doesNotReject(
      stopTracing(),
      'Should shutdown without error'
    );
  });

  it('should handle shutdown when tracer is not initialized', async () => {
    await assert.doesNotReject(
      stopTracing(),
      'Should handle uninitialized tracer gracefully'
    );
  });

  it('should allow multiple shutdown calls', async () => {
    setupTracing({
      serviceName: 'test-service',
      url: 'http://localhost:4317',
    });
    
    await stopTracing();
    await assert.doesNotReject(
      stopTracing(),
      'Should handle multiple shutdown calls'
    );
  });
});

describe('integration tests', () => {
  it('should create tracer, use it, and shutdown cleanly', async () => {
    const tracer = setupTracing({
      serviceName: 'integration-test',
      url: 'http://localhost:4317',
    });
    
    // Create a test span
    const span = tracer.startSpan('test-operation');
    span.setAttribute('test', 'value');
    span.end();
    
    // Shutdown
    await stopTracing();
    
    assert.ok(true, 'Full lifecycle should complete successfully');
  });
});
```

## Migration Steps

1. **Remove jest dependencies** - The current implementation uses Node.js native test runner, but the test file imports jest mocks that don't work
2. **Update test structure** - Use Node.js test API (`node:test`) instead of jest
3. **Fix function signatures** - Update all test calls to use options object
4. **Add comprehensive coverage** - Test all configuration options and error cases
5. **Test environment variables** - Verify fallback behavior
6. **Test shutdown behavior** - Ensure cleanup works properly

## Alternative: Keep Jest

If jest is preferred, update package.json:
```json
{
  "scripts": {
    "test": "jest",
    "test:native": "node --test libs/**/*.test.mjs"
  }
}
```

And fix the jest configuration in the test file to work with ES modules.

## Testing the Fix

Run tests with:
```bash
# Current (will fail with current test file)
npm test

# After fix
npm test
```

Expected output:
```
TAP version 13
# Subtest: setupTracing
  # Subtest: initialization
    ok 1 - should create a tracer with required parameters
    ok 2 - should use environment variables as fallback
    ...
# tests 15
# pass 15
# fail 0
```

## Resources

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Jest ES Modules](https://jestjs.io/docs/ecmascript-modules)
- [OpenTelemetry Testing Best Practices](https://opentelemetry.io/docs/instrumentation/js/testing/)

## Impact

**Current State**:
- ❌ Tests don't actually test the implementation
- ❌ False confidence in code correctness
- ❌ Changes can break functionality without test failures
- ❌ Mock setup doesn't reflect real behavior

**After Fix**:
- ✅ Tests validate actual API contract
- ✅ Proper test coverage for all features
- ✅ Breaking changes will be caught by tests
- ✅ Environment variable behavior is tested
- ✅ Error cases are validated

## Assignee
@saidsef
