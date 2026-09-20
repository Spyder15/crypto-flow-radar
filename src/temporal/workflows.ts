import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import { AggregatedHotel, AggregationResult, SupplierHotel } from '../types';

const { fetchSupplierAHotels, fetchSupplierBHotels, persistHotelsToRedis } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Merges hotel lists from both suppliers, de-duplicating by hotel name
 * (case-insensitive) and keeping the cheaper offer when a name appears in both.
 */
function mergeCheapest(
  listA: SupplierHotel[],
  listB: SupplierHotel[]
): AggregatedHotel[] {
  const byName = new Map<string, AggregatedHotel>();

  const consider = (hotel: SupplierHotel, supplierLabel: string) => {
    const key = hotel.name.trim().toLowerCase();
    const candidate: AggregatedHotel = {
      name: hotel.name,
      price: hotel.price,
      supplier: supplierLabel,
      commissionPct: hotel.commissionPct,
    };
    const existing = byName.get(key);
    if (!existing || candidate.price < existing.price) {
      byName.set(key, candidate);
    }
  };

  for (const hotel of listA) consider(hotel, 'Supplier A');
  for (const hotel of listB) consider(hotel, 'Supplier B');

  return Array.from(byName.values()).sort((a, b) => a.price - b.price);
}

/**
 * Orchestrates hotel aggregation for a city:
 * 1. Calls Supplier A and Supplier B in parallel.
 * 2. De-duplicates by hotel name, keeping the cheaper offer.
 * 3. Persists the final list to Redis for downstream price-range filtering.
 * 4. Returns the aggregated list plus per-supplier health status to the caller.
 */
export async function aggregateHotelsWorkflow(city: string): Promise<AggregationResult> {
  const [supplierAResult, supplierBResult] = await Promise.allSettled([
    fetchSupplierAHotels(city),
    fetchSupplierBHotels(city),
  ]);

  const listA = supplierAResult.status === 'fulfilled' ? supplierAResult.value : [];
  const listB = supplierBResult.status === 'fulfilled' ? supplierBResult.value : [];

  const supplierAStatus = supplierAResult.status === 'fulfilled' ? 'ok' : 'error';
  const supplierBStatus = supplierBResult.status === 'fulfilled' ? 'ok' : 'error';

  const hotels = mergeCheapest(listA, listB);

  await persistHotelsToRedis(city, hotels);

  return { city, hotels, supplierAStatus, supplierBStatus };
}
