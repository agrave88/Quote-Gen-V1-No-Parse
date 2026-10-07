import { QuoteLineItem, QuoteMeta, RockwoolProduct, CommercialItemSnapshot, QuoteCommercialSnapshot, ProjectRecord } from '../types/quote';
import { PERMANENT_SHEET_ID } from '../utils/backgroundSheetSync';
import { 
  getProductApplicationStage, 
  isAncillaryItem, 
  separateSystemAndAncillaryItems 
} from '../utils/applicationOrder';
import { getDaysDifference, toDisplayDateFormat, toInputDateFormat } from '../utils/dateUtils';
import { clearAccessToken } from './firebaseAuth';
import { DEFAULT_STANDARD_TERMS } from '../constants/terms';
import { parseQuoteReference } from '../utils/quoteNumber';
import { 
  createCommercialItemSnapshot, 
  createQuoteCommercialSnapshot, 
  extractThicknessFromText 
} from '../utils/commercialSnapshot';

export const QUOTES_TAB_HEADERS = [
  'Quote Reference',
  'Date of Issue',
  'Expiry Date',
  'Validity (Days)',
  'Expected Start Date',
  '# of Phases',
  'Phase Duration (Months)',
  'Total Program (Months)',
  'Project Name',
  'Project Reference',
  'Site Location',
  'Contractor Company',
  'Contact Person',
  'Contact Email',
  'Contact Phone',
  'Contractor Address',
  'Contractor City',
  'Contractor Postcode',
  'Technical Sales Manager',
  'Façade Area (m²)',
  'Wastage Allowance (%)',
  'Gross Sizing Area (m²)',
  '# of Units',
  'Size of Units (m²)',
  'Overall Discount (%)',
  'Installation Included',
  'Installation Rate (£/m²)',
  'System Materials Net (£)',
  'Ancillaries Net (£)',
  'Installation Net (£)',
  'Total Net Investment (£)',
  'VAT Amount (20%) (£)',
  'Total Gross Investment (£)',
  'Materials Rate (£/m²)',
  'Overall Rate (£/m²)',
  'Total Line Items',
  'Product SKUs',
  'Timestamp Exported',
  'Base Quote Reference',
  'Revision Number',
  'Is Latest',
  'Quote Status',
  'Deal Outcome',
  'Win Likelihood (%)',
  'Commercial Snapshot (JSON)',
];

export const QUOTE_ITEMS_TAB_HEADERS = [
  'Quote Reference',
  'Date of Issue',
  'Project Name',
  'Contractor Company',
  'Line Item #',
  'Application Stage',
  'Is Ancillary',
  'SKU',
  'Product Description',
  'Category',
  'Unit',
  'Consumption Rate (per m²)',
  'Coverage Notes',
  'Calculated Quantity',
  'Final Quantity',
  'Unit List Price (£)',
  'Discount (%)',
  'Unit Sell Price (£)',
  'Total Sell (£)',
  '£/m² Rate',
  'Timestamp Exported',
  'Base Quote Reference',
  'Revision Number',
  'Is Latest',
  'Commercial Snapshot (JSON)',
];

export const PROJECTS_TAB_HEADERS = [
  'Project Reference',
  'Project Title',
  'Pipeline Stage',
  'Estimated Value (£)',
  'Area / Territory',
  'Full Site Address',
  'Postcode',
  'Architect',
  'Main Contractor',
  'Specialist Contractor 1',
  'Specialist Contractor 2',
  'Specialist Contractor 3',
  'Specialist Contractor 4',
  'Specialist Contractor 5',
  'Assigned Key Contacts',
  'Scope & Specification Focus',
  'Project Description',
  'Target Completion Date',
  'Created At',
  'Last Updated',
];

export interface SaveQuoteResult {
  success: boolean;
  message: string;
  sheetUrl: string;
  quotesAppended?: number;
  itemsAppended?: number;
  projectCreated?: boolean;
  error?: string;
}

/**
 * Checks if target tabs ('Quotes', 'Quote Items', and 'Projects') exist in the spreadsheet,
 * and creates them along with their initial column headers if missing.
 */
async function ensureSheetsAndHeadersExist(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  // 1. Fetch spreadsheet metadata to inspect existing sheet tabs
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    if (metaRes.status === 403 || metaRes.status === 401) {
      throw new Error(
        'Google Sheets permission required. Click "Save" again to open Google Sign-In, and ensure you check the box next to "See, edit, create, and delete all your Google Sheets spreadsheets".'
      );
    }
    throw new Error(`Failed to access spreadsheet metadata (HTTP ${metaRes.status}): ${errText}`);
  }

  const metaData = await metaRes.json();
  const existingSheetTitles: string[] = (metaData.sheets || []).map(
    (s: any) => s.properties?.title || ''
  );

  const requests: any[] = [];
  const needsQuotesTab = !existingSheetTitles.includes('Quotes');
  const needsQuoteItemsTab = !existingSheetTitles.includes('Quote Items');
  const needsProjectsTab = !existingSheetTitles.includes('Projects');

  if (needsQuotesTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Quotes',
        },
      },
    });
  }

  if (needsQuoteItemsTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Quote Items',
        },
      },
    });
  }

  if (needsProjectsTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Projects',
        },
      },
    });
  }

  // If any sheet tabs need creation, execute batchUpdate
  if (requests.length > 0) {
    const addRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!addRes.ok) {
      const errText = await addRes.text();
      console.warn('Could not add sheet tabs via batchUpdate:', errText);
    }
  }

  // 2. Ensure all headers exist on 'Quotes' from A1 through AS1 (including columns AM-AS)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A1:AS1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [QUOTES_TAB_HEADERS],
      }),
    }
  );

  // Specifically write AM1:AS1 to guarantee revision, status, deal outcome, win likelihood, and commercial snapshot are labeled
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!AM1:AS1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[
          'Base Quote Reference', 
          'Revision Number', 
          'Is Latest', 
          'Quote Status', 
          'Deal Outcome', 
          'Win Likelihood (%)',
          'Commercial Snapshot (JSON)'
        ]],
      }),
    }
  );

  // 3. Ensure all headers exist on 'Quote Items' from A1 through AY1
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      'Quote Items!A1:AY1'
    )}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [QUOTE_ITEMS_TAB_HEADERS],
      }),
    }
  );

  // 4. Ensure headers exist on 'Projects' from A1 through T1
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Projects!A1:T1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [PROJECTS_TAB_HEADERS],
      }),
    }
  );
}

/**
 * Updates only the commercial deal outcome and win likelihood for the specified quote
 * in the spreadsheet in-place without adding a new row or incrementing the revision.
 */
export async function updateQuoteDealStatusInGoogleSheet(
  accessToken: string,
  quoteNumber: string,
  dealStatus: 'Won' | 'Lost' | 'Pending',
  winLikelihood: number,
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<{ success: boolean; message: string; updatedRowIndex?: number }> {
  try {
    const parsedTarget = parseQuoteReference(quoteNumber);
    const targetBase = parsedTarget.baseReference.toUpperCase();

    // 1. Fetch quote rows from Quotes tab
    const quotesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A2:AR5000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!quotesRes.ok) {
      return { success: false, message: `Could not fetch Quotes tab (HTTP ${quotesRes.status})` };
    }

    const data = await quotesRes.json();
    const rows: any[][] = data.values || [];

    // Find the latest matching row for this quote
    let targetRowIndex = -1; // 1-indexed sheet row number
    let maxRevision = -1;

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const fullRef = String(row[0] || '').trim();
      if (!fullRef) continue;

      const p = parseQuoteReference(fullRef);
      const rowBase = (String(row[38] || '').trim() || p.baseReference).toUpperCase();

      if (rowBase === targetBase) {
        const rev = row[39] !== undefined && row[39] !== ''
          ? parseInt(String(row[39]), 10)
          : p.revision;
        const isLatest = String(row[40] || '').trim().toUpperCase() === 'TRUE';

        // Prioritize isLatest or highest revision
        if (isLatest || rev >= maxRevision || targetRowIndex === -1) {
          maxRevision = isNaN(rev) ? 0 : rev;
          targetRowIndex = idx + 2; // Rows are 1-indexed and data starts at row 2
        }
      }
    }

    if (targetRowIndex === -1) {
      return { success: false, message: `Quote "${quoteNumber}" not found in spreadsheet.` };
    }

    // 2. In-place update columns AQ & AR on that exact row
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!AQ${targetRowIndex}:AR${targetRowIndex}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[dealStatus, `${winLikelihood}%`]],
        }),
      }
    );

    if (!updateRes.ok) {
      const err = await updateRes.text();
      return { success: false, message: `Failed to update deal status: ${err}` };
    }

    return {
      success: true,
      message: `Quote ${quoteNumber} updated to ${dealStatus} (${winLikelihood}%) in row ${targetRowIndex}.`,
      updatedRowIndex: targetRowIndex,
    };
  } catch (err: any) {
    console.error('Error updating deal status in Google Sheets:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Saves both the Quote Summary and all itemized Quote Items back to the Google Spreadsheet.
 */
export async function saveQuoteToGoogleSheet(
  accessToken: string,
  meta: QuoteMeta,
  items: QuoteLineItem[],
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<SaveQuoteResult> {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  try {
    // Step 1: Ensure tabs and headers exist
    await ensureSheetsAndHeadersExist(accessToken, spreadsheetId);

    const now = new Date();
    const timestampStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;

    // Step 2: Calculate financial aggregates
    const { systemItems, ancillaryItems } = separateSystemAndAncillaryItems(items);
    const area = meta.areaM2 <= 1 ? 1 : meta.areaM2;
    const grossArea = area * (1 + meta.wasteagePercent / 100);

    const systemItemsTotalNet = systemItems.reduce(
      (sum, i) => sum + i.finalQuantity * i.unitSellPrice,
      0
    );
    const ancillariesTotalNet = ancillaryItems.reduce(
      (sum, i) => sum + i.finalQuantity * i.unitSellPrice,
      0
    );
    const installationTotalNet = meta.includeInstallationEstimate
      ? meta.installationRatePerM2 * area
      : 0;
    const totalProjectNet = systemItemsTotalNet + ancillariesTotalNet + installationTotalNet;
    const vatAmount = totalProjectNet * 0.2;
    const totalGross = totalProjectNet + vatAmount;

    const materialsRatePerM2 = area > 0 ? systemItemsTotalNet / area : 0;
    const overallRatePerM2 = area > 0 ? totalProjectNet / area : 0;

    const validityDays = getDaysDifference(meta.date, meta.validUntil) || 30;
    const totalProgramMonths = (meta.numberOfPhases || 1) * (meta.phaseDurationMonths || 1);
    const allSkus = items.map((i) => i.sku).join(', ');

    // Ensure Quote Reference has canonical revision formatting
    const parsedRef = parseQuoteReference(meta.quoteNumber);
    const fullQuoteRef = parsedRef.fullReference;
    const baseQuoteRef = parsedRef.baseReference;
    const revisionNum = parsedRef.revision;

    // Step 2b: Mark any previous revisions of this base quote as Superseded (isLatest: FALSE) in Quotes tab
    try {
      const existingQuotesRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A2:AP5000`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (existingQuotesRes.ok) {
        const existingData = await existingQuotesRes.json();
        const existingRows: any[][] = existingData.values || [];

        const updates: any[] = [];
        existingRows.forEach((row, idx) => {
          const rowRef = String(row[0] || '').trim().toUpperCase();
          const rowBaseRef = String(row[38] || parseQuoteReference(rowRef).baseReference).trim().toUpperCase();
          if (rowBaseRef === baseQuoteRef.toUpperCase()) {
            const sheetRowNumber = idx + 2; // 1-indexed, skipping header
            // Column 40 is AO (Is Latest), Column 41 is AP (Quote Status)
            updates.push({
              range: `Quotes!AO${sheetRowNumber}:AP${sheetRowNumber}`,
              values: [['FALSE', 'Superseded']],
            });
          }
        });

        if (updates.length > 0) {
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                valueInputOption: 'USER_ENTERED',
                data: updates,
              }),
            }
          );
        }
      }
    } catch (supersedeErr) {
      console.warn('Could not mark previous revisions as superseded in Quotes tab:', supersedeErr);
    }

    // Step 3: Construct Quote Summary Row (Quotes Tab)
    const quoteSummaryRow: (string | number | boolean)[] = [
      fullQuoteRef,
      toDisplayDateFormat(meta.date) || meta.date,
      toDisplayDateFormat(meta.validUntil) || meta.validUntil,
      validityDays,
      meta.expectedStartDate ? toDisplayDateFormat(meta.expectedStartDate) : '',
      meta.numberOfPhases || 1,
      meta.phaseDurationMonths || 1,
      totalProgramMonths,
      meta.projectName || 'External Façade Specification',
      meta.projectReference || '',
      meta.projectLocation || '',
      meta.clientCompany || 'Estimating / Commercial Team',
      meta.contactPerson || meta.clientName || '',
      meta.clientEmail || '',
      meta.clientPhone || '',
      meta.clientAddress || '',
      meta.clientCity || '',
      meta.clientPostcode || '',
      meta.technicalSalesManager || '',
      meta.areaM2,
      `${meta.wasteagePercent}%`,
      Math.round(grossArea * 100) / 100,
      meta.numberOfUnits !== undefined && meta.numberOfUnits !== null ? meta.numberOfUnits : '',
      meta.unitSizeM2 !== undefined && meta.unitSizeM2 !== null ? meta.unitSizeM2 : '',
      `${meta.overallDiscountPercent}%`,
      meta.includeInstallationEstimate ? 'TRUE' : 'FALSE',
      meta.installationRatePerM2,
      Math.round(systemItemsTotalNet * 100) / 100,
      Math.round(ancillariesTotalNet * 100) / 100,
      Math.round(installationTotalNet * 100) / 100,
      Math.round(totalProjectNet * 100) / 100,
      Math.round(vatAmount * 100) / 100,
      Math.round(totalGross * 100) / 100,
      Math.round(materialsRatePerM2 * 100) / 100,
      Math.round(overallRatePerM2 * 100) / 100,
      items.length,
      allSkus,
      timestampStr,   // 37: AL: Timestamp Exported
      baseQuoteRef,   // 38: AM: Base Quote Reference
      revisionNum,    // 39: AN: Revision Number
      'TRUE',         // 40: AO: Is Latest
      'Active',       // 41: AP: Quote Status
      meta.dealStatus || 'Pending', // 42: AQ: Deal Outcome (Won, Lost, Pending)
      `${meta.winLikelihood !== undefined && meta.winLikelihood !== null ? meta.winLikelihood : (meta.dealStatus === 'Won' ? 100 : meta.dealStatus === 'Lost' ? 0 : 50)}%`, // 43: AR: Win Likelihood (%)
      JSON.stringify(createQuoteCommercialSnapshot(meta, items)), // 44: AS: Commercial Snapshot (JSON)
    ];

    // Append to 'Quotes'
    const appendQuoteRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [quoteSummaryRow],
        }),
      }
    );

    if (!appendQuoteRes.ok) {
      const err = await appendQuoteRes.text();
      throw new Error(`Failed to append quote to Quotes tab: ${err}`);
    }

    // Step 4: Mark previous items for this base quote as isLatest: FALSE in Quote Items tab
    try {
      const existingItemsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          'Quote Items!A2:Y10000'
        )}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (existingItemsRes.ok) {
        const itemsData = await existingItemsRes.json();
        const existingItemsRows: any[][] = itemsData.values || [];
        const itemUpdates: any[] = [];
        existingItemsRows.forEach((row, idx) => {
          const rowRef = String(row[0] || '').trim().toUpperCase();
          const rowBaseRef = String(row[21] || parseQuoteReference(rowRef).baseReference).trim().toUpperCase();
          if (rowBaseRef === baseQuoteRef.toUpperCase()) {
            const sheetRowNumber = idx + 2;
            itemUpdates.push({
              range: `'Quote Items'!X${sheetRowNumber}`,
              values: [['FALSE']],
            });
          }
        });
        if (itemUpdates.length > 0) {
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: itemUpdates }),
            }
          );
        }
      }
    } catch (itemSupErr) {
      console.warn('Could not update previous items to isLatest=FALSE:', itemSupErr);
    }

    // Step 5: Construct Itemized Rows (Quote Items Tab) with Commercial Snapshot
    if (items.length > 0) {
      const itemRows: (string | number | boolean)[][] = items.map((item, index) => {
        const stage = getProductApplicationStage(item);
        const stageDisplay = stage.stageOrder === 7 ? 'Ancillaries' : stage.categoryDisplay;
        const isAnc = isAncillaryItem(item);
        const itemSnapshot = createCommercialItemSnapshot(item);
        const itemSnapshotJson = JSON.stringify(itemSnapshot);

        return [
          fullQuoteRef,
          toDisplayDateFormat(meta.date) || meta.date,
          meta.projectName || 'External Façade Specification',
          meta.clientCompany || '',
          index + 1,
          stageDisplay,
          isAnc ? 'TRUE' : 'FALSE',
          item.sku,
          item.description,
          item.category,
          item.unit,
          isAnc ? '-' : item.consumptionRatePerM2,
          item.coverageNotes || '',
          item.calculatedQuantity,
          item.finalQuantity,
          item.listPrice ?? item.unitCost ?? 0,
          `${item.discountPercent}%`,
          item.unitSellPrice,
          Math.round(item.finalQuantity * item.unitSellPrice * 100) / 100,
          isAnc || item.excludeFromM2Rate ? '-' : item.pricePerM2,
          timestampStr,  // 20: Timestamp Exported
          baseQuoteRef,  // 21: Base Quote Reference
          revisionNum,   // 22: Revision Number
          'TRUE',        // 23: Is Latest
          itemSnapshotJson, // 24: Commercial Snapshot (JSON)
        ];
      });

      const appendItemsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          'Quote Items'
        )}!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: itemRows,
          }),
        }
      );

      if (!appendItemsRes.ok) {
        const err = await appendItemsRes.text();
        console.warn(`Could not append quote items to Quote Items tab: ${err}`);
      }
    }

    // Step 6: Automatically check if project exists in "Projects" tab; if not, create new project row
    let projectCreated = false;
    let createdProjectNotice = '';
    try {
      const projResult = await ensureProjectExistsInGoogleSheet(accessToken, meta, totalProjectNet, spreadsheetId);
      if (projResult.created) {
        projectCreated = true;
        createdProjectNotice = ` New project "${projResult.projectTitle}" created in 'Projects' tab directory.`;
      }
    } catch (projErr) {
      console.warn('Could not check or create project in Projects tab:', projErr);
    }

    return {
      success: true,
      message: `Quote ${fullQuoteRef} (Revision ${revisionNum}) successfully saved to Google Sheets ('Quotes'${projectCreated ? ', \'Projects\'' : ''} and 'Quote Items' tabs).${createdProjectNotice}`,
      sheetUrl,
      quotesAppended: 1,
      itemsAppended: items.length,
      projectCreated,
    };
  } catch (err: any) {
    console.error('Error saving quote to Google Sheets:', err);
    return {
      success: false,
      message: err.message || 'An error occurred while saving quote to Google Sheets.',
      sheetUrl,
      error: err.message,
    };
  }
}

/**
 * Extracts a UK postcode from a site address string if not provided explicitly.
 */
function extractPostcodeFromAddress(addr?: string): string {
  if (!addr) return '';
  const match = addr.match(/\b([A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2})\b/i);
  return match ? match[1].toUpperCase() : '';
}

/**
 * Extracts territory or city from a site address string if not provided explicitly.
 */
function extractTerritoryFromAddress(addr?: string): string {
  if (!addr) return '';
  const parts = addr.split(',').map((p) => p.trim());
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    const withoutPostcode = lastPart.replace(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/gi, '').trim();
    if (withoutPostcode && withoutPostcode.length > 1) return withoutPostcode;
    return parts[parts.length - 2] || '';
  }
  return '';
}

/**
 * Ensures the 'Projects' tab exists with row 1 headers in the spreadsheet.
 */
export async function ensureProjectsTabExists(
  accessToken: string,
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<void> {
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const existingTitles: string[] = (metaData.sheets || []).map((s: any) => s.properties?.title || '');
      if (!existingTitles.includes('Projects')) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ addSheet: { properties: { title: 'Projects' } } }],
          }),
        });
      }
    }
    // Write or ensure headers on row 1
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Projects!A1:T1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [PROJECTS_TAB_HEADERS] }),
      }
    );
  } catch (err) {
    console.warn('Could not ensure Projects tab and headers exist:', err);
  }
}

/**
 * Checks if a project already exists in the "Projects" sheet tab (by title).
 * If not found, automatically creates and appends a new project record row to the "Projects" tab
 * with all 20 specified fields.
 */
export async function ensureProjectExistsInGoogleSheet(
  accessToken: string,
  meta: QuoteMeta,
  totalProjectNet: number,
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<{ created: boolean; projectTitle: string; error?: string }> {
  const projName = (meta.projectName || '').trim();
  if (!projName) {
    return { created: false, projectTitle: '' };
  }

  try {
    // 1. Fetch existing project rows from Projects tab
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Projects!A1:T5000`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    let existingRows: any[][] = [];
    if (res.ok) {
      const data = await res.json();
      existingRows = data.values || [];
    } else if (res.status === 400 || res.status === 404) {
      // Sheet tab 'Projects' may not exist yet; create it
      await ensureProjectsTabExists(accessToken, spreadsheetId);
    }

    // 2. Check if project already exists in Projects tab
    // We strictly match by Project Title (case-insensitive & alphanumeric normalized)
    // Note: We do NOT match against Project Reference alone because lead references
    // (e.g. ADS_26-02454LR) are shared across multiple project schemes in the sheet.
    const cleanTargetTitle = projName.toUpperCase().replace(/[^A-Z0-9]/g, '');

    let exists = false;
    if (existingRows.length > 0) {
      const header = existingRows[0].map((h: any) => String(h || '').toLowerCase().trim());
      let colTitle = header.findIndex(
        (h: string) => h === 'project title' || h === 'project' || h === 'scheme' || h.includes('title')
      );
      if (colTitle < 0) colTitle = 1; // Default to Column B

      for (let r = 1; r < existingRows.length; r++) {
        const row = existingRows[r];
        if (!row || row.length === 0) continue;
        const rowTitle = String(row[colTitle] || '').trim();
        const cleanRowTitle = rowTitle.toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (cleanRowTitle && cleanRowTitle === cleanTargetTitle) {
          exists = true;
          break;
        }
        if (rowTitle.toUpperCase() === projName.toUpperCase()) {
          exists = true;
          break;
        }
      }
    }

    if (exists) {
      console.log(`[Google Sheets] Project "${projName}" already exists in Projects tab.`);
      return { created: false, projectTitle: projName };
    }

    // 3. Project does not exist -> Create new row for Projects tab with all 20 fields
    const nowIso = new Date().toISOString().split('T')[0];
    const todayFormatted = toDisplayDateFormat(nowIso) || nowIso;
    const projRef = (meta.projectReference || '').trim() || `PRJ-${Date.now().toString().slice(-4)}`;
    const pipelineStage =
      meta.dealStatus === 'Won' ? 'Contracted' :
      meta.dealStatus === 'Lost' ? 'Closed/Lost' :
      'Specified';
    const estimatedValue = Math.round(totalProjectNet);
    const siteAddress = (meta.projectLocation || '').trim();
    const postcode = (meta.clientPostcode || '').trim() || extractPostcodeFromAddress(siteAddress);
    const territory = (meta.clientCity || '').trim() || extractTerritoryFromAddress(siteAddress) || '';
    const clientArchitect = (meta.clientName || '').trim();
    const mainContractor = (meta.clientCompany || '').trim();
    const specialistContractor1 = meta.contactPerson ? `${mainContractor ? mainContractor + ' ' : ''}(${meta.contactPerson})`.trim() : mainContractor;
    const keyContacts = [meta.contactPerson, meta.clientEmail, meta.clientPhone, meta.technicalSalesManager].filter(Boolean).join(', ');
    const scopeFocus = `${meta.areaM2 || 100} m² External Façade Specification`;
    const description = `Quotation ${meta.quoteNumber} specification${meta.notesAndTerms ? ' - ' + meta.notesAndTerms.slice(0, 80) : ''}`;
    const targetDate = meta.expectedStartDate ? toDisplayDateFormat(meta.expectedStartDate) : (meta.validUntil ? toDisplayDateFormat(meta.validUntil) : '');

    const newProjectRow: (string | number)[] = [
      projRef,                // Col 1: Project Reference
      projName,               // Col 2: Project Title
      pipelineStage,          // Col 3: Pipeline Stage
      estimatedValue,         // Col 4: Estimated Value (£)
      territory,              // Col 5: Area / Territory
      siteAddress,            // Col 6: Full Site Address
      postcode,               // Col 7: Postcode
      clientArchitect,        // Col 8: Architect
      mainContractor,         // Col 9: Main Contractor
      specialistContractor1,  // Col 10: Specialist Contractor 1
      '',                     // Col 11: Specialist Contractor 2
      '',                     // Col 12: Specialist Contractor 3
      '',                     // Col 13: Specialist Contractor 4
      '',                     // Col 14: Specialist Contractor 5
      keyContacts,            // Col 15: Assigned Key Contacts
      scopeFocus,             // Col 16: Scope & Specification Focus
      description,            // Col 17: Project Description
      targetDate,             // Col 18: Target Completion Date
      todayFormatted,         // Col 19: Created At
      todayFormatted,         // Col 20: Last Updated
    ];

    // If existingRows was empty, ensure headers are written to row 1 first
    if (existingRows.length === 0) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Projects!A1:T1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [PROJECTS_TAB_HEADERS],
          }),
        }
      );
    }

    // 4. Append row to Projects tab in Google Sheets
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Projects!A:T:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [newProjectRow],
        }),
      }
    );

    if (appendRes.ok) {
      console.log(`[Google Sheets] Successfully created project "${projName}" in Projects tab.`);
      // Update local projects directory cache
      try {
        const cached = localStorage.getItem('rockwool_sheet_projects_directory_v1');
        const parsedList = cached ? JSON.parse(cached) : [];
        const newProjRecord: ProjectRecord = {
          id: `proj-${Date.now()}`,
          projectName: projName,
          projectReference: projRef,
          projectLocation: siteAddress,
          clientName: clientArchitect,
          clientCompany: mainContractor,
          contactPerson: meta.contactPerson,
          areaM2: meta.areaM2,
          assignedPriceBookCode: meta.priceBookCode,
        };
        const existsLocally = parsedList.some(
          (p: any) => (p.projectName || '').trim().toLowerCase() === projName.toLowerCase()
        );
        if (!existsLocally) {
          parsedList.unshift(newProjRecord);
          localStorage.setItem('rockwool_sheet_projects_directory_v1', JSON.stringify(parsedList));
        }
      } catch (e) {
        console.warn('Could not update local projects cache:', e);
      }
      return { created: true, projectTitle: projName };
    } else {
      const errText = await appendRes.text();
      console.error(`[Google Sheets] Failed to append project to Projects tab: ${errText}`);
      return { created: false, projectTitle: projName, error: errText };
    }
  } catch (err: any) {
    console.error('Error checking/creating project entry in Projects tab:', err);
    return { created: false, projectTitle: projName, error: err.message };
  }
}

export interface LoadQuoteResult {
  success: boolean;
  message?: string;
  meta?: QuoteMeta;
  items?: QuoteLineItem[];
  savedAt?: string;
  duplicateCount?: number;
  revision?: number;
  baseReference?: string;
  isLatest?: boolean;
  error?: string;
}

/**
 * Parses timestamps in various formats (ISO, YYYY-MM-DD HH:mm:ss, DD/MM/YYYY) to millisecond epoch
 */
function parseTimestampToMs(val: any): number {
  if (!val) return 0;
  const str = String(val).trim();
  if (!str) return 0;

  // Format 1: "YYYY-MM-DD HH:mm:ss" or ISO "YYYY-MM-DDTHH:mm:ss"
  const isoCandidate = str.replace(' ', 'T');
  const d1 = new Date(isoCandidate);
  if (!isNaN(d1.getTime())) return d1.getTime();

  // Format 2: "DD/MM/YYYY HH:mm:ss" or "DD/MM/YYYY"
  const ukMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ukMatch) {
    const day = parseInt(ukMatch[1], 10);
    const month = parseInt(ukMatch[2], 10) - 1;
    const year = parseInt(ukMatch[3], 10);
    const hour = ukMatch[4] ? parseInt(ukMatch[4], 10) : 0;
    const min = ukMatch[5] ? parseInt(ukMatch[5], 10) : 0;
    const sec = ukMatch[6] ? parseInt(ukMatch[6], 10) : 0;
    const d2 = new Date(year, month, day, hour, min, sec);
    if (!isNaN(d2.getTime())) return d2.getTime();
  }

  // Format 3: Direct parse
  const d3 = new Date(str);
  if (!isNaN(d3.getTime())) return d3.getTime();

  return 0;
}

/**
 * Loads a quotation and its BoQ line items from the Google Spreadsheet
 * using the provided quote reference number.
 * When multiple records exist for the same quote reference, loads the one
 * that was last saved / exported (most recent timestamp or lowest row).
 */
export async function loadQuoteFromGoogleSheet(
  accessToken: string,
  quoteNumberToLoad: string,
  catalogProducts: RockwoolProduct[] = [],
  currentMeta?: QuoteMeta,
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<LoadQuoteResult> {
  const parsedTarget = parseQuoteReference(quoteNumberToLoad);
  const targetRaw = quoteNumberToLoad.trim().toUpperCase();
  if (!targetRaw) {
    return { success: false, message: 'Please enter a valid Quote Reference to load.' };
  }

  const hasExplicitRevision = /-R\d+$/i.test(targetRaw);

  try {
    // 1. Fetch Quotes tab data
    const quotesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A2:AS5000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!quotesRes.ok) {
      const err = await quotesRes.text();
      if (quotesRes.status === 401 || quotesRes.status === 403) {
        clearAccessToken();
        throw new Error('Google authentication expired or lacks Sheets permission. Please sign in again.');
      }
      throw new Error(`Failed to read Quotes tab (HTTP ${quotesRes.status}): ${err}`);
    }

    const quotesData = await quotesRes.json();
    const quoteRows: any[][] = quotesData.values || [];

    // Collect ALL matching rows in Quotes tab
    const matchingQuotes = quoteRows
      .map((row, originalIndex) => {
        const rowRef = String(row[0] || '').trim();
        const rowParsed = parseQuoteReference(rowRef);
        const rowBase = String(row[38] || rowParsed.baseReference).trim();
        const rowRev =
          row[39] !== undefined && row[39] !== ''
            ? parseInt(String(row[39]), 10)
            : rowParsed.revision;
        const isLatest = String(row[40] || '').trim().toUpperCase() === 'TRUE';
        return {
          row,
          originalIndex,
          fullRef: rowRef,
          baseRef: rowBase,
          revision: isNaN(rowRev) ? rowParsed.revision : rowRev,
          isLatest,
        };
      })
      .filter((item) => {
        if (hasExplicitRevision) {
          // If user specifically entered -R0, -R1 etc., match exact revision
          return item.fullRef.toUpperCase() === parsedTarget.fullReference.toUpperCase();
        }
        // If user entered base reference, match any revision of this base
        return (
          item.baseRef.toUpperCase() === parsedTarget.baseReference.toUpperCase() ||
          item.fullRef.toUpperCase() === parsedTarget.baseReference.toUpperCase()
        );
      });

    if (matchingQuotes.length === 0) {
      return {
        success: false,
        message: `Quote "${quoteNumberToLoad}" was not found in the spreadsheet Quotes tab.`,
      };
    }

    // Sort matching quotes to find the active / most recent revision:
    // 1. Items with isLatest: TRUE come first (unless explicit revision requested)
    // 2. Highest revision number
    // 3. Highest parsed export timestamp
    // 4. Furthest down the sheet (lowest row)
    matchingQuotes.sort((a, b) => {
      if (!hasExplicitRevision) {
        if (a.isLatest && !b.isLatest) return -1;
        if (!a.isLatest && b.isLatest) return 1;
      }
      if (a.revision !== b.revision) {
        return b.revision - a.revision;
      }
      const tsA = parseTimestampToMs(a.row[37]) || parseTimestampToMs(a.row[1]);
      const tsB = parseTimestampToMs(b.row[37]) || parseTimestampToMs(b.row[1]);
      if (tsA !== tsB && tsA > 0 && tsB > 0) {
        return tsB - tsA;
      }
      return b.originalIndex - a.originalIndex;
    });

    const mostRecentQuote = matchingQuotes[0];
    const foundQuoteRow = mostRecentQuote.row;
    const loadedFullRef = mostRecentQuote.fullRef;
    const loadedBaseRef = mostRecentQuote.baseRef;
    const loadedRevision = mostRecentQuote.revision;
    const latestQuoteTimestamp = String(foundQuoteRow[37] || '').trim();

    // 2. Fetch Quote Items tab data
    let matchingItemRows: any[][] = [];
    try {
      const itemsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          'Quote Items!A2:Y10000'
        )}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        const allItemRows: any[][] = itemsData.values || [];

        // All item rows for this specific revision or base quote reference
        const allMatchingItems = allItemRows
          .map((row, idx) => ({ row, idx }))
          .filter((item) => {
            const itemRef = String(item.row[0] || '').trim();
            const itemBase = String(item.row[21] || parseQuoteReference(itemRef).baseReference).trim();
            const itemRev =
              item.row[22] !== undefined && item.row[22] !== ''
                ? parseInt(String(item.row[22]), 10)
                : parseQuoteReference(itemRef).revision;

            return (
              itemRef.toUpperCase() === loadedFullRef.toUpperCase() ||
              (itemBase.toUpperCase() === loadedBaseRef.toUpperCase() && itemRev === loadedRevision)
            );
          });

        if (allMatchingItems.length > 0) {
          // Method 1: Match by exact timestamp string with the quote header (row[20] === latestQuoteTimestamp)
          if (latestQuoteTimestamp) {
            const exactTimestampMatches = allMatchingItems.filter(
              (item) => String(item.row[20] || '').trim() === latestQuoteTimestamp
            );
            if (exactTimestampMatches.length > 0) {
              matchingItemRows = exactTimestampMatches.map((it) => it.row);
            }
          }

          // Method 2: If no exact string match, find the latest timestamp present among matching items
          if (matchingItemRows.length === 0) {
            let maxTime = 0;
            let latestItemTs = '';
            for (const item of allMatchingItems) {
              const ts = String(item.row[20] || '').trim();
              const parsed = parseTimestampToMs(ts);
              if (parsed > maxTime) {
                maxTime = parsed;
                latestItemTs = ts;
              }
            }

            if (latestItemTs && maxTime > 0) {
              const latestMatches = allMatchingItems.filter(
                (item) => String(item.row[20] || '').trim() === latestItemTs
              );
              if (latestMatches.length > 0) {
                matchingItemRows = latestMatches.map((it) => it.row);
              }
            }
          }

          // Method 3: Fallback for older saves without timestamps:
          // Isolate the last contiguous block of items ending at the bottom of allMatchingItems
          if (matchingItemRows.length === 0) {
            const lastBatch: any[][] = [];
            for (let i = allMatchingItems.length - 1; i >= 0; i--) {
              const currItem = allMatchingItems[i];
              lastBatch.unshift(currItem.row);

              const lineNum = parseInt(String(currItem.row[4] || '0'), 10);
              // Line 1 marks the start of the batch
              if (lineNum === 1) {
                break;
              }

              // Stop if there is a large row index gap
              if (i > 0 && Math.abs(currItem.idx - allMatchingItems[i - 1].idx) > 10) {
                break;
              }
            }
            matchingItemRows = lastBatch;
          }
        }
      }
    } catch (itemsErr) {
      console.warn('Could not retrieve items from Quote Items tab:', itemsErr);
    }

    // 3. Parse QuoteMeta from foundQuoteRow
    const areaM2 = parseFloat(String(foundQuoteRow[19] || '').replace(/[^\d.-]/g, '')) || 100;
    const wastagePercent = parseFloat(String(foundQuoteRow[20] || '').replace(/[^\d.-]/g, '')) || 10;
    const overallDiscount = parseFloat(String(foundQuoteRow[24] || '').replace(/[^\d.-]/g, '')) || 0;
    const incInstallation = String(foundQuoteRow[25] || '').trim().toLowerCase() === 'true' ||
                            String(foundQuoteRow[25] || '').trim().toLowerCase() === 'yes';
    const installRate = parseFloat(String(foundQuoteRow[26] || '').replace(/[^\d.-]/g, '')) || 35;

    // Parse commercial deal status and win likelihood from columns 42 (AQ) and 43 (AR)
    const rawDealStatus = String(foundQuoteRow[42] || '').trim();
    const dealStatus: 'Won' | 'Lost' | 'Pending' =
      rawDealStatus.toLowerCase() === 'won'
        ? 'Won'
        : rawDealStatus.toLowerCase() === 'lost'
        ? 'Lost'
        : 'Pending';
    const rawWinLikelihood = foundQuoteRow[43];
    const parsedLikelihood = rawWinLikelihood !== undefined && rawWinLikelihood !== ''
      ? parseFloat(String(rawWinLikelihood).replace(/[^\d.-]/g, ''))
      : NaN;
    const winLikelihood = !isNaN(parsedLikelihood)
      ? Math.max(0, Math.min(100, parsedLikelihood))
      : (dealStatus === 'Won' ? 100 : dealStatus === 'Lost' ? 0 : 50);

    const loadedMeta: QuoteMeta = {
      ...(currentMeta || ({} as any)),
      quoteNumber: loadedFullRef,
      date: toInputDateFormat(foundQuoteRow[1]),
      validUntil: toInputDateFormat(foundQuoteRow[2]),
      expectedStartDate: foundQuoteRow[4] ? toInputDateFormat(foundQuoteRow[4]) : undefined,
      numberOfPhases: parseInt(String(foundQuoteRow[5] || '1'), 10) || 1,
      phaseDurationMonths: parseInt(String(foundQuoteRow[6] || '1'), 10) || 1,
      projectName: String(foundQuoteRow[8] || '').trim(),
      projectReference: String(foundQuoteRow[9] || '').trim(),
      projectLocation: String(foundQuoteRow[10] || '').trim(),
      clientCompany: String(foundQuoteRow[11] || '').trim(),
      contactPerson: String(foundQuoteRow[12] || '').trim(),
      clientName: String(foundQuoteRow[12] || currentMeta?.clientName || '').trim(),
      clientEmail: String(foundQuoteRow[13] || '').trim(),
      clientPhone: String(foundQuoteRow[14] || '').trim(),
      clientAddress: String(foundQuoteRow[15] || '').trim(),
      clientCity: String(foundQuoteRow[16] || '').trim(),
      clientPostcode: String(foundQuoteRow[17] || '').trim(),
      technicalSalesManager: String(foundQuoteRow[18] || '').trim(),
      areaM2: areaM2,
      wasteagePercent: wastagePercent,
      numberOfUnits: foundQuoteRow[22] ? parseInt(String(foundQuoteRow[22]), 10) : undefined,
      unitSizeM2: foundQuoteRow[23] ? parseFloat(String(foundQuoteRow[23])) : undefined,
      overallDiscountPercent: overallDiscount,
      includeInstallationEstimate: incInstallation,
      installationRatePerM2: installRate,
      notesAndTerms: currentMeta?.notesAndTerms || DEFAULT_STANDARD_TERMS,
      dealStatus,
      winLikelihood,
    };

    // 4. Parse QuoteLineItem[] from matchingItemRows using frozen commercial snapshots
    const loadedItems: QuoteLineItem[] = [];

    matchingItemRows.forEach((row, idx) => {
      // Row columns:
      // 0: Quote Ref, 1: Date, 2: Project, 3: Client, 4: Line #, 5: Stage, 6: Is Ancillary,
      // 7: SKU, 8: Description, 9: Category, 10: Unit, 11: Rate/m2, 12: Coverage Notes,
      // 13: Calc Qty, 14: Final Qty, 15: List Price, 16: Discount %, 17: Sell Price, 18: Total, 19: Price/m2
      // 20: Timestamp, 21: Base Ref, 22: Revision, 23: Is Latest, 24: Commercial Snapshot (JSON)

      let itemSnapshot: CommercialItemSnapshot | null = null;
      if (row[24]) {
        try {
          const parsed = JSON.parse(String(row[24]));
          if (parsed && typeof parsed === 'object' && parsed.sku) {
            itemSnapshot = parsed;
          }
        } catch {
          // silent fallback
        }
      }

      const sku = String(itemSnapshot?.sku || row[7] || '').trim();
      const desc = String(itemSnapshot?.description || row[8] || '').trim();
      const category = String(row[9] || 'System Products').trim();
      const unit = String(itemSnapshot?.unit || row[10] || 'm²').trim();
      const ratePerM2 = parseFloat(String(row[11] || '0').replace(/[^\d.-]/g, '')) || 0;
      const coverageNotes = String(row[12] || '').trim();
      const calculatedQty = parseFloat(String(row[13] || '0').replace(/[^\d.-]/g, '')) || 0;

      const finalQty = typeof itemSnapshot?.quantity === 'number'
        ? itemSnapshot.quantity
        : (parseFloat(String(row[14] || '0').replace(/[^\d.-]/g, '')) || calculatedQty || 1);

      // COMMERCIAL RECORD: Unit Sell Price and List Price are frozen from the snapshot, NEVER from today's catalog!
      const unitSellPrice = typeof itemSnapshot?.unitPrice === 'number'
        ? itemSnapshot.unitPrice
        : (parseFloat(String(row[17] || '0').replace(/[^\d.-]/g, '')) || 0);

      const listPrice = typeof itemSnapshot?.listPrice === 'number'
        ? itemSnapshot.listPrice
        : (parseFloat(String(row[15] || '0').replace(/[^\d.-]/g, '')) || unitSellPrice);

      const discountPercent = typeof itemSnapshot?.discount === 'number'
        ? itemSnapshot.discount
        : (parseFloat(String(row[16] || '0').replace(/[^\d.-]/g, '')) || 0);

      const lineTotal = typeof itemSnapshot?.lineTotal === 'number'
        ? itemSnapshot.lineTotal
        : (parseFloat(String(row[18] || '0').replace(/[^\d.-]/g, '')) || Math.round(finalQty * unitSellPrice * 100) / 100);

      const rawSavedM2Rate = row[19] !== undefined && row[19] !== null && String(row[19]).trim() !== '-'
        ? parseFloat(String(row[19]).replace(/[^\d.-]/g, ''))
        : NaN;

      const isAnc = String(row[6] || '').trim().toUpperCase() === 'TRUE';

      const pricePerM2 = typeof itemSnapshot?.pricePerM2 === 'number'
        ? itemSnapshot.pricePerM2
        : (!isNaN(rawSavedM2Rate) ? rawSavedM2Rate : (!isAnc && areaM2 > 0 ? Math.round((finalQty * unitSellPrice / areaM2) * 100) / 100 : 0));

      const catalogMatch = catalogProducts.find(
        (p) => p.sku.toLowerCase() === sku.toLowerCase()
      );

      // If no snapshot was saved on older quotes, synthesize it from the frozen columns
      if (!itemSnapshot) {
        itemSnapshot = {
          sku,
          description: desc,
          quantity: finalQty,
          unit,
          unitPrice: unitSellPrice,
          listPrice,
          discount: discountPercent,
          lineTotal,
          pricePerM2,
          costPrice: catalogMatch?.costPrice,
        };
        const thickness = extractThicknessFromText(desc, coverageNotes);
        if (thickness !== undefined) itemSnapshot.thickness = thickness;
      }

      loadedItems.push({
        id: `loaded-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
        productId: catalogMatch?.id || `prod-${sku || idx}`,
        sku: sku || catalogMatch?.sku || `SKU-${idx + 1}`,
        description: desc || catalogMatch?.description || 'Specification Item',
        category: category || catalogMatch?.category || 'Ancillaries & Trims',
        unit: unit || catalogMatch?.unit || 'unit',
        costPrice: itemSnapshot.costPrice ?? catalogMatch?.costPrice,
        // Crucial: keep listPrice and unitSellPrice frozen to the saved commercial snapshot
        listPrice,
        unitCost: listPrice,
        consumptionRatePerM2: ratePerM2 || catalogMatch?.ratePerM2 || 1,
        coverageNotes: coverageNotes || catalogMatch?.coverageNotes || '',
        calculatedQuantity: calculatedQty || finalQty,
        finalQuantity: finalQty,
        discountPercent: discountPercent,
        unitSellPrice: unitSellPrice,
        pricePerM2: Math.round(pricePerM2 * 100) / 100,
        totalCost: Math.round(finalQty * listPrice * 100) / 100,
        totalSell: lineTotal,
        excludeFromM2Rate: isAnc || rawSavedM2Rate === 0 || row[19] === '-',
        isCustomOrAdded: !catalogMatch,
        commercialSnapshot: itemSnapshot,
      });
    });

    // Populate QuoteCommercialSnapshot on loadedMeta
    let quoteCommercialSnapshot: QuoteCommercialSnapshot | undefined;
    if (foundQuoteRow[44]) {
      try {
        const parsed = JSON.parse(String(foundQuoteRow[44]));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
          quoteCommercialSnapshot = parsed;
        }
      } catch {
        // silent fallback
      }
    }
    if (!quoteCommercialSnapshot && loadedItems.length > 0) {
      quoteCommercialSnapshot = createQuoteCommercialSnapshot(loadedMeta, loadedItems);
    }
    loadedMeta.commercialSnapshot = quoteCommercialSnapshot;
    if (quoteCommercialSnapshot?.priceBookCode) {
      loadedMeta.priceBookCode = quoteCommercialSnapshot.priceBookCode;
      loadedMeta.priceBookName = quoteCommercialSnapshot.priceBookName;
    }

    const revisionBadge = `Revision ${loadedRevision}`;
    const duplicateNote =
      matchingQuotes.length > 1
        ? ` (${revisionBadge}, latest of ${matchingQuotes.length} saved revisions${
            latestQuoteTimestamp ? ` from ${latestQuoteTimestamp}` : ''
          })`
        : ` (${revisionBadge})`;

    return {
      success: true,
      message: `Successfully loaded quote ${loadedFullRef} (${loadedItems.length} items)${duplicateNote}.`,
      meta: loadedMeta,
      items: loadedItems,
      savedAt: latestQuoteTimestamp,
      duplicateCount: matchingQuotes.length,
      revision: loadedRevision,
      baseReference: loadedBaseRef,
      isLatest: mostRecentQuote.isLatest,
    };
  } catch (err: any) {
    console.error('Error loading quote from Google Sheets:', err);
    return {
      success: false,
      message: err.message || 'Failed to load quote from Google Sheets.',
      error: err.message,
    };
  }
}

export interface QuoteSummaryRecord {
  quoteNumber: string;
  baseReference: string;
  revision: number;
  isLatest: boolean;
  date: string;
  projectName: string;
  projectLocation: string;
  clientCompany: string;
  contactPerson: string;
  salesManager: string;
  totalNet: number;
  areaM2: number;
  status: string;
  exportTimestamp: string;
  dealStatus: 'Won' | 'Lost' | 'Pending';
  winLikelihood: number;
}

/**
 * Fetches all saved quotes from the Quotes sheet for easy browsing and searching
 */
export async function listQuotesFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string = PERMANENT_SHEET_ID
): Promise<{ success: boolean; quotes?: QuoteSummaryRecord[]; message?: string }> {
  try {
    const quotesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Quotes!A2:AR5000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!quotesRes.ok) {
      if (quotesRes.status === 401 || quotesRes.status === 403) {
        throw new Error('Google authorization expired or lacks permissions to read Google Sheets.');
      }
      return { success: false, message: `Failed to fetch quotes (HTTP ${quotesRes.status}).` };
    }

    const data = await quotesRes.json();
    const rows: any[][] = data.values || [];

    const summaries = rows
      .map((row): QuoteSummaryRecord | null => {
        const fullRef = String(row[0] || '').trim();
        if (!fullRef) return null;

        const parsed = parseQuoteReference(fullRef);
        const rowBase = String(row[38] || '').trim() || parsed.baseReference;
        const rowRev = row[39] !== undefined && row[39] !== ''
          ? parseInt(String(row[39]), 10)
          : parsed.revision;
        const isLatest = String(row[40] || '').trim().toUpperCase() === 'TRUE';
        const date = String(row[1] || '').trim();
        const projectName = String(row[8] || '').trim();
        const projectLocation = String(row[10] || '').trim();
        const clientCompany = String(row[11] || '').trim();
        const contactPerson = String(row[12] || '').trim();
        // Row 18 is Technical Sales Manager; protect against phone numbers from other columns
        let salesManager = String(row[18] || '').trim();
        if (!salesManager && row[14] && !/^\+?[\d\s()-]{7,}$/.test(String(row[14]).trim())) {
          salesManager = String(row[14]).trim();
        }
        const areaM2 = parseFloat(String(row[19] || '0').replace(/[^\d.-]/g, '')) || 0;
        const totalNet = parseFloat(String(row[30] || row[27] || '0').replace(/[^\d.-]/g, '')) || 0;
        const status = String(row[41] || (isLatest ? 'Active' : 'Superseded')).trim();
        const exportTimestamp = String(row[37] || '').trim();

        // Columns 42 (AQ) & 43 (AR)
        const rawDealStatus = String(row[42] || '').trim();
        const dealStatus: 'Won' | 'Lost' | 'Pending' =
          rawDealStatus.toLowerCase() === 'won'
            ? 'Won'
            : rawDealStatus.toLowerCase() === 'lost'
            ? 'Lost'
            : 'Pending';
        const rawWinLikelihood = row[43];
        const parsedLikelihood = rawWinLikelihood !== undefined && rawWinLikelihood !== ''
          ? parseFloat(String(rawWinLikelihood).replace(/[^\d.-]/g, ''))
          : NaN;
        const winLikelihood = !isNaN(parsedLikelihood)
          ? Math.max(0, Math.min(100, parsedLikelihood))
          : (dealStatus === 'Won' ? 100 : dealStatus === 'Lost' ? 0 : 50);

        return {
          quoteNumber: fullRef,
          baseReference: rowBase,
          revision: isNaN(rowRev) ? 0 : rowRev,
          isLatest,
          date,
          projectName,
          projectLocation,
          clientCompany,
          contactPerson,
          salesManager,
          totalNet,
          areaM2,
          status,
          exportTimestamp,
          dealStatus,
          winLikelihood,
        };
      })
      .filter((q): q is QuoteSummaryRecord => q !== null);

    // Sort: newest quotes or revisions first
    summaries.reverse();

    return {
      success: true,
      quotes: summaries,
    };
  } catch (err: any) {
    console.error('Error listing quotes from Google Sheets:', err);
    return {
      success: false,
      message: err.message || 'Unable to load quotes list.',
    };
  }
}
