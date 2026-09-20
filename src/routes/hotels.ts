import { Router } from 'express';
import { getTemporalClient, TASK_QUEUE } from '../temporal/client';
import { aggregateHotelsWorkflow } from '../temporal/workflows';
import { getHotelsFromRedis } from '../redis/hotelStore';

const router = Router();

router.get('/api/hotels', async (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  if (!city) {
    return res.status(400).json({ error: 'Query parameter "city" is required, e.g. /api/hotels?city=delhi' });
  }

  const minPriceRaw = req.query.minPrice;
  const maxPriceRaw = req.query.maxPrice;
  const minPrice = typeof minPriceRaw === 'string' && minPriceRaw !== '' ? Number(minPriceRaw) : undefined;
  const maxPrice = typeof maxPriceRaw === 'string' && maxPriceRaw !== '' ? Number(maxPriceRaw) : undefined;

  if (minPrice !== undefined && Number.isNaN(minPrice)) {
    return res.status(400).json({ error: 'minPrice must be a number' });
  }
  if (maxPrice !== undefined && Number.isNaN(maxPrice)) {
    return res.status(400).json({ error: 'maxPrice must be a number' });
  }

  try {
    const client = await getTemporalClient();
    const workflowId = `aggregate-hotels-${city.toLowerCase()}-${Date.now()}`;

    const handle = await client.start(aggregateHotelsWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [city],
    });

    const result = await handle.result();

    let hotels = result.hotels;
    if (minPrice !== undefined || maxPrice !== undefined) {
      // Price filtering is performed inside Redis via ZRANGEBYSCORE.
      hotels = await getHotelsFromRedis(city, minPrice, maxPrice);
    }

    res.json(hotels);
  } catch (err) {
    console.error(`[route] /api/hotels failed for city="${city}":`, (err as Error).message);
    res.status(502).json({ error: 'Failed to aggregate hotel offers', details: (err as Error).message });
  }
});

export default router;
