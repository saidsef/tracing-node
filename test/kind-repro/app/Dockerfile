FROM docker.io/node:20-alpine
WORKDIR /app
COPY saidsef-tracing-node-4.0.0.tgz /app/saidsef-tracing-node-4.0.0.tgz
COPY package.json /app/package.json
RUN npm install --omit=dev
COPY app.mjs /app/app.mjs
EXPOSE 8080
ENV NODE_OPTIONS=--unhandled-rejections=strict
CMD ["node", "app.mjs"]
