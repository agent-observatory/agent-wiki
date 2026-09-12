FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY apps/api apps/api
COPY packages packages
RUN npx tsc -p tsconfig.json
RUN cp packages/core/src/schema.sql dist/packages/core/src/schema.sql
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node","dist/apps/api/src/server.js"]
