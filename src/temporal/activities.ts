import axios from 'axios';
import { SupplierHotel, AggregatedHotel } from '../types';
import { saveHotelsToRedis } from '../redis/hotelStore';

const SUPPLIER_BASE_URL = process.env.SUPPLIER_BASE_URL || 'http://localhost:3000';
const SUPPLIER_TIMEOUT_MS = Number(process.env.SUPPLIER_TIMEOUT_MS || 5000);

/**
 * Calls the (mocked) Supplier A HTTP endpoint hosted by this same service.
 * Throws on failure so the workflow can record the supplier as down.
 */
export async function fetchSupplierAHotels(city: string): Promise<SupplierHotel[]> {
  try {
    const res = await axios.get<SupplierHotel[]>(`${SUPPLIER_BASE_URL}/supplierA/hotels`, {
      params: { city },
      timeout: SUPPLIER_TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    console.error(`[activity] Supplier A fetch failed for city="${city}":`, (err as Error).message);
    throw new Error(`Supplier A unavailable: ${(err as Error).message}`);
  }
}

/**
 * Calls the (mocked) Supplier B HTTP endpoint hosted by this same service.
 */
export async function fetchSupplierBHotels(city: string): Promise<SupplierHotel[]> {
  try {
    const res = await axios.get<SupplierHotel[]>(`${SUPPLIER_BASE_URL}/supplierB/hotels`, {
      params: { city },
      timeout: SUPPLIER_TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    console.error(`[activity] Supplier B fetch failed for city="${city}":`, (err as Error).message);
    throw new Error(`Supplier B unavailable: ${(err as Error).message}`);
  }
}

/**
 * Persists the final de-duplicated hotel list into Redis so it can later
 * be filtered by price range with ZRANGEBYSCORE.
 */
export async function persistHotelsToRedis(city: string, hotels: AggregatedHotel[]): Promise<void> {
  try {
    await saveHotelsToRedis(city, hotels);
  } catch (err) {
    console.error(`[activity] Failed to persist hotels for city="${city}" to Redis:`, (err as Error).message);
    throw err;
  }
}
