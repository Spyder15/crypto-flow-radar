import { Router } from 'express';
import { getSupplierAHotels } from '../suppliers/supplierA';
import { getSupplierBHotels } from '../suppliers/supplierB';

const router = Router();

// Mock Supplier A endpoint
router.get('/supplierA/hotels', (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city : undefined;
  res.json(getSupplierAHotels(city));
});

// Mock Supplier B endpoint
router.get('/supplierB/hotels', (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city : undefined;
  res.json(getSupplierBHotels(city));
});

export default router;
