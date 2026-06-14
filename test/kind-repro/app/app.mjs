import {setupTracing} from '@saidsef/tracing-node';

setupTracing({
  serviceName: process.env.SERVICE_NAME || 'saidsef',
  containerName: process.env.HOSTNAME,
  url: process.env.ENDPOINT || 'http://alloy.monitoring.svc:4317',
  enableDnsInstrumentation: false,
});

const express = (await import('express')).default;

const ROLE = process.env.ROLE || 'frontend';
const PORT = parseInt(process.env.PORT || '8080', 10);
const DOWNSTREAM = process.env.DOWNSTREAM_URL;

const app = express();

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.get('/work', async (_req, res) => {
  if (ROLE === 'frontend' && DOWNSTREAM) {
    try {
      const r = await fetch(`${DOWNSTREAM}/leaf`);
      const body = await r.text();
      res.json({role: ROLE, downstream: body});
    } catch (e) {
      res.status(500).json({error: String(e)});
    }
  } else {
    res.json({role: ROLE, ok: true});
  }
});

app.get('/leaf', (_req, res) => {
  res.json({role: ROLE, leaf: true});
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${ROLE} listening on :${PORT} (downstream=${DOWNSTREAM ?? 'none'})`);
});
