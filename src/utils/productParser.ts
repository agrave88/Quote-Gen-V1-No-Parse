import { RockwoolProduct } from '../types/quote';
import { extractBoxOrPackSize } from './applicationOrder';
import { extractThicknessFromText } from './commercialSnapshot';

/**
 * Robust CSV/TSV parser supporting:
 * - Multi-line quoted cells
 * - Comma, Tab, Semicolon delimiters
 * - Flexible column naming (e.g. "SKU", "Item Code", "Product Description", "Material", "Price", "List Price (£)", "Coverage", "Consumption", "Unit")
 * - Products with blank or empty SKUs (e.g. WBS INSULATION BEDDING ADHESIVE)
 * - Consumption rates parsed from:
 *    - Board sizes e.g. "0.72m²" -> 1 / 0.72 = ~1.389 boards per m²
 *    - Coverage ranges e.g. "Allow 5m² - 6.25m²" -> 1 / 5.625
 *    - Yields e.g. "Allow up to 11m² per drum" -> 1 / 11
 *    - Items per m2 e.g. "5-6 per m²" -> 5.5 / 100 boxes per m²
 *    - Brick slips e.g. "60 Number per m²"
 * - Currency cleaning (£, $, €, commas)
 */
export function parseGoogleSheetsCsv(csvText: string): RockwoolProduct[] {
  if (!csvText || !csvText.trim()) return [];

  const records = parseCsvRecords(csvText);
  if (records.length < 2) return [];

  // Find the true header row with multi-column confidence scoring (check first 8 rows)
  let headerRowIndex = -1;
  let skuIdx = -1;
  let descIdx = -1;
  let catIdx = -1;
  let subCatIdx = -1;
  let mfrIdx = -1;
  let sysIdx = -1;
  let thickIdx = -1;
  let unitIdx = -1;
  let costIdx = -1;
  let priceIdx = -1;
  let notesIdx = -1;
  let activeIdx = -1;
  let bestScore = 0;

  for (let r = 0; r < Math.min(8, records.length); r++) {
    const candidateHeaders = records[r].map((h) => h.trim().toLowerCase());
    
    // 1. SKU column matcher
    const sIdx = candidateHeaders.findIndex((h) =>
      h === 'sku' || h === 'sku / code' || h === 'item code' || h === 'product code' || h === 'code' || h === 'part no' || h === 'ref' || h.includes('sku') || h.includes('item no')
    );

    // 2. Description column matcher
    const dIdx = candidateHeaders.findIndex((h) =>
      h === 'description' || h === 'product description' || h === 'product' || h === 'product name' || 
      h === 'item' || h === 'item description' || h === 'material' || h === 'title' ||
      (h.includes('description') && !h.includes('sku'))
    );

    // 3. Cost price matcher
    const costIdxCandidate = candidateHeaders.findIndex((h) =>
      h === 'cost' || h === 'cost price' || h === 'unit cost' || h.includes('cost price')
    );

    // 4. List price matcher (explicitly excludes consumption/coverage/usage keywords)
    const listPriceIdxCandidate = candidateHeaders.findIndex((h) =>
      h === 'list price' || h === 'list' || h === 'selling price' || h === 'price (£)' || 
      h === 'price' || h === 'unit price' || h === 'rrp' || h === 'trade price' ||
      (h.includes('price') && !h.includes('cost') && !h.includes('consumption') && !h.includes('coverage') && !h.includes('rate'))
    );

    // 5. Fallback price matcher (never match consumption/coverage/application rates)
    const generalPriceCandidate = candidateHeaders.findIndex((h, idx) =>
      idx !== costIdxCandidate && 
      (h.includes('price') || h.includes('gbp') || h.includes('£')) &&
      !h.includes('consumption') && !h.includes('coverage') && !h.includes('application') && !h.includes('usage') && !h.includes('waste')
    );
    const pIdx = listPriceIdxCandidate !== -1 ? listPriceIdxCandidate : generalPriceCandidate;

    // 6. Category matcher
    const cIdx = candidateHeaders.findIndex((h) =>
      h === 'category' || (h.includes('category') && !h.includes('sub')) || h === 'group' || h === 'section'
    );

    // 7. Sub-Category matcher
    const subCatCandidate = candidateHeaders.findIndex((h) =>
      h === 'sub-category' || h === 'subcategory' || h === 'sub category' || h === 'sub-group' || h === 'type'
    );

    // 8. Manufacturer / Brand matcher
    const mfrCandidate = candidateHeaders.findIndex((h) =>
      h === 'manufacturer' || h === 'brand' || h === 'supplier' || h === 'maker' || h === 'mfr'
    );

    // 9. Certified Wall System matcher
    const sysCandidate = candidateHeaders.findIndex((h) =>
      h === 'system' || h === 'wall system' || h === 'certified system' || h === 'build-up' || (h.includes('system') && !h.includes('file'))
    );

    // 10. Thickness matcher
    const thickCandidate = candidateHeaders.findIndex((h) =>
      h === 'thickness' || h === 'thickness (mm)' || h === 'depth' || h === 'depth (mm)' || h === 'gauge' || h.includes('thickness')
    );

    // 11. Unit matcher
    const uIdx = candidateHeaders.findIndex((h) =>
      h === 'unit' || h === 'uom' || h === 'measure' || h === 'packaging' || h === 'pack'
    );

    // 12. Coverage / Consumption matcher
    const nIdx = candidateHeaders.findIndex((h) =>
      h.includes('consumption') || h.includes('coverage') || h.includes('yield') || 
      h.includes('application rate') || h === 'rate' || h.includes('spread') || h.includes('specs')
    );

    // 13. Active status matcher
    const actCandidate = candidateHeaders.findIndex((h) =>
      h === 'active' || h === 'is active' || h === 'status' || h === 'enabled'
    );

    // Calculate confidence score: Header must represent multiple structural columns
    let score = 0;
    if (sIdx !== -1) score += 3;
    if (dIdx !== -1) score += 3;
    if (pIdx !== -1) score += 3;
    if (cIdx !== -1) score += 2;
    if (uIdx !== -1) score += 1;
    if (nIdx !== -1) score += 1;
    if (mfrCandidate !== -1) score += 2;
    if (sysCandidate !== -1) score += 2;
    if (thickCandidate !== -1) score += 2;

    // A valid header row requires at least 2 distinct structural columns (prevents single-cell title rows from matching)
    const distinctCols = [sIdx, dIdx, pIdx, cIdx, uIdx, nIdx, mfrCandidate, sysCandidate, thickCandidate].filter((idx) => idx !== -1);
    const uniqueCols = new Set(distinctCols);

    if (uniqueCols.size >= 2 && score > bestScore) {
      bestScore = score;
      headerRowIndex = r;
      skuIdx = sIdx;
      descIdx = dIdx;
      costIdx = costIdxCandidate;
      priceIdx = pIdx;
      catIdx = cIdx;
      subCatIdx = subCatCandidate;
      mfrIdx = mfrCandidate;
      sysIdx = sysCandidate;
      thickIdx = thickCandidate;
      unitIdx = uIdx;
      notesIdx = nIdx;
      activeIdx = actCandidate;
    }
  }

  // If no structural header was detected, default to row 0
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    skuIdx = 0;
    descIdx = 1;
    catIdx = 2;
    unitIdx = 3;
    priceIdx = 5;
    notesIdx = 6;
  } else {
    // Fill in default positions for missing non-essential columns
    if (skuIdx === -1 && descIdx !== 0) skuIdx = 0;
    if (descIdx === -1) descIdx = skuIdx === 0 ? 1 : 0;
    if (catIdx === -1) {
      const usedCols = new Set([skuIdx, descIdx, priceIdx, unitIdx, notesIdx]);
      const numCols = records[headerRowIndex]?.length || 6;
      for (let c = 0; c < numCols; c++) {
        if (!usedCols.has(c)) {
          catIdx = c;
          break;
        }
      }
      if (catIdx === -1) catIdx = 2;
    }
  }

  const parsedProducts: RockwoolProduct[] = [];
  const seenIds = new Set<string>();

  for (let i = headerRowIndex + 1; i < records.length; i++) {
    const row = records[i];
    if (!row || row.length === 0) continue;

    // Check if entire row is empty
    if (row.every((cell) => !cell || !cell.trim())) continue;

    const rawSku = skuIdx !== -1 && row[skuIdx] ? row[skuIdx].trim() : '';
    const rawDesc = descIdx !== -1 && row[descIdx] ? row[descIdx].trim() : '';

    // Ignore header echoes (e.g. repeated header rows within the spreadsheet)
    const lowerSku = rawSku.toLowerCase();
    const lowerDesc = rawDesc.toLowerCase();
    if (
      (lowerSku === 'sku' || lowerSku === 'item code' || lowerSku === 'code') &&
      (lowerDesc.includes('description') || lowerDesc === 'product' || lowerDesc === 'sku')
    ) {
      continue;
    }

    // Ignore category divider rows with only 1 text cell and no price or valid sku
    const populatedCells = row.filter((c) => c && c.trim().length > 0);
    if (populatedCells.length === 1 && !lowerSku.match(/^[a-z0-9_-]{3,}$/i)) {
      continue;
    }

    // If both sku and description are empty, skip row
    if (!rawSku && !rawDesc) continue;

    // Generate clean fallback SKU if missing from spreadsheet
    const description = rawDesc || `Rockwool Product (${rawSku})`;
    const sku = rawSku || generateSkuFromDescription(description, i);

    const category = catIdx !== -1 && row[catIdx] && row[catIdx].trim()
      ? row[catIdx].trim()
      : inferCategory(description);

    const unit = unitIdx !== -1 && row[unitIdx] && row[unitIdx].trim()
      ? row[unitIdx].trim()
      : inferUnit(description);

    // Parse cost price cleanly (£10.35 -> 10.35)
    let rawCost = costIdx !== -1 && row[costIdx] ? row[costIdx].trim() : '';
    rawCost = rawCost.replace(/[^0-9.-]+/g, '');
    const parsedCost = rawCost ? parseFloat(rawCost) : undefined;
    const costPrice = parsedCost !== undefined && !isNaN(parsedCost) ? Math.max(0, parsedCost) : undefined;

    // Parse list price cleanly (£22.50 -> 22.50, detect POA / missing)
    const rawPriceOriginal = priceIdx !== -1 && row[priceIdx] ? row[priceIdx].trim() : '';
    const isPoaText = /poa|tbc|tbd|call|apply|contact|pending|request/i.test(rawPriceOriginal);
    const cleanedPriceStr = rawPriceOriginal.replace(/[^0-9.-]+/g, '');
    const parsedListPrice = cleanedPriceStr ? parseFloat(cleanedPriceStr) : 0;
    const isPriceOnApplication = isPoaText || !cleanedPriceStr || isNaN(parsedListPrice) || parsedListPrice <= 0;
    const listPrice = (!isPriceOnApplication && !isNaN(parsedListPrice)) ? Math.max(0, parsedListPrice) : 0;

    // Check active status flag if column present
    if (activeIdx !== -1 && row[activeIdx]) {
      const activeStr = row[activeIdx].trim().toLowerCase();
      if (activeStr === 'false' || activeStr === 'no' || activeStr === '0' || activeStr === 'inactive' || activeStr === 'phased out') {
        continue;
      }
    }

    const coverageNotes = notesIdx !== -1 && row[notesIdx] ? row[notesIdx].trim() : '';
    const ratePerM2 = estimateRateFromCoverage(coverageNotes, unit, description);

    // Extract structured catalog attributes
    const subCategory = subCatIdx !== -1 && row[subCatIdx] ? row[subCatIdx].trim() : undefined;

    let manufacturer = mfrIdx !== -1 && row[mfrIdx] ? row[mfrIdx].trim() : undefined;
    if (!manufacturer) {
      const descUpper = description.toUpperCase();
      if (descUpper.includes('ROCKWOOL')) {
        manufacturer = 'ROCKWOOL';
      } else if (descUpper.includes('WETHERBY') || descUpper.includes('WBS')) {
        manufacturer = 'Wetherby';
      } else if (descUpper.includes('HECK')) {
        manufacturer = 'Heck';
      } else if (descUpper.includes('EJOT')) {
        manufacturer = 'EJOT';
      } else if (descUpper.includes('RAWLPLUG')) {
        manufacturer = 'Rawlplug';
      } else {
        manufacturer = 'ROCKWOOL / Partner';
      }
    }

    let system = sysIdx !== -1 && row[sysIdx] ? row[sysIdx].trim() : undefined;
    if (!system) {
      const descUpper = description.toUpperCase();
      if (descUpper.includes('WETHERBY') || descUpper.includes('WBS')) {
        system = 'Wetherby Stone Wool Façade System';
      } else if (descUpper.includes('RAINSCREEN') || descUpper.includes('DUO')) {
        system = 'ROCKWOOL RainScreen Façade System';
      } else if (descUpper.includes('HECK')) {
        system = 'Heck External Wall Insulation System';
      } else {
        system = 'A1/A2 Non-Combustible Wall System';
      }
    }

    let thicknessVal: number | undefined;
    if (thickIdx !== -1 && row[thickIdx]) {
      const parsedThick = parseFloat(String(row[thickIdx]).replace(/[^\d.-]/g, ''));
      if (!isNaN(parsedThick) && parsedThick > 0 && parsedThick < 500) {
        thicknessVal = parsedThick;
      }
    }
    if (thicknessVal === undefined) {
      thicknessVal = extractThicknessFromText(description, coverageNotes);
    }

    let cleanId = `prod-${sku.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
    if (seenIds.has(cleanId)) {
      cleanId = `${cleanId}-${i}`;
    }
    seenIds.add(cleanId);

    parsedProducts.push({
      id: cleanId,
      sku,
      description,
      category,
      subCategory,
      manufacturer,
      system,
      thickness: thicknessVal,
      unit,
      costPrice,
      listPrice,
      isPriceOnApplication: isPriceOnApplication || undefined,
      coverageNotes: coverageNotes || `${ratePerM2.toFixed(3)} ${unit}/m²`,
      ratePerM2,
    });
  }

  return parsedProducts;
}

/**
 * Creates a readable SKU code for items in the spreadsheet that have empty SKU column
 */
function generateSkuFromDescription(desc: string, rowIdx: number): string {
  const words = desc.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
  return `${initials || 'RW'}-${String(rowIdx).padStart(3, '0')}`;
}

function inferUnit(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('insulation slab') || d.includes('board')) return 'Board';
  if (d.includes('primer')) return '15lt Drum';
  if (d.includes('drum') || d.includes('finish') || d.includes('topcoat')) return '25kg Drum';
  if (d.includes('bag') || d.includes('adhesive') || d.includes('mortar')) return '25kg Bag';
  if (d.includes('fixing') || d.includes('washer') || d.includes('screw')) return 'Boxed 100s';
  if (d.includes('cloth') || d.includes('mesh')) return 'Roll';
  if (d.includes('bead') || d.includes('rail') || d.includes('trim')) return '2.5m';
  return 'Each';
}

/**
 * Standard CSV parser that correctly handles quoted cells containing newlines and commas/delimiters
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  // Detect delimiter: comma, tab, or semicolon
  const firstLine = text.split(/\r?\n/)[0] || '';
  let delimiter = ',';
  if (firstLine.includes('\t') && !firstLine.includes(',')) {
    delimiter = '\t';
  } else if (firstLine.includes(';') && !firstLine.includes(',')) {
    delimiter = ';';
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip CRLF second char
      }
      currentRow.push(currentField);
      records.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    records.push(currentRow);
  }

  return records;
}

/**
 * Robustly parses consumption notes from the spreadsheet into a numeric consumption rate per m²
 * Examples:
 * - "0.72m²" (Insulation board size 1200x600 = 0.72m²) -> 1 / 0.72 = 1.389 boards per m²
 * - "4-5kg/m² (Allow 5m² - 6.25m²)" -> 1 / 5.625 = 0.177 bags per m²
 * - "Allow up to 11m² per drum" -> 1 / 11 = 0.0909 drums per m²
 * - "Approx. 60m² per tub" -> 1 / 60 = 0.0167 tubs per m²
 * - "5-6 per m²" (Box 100) -> 5.5 / 100 = 0.055 boxes per m²
 * - "60 Number per m²" (Brick slips) -> 60 per m²
 * - "14 per lin mtr" -> 14
 * - "55m² Roll (Allow 50m² per roll)" -> 1 / 50 = 0.02 rolls per m²
 */
export function estimateRateFromCoverage(notes: string, unit: string, description: string): number {
  const lowerNotes = (notes || '').toLowerCase();
  const lowerUnit = (unit || '').toLowerCase();
  const lowerDesc = (description || '').toLowerCase();

  // 1. Insulation Board single board area e.g. "0.72m²" or "0.72 m2"
  const singleBoardAreaMatch = lowerNotes.match(/^(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)\s*$/);
  if (singleBoardAreaMatch) {
    const boardArea = parseFloat(singleBoardAreaMatch[1]);
    if (boardArea > 0) {
      return boardArea; // e.g. 0.72 m² per board (m² price = unit price / rate)
    }
  }

  // 2. Pattern "Allow Xm² - Ym²", "3.5m² - 3.75m² per bag", "5-6m² per bag", or "Allow X - Ym² per bag/drum"
  const rangeCoverageMatch = lowerNotes.match(/(?:allow\s*(?:up\s*to\s*)?|approx\.?\s*)?(\d+(?:\.\d+)?)\s*(?:m²|m2)?\s*[-–to]+\s*(\d+(?:\.\d+)?)\s*(?:m²|m2)/);
  if (rangeCoverageMatch) {
    const avgCoverage = (parseFloat(rangeCoverageMatch[1]) + parseFloat(rangeCoverageMatch[2])) / 2;
    if (avgCoverage > 0) {
      return 1 / avgCoverage;
    }
  }

  // 3. Pattern "Allow up to Xm²", "Allow Xm² per bag", "Approx. Xm² per tub", or "Xm² per bag"
  const singleCoverageMatch = lowerNotes.match(/(?:allow\s*(?:up\s*to\s*)?|approx\.?\s*)?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\s*(?:per|\/|\@|$)/);
  if (singleCoverageMatch) {
    const coverage = parseFloat(singleCoverageMatch[1]);
    if (coverage > 0) {
      return 1 / coverage;
    }
  }

  // 4. Pattern "Xm² Roll" or "50m² per roll"
  const rollCoverageMatch = lowerNotes.match(/(\d+(?:\.\d+)?)\s*(?:m²|m2)\s*(?:per\s*roll|roll)/);
  if (rollCoverageMatch) {
    const rollCoverage = parseFloat(rollCoverageMatch[1]);
    if (rollCoverage > 0) {
      return 1 / rollCoverage;
    }
  }

  // 5. Pattern for Brick Slips or discrete items sold per piece: e.g. "60 Number per m²", "60 slips per m²"
  if (lowerDesc.includes('slip') || lowerNotes.includes('number per') || lowerNotes.includes('number /') || lowerNotes.includes('slips per')) {
    const slipMatch = lowerNotes.match(/(\d+(?:\.\d+)?)\s*(?:number|slips?|pieces?|units?)?\s*(?:per|\/)\s*(?:m²|m2)/);
    if (slipMatch) {
      const num = parseFloat(slipMatch[1]);
      if (lowerUnit.includes('100') || lowerUnit.includes('box 100')) {
        return num / 100;
      }
      return num; // 60 slips per m²
    }
  }

  // 6. Fixing & Washer coverage: "5 per m²", "5-6 per m²", or "5 fixings per m²"
  // Formula: If N required per m² and B units per box, Box Covers (B / N) m², and Consumption Rate = N / B
  // E.g. If 5 fixings/m² and 100/box -> Box covers 100 / 5 = 20m², Rate = 5 / 100 = 0.05 boxes/m²
  // Washers: 1 washer is required per fixing. If 5 fixings/m² and washer is in Box of 200 -> Rate = 5 / 200 = 0.025 boxes/m²
  const fixingsPerM2RangeMatch = lowerNotes.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?)\s*)?(?:fixings?|washers?|fasteners?|screws?|anchors?)\s*(?:per|\/)\s*(?:m²|m2)/);
  const genericPerM2Match = lowerNotes.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?)\s*)?(?:units?|items?)?\s*(?:per|\/)\s*(?:m²|m2)/);
  
  if (fixingsPerM2RangeMatch || (genericPerM2Match && (lowerDesc.includes('fixing') || lowerDesc.includes('screw') || lowerDesc.includes('washer') || lowerUnit.includes('box')))) {
    const match = fixingsPerM2RangeMatch || genericPerM2Match;
    if (match) {
      const itemsPerM2 = parseFloat(match[1]);
      const boxSize = extractBoxOrPackSize({ unit, coverageNotes: notes, description });
      return itemsPerM2 / boxSize;
    }
  }

  // 6b. Standalone washer products without explicit "X per m²" notes (e.g. "35mm Stainless Steel Washer", "KC Washer")
  if (lowerDesc.includes('washer')) {
    const boxSize = extractBoxOrPackSize({ unit, coverageNotes: notes, description });
    // 1 washer per fixing -> standard 5 fixings/m² -> 5 / boxSize boxes per m²
    return 5 / boxSize;
  }

  // 6c. Generic fallback for single number per m²
  if (genericPerM2Match) {
    const num = parseFloat(genericPerM2Match[1]);
    if (lowerUnit.includes('100') || lowerUnit.includes('box')) {
      return num / 100;
    }
    return num;
  }

  // Linear metre / non-m² notes (e.g. "14 per lin mtr", "lin. mtr", etc.) -> 0 m² consumption (treated as Ancillary)
  if (
    lowerNotes.includes('lin mtr') ||
    lowerNotes.includes('linear') ||
    lowerNotes.includes('lin. mtr') ||
    lowerNotes.includes('lin m') ||
    lowerNotes.includes('per lm') ||
    lowerNotes.includes('per l/m') ||
    lowerNotes.includes('/lm') ||
    lowerDesc.includes('corner slip') ||
    lowerDesc.includes('pistol corner') ||
    lowerUnit.includes('lin mtr') ||
    lowerUnit.includes('linear')
  ) {
    return 0;
  }

  // 7. Base rails or trims (2.5m lengths, perimeter coverage)
  if (lowerUnit.includes('2.5m') || lowerDesc.includes('rail') || lowerDesc.includes('bead') || lowerDesc.includes('trim')) {
    return 0.35; // ~0.35 lengths per m² typical
  }

  // Fallback defaults
  if (lowerUnit.includes('board') || lowerDesc.includes('insulation') || lowerDesc.includes('mineral wool')) {
    return 0.72; // Default 1200x600 board = 0.72m²
  }

  return 1.0;
}

/**
 * Complete Rockwool & Wetherby Wall Systems product catalog from spreadsheet
 */
export const DEFAULT_DYNAMIC_PRODUCTS: RockwoolProduct[] = [
  {
    id: 'prod-iso-001',
    sku: 'ISO-001',
    description: '100mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 22.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-002',
    sku: 'ISO-002',
    description: '110mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 23.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-003',
    sku: 'ISO-003',
    description: '120mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 24.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-004',
    sku: 'ISO-004',
    description: '130mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 25.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-500069',
    sku: '500069',
    description: '140mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 30.00,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-006',
    sku: 'ISO-006',
    description: '150mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 27.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-007',
    sku: 'ISO-007',
    description: '160mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 28.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-iso-008',
    sku: 'ISO-008',
    description: '170mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 29.50,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-500072',
    sku: '500072',
    description: '180mm Mineral Wool Insulation Slab',
    category: 'Insulation',
    unit: 'Board',
    listPrice: 32.00,
    coverageNotes: '0.72m²',
    ratePerM2: 0.72,
  },
  {
    id: 'prod-ren-101',
    sku: 'REN-101',
    description: 'Silicone Primer (15kg)',
    category: 'Primers',
    unit: 'tub',
    listPrice: 48.00,
    coverageNotes: 'Approx. 60m² per tub',
    ratePerM2: 1 / 60,
  },
  {
    id: 'prod-ren-201',
    sku: 'REN-201',
    description: '1.5mm Silicone Topcoat Render',
    category: 'Topcoats',
    unit: 'bucket',
    listPrice: 52.00,
    coverageNotes: 'Approx. 8m² per bucket',
    ratePerM2: 1 / 8,
  },
  {
    id: 'prod-fix-001',
    sku: 'FIX-001',
    description: '100mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-fix-002',
    sku: 'FIX-002',
    description: '120mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-fix-003',
    sku: 'FIX-003',
    description: '140mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-fix-004',
    sku: 'FIX-004',
    description: '160mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-fix-005',
    sku: 'FIX-005',
    description: '180mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-fix-006',
    sku: 'FIX-006',
    description: '200mm Mechanical Fixings (Box 100)',
    category: 'Fixings',
    unit: 'box',
    listPrice: 35.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-wbs-iba',
    sku: 'WBS-IBA',
    description: 'WBS INSULATION BEDDING ADHESIVE',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 16.50,
    coverageNotes: '4-5kg/m² (Allow 5m² - 6.25m²)',
    ratePerM2: 1 / 5.625,
  },
  {
    id: 'prod-1300083',
    sku: '1300083',
    description: 'WBS SCRIM ADHESIVE',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 14.50,
    coverageNotes: '1.8kg/mm thick/m² (Allow 2.3m² - 3.5m²)',
    ratePerM2: 1 / 2.9,
  },
  {
    id: 'prod-wbs-buf',
    sku: 'WBS-BUF',
    description: 'WBS BASECOAT U.F.',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 15.00,
    coverageNotes: '1.8kg/mm thick/m² (Allow 2.3m² - 3.5m²)',
    ratePerM2: 1 / 2.9,
  },
  {
    id: 'prod-heck-ka',
    sku: 'HECK-KA',
    description: 'HECK K+A SCRIM ADHESIVE',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 16.00,
    coverageNotes: '1.2kg/mm thick/m² (Allow up to 3.5m² @ 6mm)',
    ratePerM2: 1 / 3.5,
  },
  {
    id: 'prod-heck-ka-a1',
    sku: 'HECK-KA-A1',
    description: 'HECK K+A A1 SCRIM ADHESIVE (Euroclass A1)',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 16.00,
    coverageNotes: '1.2kg/mm thick/m² (Allow up to 3.5m² @ 6mm)',
    ratePerM2: 1 / 3.5,
  },
  {
    id: 'prod-wbs-styro',
    sku: 'WBS-STYRO',
    description: 'WBS STYROBOND SCRIM ADHESIVE',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 13.00,
    coverageNotes: '1.2kg/mm thick/m² (Allow up to 3.5m² @ 6mm)',
    ratePerM2: 1 / 3.5,
  },
  {
    id: 'prod-wbs-prem',
    sku: 'WBS-PREM',
    description: 'WBS PREMIUM SCRIM ADHESIVE',
    category: 'Basecoats',
    unit: '25kg Bag',
    listPrice: 15.00,
    coverageNotes: '1.2kg/mm thick/m² (Allow up to 2.5m² 3.75m² @ 6mm)',
    ratePerM2: 1 / 3.125,
  },
  {
    id: 'prod-wbs-sil-prim',
    sku: 'WBS-SIL-PRIM',
    description: 'WBS SILICONE PRIMER',
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '15lt Drum',
    listPrice: 50.00,
    coverageNotes: '0.2-0.3l/m² (Allow up to 75m²)',
    ratePerM2: 1 / 75,
  },
  {
    id: 'prod-wbs-sil-k10',
    sku: 'WBS-SIL-K10',
    description: "WBS SILICONE 'K' FINISH 1.0mm",
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Drum',
    listPrice: 60.00,
    coverageNotes: '1.9kg/m² (Allow up to 12.5m² per drum)',
    ratePerM2: 1 / 12.5,
  },
  {
    id: 'prod-wbs-sil-k15',
    sku: 'WBS-SIL-K15',
    description: "WBS SILICONE 'K' FINISH 1.5mm",
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Drum',
    listPrice: 60.00,
    coverageNotes: '2.2kg/m² (Allow up to 11m² per drum)',
    ratePerM2: 1 / 11,
  },
  {
    id: 'prod-wbs-sil-k20',
    sku: 'WBS-SIL-K20',
    description: "WBS SILICONE 'K' FINISH 2mm",
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Drum',
    listPrice: 60.00,
    coverageNotes: '3.0kg/m² (Allow up to 8m² per drum)',
    ratePerM2: 1 / 8,
  },
  {
    id: 'prod-wbs-sil-k30',
    sku: 'WBS-SIL-K30',
    description: "WBS SILICONE 'K' FINISH 3mm",
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Drum',
    listPrice: 60.00,
    coverageNotes: '3.6kg/m² (Allow up to 7m² per drum)',
    ratePerM2: 1 / 7,
  },
  {
    id: 'prod-wbs-heck-ed2',
    sku: 'WBS-HECK-ED2',
    description: 'WBS HECK ED MINERAL RENDER FINISH 2.0mm (A1)',
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Bag',
    listPrice: 34.00,
    coverageNotes: '2.3kg/m² (Allow up to 11m² per bag)',
    ratePerM2: 1 / 11,
  },
  {
    id: 'prod-wbs-heck-ed3',
    sku: 'WBS-HECK-ED3',
    description: 'WBS HECK ED MINERAL RENDER FINISH 3.0mm (A1)',
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '25kg Bag',
    listPrice: 34.00,
    coverageNotes: '2.9kg/m² (Allow up to 9m² per bag)',
    ratePerM2: 1 / 9,
  },
  {
    id: 'prod-wbs-sil-paint',
    sku: 'WBS-SIL-PAINT',
    description: 'WBS SILICONE PAINT EPSICOAT (12.5 Litres)',
    category: 'Silicone, Acrylic & Mineral Finishes',
    unit: '12.5 Litres',
    listPrice: 78.00,
    coverageNotes: '0.2l/m² per coat (two coats required, allow 30m² approx)',
    ratePerM2: 1 / 30,
  },
  {
    id: 'prod-1300019',
    sku: '1300019',
    description: 'WBS BRICK SLIP ADHESIVE',
    category: 'Brick Slip System',
    unit: '25kg Bag',
    listPrice: 18.00,
    coverageNotes: '3.5m² - 3.75m² per bag',
    ratePerM2: 1 / 3.625,
  },
  {
    id: 'prod-zg0056',
    sku: 'ZG0056',
    description: 'WBS POINTING MORTAR (15mm Brick Slips)',
    category: 'Brick Slip System',
    unit: '25kg Bag',
    listPrice: 17.50,
    coverageNotes: '5-6m² per bag',
    ratePerM2: 1 / 5.5,
  },
  {
    id: 'prod-1101409',
    sku: '1101409',
    description: 'WBS BRICK SLIPS',
    category: 'Brick Slip System',
    unit: 'Varies',
    listPrice: 0.65,
    coverageNotes: '60 Number per m²',
    ratePerM2: 60,
  },
  {
    id: 'prod-1101410',
    sku: '1101410',
    description: 'WBS PISTOL CORNER SLIPS',
    category: 'Ancillaries',
    unit: 'Varies',
    listPrice: 2.50,
    coverageNotes: '14 per lin mtr',
    ratePerM2: 0,
  },
  {
    id: 'prod-1200027',
    sku: '1200027',
    description: 'WBS BIOCIDAL WASH (5 Litres)',
    category: 'Ancillaries',
    unit: '5 Litres',
    listPrice: 19.95,
    coverageNotes: '40m² per litre (when diluted, 200m² per container)',
    ratePerM2: 1 / 200,
  },
  {
    id: 'prod-700021',
    sku: '700021',
    description: 'WBS ALKALI RESISTANT SCRIM CLOTH (1.1m x 50m Roll)',
    category: 'Basecoats',
    unit: '1.1m x 50m Roll',
    listPrice: 49.50,
    coverageNotes: '55m² Roll (Allow 50m² per roll)',
    ratePerM2: 1 / 50,
  },
  {
    id: 'prod-400148',
    sku: '400148',
    description: '35mm Stainless Steel Washer',
    category: 'Fixings',
    unit: 'x 100s',
    listPrice: 14.00,
    coverageNotes: '5 per m² (1 washer/fixing, 1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-400034',
    sku: '400034',
    description: 'JT2-D6-5.5/6.3 x 172mm Fixing',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 50.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-400328',
    sku: '400328',
    description: 'JT2-D6-5.5/6.3 x 232mm Fixing',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 80.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-400351',
    sku: '400351',
    description: 'KC Washer',
    category: 'Fixings',
    unit: 'Boxed 200s',
    listPrice: 33.00,
    coverageNotes: '5 per m² (1 washer/fixing, 1 box of 200 covers 40m²)',
    ratePerM2: 5 / 200,
  },
  {
    id: 'prod-400549',
    sku: '400549',
    description: 'R-WX-48T180-A4 Screw',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 105.00,
    coverageNotes: 'A4 Stainless steel facade screw',
    ratePerM2: 5.5 / 100,
  },
  {
    id: 'prod-400541',
    sku: '400541',
    description: 'R-WX-48T240-A4 Screw',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 170.00,
    coverageNotes: 'A4 Stainless steel facade screw 240mm',
    ratePerM2: 5.5 / 100,
  },
  {
    id: 'prod-tfix-8s-135',
    sku: 'TFIX-8S-135',
    description: 'TFIX-8S 135mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 38.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-155',
    sku: 'TFIX-8S-155',
    description: 'TFIX-8S 155mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 39.50,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-175',
    sku: 'TFIX-8S-175',
    description: 'TFIX-8S 175mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 40.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-195',
    sku: 'TFIX-8S-195',
    description: 'TFIX-8S 195mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 41.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-215',
    sku: 'TFIX-8S-215',
    description: 'TFIX-8S 215mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 41.50,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-235',
    sku: 'TFIX-8S-235',
    description: 'TFIX-8S 235mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 42.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-255',
    sku: 'TFIX-8S-255',
    description: 'TFIX-8S 255mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 44.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-275',
    sku: 'TFIX-8S-275',
    description: 'TFIX-8S 275mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 46.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tfix-8s-295',
    sku: 'TFIX-8S-295',
    description: 'TFIX-8S 295mm Mechanical Fixings',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 48.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tkr-140',
    sku: 'TKR-140',
    description: '140mm TKR Screw with TiT/FiN Washer',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 38.00,
    coverageNotes: '5 per m² (1 box of 100 covers 20m²)',
    ratePerM2: 5 / 100,
  },
  {
    id: 'prod-tke-200',
    sku: 'TKE-200',
    description: '200mm TKE Stainless Steel Screw & Washer',
    category: 'Fixings',
    unit: 'Boxed 100s',
    listPrice: 65.00,
    coverageNotes: '1 per m²',
    ratePerM2: 1 / 100,
  },
  {
    id: 'prod-900065',
    sku: '900065',
    description: '3756 Base Rail Connector',
    category: 'Beads & Trims',
    unit: 'Boxed 100s',
    listPrice: 28.00,
    coverageNotes: 'Starter track alignment clip',
    ratePerM2: 0.15,
  },
  {
    id: 'prod-900055',
    sku: '900055',
    description: '37979 PVC Corner Bead (3707) (3797)',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 3.20,
    coverageNotes: 'External corner reinforcement profile',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-900685',
    sku: '900685',
    description: '816N PCGS Stop Bead 160mm Nosed',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 22.00,
    coverageNotes: '160mm system termination bead',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-900690',
    sku: '900690',
    description: '820N PCGS Stop Bead 200mm Nosed',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 27.00,
    coverageNotes: '200mm system termination bead',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-901692',
    sku: '901692',
    description: 'BSR-140 Brick Slip Base Rail 140mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 25.50,
    coverageNotes: 'Heavy gauge brick slip starter track',
    ratePerM2: 0.35,
  },
  {
    id: 'prod-900745',
    sku: '900745',
    description: 'BSR-180 Brick Slip Base Rail 180mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 28.50,
    coverageNotes: '180mm brick slip system starter rail',
    ratePerM2: 0.35,
  },
  {
    id: 'prod-900020',
    sku: '900020',
    description: 'MJ15 PVC White Movement Bead 15-17mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 5.95,
    coverageNotes: 'Expansion joint profile',
    ratePerM2: 0.15,
  },
  {
    id: 'prod-903534',
    sku: '903534',
    description: 'RCJB-BS15 Brick Slip Joint Base White 15mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 18.00,
    coverageNotes: 'Joint base trim',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-903532',
    sku: '903532',
    description: 'RCJT-BS15 Brick Slip Joint Top White 15mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 18.50,
    coverageNotes: 'Joint cap trim',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-900028',
    sku: '900028',
    description: 'RS15 PVC White Stop Bead 15-17mm',
    category: 'Beads & Trims',
    unit: '2.5m',
    listPrice: 3.75,
    coverageNotes: 'Perimeter stop bead profile',
    ratePerM2: 0.25,
  },
  {
    id: 'prod-1100063',
    sku: '1100063',
    description: 'Brick Slip PK Spacer (Green)',
    category: 'Brick Slip System',
    unit: 'Boxed 100s',
    listPrice: 10.50,
    coverageNotes: 'Brick slip spacing tool',
    ratePerM2: 0.5,
  },
  {
    id: 'prod-700026',
    sku: '700026',
    description: 'Fixing Patch Mesh STD 100mm x 50mtr Green Roll',
    category: 'Ancillaries',
    unit: 'Each',
    listPrice: 10.75,
    coverageNotes: '5.00 m² (£2.15/m²)',
    ratePerM2: 1 / 5.0,
  },
  {
    id: 'prod-1200017',
    sku: '1200017',
    description: 'Expanding Sealing Tape 15 x 3-6mm x 8m',
    category: 'Ancillaries',
    unit: 'Each',
    listPrice: 11.50,
    coverageNotes: 'Weatherproof perimeter compression seal',
    ratePerM2: 0.3,
  },
  {
    id: 'prod-800015',
    sku: '800015',
    description: 'FS703 FR Silicone White (310ml)',
    category: 'Ancillaries',
    unit: '310ml',
    listPrice: 9.95,
    coverageNotes: 'Fire rated perimeter sealant',
    ratePerM2: 0.4,
  }
];

function inferCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('insul') || d.includes('slab') || d.includes('wool') || d.includes('eps')) return 'Insulation';
  if (d.includes('primer')) return 'Primers';
  if (d.includes('silicone') || d.includes('topcoat') || d.includes('finish') || d.includes('render') || d.includes('paint')) return 'Silicone, Acrylic & Mineral Finishes';
  if (d.includes('fixing') || d.includes('washer') || d.includes('screw') || d.includes('pin')) return 'Fixings';
  if (d.includes('brick slip') || d.includes('mortar') || d.includes('pointing') || d.includes('spacer')) return 'Brick Slip System';
  if (d.includes('scrim') || d.includes('adhesive') || d.includes('basecoat') || d.includes('bedding') || d.includes('styrobond')) return 'Basecoats';
  if (d.includes('bead') || d.includes('rail') || d.includes('trim') || d.includes('connector')) return 'Beads & Trims';
  return 'Ancillaries';
}
