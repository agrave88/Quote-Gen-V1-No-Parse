import { CustomerRecord } from '../types/quote';
import { DEFAULT_CUSTOMERS } from './defaultCustomers';
import { PERMANENT_SHEET_ID } from './backgroundSheetSync';

const STORAGE_KEY_CUSTOMERS = 'rockwool_sheet_customers_directory_v1';
const STORAGE_KEY_CUSTOMERS_LAST_SYNC = 'rockwool_sheet_customers_last_sync_timestamp';

// Contractors tab export URL with explicit tab GID 250062093 (106 verified contractor records)
export const CUSTOMERS_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/export?format=csv&gid=250062093`;
export const CUSTOMERS_GVIZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Contractors`;

/**
 * Returns initial list of customers, preferring cached version if valid, otherwise DEFAULT_CUSTOMERS
 */
export function getInitialCustomers(): CustomerRecord[] {
  try {
    const cached = localStorage.getItem(STORAGE_KEY_CUSTOMERS);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load cached customers:', e);
  }
  return DEFAULT_CUSTOMERS;
}

/**
 * Saves customer records to localStorage
 */
export function saveCachedCustomers(customers: CustomerRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
    localStorage.setItem(STORAGE_KEY_CUSTOMERS_LAST_SYNC, new Date().toISOString());
  } catch (e) {
    console.warn('Failed to cache customers:', e);
  }
}

/**
 * Parses raw CSV from the Customers tab
 */
export function parseCustomersCsv(csvText: string): CustomerRecord[] {
  if (!csvText || typeof csvText !== 'string') return [];

  // Parse CSV into rows accounting for quoted values with line breaks/commas
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
        i++; // skip escaped quote
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
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  // Identify column indices from header with prioritized disambiguation
  const header = rows[0].map(h => h.toLowerCase().trim());

  // 1. Company Name / Contractor / Client
  let colCompany = header.findIndex(h => 
    h === 'contractor' || h === 'contractor name' || h === 'company' || h === 'company name' || h === 'customer' || h === 'customer name' || 
    h === 'client' || h === 'client name' || h === 'account name' || h === 'organization' || h === 'business'
  );
  if (colCompany === -1) {
    colCompany = header.findIndex(h => h.includes('contractor') || h.includes('company') || h.includes('customer') || h.includes('account') || h.includes('client'));
  }

  // 2. Contact Person (must explicitly exclude company/account/business/client names)
  let colContact = header.findIndex(h => 
    h === 'contact' || h === 'contact person' || h === 'contact name' || h === 'person' || 
    h === 'attn' || h === 'attention' || h === 'representative' || h === 'rep'
  );
  if (colContact === -1) {
    colContact = header.findIndex(h => 
      (h.includes('contact') || h.includes('person') || h.includes('rep') || h.includes('attn')) &&
      !h.includes('company') && !h.includes('customer') && !h.includes('account')
    );
  }
  if (colContact === -1) {
    // If column simply contains "name" and is not the company column
    colContact = header.findIndex((h, idx) => 
      idx !== colCompany && 
      (h === 'name' || h === 'full name' || h === 'individual') &&
      !h.includes('company') && !h.includes('business') && !h.includes('customer')
    );
  }

  // 3. Email Address (must take precedence to prevent email address matching physical address)
  let colEmail = header.findIndex(h => 
    h === 'email' || h === 'e-mail' || h === 'email address' || h === 'e-mail address' || h === 'mail'
  );
  if (colEmail === -1) {
    colEmail = header.findIndex(h => h.includes('email') || h.includes('e-mail') || (h.includes('mail') && !h.includes('post')));
  }

  // 4. Physical / Street Address (must explicitly exclude email, e-mail, mail, web, url)
  let colAddress = header.findIndex(h => 
    h === 'address' || h === 'street' || h === 'street address' || h === 'address line 1' || 
    h === 'site address' || h === 'postal address' || h === 'billing address'
  );
  if (colAddress === -1) {
    colAddress = header.findIndex(h => 
      (h.includes('address') || h.includes('street') || h.includes('premises') || h.includes('location')) &&
      !h.includes('email') && !h.includes('e-mail') && !h.includes('mail') && !h.includes('web') && !h.includes('url')
    );
  }

  // 5. City / County / Town
  const colCity = header.findIndex(h => 
    h.includes('city') || h.includes('county') || h.includes('town') || h.includes('province') || h.includes('state')
  );

  // 6. Postcode / Zip
  const colPostcode = header.findIndex(h => 
    h.includes('postcode') || h.includes('post code') || h.includes('zip') || h.includes('postal')
  );

  // 7. Mobile Phone
  const colMobile = header.findIndex(h => 
    h.includes('mobile') || h.includes('mob') || h.includes('cell') || h.includes('cellphone')
  );

  // 8. Telephone / Landline (must not match mobile column or random words containing "tel")
  const colTelephone = header.findIndex((h, idx) => 
    idx !== colMobile && 
    (h.includes('telephone') || h.includes('landline') || h.includes('office phone') || 
     h === 'phone' || h === 'tel' || h.startsWith('phone') || h.startsWith('tel ') || h.endsWith(' tel') || h.includes('phone'))
  );

  // 9. Technical Sales Manager / TSM
  const colTsm = header.findIndex(h => 
    h.includes('technical sales') || h.includes('sales manager') || h.includes('sales manger') || 
    h.includes('tsm') || h.includes('sales rep') || h.includes('manager')
  );

  // 10. Assigned Price Book
  const colPriceBook = header.findIndex(h => 
    h.includes('price book') || h.includes('rate book') || h.includes('pricebook') || h.includes('rate')
  );

  const customers: CustomerRecord[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const companyName = colCompany >= 0 && row[colCompany] ? row[colCompany].trim() : '';
    const contactPerson = colContact >= 0 && row[colContact] ? row[colContact].trim() : '';
    const address = colAddress >= 0 && row[colAddress] ? row[colAddress].trim() : '';
    const cityCounty = colCity >= 0 && row[colCity] ? row[colCity].trim() : '';
    const postcode = colPostcode >= 0 && row[colPostcode] ? row[colPostcode].trim() : '';
    const telephone = colTelephone >= 0 && row[colTelephone] ? row[colTelephone].trim() : '';
    const mobile = colMobile >= 0 && row[colMobile] ? row[colMobile].trim() : '';
    const email = colEmail >= 0 && row[colEmail] ? row[colEmail].trim() : '';
    const technicalSalesManager = colTsm >= 0 && row[colTsm] ? row[colTsm].trim() : '';
    const assignedPriceBookCode = colPriceBook >= 0 && row[colPriceBook] ? row[colPriceBook].trim() : undefined;

    // Must have at least company name or contact person
    if (!companyName && !contactPerson) continue;

    customers.push({
      id: `cust-${r}`,
      companyName: companyName || contactPerson,
      contactPerson: contactPerson || companyName,
      address,
      cityCounty,
      postcode,
      telephone,
      mobile,
      email,
      technicalSalesManager,
      assignedPriceBookCode,
    });
  }

  return customers;
}

/**
 * Silently syncs contractor directory from the Google Sheet "Contractors" tab
 */
export async function syncCustomersFromSheet(): Promise<{
  success: boolean;
  customers: CustomerRecord[];
  source: string;
}> {
  try {
    // 1. Try direct tab GID export (contains all 106 verified contractor records)
    let res = await fetch(CUSTOMERS_SHEET_CSV_URL);
    if (res.ok) {
      const csvText = await res.text();
      if (!csvText.includes('<!DOCTYPE html>') && !csvText.includes('<html')) {
        const parsed = parseCustomersCsv(csvText);
        if (parsed.length >= 10) {
          saveCachedCustomers(parsed);
          return { success: true, customers: parsed, source: 'Live Google Sheet (Contractors tab GID 250062093)' };
        }
      }
    }

    // 2. Secondary fallback to gviz sheet name query
    res = await fetch(CUSTOMERS_GVIZ_CSV_URL);
    if (res.ok) {
      const csvText = await res.text();
      if (!csvText.includes('<!DOCTYPE html>') && !csvText.includes('<html')) {
        const parsed = parseCustomersCsv(csvText);
        if (parsed.length > 0) {
          saveCachedCustomers(parsed);
          return { success: true, customers: parsed, source: 'Live Google Sheet (Contractors tab)' };
        }
      }
    }

    return { success: false, customers: getInitialCustomers(), source: 'Spreadsheet Fallback Directory' };
  } catch (e) {
    return { success: false, customers: getInitialCustomers(), source: 'Spreadsheet Fallback Directory' };
  }
}
