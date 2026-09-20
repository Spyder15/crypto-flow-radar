import { SupplierHotel } from '../types';

/**
 * Static mock data for Supplier A.
 * Intentionally overlaps hotel names with Supplier B for several cities
 * (delhi, mumbai, goa) so the dedupe/best-price logic has meaningful work to do.
 */
export const supplierAData: SupplierHotel[] = [
  { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
  { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
  { hotelId: 'a3', name: 'Taj Palace', price: 12000, city: 'delhi', commissionPct: 8 },
  { hotelId: 'a4', name: 'The Leela', price: 15000, city: 'mumbai', commissionPct: 9 },
  { hotelId: 'a5', name: 'Taj Mahal Palace', price: 21000, city: 'mumbai', commissionPct: 7 },
  { hotelId: 'a6', name: 'Marriott', price: 9800, city: 'mumbai', commissionPct: 11 },
  { hotelId: 'a7', name: 'Beach Resort Goa', price: 7200, city: 'goa', commissionPct: 15 },
  { hotelId: 'a8', name: 'Cidade de Goa', price: 8600, city: 'goa', commissionPct: 12 },
];

export function getSupplierAHotels(city?: string): SupplierHotel[] {
  if (!city) return supplierAData;
  const normalized = city.trim().toLowerCase();
  return supplierAData.filter((h) => h.city.toLowerCase() === normalized);
}
