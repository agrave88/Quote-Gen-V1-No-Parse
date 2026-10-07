export interface RockwoolProduct {
  id: string;
  sku: string;
  description: string;
  category: string;
  subCategory?: string;
  manufacturer?: string; // e.g. 'ROCKWOOL', 'Wetherby', 'Heck'
  system?: string; // e.g. 'Wetherby Stone Wool Façade System'
  thickness?: number; // Nominal thickness in mm (e.g. 50, 100, 120, 150)
  unit: string; // e.g. m², bag, roll, tub, bucket, box, pack, linear meter
  costPrice?: number; // £ cost price per unit from spreadsheet
  listPrice: number; // £ list price per unit
  coverageNotes: string; // e.g. "Approx. 60m² per tub" or "5-6 per m²"
  ratePerM2?: number; // Calculated or specified consumption rate per m²
  packSize?: number; // If sold in boxes of 100, etc.
  isPriceOnApplication?: boolean; // When true, price was missing/POA in catalog
}

export interface QuoteLineItem {
  id: string;
  productId: string;
  sku: string;
  description: string;
  category: string;
  unit: string;
  costPrice?: number; // Cost price per unit from spreadsheet
  listPrice: number; // List price per unit from sheet / catalog
  isPriceOnApplication?: boolean; // When true, price was missing/POA in catalog
  unitCost?: number; // Backward compatibility alias for listPrice
  consumptionRatePerM2: number; // e.g. 1.0 m²/m², 0.0167 tubs/m², 0.05 boxes/m²
  coverageNotes: string;
  manualQuantityOverride?: number | null; // If user overrides total quantity directly
  calculatedQuantity: number; // Calculated based on gross m2 * consumptionRate
  finalQuantity: number; // user override if present, else calculatedQuantity (rounded as appropriate)
  discountPercent: number; // Discount from list % (e.g. 15%)
  marginPercent?: number; // Backward compatibility
  unitSellPrice: number; // listPrice * (1 - discountPercent / 100)
  pricePerM2: number; // (finalQuantity * unitSellPrice) / areaM2 (£/m² price)
  excludeFromM2Rate?: boolean; // When true, excluded from the £/m² rate calculation
  totalCost?: number; // Optional internal
  totalSell?: number; // Optional internal
  isCustomOrAdded: boolean;
  commercialSnapshot?: CommercialItemSnapshot; // Frozen commercial snapshot from when quote was created/saved
}

export interface CommercialItemSnapshot {
  sku: string;
  description: string;
  thickness?: number | string;
  quantity: number;
  unit: string;
  unitPrice: number; // Unit Sell Price (£)
  listPrice?: number; // Unit List Price (£)
  discount: number; // Discount %
  lineTotal: number; // Line total (£)
  pricePerM2?: number; // £/m² rate
  costPrice?: number;
}

export interface QuoteCommercialSnapshot {
  quoteReference: string;
  revision: number;
  savedAt: string;
  areaM2: number;
  wasteagePercent: number;
  overallDiscountPercent: number;
  totalNet: number;
  totalGross: number;
  items: CommercialItemSnapshot[];
  priceBookCode?: string;
  priceBookName?: string;
}

export interface CustomerRecord {
  id: string;
  companyName: string;
  contactPerson: string;
  address: string;
  cityCounty: string;
  postcode: string;
  telephone: string;
  mobile: string;
  email: string;
  technicalSalesManager?: string;
  assignedPriceBookCode?: string; // Optional negotiated price book for this client
}

export interface ProjectRecord {
  id: string;
  projectName: string;
  projectReference?: string;
  projectLocation?: string;
  clientName?: string;
  clientCompany?: string;
  contactPerson?: string;
  areaM2?: number;
  assignedPriceBookCode?: string;
  notes?: string;
}

export type PriceBookType = 'standard' | 'customer' | 'sector' | 'special_project';

export interface PriceBook {
  id: string;
  code: string; // e.g. 'PB-2026-ROCK-STD', 'PB-2027-ROCK-STD'
  name: string; // e.g. '2026 Rockwool Standard Pricing'
  currency: string; // 'GBP'
  type: PriceBookType;
  effectiveFrom: string; // ISO date 'YYYY-MM-DD'
  effectiveTo?: string; // Optional expiry 'YYYY-MM-DD'
  isDefault?: boolean;
  description?: string;
}

export interface PriceBookEntry {
  id: string;
  priceBookId: string;
  productSku: string;
  listPrice: number;
  costPrice?: number;
  floorPrice?: number;
  currency: string;
  isPriceOnApplication?: boolean;
}

export interface ProductMaster {
  id: string;
  sku: string;
  name: string;
  category: string;
  subCategory?: string;
  manufacturer?: string; // e.g. 'ROCKWOOL', 'Wetherby', 'Heck'
  system?: string; // e.g. 'Wetherby Stone Wool Façade System'
  thickness?: number; // Nominal thickness in mm (e.g. 50, 100, 120, 150)
  unit: string; // m², bag, roll, tub, bucket, box, pack, linear meter
  coverageNotes?: string;
  ratePerM2?: number; // Technical consumption rate per m²
  packSize?: number;
  active: boolean;
}

export interface QuoteMeta {
  quoteNumber: string;
  date: string;
  validUntil: string;
  clientName: string;
  contactPerson?: string;
  clientCompany: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress?: string;
  clientCity?: string;
  clientPostcode?: string;
  technicalSalesManager?: string;
  projectName: string;
  projectReference?: string;
  projectLocation: string;
  areaM2: number;
  wasteagePercent: number; // e.g. 5% or 10%
  overallDiscountPercent: number; // Global discount from list benchmark %
  overallMarginPercent?: number; // Backward compatibility
  notesAndTerms: string;
  includeInstallationEstimate: boolean;
  installationRatePerM2: number;
  expectedStartDate?: string;
  numberOfPhases?: number;
  phaseDurationMonths?: number;
  numberOfUnits?: number;
  unitSizeM2?: number;
  dealStatus?: 'Won' | 'Lost' | 'Pending';
  winLikelihood?: number; // 0-100 percentage
  commercialSnapshot?: QuoteCommercialSnapshot; // Frozen commercial snapshot of the quote record
  priceBookCode?: string; // e.g. 'PB-2026-ROCK-STD'
  priceBookName?: string; // e.g. '2026 Rockwool Standard Pricing'
}

export interface SheetSourceConfig {
  sourceType: 'google_workspace' | 'public_sheet_csv' | 'pasted_csv' | 'preset_demo';
  sheetId?: string;
  sheetName?: string;
  csvUrl?: string;
  pastedData?: string;
  lastSynced?: string;
  connectedAccount?: string;
}
