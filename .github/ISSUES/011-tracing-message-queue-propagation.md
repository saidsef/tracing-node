# Tracing Improvement: Enhance Context Propagation for Message Queues

## Category
🔍 Tracing Improvement

## Priority
Medium

## Problem Statement

The current implementation provides excellent HTTP context propagation but lacks specific support for message queue systems. This creates gaps in distributed tracing for event-driven architectures:

1. **Missing Queue Instrumentations**: No built-in support for popular message queues:
   - RabbitMQ
   - Apache Kafka
   - Amazon SQS (partially via AWS SDK but not optimized)
   - Google Pub/Sub
   - Azure Service Bus

2. **Manual Context Injection**: Developers must manually:
   - Inject trace context into message headers
   - Extract trace context from received messages
   - Create child spans for message processing
   - Handle correlation IDs

3. **Broken Trace Chains**: Without proper propagation:
   - Traces stop at message producers
   - Consumer operations start new, unrelated traces
   - End-to-end latency is not captured
   - Message processing errors aren't correlated to origin

4. **Limited AWS SQS Support**: While AWS SDK instrumentation exists, it doesn't fully leverage SQS-specific features like message attributes for context propagation

## Proposed Solution

Add comprehensive message queue instrumentation with automatic context propagation.

### 1. Create Message Queue Propagation Utilities

```javascript
// libs/messaging-propagation.mjs
import { propagation, trace, context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/**
 * Utility for propagating trace context through message queues
 */
export class MessagingPropagator {
  constructor() {
    this.propagator = new W3CTraceContextPropagator();
  }

  /**
   * Inject trace context into message attributes/headers
   * @param {Object} message - The message object
   * @param {string} attributeKey - Where to store context (e.g., 'MessageAttributes', 'headers')
   * @returns {Object} Message with injected context
   */
  inject(message, attributeKey = 'MessageAttributes') {
    const carrier = {};
    
    // Inject current context into carrier
    propagation.inject(context.active(), carrier);
    
    // Convert carrier to message format
    const attributes = {};
    for (const [key, value] of Object.entries(carrier)) {
      attributes[key] = {
        DataType: 'String',
        StringValue: value,
      };
    }
    
    return {
      ...message,
      [attributeKey]: {
        ...message[attributeKey],
        ...attributes,
      },
    };
  }

  /**
   * Extract trace context from message attributes/headers
   * @param {Object} message - The received message
   * @param {string} attributeKey - Where context is stored
   * @returns {Context} OpenTelemetry context
   */
  extract(message, attributeKey = 'MessageAttributes') {
    const attributes = message[attributeKey] || {};
    
    // Convert message format to carrier
    const carrier = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value.StringValue) {
        carrier[key] = value.StringValue;
      }
    }
    
    // Extract context from carrier
    return propagation.extract(context.active(), carrier);
  }

  /**
   * Create a span for message production
   * @param {string} destination - Queue/topic name
   * @param {Object} options - Span options
   * @returns {Span}
   */
  startProducerSpan(destination, options = {}) {
    const tracer = trace.getTracer(options.serviceName || 'messaging');
    
    return tracer.startSpan(`${destination} send`, {
      kind: 2, // SpanKind.PRODUCER
      attributes: {
        'messaging.system': options.system || 'unknown',
        'messaging.destination': destination,
        'messaging.operation': 'send',
        ...options.attributes,
      },
    });
  }

  /**
   * Create a span for message consumption
   * @param {string} destination - Queue/topic name
   * @param {Context} parentContext - Extracted from message
   * @param {Object} options - Span options
   * @returns {Span}
   */
  startConsumerSpan(destination, parentContext, options = {}) {
    const tracer = trace.getTracer(options.serviceName || 'messaging');
    
    return tracer.startSpan(
      `${destination} receive`,
      {
        kind: 4, // SpanKind.CONSUMER
        attributes: {
          'messaging.system': options.system || 'unknown',
          'messaging.destination': destination,
          'messaging.operation': 'receive',
          ...options.attributes,
        },
      },
      parentContext
    );
  }

  /**
   * Create a span for message processing
   * @param {string} destination - Queue/topic name
   * @param {Context} parentContext - From consumer span
   * @param {Object} options - Span options
   * @returns {Span}
   */
  startProcessSpan(destination, parentContext, options = {}) {
    const tracer = trace.getTracer(options.serviceName || 'messaging');
    
    return tracer.startSpan(
      `${destination} process`,
      {
        kind: 0, // SpanKind.INTERNAL
        attributes: {
          'messaging.system': options.system || 'unknown',
          'messaging.destination': destination,
          'messaging.operation': 'process',
          ...options.attributes,
        },
      },
      parentContext
    );
  }
}

export const messagingPropagator = new MessagingPropagator();
```

### 2. Add SQS Helper Functions

```javascript
// libs/sqs-tracing.mjs
import { messagingPropagator } from './messaging-propagation.mjs';
import { context } from '@opentelemetry/api';

/**
 * Wrap SQS sendMessage with tracing
 */
export function tracedSendMessage(sqs, params, options = {}) {
  const span = messagingPropagator.startProducerSpan(params.QueueUrl, {
    system: 'aws_sqs',
    serviceName: options.serviceName,
    attributes: {
      'messaging.message.id': params.MessageId,
      'messaging.destination.kind': 'queue',
    },
  });

  return context.with(context.active().setValue('span', span), async () => {
    try {
      // Inject trace context into message attributes
      const tracedParams = messagingPropagator.inject(params);
      
      const result = await sqs.sendMessage(tracedParams).promise();
      
      span.setAttribute('messaging.message.id', result.MessageId);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
      
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap SQS message processing with tracing
 */
export async function tracedProcessMessage(message, handler, options = {}) {
  // Extract context from message
  const parentContext = messagingPropagator.extract(message);
  
  // Create consumer span
  const consumerSpan = messagingPropagator.startConsumerSpan(
    options.queueUrl || 'unknown',
    parentContext,
    {
      system: 'aws_sqs',
      serviceName: options.serviceName,
      attributes: {
        'messaging.message.id': message.MessageId,
        'messaging.destination.kind': 'queue',
      },
    }
  );

  return context.with(context.active().setValue('span', consumerSpan), async () => {
    try {
      consumerSpan.end(); // Consumer span is instantaneous
      
      // Create processing span as child
      const processSpan = messagingPropagator.startProcessSpan(
        options.queueUrl || 'unknown',
        context.active(),
        {
          system: 'aws_sqs',
          serviceName: options.serviceName,
          attributes: {
            'messaging.message.id': message.MessageId,
            'messaging.message.body.size': message.Body?.length || 0,
          },
        }
      );

      return context.with(context.active().setValue('span', processSpan), async () => {
        try {
          const result = await handler(message);
          processSpan.setStatus({ code: 1 }); // SpanStatusCode.OK
          return result;
        } catch (error) {
          processSpan.recordException(error);
          processSpan.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR
          throw error;
        } finally {
          processSpan.end();
        }
      });
    } catch (error) {
      consumerSpan.recordException(error);
      consumerSpan.setStatus({ code: 2, message: error.message });
      throw error;
    }
  });
}

/**
 * Wrap SQS receiveMessage with batch support
 */
export async function tracedReceiveMessages(sqs, params, messageHandler, options = {}) {
  const result = await sqs.receiveMessage(params).promise();
  
  if (!result.Messages || result.Messages.length === 0) {
    return result;
  }

  // Process each message with tracing
  const processedMessages = await Promise.all(
    result.Messages.map(message =>
      tracedProcessMessage(message, messageHandler, {
        queueUrl: params.QueueUrl,
        serviceName: options.serviceName,
      })
    )
  );

  return {
    ...result,
    ProcessedMessages: processedMessages,
  };
}
```

### 3. Add RabbitMQ Helper Functions

```javascript
// libs/rabbitmq-tracing.mjs
import { messagingPropagator } from './messaging-propagation.mjs';
import { context } from '@opentelemetry/api';

/**
 * Wrap RabbitMQ publish with tracing
 */
export function tracedPublish(channel, exchange, routingKey, content, options = {}) {
  const destination = exchange || routingKey;
  const span = messagingPropagator.startProducerSpan(destination, {
    system: 'rabbitmq',
    serviceName: options.serviceName,
    attributes: {
      'messaging.destination.kind': exchange ? 'topic' : 'queue',
      'messaging.rabbitmq.routing_key': routingKey,
    },
  });

  return context.with(context.active().setValue('span', span), () => {
    try {
      // Inject trace context into message headers
      const carrier = {};
      propagation.inject(context.active(), carrier);
      
      const msgOptions = {
        ...options,
        headers: {
          ...options.headers,
          ...carrier,
        },
      };
      
      const result = channel.publish(exchange, routingKey, content, msgOptions);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap RabbitMQ consume with tracing
 */
export function tracedConsume(channel, queue, handler, options = {}) {
  return channel.consume(queue, async (message) => {
    if (!message) return;

    // Extract context from headers
    const parentContext = propagation.extract(context.active(), message.properties.headers || {});
    
    // Create consumer span
    const consumerSpan = messagingPropagator.startConsumerSpan(
      queue,
      parentContext,
      {
        system: 'rabbitmq',
        serviceName: options.serviceName,
        attributes: {
          'messaging.destination.kind': 'queue',
          'messaging.message.body.size': message.content?.length || 0,
        },
      }
    );

    await context.with(context.active().setValue('span', consumerSpan), async () => {
      try {
        consumerSpan.end(); // Consumer span is instantaneous
        
        // Create processing span
        const processSpan = messagingPropagator.startProcessSpan(
          queue,
          context.active(),
          {
            system: 'rabbitmq',
            serviceName: options.serviceName,
          }
        );

        await context.with(context.active().setValue('span', processSpan), async () => {
          try {
            await handler(message);
            processSpan.setStatus({ code: 1 });
            channel.ack(message);
          } catch (error) {
            processSpan.recordException(error);
            processSpan.setStatus({ code: 2, message: error.message });
            channel.nack(message);
            throw error;
          } finally {
            processSpan.end();
          }
        });
      } catch (error) {
        consumerSpan.recordException(error);
        consumerSpan.setStatus({ code: 2, message: error.message });
      }
    });
  }, options);
}
```

### 4. Usage Examples

#### Example 1: AWS SQS Producer
```javascript
import { tracedSendMessage } from '@saidsef/tracing-node/sqs-tracing';
import AWS from 'aws-sdk';

const sqs = new AWS.SQS();

async function sendOrder(order) {
  const params = {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456/orders',
    MessageBody: JSON.stringify(order),
  };
  
  // Automatically injects trace context
  const result = await tracedSendMessage(sqs, params, {
    serviceName: 'order-service',
  });
  
  console.log('Message sent:', result.MessageId);
}
```

#### Example 2: AWS SQS Consumer
```javascript
import { tracedProcessMessage } from '@saidsef/tracing-node/sqs-tracing';
import AWS from 'aws-sdk';

const sqs = new AWS.SQS();

async function pollMessages() {
  const params = {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456/orders',
    MaxNumberOfMessages: 10,
  };
  
  const result = await sqs.receiveMessage(params).promise();
  
  if (result.Messages) {
    for (const message of result.Messages) {
      // Automatically extracts trace context and creates spans
      await tracedProcessMessage(
        message,
        async (msg) => {
          const order = JSON.parse(msg.Body);
          await processOrder(order);
        },
        {
          queueUrl: params.QueueUrl,
          serviceName: 'order-processor',
        }
      );
      
      // Delete message after processing
      await sqs.deleteMessage({
        QueueUrl: params.QueueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }).promise();
    }
  }
}
```

#### Example 3: RabbitMQ Producer
```javascript
import { tracedPublish } from '@saidsef/tracing-node/rabbitmq-tracing';
import amqp from 'amqplib';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();

async function publishEvent(event) {
  const content = Buffer.from(JSON.stringify(event));
  
  // Automatically injects trace context into headers
  tracedPublish(channel, 'events', 'order.created', content, {
    serviceName: 'order-service',
    persistent: true,
  });
}
```

#### Example 4: RabbitMQ Consumer
```javascript
import { tracedConsume } from '@saidsef/tracing-node/rabbitmq-tracing';
import amqp from 'amqplib';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();
await channel.assertQueue('orders');

// Automatically extracts trace context and creates spans
tracedConsume(
  channel,
  'orders',
  async (message) => {
    const event = JSON.parse(message.content.toString());
    await handleOrderEvent(event);
  },
  {
    serviceName: 'order-handler',
    noAck: false,
  }
);
```

## Benefits

### For Developers
- ✅ Automatic context propagation without manual work
- ✅ Simple wrapper functions for common patterns
- ✅ Works with existing queue client libraries
- ✅ Clear parent-child span relationships

### For Operations
- ✅ End-to-end latency tracking across services
- ✅ Identify bottlenecks in async processing
- ✅ Correlate errors from producer to consumer
- ✅ Visualize message flow in service maps

### For Debugging
- ✅ Trace messages through entire pipeline
- ✅ See which messages are slow to process
- ✅ Identify which messages cause errors
- ✅ Correlate HTTP requests to async processing

## Trace Visualization

With proper context propagation, traces will show:

```
HTTP POST /orders (200ms)
  └─> order-service
      ├─> Database INSERT (50ms)
      └─> SQS send message (10ms)
          └─> order-processor
              ├─> SQS receive (0ms)
              └─> Process message (150ms)
                  ├─> Validate order (20ms)
                  ├─> Charge payment (100ms)
                  └─> Send confirmation email (30ms)
```

## Implementation Checklist

- [ ] Create messaging-propagation.mjs
- [ ] Create sqs-tracing.mjs
- [ ] Create rabbitmq-tracing.mjs
- [ ] Add Kafka support (kafka-tracing.mjs)
- [ ] Export helpers from main index
- [ ] Add tests for all queue types
- [ ] Update documentation with examples
- [ ] Add example projects for each queue system
- [ ] Update README with messaging section

## Testing

```javascript
// test/messaging-propagation.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MessagingPropagator } from '../libs/messaging-propagation.mjs';

describe('MessagingPropagator', () => {
  it('should inject context into message', () => {
    const propagator = new MessagingPropagator();
    const message = { Body: 'test' };
    
    const injected = propagator.inject(message);
    
    assert.ok(injected.MessageAttributes);
    assert.ok(injected.MessageAttributes.traceparent);
  });

  it('should extract context from message', () => {
    const propagator = new MessagingPropagator();
    const message = {
      MessageAttributes: {
        traceparent: {
          DataType: 'String',
          StringValue: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        },
      },
    };
    
    const context = propagator.extract(message);
    
    assert.ok(context);
  });
});
```

## Resources

- [OpenTelemetry Messaging Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/messaging/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [AWS SQS Message Attributes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html)
- [RabbitMQ Message Properties](https://www.rabbitmq.com/publishers.html#message-properties)
- [Distributed Tracing for Event-Driven Architectures](https://medium.com/jaegertracing/distributed-tracing-for-event-driven-architectures-a-practical-guide-7b47f8f1b73e)

## Assignee
@saidsef
