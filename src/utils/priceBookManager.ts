import { PriceBook, PriceBookEntry, RockwoolProduct, CustomerRecord, ProductMaster } from '../types/quote';
import { PERMANENT_SHEET_ID } from './backgroundSheetSync';

export const PRICE_BOOKS_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Price%20Books`;
export const PRICE_ENTRIES_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Price%20Book%20Entries`;

/**
 * Standard built-in price books available across the platform.
 * These represent annual commercial rate schedules and special project agreements.
 */
export const DEFAULT_PRICE_BOOKS: PriceBook[] = [
  {
    id: 'pb-2026-rock-std',
    code: 'PB-2026-ROCK-STD',
    name: '2026 Rockwool Standard Pricing',
    currency: 'GBP',
    type: 'standard',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    isDefault: true,
    description: 'Current standard commercial rate book for all ROCKWOOL certified systems.',
  },
  {
    id: 'pb-2027-rock-std',
    code: 'PB-2027-ROCK-STD',
    name: '2027 Rockwool Standard Pricing',
    currency: 'GBP',
    type: 'standard',
    effectiveFrom: '2027-01-01',
    effectiveTo: '2027-12-31',
    isDefault: false,
    description: 'Next-year forward pricing for contracts commencing in 2027.',
  },
  {
    id: 'pb-tier1-framework',
    code: 'PB-TIER1-FRAMEWORK',
    name: 'Tier 1 Framework Agreement Pricing',
    currency: 'GBP',
    type: 'customer',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2027-12-31',
    isDefault: false,
    description: 'Negotiated commercial rates for contracted Tier 1 main contractors.',
  },
  {
    id: 'pb-spec-project',
    code: 'PB-SPEC-PROJECT',
    name: 'Special Project Pricing',
    currency: 'GBP',
    type: 'special_project',
    effectiveFrom: '2026-01-01',
    effectiveTo: undefined,
    isDefault: false,
    description: 'Bespoke volume agreement pricing for large-scale developments.',
  },
];

const PRICE_BOOKS_STORAGE_KEY = 'rockwool_price_books_v1';
const PRICE_ENTRIES_STORAGE_KEY = 'rockwool_price_entries_v1';

/**
 * Retrieves all registered price books from storage or built-in defaults.
 */
export function getAllPriceBooks(): PriceBook[] {
  if (typeof window === 'undefined') return DEFAULT_PRICE_BOOKS;
  try {
    const raw = localStorage.getItem(PRICE_BOOKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read cached price books:', e);
  }
  return DEFAULT_PRICE_BOOKS;
}

/**
 * Persists an updated list of price books in local cache.
 */
export function savePriceBooks(priceBooks: PriceBook[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PRICE_BOOKS_STORAGE_KEY, JSON.stringify(priceBooks));
  } catch (e) {
    console.warn('Could not save price books:', e);
  }
}

/**
 * Retrieves all price book entries (item overrides) from storage.
 */
export function getAllPriceBookEntries(): PriceBookEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PRICE_ENTRIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read cached price book entries:', e);
  }
  return [];
}

/**
 * Finds a specific price book by its code (e.g. 'PB-2026-ROCK-STD').
 */
export function getPriceBookByCode(code?: string): PriceBook | undefined {
  if (!code) return undefined;
  const list = getAllPriceBooks();
  return list.find((pb) => pb.code.toUpperCase() === code.trim().toUpperCase());
}

/**
 * Resolves the default standard price book, optionally matching the issue date of a quote.
 */
export function getDefaultPriceBook(targetDateStr?: string): PriceBook {
  const list = getAllPriceBooks();
  const dateStr = targetDateStr || new Date().toISOString().split('T')[0];

  // 1. Try to find a standard book whose date window covers the quote date
  const dateMatch = list.find((pb) => {
    if (pb.type !== 'standard') return false;
    const fromOk = !pb.effectiveFrom || pb.effectiveFrom <= dateStr;
    const toOk = !pb.effectiveTo || pb.effectiveTo >= dateStr;
    return fromOk && toOk;
  });

  if (dateMatch) return dateMatch;

  // 2. Fallback to book flagged with isDefault
  const explicitDefault = list.find((pb) => pb.isDefault);
  if (explicitDefault) return explicitDefault;

  // 3. Absolute fallback to first book or 2026 Standard
  return list[0] || DEFAULT_PRICE_BOOKS[0];
}

/**
 * Resolves the appropriate Price Book for a quotation:
 * 1. Checks if customer has an assigned negotiated price book code.
 * 2. Otherwise matches standard price book by quote issue date.
 * 3. Falls back to active default price book.
 */
export function resolvePriceBookForQuote(
  quoteDate?: string,
  customer?: CustomerRecord | null
): PriceBook {
  if (customer?.assignedPriceBookCode) {
    const customerBook = getPriceBookByCode(customer.assignedPriceBookCode);
    if (customerBook) {
      return customerBook;
    }
  }

  return getDefaultPriceBook(quoteDate);
}

/**
 * Resolves the commercial list and cost price for a product under a specific price book.
 * If no price book override entry exists, falls back gracefully to the product's base catalogue price.
 */
export function resolveProductPricing(
  product: RockwoolProduct,
  priceBookCode?: string,
  priceEntries?: PriceBookEntry[]
): {
  listPrice: number;
  costPrice?: number;
  floorPrice?: number;
  isPriceOnApplication: boolean;
  priceBookCode: string;
} {
  const activeBook = getPriceBookByCode(priceBookCode) || getDefaultPriceBook();
  const entries = priceEntries || getAllPriceBookEntries();

  const entry = entries.find(
    (e) =>
      e.priceBookId.toUpperCase() === activeBook.code.toUpperCase() &&
      e.productSku.toUpperCase() === product.sku.toUpperCase()
  );

  if (entry) {
    return {
      listPrice: entry.listPrice,
      costPrice: entry.costPrice !== undefined ? entry.costPrice : product.costPrice,
      floorPrice: entry.floorPrice,
      isPriceOnApplication: entry.isPriceOnApplication || entry.listPrice <= 0,
      priceBookCode: activeBook.code,
    };
  }

  // Example dynamic adjustments for forward standard price books if no direct line override exists:
  // (e.g. 2027 standard pricing carries a benchmark annual index adjustment if not individually line-specified)
  let resolvedList = product.listPrice;
  let resolvedCost = product.costPrice;

  if (activeBook.code === 'PB-2027-ROCK-STD' && product.listPrice > 0) {
    // Model projected 2027 list adjustment (+5% standard annual indexation on raw materials)
    resolvedList = Math.round(product.listPrice * 1.05 * 100) / 100;
    if (resolvedCost !== undefined && resolvedCost > 0) {
      resolvedCost = Math.round(resolvedCost * 1.05 * 100) / 100;
    }
  } else if (activeBook.code === 'PB-TIER1-FRAMEWORK' && product.listPrice > 0) {
    // Tier 1 Framework baseline agreement (-4% list concession)
    resolvedList = Math.round(product.listPrice * 0.96 * 100) / 100;
  }

  return {
    listPrice: resolvedList,
    costPrice: resolvedCost,
    isPriceOnApplication: product.isPriceOnApplication || resolvedList <= 0,
    priceBookCode: activeBook.code,
  };
}

/**
 * Persists an updated list of price book entries in local cache.
 */
export function savePriceBookEntries(entries: PriceBookEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PRICE_ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Could not save price book entries:', e);
  }
}

/**
 * Maps an entire catalogue array to reflect the pricing of a selected Price Book.
 */
export function resolveCatalogForPriceBook(
  catalogProducts: RockwoolProduct[],
  priceBookCode?: string,
  priceEntries?: PriceBookEntry[]
): RockwoolProduct[] {
  const activeBook = getPriceBookByCode(priceBookCode) || getDefaultPriceBook();

  return catalogProducts.map((p) => {
    const pricing = resolveProductPricing(p, activeBook.code, priceEntries);
    return {
      ...p,
      listPrice: pricing.listPrice,
      costPrice: pricing.costPrice,
      isPriceOnApplication: pricing.isPriceOnApplication,
    };
  });
}

/**
 * Parses raw CSV from the "Price Books" tab in Google Sheets
 */
export function parsePriceBooksCsv(csvText: string): PriceBook[] {
  if (!csvText || typeof csvText !== 'string') return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.toLowerCase().trim());

  const colCode = header.findIndex((h) => h.includes('code') || h.includes('id') || h === 'price book');
  const colName = header.findIndex((h) => h.includes('name') || h.includes('title') || h.includes('description'));
  const colCurrency = header.findIndex((h) => h.includes('currency') || h === 'curr');
  const colType = header.findIndex((h) => h.includes('type') || h.includes('category'));
  const colFrom = header.findIndex((h) => h.includes('from') || h.includes('start'));
  const colTo = header.findIndex((h) => h.includes('to') || h.includes('end') || h.includes('expiry'));
  const colDefault = header.findIndex((h) => h.includes('default'));
  const colDesc = header.findIndex((h) => h.includes('desc') || h.includes('note'));

  const books: PriceBook[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const code = colCode >= 0 && row[colCode] ? row[colCode].trim() : '';
    if (!code) continue;

    const name = colName >= 0 && row[colName] ? row[colName].trim() : code;
    const currency = colCurrency >= 0 && row[colCurrency] ? row[colCurrency].trim() : 'GBP';
    const rawType = colType >= 0 && row[colType] ? row[colType].trim().toLowerCase() : 'standard';
    const type: any = ['standard', 'customer', 'sector', 'special_project'].includes(rawType) ? rawType : 'standard';
    const effectiveFrom = colFrom >= 0 && row[colFrom] ? row[colFrom].trim() : '2026-01-01';
    const effectiveTo = colTo >= 0 && row[colTo] ? row[colTo].trim() : undefined;
    const isDefault = colDefault >= 0 && row[colDefault] ? ['true', 'yes', '1'].includes(row[colDefault].trim().toLowerCase()) : false;
    const description = colDesc >= 0 && row[colDesc] ? row[colDesc].trim() : undefined;

    books.push({
      id: `pb-${r}-${code.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      code,
      name,
      currency,
      type,
      effectiveFrom,
      effectiveTo,
      isDefault,
      description,
    });
  }

  return books;
}

/**
 * Parses raw CSV from the "Price Book Entries" tab in Google Sheets
 */
export function parsePriceBookEntriesCsv(csvText: string): PriceBookEntry[] {
  if (!csvText || typeof csvText !== 'string') return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.toLowerCase().trim());

  const colCode = header.findIndex((h) => h.includes('book') || h.includes('code') || h === 'price book');
  const colSku = header.findIndex((h) => h.includes('sku') || h.includes('code') || h.includes('item'));
  const colPrice = header.findIndex((h) => h.includes('list') || h.includes('price') || h.includes('rate') || h.includes('unit price'));
  const colCost = header.findIndex((h) => h.includes('cost'));
  const colFloor = header.findIndex((h) => h.includes('floor') || h.includes('min'));
  const colCurrency = header.findIndex((h) => h.includes('currency') || h === 'curr');

  const entries: PriceBookEntry[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const priceBookId = colCode >= 0 && row[colCode] ? row[colCode].trim() : '';
    const productSku = colSku >= 0 && row[colSku] ? row[colSku].trim() : '';

    if (!priceBookId || !productSku) continue;

    let listPrice = 0;
    if (colPrice >= 0 && row[colPrice]) {
      const parsed = parseFloat(row[colPrice].replace(/[^\d.-]/g, ''));
      if (!isNaN(parsed) && parsed >= 0) {
        listPrice = parsed;
      }
    }

    let costPrice: number | undefined;
    if (colCost >= 0 && row[colCost]) {
      const parsed = parseFloat(row[colCost].replace(/[^\d.-]/g, ''));
      if (!isNaN(parsed) && parsed >= 0) {
        costPrice = parsed;
      }
    }

    let floorPrice: number | undefined;
    if (colFloor >= 0 && row[colFloor]) {
      const parsed = parseFloat(row[colFloor].replace(/[^\d.-]/g, ''));
      if (!isNaN(parsed) && parsed >= 0) {
        floorPrice = parsed;
      }
    }

    const currency = colCurrency >= 0 && row[colCurrency] ? row[colCurrency].trim() : 'GBP';

    entries.push({
      id: `pbe-${r}-${priceBookId.toLowerCase()}-${productSku.toLowerCase()}`,
      priceBookId,
      productSku,
      listPrice,
      costPrice,
      floorPrice,
      currency,
      isPriceOnApplication: listPrice <= 0,
    });
  }

  return entries;
}

/**
 * Background silent sync for Price Books tab in Google Sheets
 */
export async function syncPriceBooksFromSheet(): Promise<{
  success: boolean;
  books: PriceBook[];
}> {
  try {
    const res = await fetch(PRICE_BOOKS_SHEET_CSV_URL);
    if (!res.ok) return { success: false, books: getAllPriceBooks() };

    const csvText = await res.text();
    if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
      return { success: false, books: getAllPriceBooks() };
    }

    const parsed = parsePriceBooksCsv(csvText);
    if (parsed.length > 0) {
      savePriceBooks(parsed);
      return { success: true, books: parsed };
    }

    return { success: false, books: getAllPriceBooks() };
  } catch {
    return { success: false, books: getAllPriceBooks() };
  }
}

/**
 * Background silent sync for Price Book Entries tab in Google Sheets
 */
export async function syncPriceEntriesFromSheet(): Promise<{
  success: boolean;
  entries: PriceBookEntry[];
}> {
  try {
    const res = await fetch(PRICE_ENTRIES_SHEET_CSV_URL);
    if (!res.ok) return { success: false, entries: getAllPriceBookEntries() };

    const csvText = await res.text();
    if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
      return { success: false, entries: getAllPriceBookEntries() };
    }

    const parsed = parsePriceBookEntriesCsv(csvText);
    if (parsed.length > 0) {
      savePriceBookEntries(parsed);
      return { success: true, entries: parsed };
    }

    return { success: false, entries: getAllPriceBookEntries() };
  } catch {
    return { success: false, entries: getAllPriceBookEntries() };
  }
}
