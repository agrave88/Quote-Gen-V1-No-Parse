import { QuoteLineItem, QuoteMeta, CommercialItemSnapshot, QuoteCommercialSnapshot } from '../types/quote';
import { parseQuoteReference } from './quoteNumber';

/**
 * Extracts nominal thickness (in mm) from product description or coverage notes.
 * Matches patterns like "100mm", "120 mm", "50mm", "t=100mm", etc.
 */
export function extractThicknessFromText(description?: string, notes?: string): number | undefined {
  const combined = `${description || ''} ${notes || ''}`;
  // Look for pattern like "100mm", "120 mm", "150 MM", "90mm"
  const match = combined.match(/\b(\d{2,3})\s*mm\b/i);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    if (!isNaN(val) && val > 0 && val < 500) {
      return val;
    }
  }
  return undefined;
}

/**
 * Creates a frozen commercial snapshot of a single line item.
 * Guarantees that historical quote prices, quantities, and discounts
 * are permanently preserved and never recomputed from today's catalog.
 */
export function createCommercialItemSnapshot(item: QuoteLineItem): CommercialItemSnapshot {
  const qty = item.finalQuantity !== undefined && item.finalQuantity !== null
    ? item.finalQuantity
    : item.calculatedQuantity || 1;
  const unitPrice = Math.round((item.unitSellPrice || 0) * 100) / 100;
  const listPrice = Math.round((item.listPrice ?? item.unitCost ?? unitPrice) * 100) / 100;
  const discount = item.discountPercent ?? 0;
  const lineTotal = Math.round(qty * unitPrice * 100) / 100;
  const thickness = extractThicknessFromText(item.description, item.coverageNotes);

  const snapshot: CommercialItemSnapshot = {
    sku: item.sku || 'CUSTOM',
    description: item.description || 'Quotation Product',
    quantity: qty,
    unit: item.unit || 'm²',
    unitPrice,
    listPrice,
    discount,
    lineTotal,
  };

  if (thickness !== undefined) {
    snapshot.thickness = thickness;
  }
  if (item.pricePerM2 !== undefined && item.pricePerM2 > 0) {
    snapshot.pricePerM2 = Math.round(item.pricePerM2 * 100) / 100;
  }
  if (item.costPrice !== undefined) {
    snapshot.costPrice = item.costPrice;
  }

  return snapshot;
}

/**
 * Creates a complete commercial snapshot of an entire quotation version.
 */
export function createQuoteCommercialSnapshot(
  meta: QuoteMeta,
  items: QuoteLineItem[]
): QuoteCommercialSnapshot {
  const itemSnapshots = items.map(createCommercialItemSnapshot);
  const totalNet = Math.round(itemSnapshots.reduce((acc, i) => acc + i.lineTotal, 0) * 100) / 100;
  const totalGross = Math.round(totalNet * 1.2 * 100) / 100;

  return {
    quoteReference: meta.quoteNumber,
    revision: parseQuoteReference(meta.quoteNumber).revision,
    savedAt: new Date().toISOString(),
    areaM2: meta.areaM2,
    wasteagePercent: meta.wasteagePercent,
    overallDiscountPercent: meta.overallDiscountPercent,
    totalNet,
    totalGross,
    items: itemSnapshots,
    priceBookCode: meta.priceBookCode,
    priceBookName: meta.priceBookName,
  };
}
