import { RockwoolProduct } from '../types/quote';
import { parseGoogleSheetsCsv, DEFAULT_DYNAMIC_PRODUCTS } from './productParser';

const STORAGE_KEY_PRODUCTS = 'rockwool_sheet_dynamic_products_v4';
const STORAGE_KEY_SHEET_URL = 'rockwool_sheet_sync_url_v2';
const STORAGE_KEY_LAST_SYNC = 'rockwool_sheet_last_sync_timestamp';
const STORAGE_KEY_LAST_ERROR = 'rockwool_sheet_last_sync_error';
const STORAGE_KEY_PASTED_BACKUP = 'rockwool_sheet_pasted_data_backup';

// Fixed Google Sheet ID provided by the user (targeting Products tab)
export const PERMANENT_SHEET_ID = '1KadFxjyUz8mbUfbvTBGMD6QSwuLMrnlcWL71BRPQDF8';
export const PERMANENT_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Products`;

export function getInitialProducts(): RockwoolProduct[] {
  try {
    const cached = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Trust any valid cached product list with 1 or more items
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load cached products from localStorage:', e);
  }
  return DEFAULT_DYNAMIC_PRODUCTS;
}

export function saveCachedProducts(products: RockwoolProduct[]): void {
  try {
    if (Array.isArray(products) && products.length > 0) {
      localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, new Date().toISOString());
      localStorage.removeItem(STORAGE_KEY_LAST_ERROR);
    }
  } catch (e) {
    console.warn('Failed to cache products to localStorage:', e);
  }
}

export function saveCachedSyncError(errorMsg: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_ERROR, errorMsg);
  } catch (e) {
    console.warn('Failed to save sync error:', e);
  }
}

export function getCachedLastSyncTime(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_SYNC);
  } catch {
    return null;
  }
}

export function getCachedLastError(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_ERROR);
  } catch {
    return null;
  }
}

export function getConfiguredSheetUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_SHEET_URL) || PERMANENT_SHEET_CSV_URL;
  } catch {
    return PERMANENT_SHEET_CSV_URL;
  }
}

export function setConfiguredSheetUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_SHEET_URL, url.trim());
  } catch (e) {
    console.warn('Failed to store sheet URL:', e);
  }
}

export function getCachedPastedData(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_PASTED_BACKUP) || '';
  } catch {
    return '';
  }
}

export function saveCachedPastedData(data: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_PASTED_BACKUP, data);
  } catch (e) {
    console.warn('Failed to save pasted data:', e);
  }
}

/**
 * Normalizes Google Sheets URLs to direct CSV export format targeting the Products tab
 */
export function formatGoogleSheetCsvUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url || url === PERMANENT_SHEET_CSV_URL) return PERMANENT_SHEET_CSV_URL;

  // Pattern 1: https://docs.google.com/spreadsheets/d/{ID}/edit or similar
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetIdMatch) {
    const id = sheetIdMatch[1];
    if (url.includes('gviz/tq')) return url;
    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch) {
      return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gidMatch[1]}`;
    }
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=Products`;
  }

  // Pattern 2: Google Drive file share URL https://drive.google.com/file/d/{ID}/view
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
  if (driveMatch) {
    const id = driveMatch[1];
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=Products`;
  }

  return url;
}

/**
 * Silently synchronizes products from Google Sheets in the background
 */
export async function syncFromGoogleSheetBackground(
  sheetUrl?: string
): Promise<{ success: boolean; products?: RockwoolProduct[]; error?: string; source?: string }> {
  const targetUrl = (sheetUrl !== undefined && sheetUrl.trim() !== '' ? sheetUrl : getConfiguredSheetUrl()).trim();
  const fetchUrl = formatGoogleSheetCsvUrl(targetUrl);

  try {
    const res = await fetch(fetchUrl);

    if (!res.ok) {
      const errorMsg = `Google Sheets returned HTTP ${res.status} (${res.statusText || 'Error'})`;
      saveCachedSyncError(errorMsg);
      return { success: false, error: errorMsg };
    }

    const csvText = await res.text();

    // Check if Google returned an HTML login page instead of CSV
    if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html') || csvText.includes('google-signin')) {
      const errorMsg = 'Google Sheet is private or requires sign-in. Set sharing to "Anyone with link can view".';
      saveCachedSyncError(errorMsg);
      return { success: false, error: errorMsg };
    }

    const parsed = parseGoogleSheetsCsv(csvText);

    if (parsed.length > 0) {
      saveCachedProducts(parsed);
      saveCachedPastedData(csvText);
      return { success: true, products: parsed, source: 'Live Google Sheet' };
    } else {
      const errorMsg = 'Spreadsheet parsed successfully but returned 0 valid product rows.';
      saveCachedSyncError(errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    const errorMsg = err?.message || 'Network error or CORS restriction connecting to Google Sheets.';
    saveCachedSyncError(errorMsg);
    return { success: false, error: errorMsg };
  }
}
