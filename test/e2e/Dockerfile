# Build context = repo root:
#   docker build -t tracing-e2e-demo:local -f test/e2e/Dockerfile .
FROM node:22-slim

WORKDIR /app

# Install the tracing-node library's own prod deps (the @opentelemetry/* packages
# that libs/index.mjs imports). All are pure-JS, so no build toolchain is needed.
COPY package.json package-lock.json ./
COPY libs ./libs
RUN npm ci --omit=dev

# Consumer libraries the demo app instruments (not deps of tracing-node).
RUN npm install --no-save express@^4 ioredis@^5 pino@^9

# Demo app + tracing preload (placed at /app so ./libs/index.mjs resolves).
COPY test/e2e/app.cjs test/e2e/instrument.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

# --import runs the ESM tracing preload to completion before the CJS app loads.
CMD ["node", "--import", "./instrument.mjs", "./app.cjs"]
