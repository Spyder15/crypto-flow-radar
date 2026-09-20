FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime image ---
# Single-container setup: bundles Redis, an embedded Temporal dev server
# (SQLite-backed — no Postgres needed), the Temporal worker, and the Express
# API server together. Everything talks over 127.0.0.1 inside one container,
# which avoids Docker bridge/host networking issues seen across different
# environments (Docker Desktop, GitHub Codespaces, CI, etc.).
#
# NOTE: node:20-bookworm-slim (glibc) is required, not node:20-alpine (musl):
# @temporalio/core-bridge ships a glibc-linked native binary that fails to
# load on musl (ERR_DLOPEN_FAILED: ld-linux-x86-64.so.2).
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-server \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the Temporal CLI (provides `temporal server start-dev`).
RUN curl -sSf https://temporal.download/cli.sh | sh \
    && mv /root/.temporalio/bin/temporal /usr/local/bin/temporal \
    && temporal --version

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY docker/start.sh ./docker/start.sh
RUN chmod +x ./docker/start.sh

ENV PORT=3000 \
    REDIS_URL=redis://127.0.0.1:6379 \
    TEMPORAL_ADDRESS=127.0.0.1:7233 \
    TEMPORAL_TASK_QUEUE=hotel-offer-task-queue \
    SUPPLIER_BASE_URL=http://127.0.0.1:3000

EXPOSE 3000 7233 8080

CMD ["./docker/start.sh"]
