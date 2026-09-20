import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import path from 'path';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'hotel-offer-task-queue';
const MAX_CONNECT_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Temporal's auto-setup container takes a while to run schema migrations and
 * start the frontend service, so the worker retries the initial connection
 * instead of crashing immediately on startup.
 */
async function connectWithRetry(): Promise<NativeConnection> {
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      return await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
    } catch (err) {
      console.warn(
        `[worker] Temporal not reachable at ${TEMPORAL_ADDRESS} (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}): ${(err as Error).message}`
      );
      if (attempt === MAX_CONNECT_ATTEMPTS) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error('Unreachable');
}

async function run() {
  const connection = await connectWithRetry();

  const worker = await Worker.create({
    connection,
    workflowsPath: path.join(__dirname, 'workflows.js'),
    activities,
    taskQueue: TASK_QUEUE,
  });

  console.log(`[worker] Connected to Temporal at ${TEMPORAL_ADDRESS}, task queue "${TASK_QUEUE}"`);
  await worker.run();
}

run().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
