// E2E tracing preload. Run via: node --import ./instrument.mjs ./app.cjs
// Initialises the LOCAL tracing-node library (libs/index.mjs) before the app
// loads, so its instrumentations patch express/ioredis/http on require.
// serviceName + url are read from SERVICE_NAME and ENDPOINT env vars.
import {setupTracing} from './libs/index.mjs';

setupTracing();
