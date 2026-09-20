# Hotel Offer Orchestrator

A small service that pulls hotel listings from two supplier APIs, merges duplicates,
and keeps the cheaper offer for each hotel. Built with Node.js, TypeScript, Express,
Temporal and Redis.

## What it does

- Calls Supplier A and Supplier B in parallel for a given city
- Matches hotels by name and keeps whichever price is lower
- If only one supplier has a hotel, that offer is kept as-is
- Saves the final list in Redis
- Supports filtering the result by min/max price, filtered directly in Redis

The whole comparison flow (calling both suppliers, deduping, saving to Redis) runs as
a Temporal workflow, so it gets retries and visibility for free.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/hotels?city=delhi` | Runs the workflow and returns the deduped hotel list |
| GET | `/api/hotels?city=delhi&minPrice=5000&maxPrice=10000` | Same, filtered by price range |
| GET | `/supplierA/hotels?city=delhi` | Mock Supplier A data |
| GET | `/supplierB/hotels?city=delhi` | Mock Supplier B data |
| GET | `/health` | Status of Supplier A, Supplier B and Redis |

Sample response:

```json
[
  { "name": "Holtin", "price": 5340, "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison", "price": 5900, "supplier": "Supplier A", "commissionPct": 13 }
]
```

Cities with overlapping mock data: `delhi`, `mumbai`, `goa`. Any other city just returns `[]`.

## Running it with Docker

Everything (Redis, Temporal, the worker and the API) runs in one container, so there's
nothing extra to configure.

```bash
docker compose up --build
```

Once it's up:

```bash
curl "http://localhost:3000/api/hotels?city=delhi"
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=5000&maxPrice=10000"
curl "http://localhost:3000/health"
```

Temporal's web UI is at `http://localhost:8080` if you want to inspect workflow runs.

Stop it with:

```bash
docker compose down
```

There's also a `docker-compose.multi-container.yml` that runs Postgres, Temporal, Redis,
the API and the worker as separate containers, closer to a real production setup. Use it
with `docker compose -f docker-compose.multi-container.yml up --build`.

## Running it locally (without Docker)

You'll need Node.js 20+, a Redis instance, and a Temporal server running
(`temporal server start-dev` from the [Temporal CLI](https://docs.temporal.io/cli) works fine).

```bash
npm install
cp .env.example .env

# terminal 1
npm run dev

# terminal 2 — required for /api/hotels to work
npm run dev:worker
```

Or build and run the compiled version:

```bash
npm run build
npm start
npm run start:worker
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal frontend address |
| `TEMPORAL_TASK_QUEUE` | `hotel-offer-task-queue` | Task queue shared by the API and the worker |
| `SUPPLIER_BASE_URL` | `http://localhost:3000` | Base URL used to call the mock supplier endpoints |
| `SUPPLIER_TIMEOUT_MS` | `5000` | Timeout for supplier calls |

## Testing with Postman

Import `postman/hotel-offer-orchestrator.postman_collection.json`. It covers:

- Health check
- Raw supplier A/B responses
- A valid city with overlapping hotels (`delhi`)
- A city with no results
- Missing `city` param (should 400)
- Price range filtering
- A couple more overlap cities (`mumbai`, `goa`)

To simulate a supplier being down, point `SUPPLIER_BASE_URL` at an unreachable address (or
stop the process) and call `/api/hotels?city=delhi` — the workflow still returns results
from whichever supplier responded, and `/health` will show the other one as down.

## Error handling & logging

- Supplier calls are retried a few times by Temporal before falling back to whatever
  succeeded.
- The Redis save step throws on failure instead of silently succeeding, so Temporal
  retries it properly.
- `/api/hotels` returns 400 for missing/invalid query params and 502 if the workflow
  fails after retries.
- `/health` returns 200 when everything is healthy, 503 if anything is down.

## Project structure

```
src/
  server.ts            Express app entry point
  types.ts             Shared interfaces
  routes/
    hotels.ts           GET /api/hotels
    suppliers.ts         Mock supplier endpoints
    health.ts             GET /health
  suppliers/
    supplierA.ts / supplierB.ts   Mock hotel data
  redis/
    client.ts             ioredis client
    hotelStore.ts          Save/read/filter hotels in Redis
  temporal/
    activities.ts          Supplier calls + Redis persistence
    workflows.ts           Main workflow (fetch, dedupe, save)
    worker.ts              Worker process
    client.ts              Workflow client used by the API
postman/
  hotel-offer-orchestrator.postman_collection.json
docker/
  start.sh               Container entrypoint (starts Redis, Temporal, worker, API)
Dockerfile               Single-container build
docker-compose.yml       Default compose file
docker-compose.multi-container.yml   Optional separate-container setup
```
