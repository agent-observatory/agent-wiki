FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY apps/agent-wiki-api apps/agent-wiki-api
COPY apps/agent-wiki-worker apps/agent-wiki-worker
COPY packages packages
RUN npx tsc -p tsconfig.json
RUN cp packages/core/src/schema.sql dist/packages/core/src/schema.sql
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
FROM runtime AS agent-wiki-api
ENV SERVICE_NAME=agent-wiki-api
CMD ["node","dist/apps/agent-wiki-api/src/server.js"]
FROM runtime AS agent-wiki-worker
ENV SERVICE_NAME=agent-wiki-worker
CMD ["node","dist/apps/agent-wiki-worker/src/server.js"]
