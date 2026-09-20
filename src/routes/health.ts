import { Router } from 'express';
import axios from 'axios';
import { pingRedis } from '../redis/client';

const router = Router();

const SUPPLIER_BASE_URL = process.env.SUPPLIER_BASE_URL || 'http://localhost:3000';

async function checkSupplier(path: string): Promise<'ok' | 'error'> {
  try {
    await axios.get(`${SUPPLIER_BASE_URL}${path}`, { timeout: 3000 });
    return 'ok';
  } catch {
    return 'error';
  }
}

router.get('/health', async (_req, res) => {
  const [supplierA, supplierB, redisOk] = await Promise.all([
    checkSupplier('/supplierA/hotels'),
    checkSupplier('/supplierB/hotels'),
    pingRedis(),
  ]);

  const overallOk = supplierA === 'ok' && supplierB === 'ok' && redisOk;

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    dependencies: {
      supplierA,
      supplierB,
      redis: redisOk ? 'ok' : 'error',
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
