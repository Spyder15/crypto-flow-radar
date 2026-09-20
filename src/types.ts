export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

export interface AggregatedHotel {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface AggregationResult {
  city: string;
  hotels: AggregatedHotel[];
  supplierAStatus: 'ok' | 'error';
  supplierBStatus: 'ok' | 'error';
}
