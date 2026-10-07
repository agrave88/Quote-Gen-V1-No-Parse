import { QuoteLineItem, RockwoolProduct } from '../types/quote';

/**
 * Checks if a product or line item is an item where a single unit covers less than 1m²
 * (e.g. insulation boards covering 0.72m², mineral wool slabs, or category insulation).
 */
export function isUnitCoversLessThanOneM2(product: {
  sku?: string;
  description: string;
  category?: string;
  unit?: string;
  coverageNotes?: string;
  consumptionRatePerM2?: number;
  ratePerM2?: number;
}): boolean {
  return getProductTypeCategory(product) === 'insulation';
}

/**
 * Calculates the m² price for a product or line item:
 * - For items where a single unit covers < 1m² (such as insulation boards covering 0.72m²):
 *   m² price = unit price / consumption rate (e.g. £22.50 / 0.72 = £31.25/m²)
 * - For standard items:
 *   m² price = unit price * consumption rate
 */
export function calculateItemPricePerM2(
  unitPrice: number,
  consumptionRate: number,
  isAncillary: boolean,
  isLessThanOneM2: boolean
): number {
  if (isAncillary || consumptionRate <= 0) return 0;
  if (isLessThanOneM2) {
    const rate = consumptionRate > 0 ? consumptionRate : 0.72;
    return Math.round((unitPrice / rate) * 100) / 100;
  }
  return Math.round((unitPrice * consumptionRate) * 100) / 100;
}

/**
 * Calculates the quantity required for a given gross area:
 * - For items where a single unit covers < 1m² (such as insulation boards covering 0.72m²):
 *   quantity = Math.ceil(grossArea / consumption rate) (e.g. Math.ceil(100 / 0.72) = 139)
 * - For standard items:
 *   quantity = Math.ceil(grossArea * consumption rate)
 */
export function calculateItemQuantity(
  grossArea: number,
  consumptionRate: number,
  isAncillary: boolean,
  isLessThanOneM2: boolean
): number {
  if (isAncillary) return 1;
  // Final quantity defaults to 1 unless the facade area input has been changed to > 1
  if (grossArea <= 1) return 1;
  if (isLessThanOneM2) {
    const rate = consumptionRate > 0 ? consumptionRate : 0.72;
    return Math.max(1, Math.ceil(grossArea / rate));
  }
  return Math.max(1, Math.ceil(grossArea * consumptionRate));
}

/**
 * Checks if a product or line item is a standalone washer product (e.g. 35mm Washer, KC Washer)
 */
export function isWasherProduct(product: {
  sku?: string;
  description: string;
  category?: string;
}): boolean {
  const desc = (product.description || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();
  return (
    desc.includes('washer') ||
    sku.includes('washer') ||
    sku === '400148' ||
    sku === '400351'
  );
}

/**
 * Checks if a product or line item is a mechanical fixing item (excluding standalone washers)
 */
export function isFixingProduct(product: {
  sku?: string;
  description: string;
  category?: string;
}): boolean {
  const cat = (product.category || '').toLowerCase();
  const desc = (product.description || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();

  if (isWasherProduct(product)) return false;

  return (
    cat.includes('fixing') ||
    cat.includes('fastener') ||
    desc.includes('fixing') ||
    desc.includes('screw') ||
    desc.includes('fastener') ||
    sku.startsWith('fix-') ||
    sku.startsWith('tfix') ||
    sku.startsWith('tkr') ||
    sku.startsWith('tke') ||
    sku.startsWith('jt2')
  );
}

export const PACK_PATTERNS = [
  /\b(\d{2,4})\s*s\b/i,                                                        // "100s", "200s"
  /\b(?:box(?:ed)?|pack|bx|x)\s*(?:of\s*)?(\d{2,4})\b(?!\s*(?:mm|kg|m\b))/i,    // "Box 250", "Boxed 100", not "200mm"
  /\b(\d{2,4})\s*(?:per\s*(?:box|pack)|pcs|pieces)\b/i,                       // "100 per box", "250 pcs"
];

/**
 * Extracts box / pack size for boxed items (e.g. "Boxed 100s" -> 100, "Boxed 200s" -> 200, "Box 250" -> 250)
 */
export function extractBoxOrPackSize(product: {
  unit?: string;
  description?: string;
  coverageNotes?: string;
}): number {
  for (const src of [product.unit, product.coverageNotes, product.description]) {
    for (const re of PACK_PATTERNS) {
      const m = (src ?? '').match(re);
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > 0) return val;
      }
    }
  }
  return 100; // default standard box size
}

/**
 * Returns the individual fixing count per m² from a fixing item.
 * E.g. If consumption rate is 0.05 boxes/m² and box size is 100 -> 5 fixings per m².
 */
export function getIndividualFixingsPerM2(fixingItem: {
  consumptionRatePerM2?: number;
  ratePerM2?: number;
  unit?: string;
  description?: string;
  coverageNotes?: string;
}): number {
  const boxSize = extractBoxOrPackSize(fixingItem);
  const rate = fixingItem.consumptionRatePerM2 ?? fixingItem.ratePerM2 ?? 0.05;
  
  // If rate is given in boxes per m² (e.g. 0.05 boxes/m²):
  if (rate < 1.0) {
    return Math.round(rate * boxSize * 10) / 10;
  }
  // If rate is already in individual items per m² (e.g. 5 per m²):
  return rate;
}

/**
 * Computes the washer box consumption rate per m² given the fixing count per m² and the washer box size.
 * Since 1 washer is required per fixing:
 * individual washers/m² = individual fixings/m²
 * washer box consumption rate = (individual fixings/m²) / (washer box size)
 */
export function calculateWasherRate(
  fixingsPerM2: number,
  washerProduct: {
    unit?: string;
    description?: string;
    coverageNotes?: string;
  }
): {
  consumptionRatePerM2: number;
  boxSize: number;
  coverageNotes: string;
} {
  const boxSize = extractBoxOrPackSize(washerProduct);
  const validFixingsCount = fixingsPerM2 > 0 ? fixingsPerM2 : 5;
  const consumptionRatePerM2 = validFixingsCount / boxSize;
  const areaPerBox = boxSize / validFixingsCount;
  const coverageNotes = `${validFixingsCount} per m² (1 washer/fixing, 1 box of ${boxSize} covers ${areaPerBox.toFixed(1).replace('.0', '')}m²)`;

  return {
    consumptionRatePerM2,
    boxSize,
    coverageNotes,
  };
}

export interface ApplicationStageInfo {
  stageOrder: number;
  stageName: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  dotColor: string;
  categoryDisplay: string;
}

export const ALL_APPLICATION_STAGES: ApplicationStageInfo[] = [
  {
    stageOrder: 1,
    stageName: 'Bedding Adhesive',
    badgeColor: 'text-teal-900',
    badgeBg: 'bg-teal-100',
    badgeBorder: 'border-teal-300',
    dotColor: 'bg-teal-600',
    categoryDisplay: 'Adhesive',
  },
  {
    stageOrder: 2,
    stageName: 'Insulation',
    badgeColor: 'text-amber-900',
    badgeBg: 'bg-amber-100',
    badgeBorder: 'border-amber-300',
    dotColor: 'bg-amber-500',
    categoryDisplay: 'Insulation',
  },
  {
    stageOrder: 3,
    stageName: 'Mechanical Fixings',
    badgeColor: 'text-indigo-900',
    badgeBg: 'bg-indigo-100',
    badgeBorder: 'border-indigo-300',
    dotColor: 'bg-indigo-600',
    categoryDisplay: 'Fixings',
  },
  {
    stageOrder: 4,
    stageName: 'Basecoat & Mesh',
    badgeColor: 'text-sky-900',
    badgeBg: 'bg-sky-100',
    badgeBorder: 'border-sky-300',
    dotColor: 'bg-sky-600',
    categoryDisplay: 'Basecoat & Mesh',
  },
  {
    stageOrder: 5,
    stageName: 'Primer',
    badgeColor: 'text-purple-900',
    badgeBg: 'bg-purple-100',
    badgeBorder: 'border-purple-300',
    dotColor: 'bg-purple-600',
    categoryDisplay: 'Primers',
  },
  {
    stageOrder: 6,
    stageName: 'Topcoat & Finishes',
    badgeColor: 'text-emerald-900',
    badgeBg: 'bg-emerald-100',
    badgeBorder: 'border-emerald-300',
    dotColor: 'bg-emerald-600',
    categoryDisplay: 'Topcoats & Finishes',
  },
  {
    stageOrder: 7,
    stageName: 'Ancillaries',
    badgeColor: 'text-slate-900',
    badgeBg: 'bg-slate-100',
    badgeBorder: 'border-slate-300',
    dotColor: 'bg-slate-600',
    categoryDisplay: 'Ancillaries',
  },
];

/**
 * Returns the structural EWI application stage (1 to 7) for any product.
 * Sequence:
 * 1. Adhesive (Bedding / Bonding Adhesive)
 * 2. Insulation (Mineral wool slabs, EPS, etc.)
 * 3. Mechanical Fixings (Fixings, pins, screws, washers)
 * 4. Basecoat & Mesh (Scrim adhesive, basecoat, reinforcing scrim cloth/mesh)
 * 5. Primers (Silicone primer, quartz keying primer, substrate primer)
 * 6. Topcoat & Finishes (Silicone 'K' finish, mineral render, brick slips, pointing mortar, paint)
 * 7. Ancillaries (ALL THE REST: base rails, starter tracks, beads, trims, tapes, sealants, spacers, cleaners, sundries)
 *
 * NOTE: Column C (Category) from the spreadsheet is ALWAYS evaluated FIRST to determine classification.
 */
export function getProductApplicationStage(product: {
  sku?: string;
  description: string;
  category?: string;
  coverageNotes?: string;
  unit?: string;
  ratePerM2?: number;
  consumptionRatePerM2?: number;
}): ApplicationStageInfo {
  const cat = (product.category || '').trim().toLowerCase();
  const desc = (product.description || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();
  const notes = (product.coverageNotes || '').toLowerCase();
  const unit = (product.unit || '').toLowerCase();

  // If a product doesn't have an m² consumption (e.g. per lin mtr, linear metre, corner slips, spacers, etc.),
  // treat it as an ancillary product (Stage 7)
  if (
    notes.includes('lin mtr') ||
    notes.includes('lin. mtr') ||
    notes.includes('linear') ||
    notes.includes('lin m') ||
    notes.includes('per lm') ||
    notes.includes('per l/m') ||
    notes.includes('/lm') ||
    desc.includes('corner slip') ||
    desc.includes('pistol corner') ||
    unit.includes('lin mtr') ||
    unit.includes('linear') ||
    desc.includes('spacer')
  ) {
    return ALL_APPLICATION_STAGES[6]; // Stage 7: Ancillaries
  }

  // =========================================================================
  // PRIORITY 1: USE COLUMN C (CATEGORY) FROM THE SPREADSHEET FIRST
  // =========================================================================
  if (cat) {
    // Stage 1: Bedding Adhesive
    if (
      cat === 'adhesives' ||
      cat === 'adhesive' ||
      cat.includes('adhesive') ||
      cat.includes('bedding') ||
      cat.includes('bonding')
    ) {
      return ALL_APPLICATION_STAGES[0];
    }

    // Stage 3: Mechanical Fixings
    if (
      cat.includes('fixing') ||
      cat.includes('fastener') ||
      cat.includes('anchor') ||
      cat.includes('screw') ||
      cat.includes('washer')
    ) {
      return ALL_APPLICATION_STAGES[2];
    }

    // Stage 4: Basecoat & Mesh
    if (
      cat.includes('basecoat') ||
      cat.includes('scrim') ||
      cat.includes('mesh') ||
      cat.includes('reinforc')
    ) {
      return ALL_APPLICATION_STAGES[3];
    }

    // Stage 5: Primers
    if (cat.includes('primer') || cat.includes('keying')) {
      return ALL_APPLICATION_STAGES[4];
    }

    // Stage 2: Insulation
    if (
      cat.includes('insulation') ||
      cat.includes('mineral wool') ||
      cat.includes('rockwool') ||
      cat === 'eps' ||
      cat === 'insulation slab'
    ) {
      return ALL_APPLICATION_STAGES[1];
    }

    // Stage 6: Topcoats & Finishes
    if (
      cat.includes('finish') ||
      cat.includes('topcoat') ||
      cat.includes('silicone') ||
      cat.includes('acrylic') ||
      cat.includes('render') ||
      cat.includes('brick') ||
      cat.includes('paint') ||
      cat.includes('mineral')
    ) {
      return ALL_APPLICATION_STAGES[5];
    }

    // Stage 7: Ancillaries
    if (
      cat.includes('ancillar') ||
      cat.includes('bead') ||
      cat.includes('trim') ||
      cat.includes('rail') ||
      cat.includes('track') ||
      cat.includes('profile') ||
      cat.includes('tape') ||
      cat.includes('sealant') ||
      cat.includes('sundr') ||
      cat.includes('accessori')
    ) {
      return ALL_APPLICATION_STAGES[6];
    }
  }

  // =========================================================================
  // PRIORITY 2: FALLBACK TO DESCRIPTION / SKU (ONLY IF COLUMN C IS MISSING)
  // =========================================================================
  // 1. ADHESIVE (Bedding adhesive applied to substrate/board back)
  if (
    desc.includes('bedding adhesive') ||
    desc.includes('bonding adhesive') ||
    desc.includes('bedding mortar') ||
    desc.includes('insulation bedding') ||
    sku.includes('iba') ||
    (desc.includes('bedding') && !desc.includes('rail'))
  ) {
    return ALL_APPLICATION_STAGES[0];
  }

  // 2. INSULATION (Slabs / boards)
  if (
    desc.includes('insulation slab') ||
    desc.includes('mineral wool slab') ||
    desc.includes('frontrock') ||
    desc.includes('rainscreen') ||
    sku.startsWith('iso-') ||
    sku === '500069' ||
    sku === '500072'
  ) {
    return ALL_APPLICATION_STAGES[1];
  }

  // 3. MECHANICAL FIXINGS (Anchors, screws, washers into substrate)
  if (
    desc.includes('mechanical fixing') ||
    desc.includes('fixing') ||
    desc.includes('screw') ||
    desc.includes('washer') ||
    sku.startsWith('fix-') ||
    sku.startsWith('400') ||
    desc.includes('jt2-') ||
    desc.includes('r-wx-')
  ) {
    return ALL_APPLICATION_STAGES[2];
  }

  // 4. BASECOAT & MESH (Scrim adhesive & alkali resistant glass fibre mesh)
  if (
    desc.includes('scrim adhesive') ||
    desc.includes('scrim cloth') ||
    desc.includes('mesh') ||
    desc.includes('basecoat u.f') ||
    desc.includes('basecoat') ||
    desc.includes('styrobond') ||
    desc.includes('heck k+a') ||
    desc.includes('dubbing') ||
    sku.startsWith('msh-') ||
    sku === '1300083' ||
    sku === '700021' ||
    sku === '700026'
  ) {
    return ALL_APPLICATION_STAGES[3];
  }

  // 5. PRIMERS (Keying & substrate primers)
  if (
    desc.includes('primer') ||
    sku.startsWith('ren-10') ||
    sku.includes('prim')
  ) {
    return ALL_APPLICATION_STAGES[4];
  }

  // 6. TOPCOAT RENDERS & FINISHES (Silicone K finish, mineral render, brick slips & pointing mortar, paint)
  if (
    !desc.includes('rail') &&
    !desc.includes('track') &&
    !desc.includes('bead') &&
    !desc.includes('trim') &&
    !desc.includes('profile') &&
    !sku.startsWith('bsr-') &&
    !sku.startsWith('trk-') &&
    (
      desc.includes('silicone') ||
      desc.includes('topcoat') ||
      desc.includes('finish') ||
      desc.includes('mineral render') ||
      desc.includes('brick slip') ||
      desc.includes('pointing mortar') ||
      desc.includes('dash receiver') ||
      desc.includes('aggregate dash') ||
      desc.includes('epsirend') ||
      desc.includes('epsicoats') ||
      desc.includes('mortar coat') ||
      sku.startsWith('ren-20') ||
      sku.startsWith('11014') ||
      sku === 'zg0056' ||
      sku === '1300019'
    )
  ) {
    return ALL_APPLICATION_STAGES[5];
  }

  // 7. ANCILLARIES
  return ALL_APPLICATION_STAGES[6];
}

/**
 * Checks whether a product or quote line item belongs to the Ancillaries group (Stage 7).
 * Ancillaries cannot be calculated on a m² rate and are treated as individual item prices.
 */
export function isAncillaryItem(product: {
  sku?: string;
  description: string;
  category?: string;
  coverageNotes?: string;
  unit?: string;
  ratePerM2?: number;
  consumptionRatePerM2?: number;
}): boolean {
  const notes = (product.coverageNotes || '').toLowerCase();
  const desc = (product.description || '').toLowerCase();
  const unit = (product.unit || '').toLowerCase();

  // Linear metre and non-m² products are always ancillary
  if (
    notes.includes('lin mtr') ||
    notes.includes('lin. mtr') ||
    notes.includes('linear') ||
    notes.includes('lin m') ||
    notes.includes('per lm') ||
    notes.includes('per l/m') ||
    notes.includes('/lm') ||
    desc.includes('corner slip') ||
    desc.includes('pistol corner') ||
    unit.includes('lin mtr') ||
    unit.includes('linear') ||
    desc.includes('spacer')
  ) {
    return true;
  }

  const stage = getProductApplicationStage(product);
  return stage.stageOrder === 7;
}

/**
 * Separates items into main façade system items (stages 1-6, calculated per m²)
 * and ancillary items (stage 7, treated as individual item prices).
 */
export function separateSystemAndAncillaryItems(items: QuoteLineItem[]): {
  systemItems: QuoteLineItem[];
  ancillaryItems: QuoteLineItem[];
} {
  const sorted = sortQuoteItemsByApplicationOrder(items);
  return {
    systemItems: sorted.filter((i) => !isAncillaryItem(i)),
    ancillaryItems: sorted.filter((i) => isAncillaryItem(i)),
  };
}

/**
 * Sorts quote line items strictly in application sequence:
 * 1. Adhesive -> 2. Insulation -> 3. Fixings -> 4. Basecoat & Mesh -> 5. Primers -> 6. Topcoat -> 7. Ancillaries
 * And ensures all items in stage 7 have category listed as "Ancillaries"
 */
export function sortQuoteItemsByApplicationOrder(items: QuoteLineItem[]): QuoteLineItem[] {
  return [...items].map(item => {
    const stage = getProductApplicationStage(item);
    // Explicit rule: list the rest as ancillaries in the quote
    const updatedCategory = stage.stageOrder === 7 ? 'Ancillaries' : stage.categoryDisplay;
    return {
      ...item,
      category: updatedCategory,
    };
  }).sort((a, b) => {
    const stageA = getProductApplicationStage(a);
    const stageB = getProductApplicationStage(b);

    if (stageA.stageOrder !== stageB.stageOrder) {
      return stageA.stageOrder - stageB.stageOrder;
    }

    // Secondary sort: preserve logical flow (e.g. thickness or sku)
    return a.description.localeCompare(b.description);
  });
}

/**
 * Sorts generic product catalog in application sequence
 */
export function sortProductsByApplicationOrder(products: RockwoolProduct[]): RockwoolProduct[] {
  return [...products].sort((a, b) => {
    const stageA = getProductApplicationStage(a);
    const stageB = getProductApplicationStage(b);

    if (stageA.stageOrder !== stageB.stageOrder) {
      return stageA.stageOrder - stageB.stageOrder;
    }

    return a.description.localeCompare(b.description);
  });
}

export type ProductTypeCategory = 
  | 'adhesive'
  | 'insulation'
  | 'fixing'
  | 'basecoat'
  | 'mesh'
  | 'primer'
  | 'finish'
  | 'ancillary_track'
  | 'ancillary_bead'
  | 'ancillary_seal'
  | 'ancillary_other';

/**
 * Categorizes a product into its precise functional system role.
 * Uses Column C (Category) from the spreadsheet FIRST.
 */
export function getProductTypeCategory(product: {
  sku?: string;
  description: string;
  category?: string;
}): ProductTypeCategory {
  const cat = (product.category || '').trim().toLowerCase();
  const desc = (product.description || '').toLowerCase();
  const sku = (product.sku || '').toLowerCase();

  // 1. Column C (Category) from spreadsheet evaluated FIRST
  if (cat) {
    if (
      cat === 'adhesives' ||
      cat === 'adhesive' ||
      cat.includes('adhesive') ||
      cat.includes('bedding') ||
      cat.includes('bonding')
    ) {
      return 'adhesive';
    }

    if (
      cat.includes('fixing') ||
      cat.includes('fastener') ||
      cat.includes('anchor') ||
      cat.includes('screw') ||
      cat.includes('washer')
    ) {
      return 'fixing';
    }

    if (cat.includes('mesh')) {
      return 'mesh';
    }

    if (cat.includes('basecoat') || cat.includes('scrim')) {
      return 'basecoat';
    }

    if (cat.includes('primer') || cat.includes('keying')) {
      return 'primer';
    }

    if (
      cat.includes('insulation') ||
      cat.includes('mineral wool') ||
      cat.includes('rockwool') ||
      cat === 'eps' ||
      cat === 'insulation slab'
    ) {
      return 'insulation';
    }

    if (
      cat.includes('finish') ||
      cat.includes('topcoat') ||
      cat.includes('silicone') ||
      cat.includes('acrylic') ||
      cat.includes('render') ||
      cat.includes('brick') ||
      cat.includes('paint') ||
      cat.includes('mineral')
    ) {
      return 'finish';
    }

    if (cat.includes('track') || cat.includes('rail')) {
      return 'ancillary_track';
    }
    if (cat.includes('bead') || cat.includes('trim') || cat.includes('profile')) {
      return 'ancillary_bead';
    }
    if (cat.includes('seal') || cat.includes('tape')) {
      return 'ancillary_seal';
    }
    if (cat.includes('ancillar') || cat.includes('sundr') || cat.includes('accessories')) {
      return 'ancillary_other';
    }
  }

  // 2. Fallback when Column C is missing
  if (
    desc.includes('bedding adhesive') ||
    desc.includes('bonding adhesive') ||
    desc.includes('bedding mortar') ||
    desc.includes('insulation bedding') ||
    desc.includes('insulation adhesive') ||
    desc.includes('substrate adhesive') ||
    sku.includes('iba') ||
    (desc.includes('bedding') && !desc.includes('rail')) ||
    ((desc.includes('adhesive') || desc.includes('bonding')) &&
      !desc.includes('scrim') &&
      !desc.includes('brick slip') &&
      !desc.includes('tape') &&
      !desc.includes('rail') &&
      !desc.includes('bead'))
  ) {
    return 'adhesive';
  }

  if (
    desc.includes('insulation slab') ||
    desc.includes('mineral wool slab') ||
    desc.includes('frontrock') ||
    desc.includes('rainscreen') ||
    sku.startsWith('iso-') ||
    sku === '500069' ||
    sku === '500072'
  ) {
    return 'insulation';
  }

  if (
    desc.includes('mechanical fixing') ||
    desc.includes('fixing') ||
    desc.includes('screw') ||
    desc.includes('washer') ||
    sku.startsWith('fix-') ||
    sku.startsWith('400') ||
    desc.includes('jt2-') ||
    desc.includes('r-wx-')
  ) {
    return 'fixing';
  }

  if (
    desc.includes('mesh') ||
    desc.includes('scrim cloth') ||
    desc.includes('glass fibre') ||
    sku.startsWith('msh-') ||
    sku === '700021' ||
    sku === '700026'
  ) {
    return 'mesh';
  }

  if (
    desc.includes('scrim adhesive') ||
    desc.includes('basecoat') ||
    desc.includes('styrobond') ||
    desc.includes('heck k+a') ||
    desc.includes('dubbing') ||
    desc.includes('reinforcing mortar') ||
    sku === '1300083'
  ) {
    return 'basecoat';
  }

  if (
    desc.includes('primer') ||
    desc.includes('stabilising') ||
    desc.includes('key coat') ||
    sku.startsWith('ren-10') ||
    sku.includes('prim')
  ) {
    return 'primer';
  }

  if (
    !desc.includes('rail') &&
    !desc.includes('track') &&
    !desc.includes('bead') &&
    !desc.includes('trim') &&
    !desc.includes('profile') &&
    !sku.startsWith('bsr-') &&
    !sku.startsWith('trk-') &&
    (
      desc.includes('silicone') ||
      desc.includes('topcoat') ||
      desc.includes('finish') ||
      desc.includes('mineral render') ||
      desc.includes('brick slip') ||
      desc.includes('pointing mortar') ||
      desc.includes('dash receiver') ||
      desc.includes('aggregate dash') ||
      desc.includes('epsirend') ||
      desc.includes('epsicoats') ||
      desc.includes('mortar coat') ||
      sku.startsWith('ren-20') ||
      sku.startsWith('11014') ||
      sku === 'zg0056' ||
      sku === '1300019'
    )
  ) {
    return 'finish';
  }

  if (desc.includes('rail') || desc.includes('track') || desc.includes('connector')) {
    return 'ancillary_track';
  }
  if (desc.includes('bead') || desc.includes('trim') || desc.includes('joint')) {
    return 'ancillary_bead';
  }
  if (desc.includes('tape') || desc.includes('sealant') || desc.includes('silicone white')) {
    return 'ancillary_seal';
  }

  return 'ancillary_other';
}

/**
 * Extracts insulation board thickness from description or SKU (e.g. 100mm, 150mm)
 */
export function extractInsulationThickness(desc: string): string | null {
  const match = desc.match(/(\d{2,3})\s*mm/i);
  return match ? `${match[1]}mm` : null;
}

/**
 * Extracts fixing length/type identifier (e.g. 160mm, washer, screw)
 */
export function extractFixingIdentifier(product: { sku?: string; description: string }): string {
  const desc = product.description.toLowerCase();
  if (desc.includes('washer')) return 'washer';
  if (desc.includes('screw')) return 'screw';
  const match = desc.match(/(\d{2,3})\s*mm/i);
  if (match) return `${match[1]}mm`;
  return product.sku || product.description;
}

/**
 * Strict Specification Rule:
 * Only add products from the specification ONCE for each type of item
 * (adhesive, basecoat, mesh, primer, finish, etc.).
 * The only products that may have more than 1 are:
 * 1. Insulation - IF multiple distinct sizes/thicknesses are listed in the spec.
 * 2. Fixings - if multiple sizes or fixing types are listed.
 */
export function deduplicateProductsBySpecificationRules<T extends { sku?: string; description: string; category?: string }>(
  items: T[]
): T[] {
  const result: T[] = [];
  const seenTypes = new Set<string>();
  const seenInsulationThicknesses = new Set<string>();
  const seenFixingIds = new Set<string>();

  for (const item of items) {
    const typeCat = getProductTypeCategory(item);

    // Insulation: allowed more than 1 ONLY if multiple distinct thicknesses/sizes
    if (typeCat === 'insulation') {
      const thickness = extractInsulationThickness(item.description) || item.sku || 'default';
      if (!seenInsulationThicknesses.has(thickness)) {
        seenInsulationThicknesses.add(thickness);
        result.push(item);
      }
      continue;
    }

    // Fixings: allowed more than 1 if multiple lengths/types
    if (typeCat === 'fixing') {
      const fixingId = extractFixingIdentifier(item);
      if (!seenFixingIds.has(fixingId)) {
        seenFixingIds.add(fixingId);
        result.push(item);
      }
      continue;
    }

    // Ancillaries: allow at most 1 per specific sub-type (1 track, 1 bead, 1 seal, 1 other)
    if (typeCat.startsWith('ancillary_')) {
      if (!seenTypes.has(typeCat)) {
        seenTypes.add(typeCat);
        result.push(item);
      }
      continue;
    }

    // Basecoat, Adhesive, Mesh, Primer, Finish: STRICTLY ONLY ONCE!
    if (!seenTypes.has(typeCat)) {
      seenTypes.add(typeCat);
      result.push(item);
    }
  }

  return result;
}

/**
 * Strict Specification Rule for Match Objects:
 * Dedupes match objects while preserving confidence and notes.
 * Guarantees basecoat, adhesive, finish, primer, and mesh appear ONLY ONCE.
 * Only insulation (multiple sizes) or fixings may have more than 1.
 */
export function deduplicateSpecificationMatches<T extends { product: RockwoolProduct }>(
  matches: T[]
): T[] {
  const result: T[] = [];
  const seenTypes = new Set<string>();
  const seenInsulationThicknesses = new Set<string>();
  const seenFixingIds = new Set<string>();

  for (const match of matches) {
    const item = match.product;
    const typeCat = getProductTypeCategory(item);

    // Insulation: allowed more than 1 ONLY if multiple distinct thicknesses/sizes
    if (typeCat === 'insulation') {
      const thickness = extractInsulationThickness(item.description) || item.sku || 'default';
      if (!seenInsulationThicknesses.has(thickness)) {
        seenInsulationThicknesses.add(thickness);
        result.push(match);
      }
      continue;
    }

    // Fixings: allowed more than 1 if multiple lengths/types
    if (typeCat === 'fixing') {
      const fixingId = extractFixingIdentifier(item);
      if (!seenFixingIds.has(fixingId)) {
        seenFixingIds.add(fixingId);
        result.push(match);
      }
      continue;
    }

    // Ancillaries: allow at most 1 per specific sub-type (1 track, 1 bead, 1 seal, 1 other)
    if (typeCat.startsWith('ancillary_')) {
      if (!seenTypes.has(typeCat)) {
        seenTypes.add(typeCat);
        result.push(match);
      }
      continue;
    }

    // Basecoat, Adhesive, Mesh, Primer, Finish: STRICTLY ONLY ONCE!
    if (!seenTypes.has(typeCat)) {
      seenTypes.add(typeCat);
      result.push(match);
    }
  }

  return result;
}
