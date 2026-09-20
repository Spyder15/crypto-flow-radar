import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import hotelsRouter from './routes/hotels';
import suppliersRouter from './routes/suppliers';
import healthRouter from './routes/health';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.use(healthRouter);
app.use(suppliersRouter);
app.use(hotelsRouter);

app.get('/', (_req, res) => {
  res.json({
    service: 'Hotel Offer Orchestrator',
    endpoints: [
      'GET /api/hotels?city=delhi',
      'GET /api/hotels?city=delhi&minPrice=5000&maxPrice=10000',
      'GET /supplierA/hotels?city=delhi',
      'GET /supplierB/hotels?city=delhi',
      'GET /health',
    ],
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] Hotel Offer Orchestrator listening on port ${PORT}`);
});
