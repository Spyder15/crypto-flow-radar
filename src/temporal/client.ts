import { Connection, WorkflowClient } from '@temporalio/client';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || 'hotel-offer-task-queue';

let cachedClient: WorkflowClient | null = null;

export async function getTemporalClient(): Promise<WorkflowClient> {
  if (cachedClient) return cachedClient;
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  cachedClient = new WorkflowClient({ connection });
  return cachedClient;
}

export { TASK_QUEUE };
