'use strict';

// CommonJS so @opentelemetry/instrumentation patches express/ioredis/http via
// require-in-the-middle (no ESM loader flags needed). Tracing is initialised by
// instrument.mjs (node --import) before this module loads.
const express = require('express');
const Redis = require('ioredis');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = parseInt(process.env.PORT || '8080', 10);

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on('error', (err) => logger.error({err: err.message}, 'redis error'));
redis.on('connect', () => logger.info('redis connected'));

const app = express();

app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Exercises HTTP (server span) + Express (route span) + IORedis (SET/GET) +
// Pino (trace context injection) in a single request.
app.get('/work/:id', async (req, res) => {
  const id = req.params.id;
  const key = `key:${id}`;
  try {
    await redis.set(key, `hello-${id}`, 'EX', 60);
    const val = await redis.get(key);
    logger.info({id, key, val}, 'handled work');
    res.json({id, key, val});
  } catch (err) {
    logger.error({id, err: err.message}, 'work failed');
    res.status(500).json({error: err.message});
  }
});

app.listen(PORT, () => logger.info({port: PORT}, 'demo listening'));
