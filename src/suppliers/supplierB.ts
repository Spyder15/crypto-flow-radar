import { SupplierHotel } from '../types';

/**
 * Static mock data for Supplier B.
 * Overlaps several hotel names with Supplier A (Holtin, Radison, Marriott, ...)
 * with different prices/commissions so the "cheapest wins" logic can be exercised.
 */
export const supplierBData: SupplierHotel[] = [
  { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
  { hotelId: 'b2', name: 'Radison', price: 6100, city: 'delhi', commissionPct: 14 },
  { hotelId: 'b3', name: 'Hyatt Regency', price: 10500, city: 'delhi', commissionPct: 10 },
  { hotelId: 'b4', name: 'The Leela', price: 14500, city: 'mumbai', commissionPct: 10 },
  { hotelId: 'b5', name: 'Marriott', price: 9500, city: 'mumbai', commissionPct: 12 },
  { hotelId: 'b6', name: 'ITC Grand Central', price: 11200, city: 'mumbai', commissionPct: 9 },
  { hotelId: 'b7', name: 'Beach Resort Goa', price: 6900, city: 'goa', commissionPct: 16 },
  { hotelId: 'b8', name: 'Taj Fort Aguada', price: 18000, city: 'goa', commissionPct: 8 },
];

export function getSupplierBHotels(city?: string): SupplierHotel[] {
  if (!city) return supplierBData;
  const normalized = city.trim().toLowerCase();
  return supplierBData.filter((h) => h.city.toLowerCase() === normalized);
}
