import {trace, SpanKind} from '@opentelemetry/api';
import {setupTracing, stopTracing} from '../../libs/index.mjs';

const TEMPO_API = 'http://localhost:3200';

async function waitForTempoReady(maxSeconds = 30) {
  for (let i = 0; i < maxSeconds; i++) {
    try {
      const r = await fetch(`${TEMPO_API}/ready`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Tempo /ready never returned 200');
}

async function searchTempo(serviceName, maxSeconds = 30) {
  const url = `${TEMPO_API}/api/search?tags=${encodeURIComponent(`service.name=${serviceName}`)}&limit=20`;
  for (let i = 0; i < maxSeconds; i++) {
    const r = await fetch(url);
    if (r.ok) {
      const body = await r.json();
      if (body.traces && body.traces.length > 0) return body.traces;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return [];
}

async function emitWorkload(label, opts) {
  await stopTracing().catch(() => {});
  const tracer = setupTracing(opts);
  const root = tracer.startSpan(`${label}-root`, {kind: SpanKind.SERVER});
  root.setAttribute('test.label', label);
  const child = tracer.startSpan(`${label}-child`, {kind: SpanKind.CLIENT});
  child.setAttribute('peer.service', 'fake-downstream');
  child.end();
  root.end();
  await stopTracing();
}

async function main() {
  console.log('# Wait for Tempo readiness');
  await waitForTempoReady();

  console.log('# Phase 1: grpc default (matches saidsef bootstrap)');
  await emitWorkload('grpc', {
    serviceName: 'saidsef',
    containerName: process.env.HOSTNAME,
    url: 'http://localhost:4317',
    enableDnsInstrumentation: false,
  });

  console.log('# Phase 2: http/protobuf with BARE URL (would have failed pre-fix; new code auto-appends /v1/traces)');
  await emitWorkload('httpproto-bare', {
    serviceName: 'saidsef-httpproto-bare',
    url: 'http://localhost:4318',
    exporterProtocol: 'http/protobuf',
    enableMetrics: false,
  });

  console.log('# Phase 3: env conflict: OTEL_SERVICE_NAME set, programmatic must win');
  process.env.OTEL_SERVICE_NAME = 'hijacked-by-env';
  try {
    await emitWorkload('envconflict', {
      serviceName: 'saidsef-programmatic-wins',
      url: 'http://localhost:4317',
    });
  } finally {
    delete process.env.OTEL_SERVICE_NAME;
  }

  console.log('# Wait for Tempo to ingest...');
  await new Promise((r) => setTimeout(r, 6000));

  let exitCode = 0;
  for (const svc of ['saidsef', 'saidsef-httpproto-bare', 'saidsef-programmatic-wins']) {
    const traces = await searchTempo(svc);
    if (traces.length === 0) {
      console.error(`FAIL: no traces found for service.name=${svc}`);
      exitCode = 1;
    } else {
      console.log(`OK:   ${traces.length} trace(s) found for service.name=${svc} (first traceID=${traces[0].traceID})`);
    }
  }
  const hijacked = await searchTempo('hijacked-by-env', 3);
  if (hijacked.length > 0) {
    console.error(`FAIL: traces leaked under service.name=hijacked-by-env (env override should have been beaten by the programmatic value)`);
    exitCode = 1;
  } else {
    console.log('OK:   no traces under hijacked-by-env (programmatic serviceName wins)');
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(2); });
