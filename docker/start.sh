#!/bin/bash
# Single-container startup: runs Redis, an embedded Temporal dev server
# (SQLite-backed, no separate Postgres needed), the Temporal worker, and the
# Express API server — all in one process group talking over 127.0.0.1.
# This sidesteps Docker bridge/host networking issues entirely since nothing
# needs to cross a container boundary.
set -e

echo "[start] Starting Redis..."
redis-server --daemonize yes --bind 127.0.0.1 --save "" --appendonly no

echo "[start] Waiting for Redis..."
until redis-cli ping >/dev/null 2>&1; do
  sleep 0.5
done
echo "[start] Redis is ready."

echo "[start] Starting embedded Temporal dev server (SQLite, no Postgres needed)..."
temporal server start-dev \
  --ip 0.0.0.0 \
  --port 7233 \
  --ui-port 8080 \
  --db-filename /tmp/temporal.db \
  --log-level warn &
TEMPORAL_PID=$!

echo "[start] Waiting for Temporal frontend on 127.0.0.1:7233..."
until temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; do
  sleep 1
done
echo "[start] Temporal is ready."

echo "[start] Starting Temporal worker..."
node dist/temporal/worker.js &
WORKER_PID=$!

echo "[start] Starting API server..."
node dist/server.js &
APP_PID=$!

# Exit the whole container if any of the core processes die.
wait -n "$TEMPORAL_PID" "$WORKER_PID" "$APP_PID"
EXIT_CODE=$?
echo "[start] A core process exited (code $EXIT_CODE); shutting down."
exit $EXIT_CODE
