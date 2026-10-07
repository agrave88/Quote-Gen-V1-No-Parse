import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Calculator, 
  Percent, 
  ArrowUpDown, 
  Info, 
  Layers, 
  FileDown, 
  Edit3, 
  Sliders, 
  Check, 
  HelpCircle,
  PackagePlus,
  RefreshCw,
  Building,
  MapPin,
  Calendar,
  Sparkles,
  TrendingUp,
  Search,
  CheckCircle2,
  Lock,
  EyeOff,
  Ban,
  Copy,
  Clock,
  Save,
  ExternalLink,
  AlertCircle,
  Download,
  FilePlus,
  GitBranch,
  BookOpen
} from 'lucide-react';
import { QuoteLineItem, QuoteMeta, RockwoolProduct, CustomerRecord, ProjectRecord, PriceBook } from '../types/quote';
import { 
  getAllPriceBooks, 
  getPriceBookByCode, 
  getDefaultPriceBook,
  resolvePriceBookForQuote, 
  resolveProductPricing, 
  resolveCatalogForPriceBook 
} from '../utils/priceBookManager';
import { exportQuoteToClientPdf } from '../utils/pdfExport';
import { 
  generateFormattedQuoteNumber, 
  updateQuoteNumberInitials,
  parseQuoteReference,
  incrementQuoteRevision,
  normalizeQuoteReference
} from '../utils/quoteNumber';
import { 
  initAuth, 
  googleSignIn, 
  getAccessToken, 
  getCurrentUser,
  clearAccessToken
} from '../services/firebaseAuth';
import { 
  saveQuoteToGoogleSheet, 
  loadQuoteFromGoogleSheet, 
  listQuotesFromGoogleSheet, 
  updateQuoteDealStatusInGoogleSheet,
  ensureProjectExistsInGoogleSheet,
  QuoteSummaryRecord 
} from '../services/googleSheetsService';
import { 
  toInputDateFormat, 
  toDisplayDateFormat, 
  addDaysToDate, 
  getDaysDifference,
  getLocalIsoDate
} from '../utils/dateUtils';
import { DEFAULT_STANDARD_TERMS } from '../constants/terms';
import { getInitialCustomers } from '../utils/customerSync';
import { getInitialProjects } from '../utils/projectSync';
import { CustomerSelector } from './CustomerSelector';
import { ProjectSelector } from './ProjectSelector';
import { 
  sortQuoteItemsByApplicationOrder, 
  getProductApplicationStage, 
  sortProductsByApplicationOrder,
  separateSystemAndAncillaryItems,
  isAncillaryItem,
  isUnitCoversLessThanOneM2,
  calculateItemPricePerM2,
  calculateItemQuantity,
  isWasherProduct,
  isFixingProduct,
  getIndividualFixingsPerM2,
  calculateWasherRate,
  ALL_APPLICATION_STAGES
} from '../utils/applicationOrder';
import confetti from 'canvas-confetti';
import { PERMANENT_SHEET_ID } from '../utils/backgroundSheetSync';

/**
 * Returns color-coordinated styles for quote lines based on discount from list percentage:
 * - <= 10%: Emerald Green (Standard / low discount, maximum margin retained)
 * - 11% - 20%: Lime / Light Green (Commercial preferred discount)
 * - 21% - 30%: Amber / Yellow (Trade contractor discount)
 * - 31% - 40%: Orange (High commercial discount)
 * - > 40%: Rose / Red (Deep discount from list)
 */
function getDiscountColorStyle(discountPct: number) {
  if (discountPct <= 10) {
    return {
      rowBg: 'bg-emerald-50/50 hover:bg-emerald-100/60',
      borderLeft: 'border-l-4 border-l-[#059669]',
      badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      inputBorder: 'border-emerald-300 focus:border-[#059669] text-emerald-900',
      dotColor: 'bg-[#059669]',
      label: 'Standard (≤10%)',
    };
  } else if (discountPct <= 20) {
    return {
      rowBg: 'bg-lime-50/45 hover:bg-lime-100/55',
      borderLeft: 'border-l-4 border-l-[#65A30D]',
      badgeBg: 'bg-lime-100 text-lime-900 border-lime-300',
      inputBorder: 'border-lime-300 focus:border-[#65A30D] text-lime-900',
      dotColor: 'bg-[#65A30D]',
      label: 'Commercial (11–20%)',
    };
  } else if (discountPct <= 30) {
    return {
      rowBg: 'bg-amber-50/45 hover:bg-amber-100/60',
      borderLeft: 'border-l-4 border-l-[#D97706]',
      badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
      inputBorder: 'border-amber-300 focus:border-[#D97706] text-amber-900',
      dotColor: 'bg-[#D97706]',
      label: 'Trade (21–30%)',
    };
  } else if (discountPct <= 40) {
    return {
      rowBg: 'bg-orange-50/55 hover:bg-orange-100/65',
      borderLeft: 'border-l-4 border-l-[#EA580C]',
      badgeBg: 'bg-orange-100 text-orange-900 border-orange-300',
      inputBorder: 'border-orange-300 focus:border-[#EA580C] text-orange-900',
      dotColor: 'bg-[#EA580C]',
      label: 'High (31–40%)',
    };
  } else {
    return {
      rowBg: 'bg-rose-50/65 hover:bg-rose-100/75',
      borderLeft: 'border-l-4 border-l-[#DC2626]',
      badgeBg: 'bg-rose-100 text-rose-900 border-rose-300',
      inputBorder: 'border-rose-300 focus:border-[#DC2626] text-rose-900',
      dotColor: 'bg-[#DC2626]',
      label: 'Deep (>40%)',
    };
  }
}

/**
 * Computes a lightweight deterministic fingerprint of quote metadata and items
 * to accurately detect modifications since the quote was loaded or saved.
 */
function computeQuoteFingerprint(meta: QuoteMeta, items: QuoteLineItem[]): string {
  const metaSubset = {
    projectName: meta.projectName,
    projectLocation: meta.projectLocation,
    projectReference: meta.projectReference,
    clientCompany: meta.clientCompany,
    contactPerson: meta.contactPerson,
    clientName: meta.clientName,
    clientEmail: meta.clientEmail,
    clientPhone: meta.clientPhone,
    clientAddress: meta.clientAddress,
    clientCity: meta.clientCity,
    clientPostcode: meta.clientPostcode,
    areaM2: meta.areaM2,
    wasteagePercent: meta.wasteagePercent,
    overallDiscountPercent: meta.overallDiscountPercent,
    includeInstallationEstimate: meta.includeInstallationEstimate,
    installationRatePerM2: meta.installationRatePerM2,
    numberOfPhases: meta.numberOfPhases,
    phaseDurationMonths: meta.phaseDurationMonths,
    expectedStartDate: meta.expectedStartDate,
    validUntil: meta.validUntil,
    date: meta.date,
  };

  const itemsSubset = items.map((i) => ({
    sku: i.sku,
    finalQuantity: i.finalQuantity,
    unitSellPrice: i.unitSellPrice,
    discountPercent: i.discountPercent,
    excludeFromM2Rate: i.excludeFromM2Rate,
  }));

  return JSON.stringify({ meta: metaSubset, items: itemsSubset });
}

/**
 * Translates technical error messages into a single, crystal-clear layman sentence
 */
function getLaymanLoadErrorMessage(rawError: string, quoteRef: string): {
  title: string;
  explanation: string;
  isPermissionIssue?: boolean;
} {
  const lower = (rawError || '').toLowerCase();
  const trimmedRef = (quoteRef || '').trim();

  if (!trimmedRef) {
    return {
      title: 'Quote Reference Missing',
      explanation: 'Please enter or paste a quote reference number into the REF box before clicking Load Quote.',
    };
  }

  if (lower.includes('not found') || lower.includes('was not found')) {
    return {
      title: 'Quote Not Found',
      explanation: `We couldn't find quote "${trimmedRef}" in your spreadsheet, so please check for any typing mistakes in the reference number.`,
    };
  }

  if (
    lower.includes('permission') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('lacks sheets') ||
    lower.includes('access token') ||
    lower.includes('cancelled')
  ) {
    return {
      title: 'Google Permission Needed',
      explanation: 'Google did not grant access to open your spreadsheet, so please sign in and ensure the Google Sheets permission box is ticked.',
      isPermissionIssue: true,
    };
  }

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('offline')) {
    return {
      title: 'Connection Issue',
      explanation: 'We could not reach Google Sheets due to an internet connection interruption, so please check your connection and try again.',
    };
  }

  return {
    title: 'Unable to Load Quote',
    explanation: `We couldn't open quote "${trimmedRef}" because of an unexpected issue reading the spreadsheet.`,
  };
}

interface QuoteEditorProps {
  items: QuoteLineItem[];
  meta: QuoteMeta;
  availableProducts: RockwoolProduct[];
  customers?: CustomerRecord[];
  projects?: ProjectRecord[];
  priceBooks?: PriceBook[];
  onUpdateMeta: (meta: QuoteMeta) => void;
  onUpdateItems: (items: QuoteLineItem[]) => void;
  onAddItem: (product: RockwoolProduct) => void;
  onAddMultipleItems?: (products: RockwoolProduct[]) => void;
  onRemoveItem: (id: string) => void;
}

export const QuoteEditor: React.FC<QuoteEditorProps> = ({
  items,
  meta,
  availableProducts,
  customers = [],
  projects = [],
  priceBooks = [],
  onUpdateMeta,
  onUpdateItems,
  onAddItem,
  onAddMultipleItems,
  onRemoveItem,
}) => {
  const [selectedAddProductId, setSelectedAddProductId] = useState<string>('');
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [showProductPickerModal, setShowProductPickerModal] = useState<boolean>(false);
  const [confirmingClearAll, setConfirmingClearAll] = useState<boolean>(false);
  const [selectedProductsMap, setSelectedProductsMap] = useState<Map<string, RockwoolProduct>>(new Map());
  const activeDiscount = meta.overallDiscountPercent ?? meta.overallMarginPercent ?? 0;
  const [customDiscountInput, setCustomDiscountInput] = useState<string>(activeDiscount.toString());
  const [areaInput, setAreaInput] = useState<string>(meta.areaM2.toString());
  const [wastageInput, setWastageInput] = useState<string>(meta.wasteagePercent.toString());
  const [unitCountInput, setUnitCountInput] = useState<string>(
    meta.numberOfUnits !== undefined && meta.numberOfUnits !== null ? meta.numberOfUnits.toString() : ''
  );
  const [unitSizeInput, setUnitSizeInput] = useState<string>(
    meta.unitSizeM2 !== undefined && meta.unitSizeM2 !== null ? meta.unitSizeM2.toString() : ''
  );
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showUnpricedWarningModal, setShowUnpricedWarningModal] = useState<boolean>(false);
  const [showNewQuotePromptModal, setShowNewQuotePromptModal] = useState<boolean>(false);
  const [showLoadQuoteModal, setShowLoadQuoteModal] = useState<boolean>(false);
  const [manualQuoteInput, setManualQuoteInput] = useState<string>('');
  const [quoteSearchTerm, setQuoteSearchTerm] = useState<string>('');
  const [showLatestOnly, setShowLatestOnly] = useState<boolean>(true);
  const [isFetchingQuotesList, setIsFetchingQuotesList] = useState<boolean>(false);
  const [sheetQuotesList, setSheetQuotesList] = useState<QuoteSummaryRecord[]>([]);
  const [copiedRef, setCopiedRef] = useState<boolean>(false);
  const [lastSavedDealState, setLastSavedDealState] = useState<{
    dealStatus: 'Won' | 'Lost' | 'Pending';
    winLikelihood: number;
  } | null>(null);
  const [isSavingDealStatus, setIsSavingDealStatus] = useState<boolean>(false);
  const [dealSyncFeedback, setDealSyncFeedback] = useState<string | null>(null);
  const dealSyncTimerRef = useRef<any>(null);
  const [loadErrorModal, setLoadErrorModal] = useState<{
    title: string;
    message: string;
    quoteRef?: string;
    isPermissionIssue?: boolean;
  } | null>(null);
  const [showInternalFinancials, setShowInternalFinancials] = useState<boolean>(true);
  const [showMarginColumn, setShowMarginColumn] = useState<boolean>(false);
  const [showGrossProfitColumn, setShowGrossProfitColumn] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    sheetUrl?: string;
  } | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(false);
  const [loadFeedback, setLoadFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  // Tracks state snapshot fingerprint from last load or save
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(null);
  // Tracks the quote reference from the last load or save
  const [loadedSnapshotRef, setLoadedSnapshotRef] = useState<string | null>(null);
  const [, setGoogleUser] = useState<any>(null);

  // ---------------------------------------------------------------------------
  // COMMERCIAL PRICE BOOK MANAGEMENT
  // ---------------------------------------------------------------------------
  const availablePriceBooks = useMemo(() => {
    return priceBooks && priceBooks.length > 0 ? priceBooks : getAllPriceBooks();
  }, [priceBooks]);

  const activePriceBook = useMemo(() => {
    if (meta.priceBookCode) {
      const match = getPriceBookByCode(meta.priceBookCode);
      if (match) return match;
    }
    return resolvePriceBookForQuote(meta.date);
  }, [meta.priceBookCode, meta.date]);

  // Ensure quote meta tracks the resolved price book
  useEffect(() => {
    if ((!meta.priceBookCode || meta.priceBookCode !== activePriceBook.code) && !meta.commercialSnapshot) {
      onUpdateMeta({
        ...meta,
        priceBookCode: activePriceBook.code,
        priceBookName: activePriceBook.name,
      });
    }
  }, [activePriceBook, meta.priceBookCode, meta.commercialSnapshot]);

  // Recalculates unfrozen line items to match the newly selected price book's rates
  const applyPriceBookToQuoteItems = useCallback((targetBookCode: string) => {
    if (!items || items.length === 0) return;

    let hasChanges = false;
    const updated = items.map((item) => {
      // CRITICAL: Historical frozen snapshot records must NEVER be mutated
      if (item.commercialSnapshot) return item;

      const matchedProd = availableProducts.find(
        (p) => p.sku.trim().toLowerCase() === item.sku.trim().toLowerCase()
      );
      if (!matchedProd) return item;

      const pricing = resolveProductPricing(matchedProd, targetBookCode);
      const newListPrice = pricing.listPrice;
      const discount = item.discountPercent ?? item.marginPercent ?? 0;
      const discountFactor = (100 - discount) / 100;
      const unitSellPrice = Math.round(newListPrice * discountFactor * 100) / 100;
      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);
      const costPrice = pricing.costPrice !== undefined ? pricing.costPrice : item.costPrice;
      const marginPercent = costPrice !== undefined && unitSellPrice > 0
        ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
        : undefined;

      const qty = item.finalQuantity;
      hasChanges = true;

      return {
        ...item,
        listPrice: newListPrice,
        unitCost: newListPrice,
        costPrice,
        marginPercent,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(qty * newListPrice * 100) / 100,
        totalSell: Math.round(qty * unitSellPrice * 100) / 100,
      };
    });

    if (hasChanges) {
      onUpdateItems(updated);
    }
  }, [items, availableProducts, onUpdateItems]);

  const handlePriceBookChange = (code: string) => {
    const book = getPriceBookByCode(code) || activePriceBook;
    onUpdateMeta({
      ...meta,
      priceBookCode: book.code,
      priceBookName: book.name,
    });
    applyPriceBookToQuoteItems(book.code);
  };

  // Computes whether current quote has been modified since it was loaded or saved
  const isDirty = useMemo(() => {
    if (!lastSavedFingerprint) {
      return true; // Brand new, never saved
    }
    const currentFingerprint = computeQuoteFingerprint(meta, items);
    return currentFingerprint !== lastSavedFingerprint;
  }, [meta, items, lastSavedFingerprint]);

  // Updates only the commercial deal outcome and win likelihood for the quote in the spreadsheet in-place
  const syncDealStatusToSheet = useCallback(
    (newStatus: 'Won' | 'Lost' | 'Pending', newLikelihood: number) => {
      if (dealSyncTimerRef.current) {
        clearTimeout(dealSyncTimerRef.current);
      }

      dealSyncTimerRef.current = setTimeout(async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;

          setDealSyncFeedback('Updating sheet...');
          const res = await updateQuoteDealStatusInGoogleSheet(
            token,
            meta.quoteNumber,
            newStatus,
            newLikelihood
          );
          if (res.success) {
            setLastSavedDealState({
              dealStatus: newStatus,
              winLikelihood: newLikelihood,
            });
            setDealSyncFeedback('✓ Updated in sheet');
            setTimeout(() => setDealSyncFeedback(null), 3000);
            const baseKey = parseQuoteReference(meta.quoteNumber).baseReference.toUpperCase();
            setSheetQuotesList((prev) =>
              prev.map((q) =>
                q.baseReference.toUpperCase() === baseKey
                  ? { ...q, dealStatus: newStatus, winLikelihood: newLikelihood }
                  : q
              )
            );
          } else {
            setDealSyncFeedback(null);
          }
        } catch {
          setDealSyncFeedback(null);
        }
      }, 500);
    },
    [meta.quoteNumber]
  );

  useEffect(() => {
    setAreaInput(meta.areaM2.toString());
  }, [meta.areaM2]);

  useEffect(() => {
    setWastageInput(meta.wasteagePercent.toString());
  }, [meta.wasteagePercent]);

  // Ensure carriage terms wording matches updated standard
  useEffect(() => {
    if (
      meta.notesAndTerms &&
      (meta.notesAndTerms.includes('Order value of £1,999 or below') ||
        meta.notesAndTerms.includes('Order value of 1999 or below') ||
        meta.notesAndTerms.includes('order value of 1999 or below'))
    ) {
      const updatedTerms = meta.notesAndTerms
        .replace(/Order value of £1,999 or below/gi, 'Order value below £2000')
        .replace(/Order value of 1999 or below/gi, 'Order value below £2000');
      onUpdateMeta({
        ...meta,
        notesAndTerms: updatedTerms,
      });
    }
  }, [meta.notesAndTerms]);

  // Listen to Google Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, _token) => {
        setGoogleUser(user);
      },
      () => {
        setGoogleUser(null);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Fallback to verified 106 customers if prop empty
  const activeCustomers = useMemo(() => {
    return customers && customers.length > 0 ? customers : getInitialCustomers();
  }, [customers]);

  // Fallback to initial project directory if prop empty
  const activeProjects = useMemo(() => {
    return projects && projects.length > 0 ? projects : getInitialProjects();
  }, [projects]);

  // Handle project selection from spreadsheet directory
  const handleSelectProject = (project: ProjectRecord) => {
    const projectBook = project.assignedPriceBookCode
      ? getPriceBookByCode(project.assignedPriceBookCode)
      : undefined;
    const finalBook = projectBook || activePriceBook;

    if (project.areaM2 && project.areaM2 !== meta.areaM2) {
      setAreaInput(project.areaM2.toString());
      handleAreaChange(project.areaM2, {
        projectName: project.projectName,
        projectReference: project.projectReference || meta.projectReference,
        projectLocation: project.projectLocation || meta.projectLocation,
        clientName: project.clientName || meta.clientName,
        clientCompany: project.clientCompany || meta.clientCompany,
        contactPerson: project.contactPerson || meta.contactPerson,
        priceBookCode: finalBook.code,
        priceBookName: finalBook.name,
      });
    } else {
      onUpdateMeta({
        ...meta,
        projectName: project.projectName,
        projectReference: project.projectReference || meta.projectReference,
        projectLocation: project.projectLocation || meta.projectLocation,
        clientName: project.clientName || meta.clientName,
        clientCompany: project.clientCompany || meta.clientCompany,
        contactPerson: project.contactPerson || meta.contactPerson,
        priceBookCode: finalBook.code,
        priceBookName: finalBook.name,
      });
    }

    if (projectBook && projectBook.code !== meta.priceBookCode) {
      applyPriceBookToQuoteItems(projectBook.code);
    }
  };

  // Handle clearing project selection
  const handleClearProject = () => {
    onUpdateMeta({
      ...meta,
      projectName: '',
      projectReference: '',
      projectLocation: '',
    });
  };

  // Handle customer selection from spreadsheet directory
  const handleSelectCustomer = (customer: CustomerRecord) => {
    const updatedQuoteNum = customer.technicalSalesManager
      ? updateQuoteNumberInitials(meta.quoteNumber, customer.technicalSalesManager)
      : meta.quoteNumber;

    // Check if client has a contracted or negotiated price book
    const customerPriceBook = customer.assignedPriceBookCode
      ? getPriceBookByCode(customer.assignedPriceBookCode)
      : undefined;
    const finalBook = customerPriceBook || activePriceBook;

    onUpdateMeta({
      ...meta,
      quoteNumber: updatedQuoteNum,
      clientCompany: customer.companyName,
      contactPerson: customer.contactPerson || '',
      clientName: customer.contactPerson || meta.clientName,
      clientEmail: customer.email,
      clientPhone: customer.mobile || customer.telephone,
      clientAddress: customer.address,
      clientCity: customer.cityCounty,
      clientPostcode: customer.postcode,
      technicalSalesManager: customer.technicalSalesManager,
      priceBookCode: finalBook.code,
      priceBookName: finalBook.name,
    });

    if (customerPriceBook && customerPriceBook.code !== meta.priceBookCode) {
      applyPriceBookToQuoteItems(customerPriceBook.code);
    }
  };

  // Handle clearing customer
  const handleClearCustomer = () => {
    const updatedQuoteNum = updateQuoteNumberInitials(meta.quoteNumber, 'RW');
    const defaultBook = resolvePriceBookForQuote(meta.date);
    onUpdateMeta({
      ...meta,
      quoteNumber: updatedQuoteNum,
      clientCompany: '',
      contactPerson: '',
      clientEmail: '',
      clientPhone: '',
      clientAddress: '',
      clientCity: '',
      clientPostcode: '',
      technicalSalesManager: '',
      priceBookCode: defaultBook.code,
      priceBookName: defaultBook.name,
    });
    if (meta.priceBookCode !== defaultBook.code) {
      applyPriceBookToQuoteItems(defaultBook.code);
    }
  };

  // Toggle multi-select tick box for a product
  const toggleProductSelection = (product: RockwoolProduct) => {
    setSelectedProductsMap((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else {
        next.set(product.id, product);
      }
      return next;
    });
  };

  // Select or deselect all currently filtered products
  const toggleSelectAllFiltered = () => {
    setSelectedProductsMap((prev) => {
      const next = new Map(prev);
      const allFilteredSelected = filteredAvailableProducts.every((p) => next.has(p.id));
      if (allFilteredSelected) {
        filteredAvailableProducts.forEach((p) => next.delete(p.id));
      } else {
        filteredAvailableProducts.forEach((p) => next.set(p.id, p));
      }
      return next;
    });
  };

  // Add all currently selected products to the quote
  const handleAddAllSelectedToQuote = () => {
    const productsToAdd = Array.from(selectedProductsMap.values());
    if (productsToAdd.length === 0) return;

    if (onAddMultipleItems) {
      onAddMultipleItems(productsToAdd);
    } else {
      productsToAdd.forEach((p) => onAddItem(p));
    }

    setSelectedProductsMap(new Map());
    setShowProductPickerModal(false);
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#D20014', '#1A1A1A', '#00A887'],
    });
  };

  // Sort available products in technical application sequence
  const orderedAvailableProducts = useMemo(() => {
    return sortProductsByApplicationOrder(availableProducts);
  }, [availableProducts]);

  // Filter available products by search query
  const filteredAvailableProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return orderedAvailableProducts;
    const q = productSearchQuery.toLowerCase();
    return orderedAvailableProducts.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [orderedAvailableProducts, productSearchQuery]);

  // Quote items always kept sorted strictly in application order:
  // 1. Adhesive -> 2. Insulation -> 3. Fixings -> 4. Basecoat & Mesh -> 5. Primers -> 6. Topcoat -> 7. Ancillaries
  const sortedItems = useMemo(() => {
    return sortQuoteItemsByApplicationOrder(items);
  }, [items]);

  // Handle changing Area m2
  const handleAreaChange = (newArea: number, extraMeta?: Partial<QuoteMeta>) => {
    const validArea = Math.max(1, newArea || 0);
    const updatedMeta = { ...meta, areaM2: validArea, ...extraMeta };
    onUpdateMeta(updatedMeta);

    // Recalculate quantities and m2 rate for all system items; ancillaries are treated as individual item prices
    const updatedItems = sortedItems.map((item) => {
      // Ancillaries cannot be calculated on a m² rate: individual quantities remain independent of area
      if (isAncillaryItem(item)) {
        return {
          ...item,
          pricePerM2: 0,
        };
      }

      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const grossArea = validArea <= 1 ? 1 : validArea * (1 + meta.wasteagePercent / 100);
      const calculatedQuantity = calculateItemQuantity(grossArea, item.consumptionRatePerM2, false, isLessThanOne);
      const finalQuantity = item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
        ? item.manualQuantityOverride
        : calculatedQuantity;

      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const discount = item.discountPercent ?? item.marginPercent ?? 0;
      const unitSellPrice = item.unitSellPrice > 0
        ? item.unitSellPrice
        : Math.round(listPrice * ((100 - discount) / 100) * 100) / 100;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, false, isLessThanOne);

      return {
        ...item,
        listPrice,
        unitCost: listPrice,
        calculatedQuantity,
        finalQuantity,
        discountPercent: discount,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Handle change to # of Units
  const handleUnitCountChange = (val: string) => {
    setUnitCountInput(val);
    const count = parseFloat(val);
    const size = parseFloat(unitSizeInput);
    if (!isNaN(count) && count > 0 && !isNaN(size) && size > 0) {
      const calculatedArea = Math.round(count * size * 100) / 100;
      setAreaInput(calculatedArea.toString());
      handleAreaChange(calculatedArea, { numberOfUnits: count, unitSizeM2: size });
    } else {
      onUpdateMeta({
        ...meta,
        numberOfUnits: !isNaN(count) && count > 0 ? count : undefined,
      });
    }
  };

  // Handle change to Size of Units (m²)
  const handleUnitSizeChange = (val: string) => {
    setUnitSizeInput(val);
    const count = parseFloat(unitCountInput);
    const size = parseFloat(val);
    if (!isNaN(count) && count > 0 && !isNaN(size) && size > 0) {
      const calculatedArea = Math.round(count * size * 100) / 100;
      setAreaInput(calculatedArea.toString());
      handleAreaChange(calculatedArea, { numberOfUnits: count, unitSizeM2: size });
    } else {
      onUpdateMeta({
        ...meta,
        unitSizeM2: !isNaN(size) && size > 0 ? size : undefined,
      });
    }
  };

  // Handle Wastage percentage change
  const handleWastageChange = (newWastage: number) => {
    const validWastage = Math.max(0, newWastage || 0);
    const updatedMeta = { ...meta, wasteagePercent: validWastage };
    onUpdateMeta(updatedMeta);

    const updatedItems = sortedItems.map((item) => {
      // Ancillaries cannot be calculated on a m² rate: individual quantities remain independent of wastage
      if (isAncillaryItem(item)) {
        return {
          ...item,
          pricePerM2: 0,
        };
      }

      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const grossArea = meta.areaM2 <= 1 ? 1 : meta.areaM2 * (1 + validWastage / 100);
      const calculatedQuantity = calculateItemQuantity(grossArea, item.consumptionRatePerM2, false, isLessThanOne);
      const finalQuantity = item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
        ? item.manualQuantityOverride
        : calculatedQuantity;

      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const discount = item.discountPercent ?? item.marginPercent ?? 0;
      const unitSellPrice = item.unitSellPrice > 0
        ? item.unitSellPrice
        : Math.round(listPrice * ((100 - discount) / 100) * 100) / 100;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, false, isLessThanOne);

      return {
        ...item,
        listPrice,
        unitCost: listPrice,
        calculatedQuantity,
        finalQuantity,
        discountPercent: discount,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Apply Overall Discount from List to all products simultaneously
  const handleApplyOverallDiscount = (targetDiscount: number) => {
    const validDiscount = Math.min(99, Math.max(0, targetDiscount));
    setCustomDiscountInput(validDiscount.toString());
    onUpdateMeta({ 
      ...meta, 
      overallDiscountPercent: validDiscount,
      overallMarginPercent: validDiscount 
    });

    const updatedItems = sortedItems.map((item) => {
      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const discountFactor = (100 - validDiscount) / 100;
      const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);
      const costPrice = item.costPrice !== undefined ? item.costPrice : undefined;
      const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
        ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
        : undefined;

      return {
        ...item,
        costPrice,
        listPrice,
        unitCost: listPrice,
        discountPercent: validDiscount,
        marginPercent,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(item.finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(item.finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Update an individual line item's discount from list
  const handleLineDiscountChange = (itemId: string, newDiscount: number) => {
    const validDiscount = Math.min(99, Math.max(0, newDiscount));
    const updatedItems = sortedItems.map((item) => {
      if (item.id !== itemId) return item;

      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const discountFactor = (100 - validDiscount) / 100;
      const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);
      const costPrice = item.costPrice !== undefined ? item.costPrice : undefined;
      const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
        ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
        : undefined;

      return {
        ...item,
        costPrice,
        listPrice,
        unitCost: listPrice,
        discountPercent: validDiscount,
        marginPercent,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(item.finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(item.finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Update an individual line item's client unit sell price directly
  const handleLinePriceChange = (itemId: string, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    const updatedItems = sortedItems.map((item) => {
      if (item.id !== itemId) return item;

      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const listPrice = item.listPrice ?? item.unitCost ?? validPrice;
      const costPrice = item.costPrice !== undefined ? item.costPrice : undefined;
      const unitSellPrice = Math.round(validPrice * 100) / 100;
      const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
        ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
        : undefined;
      const discountPercent = listPrice > 0
        ? Math.max(0, Math.round(((listPrice - unitSellPrice) / listPrice) * 1000) / 10)
        : 0;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);

      return {
        ...item,
        costPrice,
        unitSellPrice,
        marginPercent,
        discountPercent,
        pricePerM2,
        totalCost: Math.round(item.finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(item.finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Update an individual line item's margin % directly
  const handleLineMarginChange = (itemId: string, newMargin: number) => {
    const validMargin = Math.min(95, newMargin);
    const updatedItems = sortedItems.map((item) => {
      if (item.id !== itemId) return item;

      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const costPrice = item.costPrice !== undefined ? item.costPrice : undefined;

      // Price = Cost / (1 - Margin/100)
      let unitSellPrice = (costPrice !== undefined && costPrice > 0 && validMargin < 100)
        ? Math.round((costPrice / (1 - validMargin / 100)) * 100) / 100
        : item.unitSellPrice;
      if (isNaN(unitSellPrice) || unitSellPrice < 0) {
        unitSellPrice = 0;
      }

      const discountPercent = listPrice > 0
        ? Math.max(0, Math.round(((listPrice - unitSellPrice) / listPrice) * 1000) / 10)
        : 0;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);

      return {
        ...item,
        costPrice,
        unitSellPrice,
        marginPercent: costPrice !== undefined ? validMargin : undefined,
        discountPercent,
        pricePerM2,
        totalCost: Math.round(item.finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(item.finalQuantity * unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Update an individual line item's quantity override
  const handleLineQuantityChange = (itemId: string, newQtyStr: string) => {
    const isOverride = newQtyStr !== '';
    const newQty = Math.ceil(parseFloat(newQtyStr) || 0);

    const updatedItems = sortedItems.map((item) => {
      if (item.id !== itemId) return item;

      const isAncillary = isAncillaryItem(item);
      const isLessThanOne = isUnitCoversLessThanOneM2(item);
      const finalQuantity = isOverride ? Math.max(0, newQty) : item.calculatedQuantity;
      const listPrice = item.listPrice ?? item.unitCost ?? 0;
      const pricePerM2 = calculateItemPricePerM2(item.unitSellPrice, item.consumptionRatePerM2, isAncillary, isLessThanOne);

      return {
        ...item,
        manualQuantityOverride: isOverride ? newQty : null,
        finalQuantity,
        pricePerM2,
        totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
        totalSell: Math.round(finalQuantity * item.unitSellPrice * 100) / 100,
      };
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Update consumption rate
  const handleLineConsumptionRateChange = (itemId: string, newRate: number) => {
    const validRate = Math.max(0.0001, newRate);
    const grossArea = meta.areaM2 <= 1 ? 1 : meta.areaM2 * (1 + meta.wasteagePercent / 100);
    const targetItem = sortedItems.find(i => i.id === itemId);
    const isTargetFixing = targetItem ? isFixingProduct(targetItem) : false;
    const newFixingsPerM2 = isTargetFixing 
      ? getIndividualFixingsPerM2({ ...targetItem!, consumptionRatePerM2: validRate }) 
      : 5;

    const updatedItems = sortedItems.map((item) => {
      if (item.id === itemId) {
        const isAncillary = isAncillaryItem(item);
        const isLessThanOne = isUnitCoversLessThanOneM2(item);
        const calculatedQuantity = calculateItemQuantity(grossArea, validRate, isAncillary, isLessThanOne);
        const finalQuantity = item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
          ? item.manualQuantityOverride
          : calculatedQuantity;

        const listPrice = item.listPrice ?? item.unitCost ?? 0;
        const pricePerM2 = calculateItemPricePerM2(item.unitSellPrice, validRate, isAncillary, isLessThanOne);

        return {
          ...item,
          consumptionRatePerM2: validRate,
          calculatedQuantity,
          finalQuantity,
          pricePerM2,
          totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
          totalSell: Math.round(finalQuantity * item.unitSellPrice * 100) / 100,
        };
      }

      // If the modified line was a mechanical fixing, automatically sync all washers (1 washer per fixing, accounting for washer box size)
      if (isTargetFixing && isWasherProduct(item)) {
        const washerInfo = calculateWasherRate(newFixingsPerM2, item);
        const washerRate = washerInfo.consumptionRatePerM2;
        const isAncillary = isAncillaryItem(item);
        const isLessThanOne = isUnitCoversLessThanOneM2(item);
        const calculatedQuantity = calculateItemQuantity(grossArea, washerRate, isAncillary, isLessThanOne);
        const finalQuantity = item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
          ? item.manualQuantityOverride
          : calculatedQuantity;

        const listPrice = item.listPrice ?? item.unitCost ?? 0;
        const pricePerM2 = calculateItemPricePerM2(item.unitSellPrice, washerRate, isAncillary, isLessThanOne);

        return {
          ...item,
          consumptionRatePerM2: washerRate,
          coverageNotes: washerInfo.coverageNotes,
          calculatedQuantity,
          finalQuantity,
          pricePerM2,
          totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
          totalSell: Math.round(finalQuantity * item.unitSellPrice * 100) / 100,
        };
      }

      return item;
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Explicitly duplicate a line item when estimator needs same product on separate line (e.g. Phase 2)
  const handleDuplicateLineItem = (itemId: string) => {
    const itemToDup = items.find((i) => i.id === itemId);
    if (!itemToDup) return;

    const duplicatedItem: QuoteLineItem = {
      ...itemToDup,
      id: `item-${Date.now()}-copy-${Math.random().toString(36).substring(2, 6)}`,
      description: itemToDup.description.includes('(Copy)')
        ? itemToDup.description
        : `${itemToDup.description} (Copy)`,
      isCustomOrAdded: true,
    };

    const newItems = [...items];
    const itemIndex = items.findIndex((i) => i.id === itemId);
    if (itemIndex !== -1) {
      newItems.splice(itemIndex + 1, 0, duplicatedItem);
    } else {
      newItems.push(duplicatedItem);
    }
    onUpdateItems(newItems);
  };

  // Toggle excluding or including an item from the £/m² rate calculation
  const handleToggleExcludeFromM2Rate = (itemId: string) => {
    const updatedItems = sortedItems.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          excludeFromM2Rate: !item.excludeFromM2Rate,
        };
      }
      return item;
    });

    onUpdateItems(sortQuoteItemsByApplicationOrder(updatedItems));
  };

  // Save Quote to Google Sheets ('Quotes' and 'Quote Items' tabs)
  const handleSaveToGoogleSheets = async (isBackground = false) => {
    if (sortedItems.length === 0) {
      if (!isBackground) {
        setSaveFeedback({
          type: 'error',
          message: 'Cannot save an empty quote. Please add products first.',
        });
      }
      return;
    }

    // If quote was loaded or previously saved, and no modifications were made, avoid creating duplicate quote revision
    // BUT still check if the project is in the Projects tab of the Google Spreadsheet!
    if (!isDirty && loadedSnapshotRef) {
      if (meta.projectName?.trim()) {
        try {
          const token = await getAccessToken();
          if (token) {
            const projCheck = await ensureProjectExistsInGoogleSheet(token, meta, totalProjectNet);
            if (projCheck.created) {
              setSaveFeedback({
                type: 'success',
                message: `Project "${projCheck.projectTitle}" created in Google Sheets 'Projects' tab! (Quote is up to date).`,
                sheetUrl: `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/edit`,
              });
              return;
            }
          }
        } catch (projErr) {
          console.warn('Could not check project in Projects tab on clean quote:', projErr);
        }
      }

      if (!isBackground) {
        setSaveFeedback({
          type: 'success',
          message: `Quote ${meta.quoteNumber} is already up to date in Google Sheets (no changes detected).`,
        });
      }
      return;
    }

    setIsSaving(true);
    if (!isBackground) {
      setSaveFeedback(null);
    }

    try {
      let token = await getAccessToken();

      // If token not present in memory, request interactive sign-in
      if (!token) {
        if (isBackground) {
          // If triggered automatically by PDF export, prompt user via feedback banner
          setSaveFeedback({
            type: 'error',
            message: 'PDF exported! Click "Save" below to sign in with Google and log to the Quotes sheet.',
          });
          setIsSaving(false);
          return;
        }

        const authResult = await googleSignIn();
        if (!authResult?.accessToken) {
          throw new Error('Google sign-in was cancelled or did not provide an access token.');
        }
        token = authResult.accessToken;
        setGoogleUser(authResult.user);
      }

      // If this quote was previously loaded or saved, and only deal status/win % was changed (not dirty),
      // update the latest version in the spreadsheet in-place without creating a new revision!
      if (loadedSnapshotRef && !isDirty) {
        const dealResult = await updateQuoteDealStatusInGoogleSheet(
          token,
          meta.quoteNumber,
          meta.dealStatus || 'Pending',
          meta.winLikelihood ?? (meta.dealStatus === 'Won' ? 100 : meta.dealStatus === 'Lost' ? 0 : 50)
        );

        // Also ensure project exists in Projects tab
        await ensureProjectExistsInGoogleSheet(token, meta, totalProjectNet);

        if (dealResult.success) {
          setLastSavedDealState({
            dealStatus: meta.dealStatus || 'Pending',
            winLikelihood: meta.winLikelihood ?? (meta.dealStatus === 'Won' ? 100 : meta.dealStatus === 'Lost' ? 0 : 50),
          });
          setSaveFeedback({
            type: 'success',
            message: `Deal status for ${meta.quoteNumber} updated in Google Sheets (no new revision needed).`,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/edit`,
          });
          setIsSaving(false);
          return;
        }
      }

      // If this quote was previously loaded or saved, and changes were made to line items or specifications, increment revision!
      let quoteNumberToSave = meta.quoteNumber;
      if (loadedSnapshotRef && isDirty) {
        const loadedParsed = parseQuoteReference(loadedSnapshotRef);
        const currentParsed = parseQuoteReference(meta.quoteNumber);
        if (loadedParsed.baseReference.toUpperCase() === currentParsed.baseReference.toUpperCase()) {
          quoteNumberToSave = incrementQuoteRevision(loadedSnapshotRef);
          onUpdateMeta({ ...meta, quoteNumber: quoteNumberToSave });
        }
      } else {
        quoteNumberToSave = normalizeQuoteReference(meta.quoteNumber, 0);
        if (quoteNumberToSave !== meta.quoteNumber) {
          onUpdateMeta({ ...meta, quoteNumber: quoteNumberToSave });
        }
      }

      const metaToSave: QuoteMeta = {
        ...meta,
        quoteNumber: quoteNumberToSave,
      };

      const result = await saveQuoteToGoogleSheet(token, metaToSave, sortedItems);

      if (result.success) {
        const newFingerprint = computeQuoteFingerprint(metaToSave, sortedItems);
        setLastSavedFingerprint(newFingerprint);
        setLoadedSnapshotRef(quoteNumberToSave);
        setLastSavedDealState({
          dealStatus: metaToSave.dealStatus || 'Pending',
          winLikelihood: metaToSave.winLikelihood ?? (metaToSave.dealStatus === 'Won' ? 100 : metaToSave.dealStatus === 'Lost' ? 0 : 50),
        });

        setSaveFeedback({
          type: 'success',
          message: result.message || `Quote ${quoteNumberToSave} saved to Google Sheets!`,
          sheetUrl: result.sheetUrl,
        });
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#00A887', '#1A1A1A', '#C8102E'],
        });
      } else {
        if (result.message?.includes('401') || result.message?.includes('403') || result.message?.includes('permission')) {
          clearAccessToken();
        }
        setSaveFeedback({
          type: 'error',
          message: result.message || 'Failed to save quote to Google Sheets.',
          sheetUrl: result.sheetUrl,
        });
      }
    } catch (err: any) {
      if (err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('permission') || err.message?.includes('expired')) {
        clearAccessToken();
      }
      console.error('Error during Google Sheets save:', err);
      setSaveFeedback({
        type: 'error',
        message: err.message || 'Unable to connect to Google Sheets.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Explicitly prompt Google Account selection and Sheets authorization
  const handleReconnectGoogle = async () => {
    clearAccessToken();
    try {
      setIsSaving(true);
      setSaveFeedback(null);
      const authResult = await googleSignIn(true);
      if (authResult?.accessToken) {
        setGoogleUser(authResult.user);
        const result = await saveQuoteToGoogleSheet(authResult.accessToken, meta, sortedItems);
        if (result.success) {
          const newFingerprint = computeQuoteFingerprint(meta, sortedItems);
          setLastSavedFingerprint(newFingerprint);
          setLoadedSnapshotRef(meta.quoteNumber);
          setLastSavedDealState({
            dealStatus: meta.dealStatus || 'Pending',
            winLikelihood: meta.winLikelihood ?? (meta.dealStatus === 'Won' ? 100 : meta.dealStatus === 'Lost' ? 0 : 50),
          });

          setSaveFeedback({
            type: 'success',
            message: `Quote ${meta.quoteNumber} saved to Google Sheets ('Quotes' & 'Quote Items' tabs)!`,
            sheetUrl: result.sheetUrl,
          });
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.7 },
            colors: ['#00A887', '#1A1A1A', '#C8102E'],
          });
        } else {
          clearAccessToken();
          setSaveFeedback({
            type: 'error',
            message: result.message || 'Failed to save quote to Google Sheets.',
            sheetUrl: result.sheetUrl,
          });
        }
      }
    } catch (err: any) {
      clearAccessToken();
      setSaveFeedback({
        type: 'error',
        message: err.message || 'Authentication failed or permission was denied.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Explicitly saves status change in-place to Google Sheets when user clicks 'Status Unsaved (Click to save)'
  const handleSaveDealStatusOnly = async () => {
    setIsSavingDealStatus(true);
    try {
      let token = await getAccessToken();
      if (!token) {
        const authResult = await googleSignIn();
        if (!authResult?.accessToken) {
          setIsSavingDealStatus(false);
          return;
        }
        token = authResult.accessToken;
        setGoogleUser(authResult.user);
      }

      const currentDealStatus = meta.dealStatus || 'Pending';
      const currentLikelihood =
        meta.winLikelihood !== undefined && meta.winLikelihood !== null
          ? meta.winLikelihood
          : currentDealStatus === 'Won'
          ? 100
          : currentDealStatus === 'Lost'
          ? 0
          : 50;

      if (loadedSnapshotRef) {
        const res = await updateQuoteDealStatusInGoogleSheet(
          token,
          meta.quoteNumber,
          currentDealStatus,
          currentLikelihood
        );
        if (res.success) {
          setLastSavedDealState({
            dealStatus: currentDealStatus,
            winLikelihood: currentLikelihood,
          });
          const baseKey = parseQuoteReference(meta.quoteNumber).baseReference.toUpperCase();
          setSheetQuotesList((prev) =>
            prev.map((q) =>
              q.baseReference.toUpperCase() === baseKey
                ? { ...q, dealStatus: currentDealStatus, winLikelihood: currentLikelihood }
                : q
            )
          );
        } else {
          await handleSaveToGoogleSheets();
        }
      } else {
        await handleSaveToGoogleSheets();
      }
    } catch (err) {
      console.warn('Could not save deal status change:', err);
    } finally {
      setIsSavingDealStatus(false);
    }
  };

  // Fetch list of saved quotes from Google Sheets for the Load Quote browser
  const fetchQuotesList = async () => {
    setIsFetchingQuotesList(true);
    try {
      let token = await getAccessToken();
      if (!token) {
        const authResult = await googleSignIn();
        if (!authResult?.accessToken) {
          setIsFetchingQuotesList(false);
          return;
        }
        token = authResult.accessToken;
        setGoogleUser(authResult.user);
      }
      const res = await listQuotesFromGoogleSheet(token);
      if (res.success && res.quotes) {
        setSheetQuotesList(res.quotes);
      }
    } catch (err) {
      console.warn('Could not fetch quotes list:', err);
    } finally {
      setIsFetchingQuotesList(false);
    }
  };

  // Opens the Load Quote modal and initializes the quote list
  const handleOpenLoadQuoteModal = () => {
    setShowLoadQuoteModal(true);
    setManualQuoteInput(meta.quoteNumber || '');
    setQuoteSearchTerm('');
    fetchQuotesList();
  };

  // Filtered quotes based on search query and latest revision toggle
  const filteredQuotesList = useMemo(() => {
    let list = sheetQuotesList;
    if (showLatestOnly) {
      const seenBases = new Set<string>();
      list = list.filter((q) => {
        if (q.isLatest) return true;
        const baseKey = q.baseReference.toUpperCase();
        if (!seenBases.has(baseKey)) {
          seenBases.add(baseKey);
          return true;
        }
        return false;
      });
    }

    if (!quoteSearchTerm.trim()) return list;

    const term = quoteSearchTerm.toLowerCase();
    return list.filter(
      (q) =>
        q.quoteNumber.toLowerCase().includes(term) ||
        q.baseReference.toLowerCase().includes(term) ||
        q.projectName.toLowerCase().includes(term) ||
        q.clientCompany.toLowerCase().includes(term) ||
        q.contactPerson.toLowerCase().includes(term) ||
        q.salesManager.toLowerCase().includes(term) ||
        q.projectLocation.toLowerCase().includes(term)
    );
  }, [sheetQuotesList, showLatestOnly, quoteSearchTerm]);

  // Load Quote from Google Sheet using specified or entered Quote Number
  const handleLoadQuoteFromSheet = async (quoteRefToLoad?: string) => {
    const targetQuoteNumber = (quoteRefToLoad || manualQuoteInput || meta.quoteNumber).trim();
    if (!targetQuoteNumber) {
      const errInfo = getLaymanLoadErrorMessage('Please enter a quote reference to load.', '');
      setLoadErrorModal({
        title: errInfo.title,
        message: errInfo.explanation,
        quoteRef: '',
        isPermissionIssue: errInfo.isPermissionIssue,
      });
      setLoadFeedback({ type: 'error', message: 'Quote reference is required.' });
      return;
    }

    setIsLoadingQuote(true);
    setLoadFeedback(null);

    try {
      let token = await getAccessToken();
      if (!token) {
        const authResult = await googleSignIn();
        if (!authResult?.accessToken) {
          throw new Error('Google sign-in was cancelled or did not provide an access token.');
        }
        token = authResult.accessToken;
        setGoogleUser(authResult.user);
      }

      const result = await loadQuoteFromGoogleSheet(
        token,
        targetQuoteNumber,
        availableProducts,
        meta
      );

      if (result.success && result.meta) {
        onUpdateMeta(result.meta);
        const loadedItems = result.items || [];
        if (result.items) {
          onUpdateItems(loadedItems);
        }

        // Initialize snapshot fingerprint to mark clean state
        const loadedFingerprint = computeQuoteFingerprint(result.meta, loadedItems);
        setLastSavedFingerprint(loadedFingerprint);
        setLoadedSnapshotRef(result.meta.quoteNumber);
        setLastSavedDealState({
          dealStatus: result.meta.dealStatus || 'Pending',
          winLikelihood: result.meta.winLikelihood ?? (result.meta.dealStatus === 'Won' ? 100 : result.meta.dealStatus === 'Lost' ? 0 : 50),
        });

        // Close load modal upon successful loading
        setShowLoadQuoteModal(false);

        const revBadge = result.revision !== undefined ? `Rev ${result.revision}` : '';
        setLoadFeedback({
          type: 'success',
          message: revBadge ? `Quote Loaded (${revBadge})` : 'Quote Loaded',
        });
        setSaveFeedback(null);
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.3 },
          colors: ['#00A887', '#1A1A1A', '#C8102E'],
        });
      } else {
        const errInfo = getLaymanLoadErrorMessage(result.message || 'Quote not found', targetQuoteNumber);
        setLoadErrorModal({
          title: errInfo.title,
          message: errInfo.explanation,
          quoteRef: targetQuoteNumber,
          isPermissionIssue: errInfo.isPermissionIssue,
        });
        setLoadFeedback({
          type: 'error',
          message: result.message || `Quote ${targetQuoteNumber} not found`,
        });
      }
    } catch (err: any) {
      console.error('Error loading quote from Google Sheets:', err);
      const errInfo = getLaymanLoadErrorMessage(err.message || 'Unable to connect to Google Sheets', targetQuoteNumber);
      setLoadErrorModal({
        title: errInfo.title,
        message: errInfo.explanation,
        quoteRef: targetQuoteNumber,
        isPermissionIssue: errInfo.isPermissionIssue,
      });
      setLoadFeedback({
        type: 'error',
        message: err.message || 'Unable to connect to Google Sheets.',
      });
    } finally {
      setIsLoadingQuote(false);
    }
  };

  // Start a fresh quote - prompts to clear back to fresh or keep current items
  const handleConfirmNewQuote = (clearAll: boolean) => {
    setShowNewQuotePromptModal(false);
    const newQuoteNum = generateFormattedQuoteNumber(meta.technicalSalesManager, new Date(), 0);

    if (clearAll) {
      const today = getLocalIsoDate();
      const defaultExpiry = addDaysToDate(today, 30);
      onUpdateItems([]);
      onUpdateMeta({
        quoteNumber: newQuoteNum,
        date: today,
        validUntil: defaultExpiry,
        clientName: '',
        contactPerson: '',
        clientCompany: '',
        clientEmail: '',
        clientPhone: '',
        clientAddress: '',
        clientCity: '',
        clientPostcode: '',
        technicalSalesManager: meta.technicalSalesManager || '',
        projectName: '',
        projectReference: '',
        projectLocation: '',
        areaM2: 100,
        wasteagePercent: 10,
        overallDiscountPercent: 0,
        overallMarginPercent: 0,
        includeInstallationEstimate: false,
        installationRatePerM2: 35,
        numberOfPhases: 1,
        phaseDurationMonths: 1,
        notesAndTerms: DEFAULT_STANDARD_TERMS,
        dealStatus: 'Pending',
        winLikelihood: 50,
      });
      setAreaInput('100');
      setWastageInput('10');
      setCustomDiscountInput('0');
      setUnitCountInput('');
      setUnitSizeInput('');
      setLastSavedFingerprint(null);
      setLoadedSnapshotRef(null);
      setLastSavedDealState(null);
      setLoadFeedback({
        type: 'success',
        message: 'Quotation Reset',
      });
      setSaveFeedback(null);
    } else {
      onUpdateMeta({
        ...meta,
        quoteNumber: newQuoteNum,
      });
      setLastSavedFingerprint(null);
      setLoadedSnapshotRef(null);
      setLastSavedDealState(null);
      setLoadFeedback({
        type: 'success',
        message: 'New Quote Started',
      });
      setSaveFeedback(null);
    }
  };

  // Export PDF Handler with zero-price safeguard
  const handleExportPdf = async (forceExport: boolean | React.MouseEvent = false) => {
    const isForce = typeof forceExport === 'boolean' ? forceExport : false;
    const unpricedItems = sortedItems.filter((i) => i.unitSellPrice <= 0);
    if (unpricedItems.length > 0 && !isForce) {
      setShowUnpricedWarningModal(true);
      return;
    }

    setShowUnpricedWarningModal(false);
    setIsExporting(true);
    try {
      await exportQuoteToClientPdf(meta, sortedItems);
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#D20014', '#1A1A1A', '#CBD5E1'],
      });

      // Automatically run save function when user exports quote (saves quote and ensures project is in Projects tab)
      await handleSaveToGoogleSheets(true);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Unable to generate PDF. Check console for details.');
    } finally {
      setIsExporting(false);
    }
  };

  // Separate Main System Items (calculated on m² rate) from Ancillaries (treated as individual item prices)
  const { systemItems, ancillaryItems } = useMemo(
    () => separateSystemAndAncillaryItems(sortedItems),
    [sortedItems]
  );

  const area = Math.max(1, meta.areaM2);

  // Façade system m² rates (strictly EXCLUDES ancillaries and items explicitly marked excludeFromM2Rate)
  const materialsRatePerM2 = systemItems.reduce((sum, i) => {
    if (i.excludeFromM2Rate) return sum;
    const isLessThanOne = isUnitCoversLessThanOneM2(i);
    const itemPricePerM2 = i.pricePerM2 ?? calculateItemPricePerM2(i.unitSellPrice, i.consumptionRatePerM2 || (isLessThanOne ? 0.72 : 1), false, isLessThanOne);
    return sum + itemPricePerM2;
  }, 0);

  const installationRatePerM2 = meta.includeInstallationEstimate ? meta.installationRatePerM2 : 0;
  const netRatePerM2 = materialsRatePerM2 + installationRatePerM2;

  // Real quantity-based materials total for main system items (reflects wastage, pack rounding, and manual overrides)
  const systemItemsTotalNet = systemItems
    .filter((i) => !i.excludeFromM2Rate)
    .reduce((sum, i) => sum + (i.finalQuantity * i.unitSellPrice), 0);

  const installationTotalNet = meta.includeInstallationEstimate
    ? (installationRatePerM2 * area)
    : 0;

  // Ancillaries aggregates (treated as individual item prices, NOT on m² rate)
  const ancillariesTotalNet = ancillaryItems.reduce((sum, i) => {
    return sum + (i.finalQuantity * i.unitSellPrice);
  }, 0);

  // System items excluded from £/m² rate (treated as individual line totals)
  const excludedSystemItemsTotalNet = systemItems
    .filter((i) => i.excludeFromM2Rate)
    .reduce((sum, i) => sum + (i.finalQuantity * i.unitSellPrice), 0);

  // Overall Project Investment (Physical bill of quantities: system items + installation + excluded + ancillaries)
  const totalProjectNet = systemItemsTotalNet + installationTotalNet + excludedSystemItemsTotalNet + ancillariesTotalNet;

  // Internal benchmark list rate for main system (skips excluded items)
  const listRatePerM2 = systemItems.reduce((sum, i) => {
    if (i.excludeFromM2Rate) return sum;
    const isLessThanOne = isUnitCoversLessThanOneM2(i);
    const list = i.listPrice ?? i.unitCost ?? 0;
    const itemListRate = calculateItemPricePerM2(list, i.consumptionRatePerM2 || (isLessThanOne ? 0.72 : 1), false, isLessThanOne);
    return sum + itemListRate;
  }, 0);
  const discountSavingsRate = Math.max(0, listRatePerM2 - materialsRatePerM2);
  const averageDiscountPercent = listRatePerM2 > 0 ? (discountSavingsRate / listRatePerM2) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* 1. Project & Area Estimation Controls Card */}
      <div id="project-details-section" className="bg-white border border-[#E2E8F0] p-4 sm:p-6 space-y-6 shadow-2xs max-w-full overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4 max-w-full overflow-hidden">
          <div className="flex items-center gap-3 min-w-0 shrink">
            <div className="w-8 h-8 bg-[#1A1A1A] flex items-center justify-center text-white shrink-0">
              <Building className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-[#1A1A1A] text-lg flex items-center gap-2 font-['Red_Hat_Display'] truncate">
                Project Details
              </h2>
              <p className="text-xs text-[#6B7280] truncate">
                Enter project information, customer details, and site specifications.
              </p>
            </div>
          </div>

          {/* Quote Reference, Status, & Versioning Controls */}
          <div className="flex flex-col items-start md:items-end gap-1.5 w-full md:w-auto max-w-full overflow-hidden">
            {/* Top Row: Automated Non-Editable Quote Reference Display & Status Chips */}
            <div className="flex flex-wrap items-center md:justify-end gap-1.5 w-full max-w-full">
              {/* Historical Commercial Record Lock Badge */}
              {loadedSnapshotRef && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1 shadow-2xs select-none shrink-0"
                  title="Historical Commercial Record: Pricing, discounts, and line totals are locked to this quote's creation snapshot, never recalculated from today's product catalog."
                >
                  <Lock className="w-3 h-3 text-blue-600 shrink-0" />
                  <span>Commercial Record</span>
                </span>
              )}

              {/* Revision / Modification Status Indicator */}
              {loadedSnapshotRef ? (
                isDirty ? (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1 shadow-2xs shrink-0"
                    title="Changes detected since last load/save. Saving will record the next revision."
                  >
                    <GitBranch className="w-3 h-3 text-amber-600 shrink-0" />
                    <span>Edited (Next: Rev {parseQuoteReference(meta.quoteNumber).revision + 1})</span>
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-2xs shrink-0"
                    title="Quote is up to date with Google Sheets."
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span>Saved (Rev {parseQuoteReference(meta.quoteNumber).revision})</span>
                  </span>
                )
              ) : (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1 shadow-2xs shrink-0"
                  title="New quotation"
                >
                  <FilePlus className="w-3 h-3 text-slate-500 shrink-0" />
                  <span>Rev 0</span>
                </span>
              )}

              {/* Active Price Book Indicator Badge */}
              <span
                className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-800 border border-slate-300 flex items-center gap-1 shadow-2xs font-mono shrink-0 max-w-full"
                title={`Commercial Price Book: ${activePriceBook.name} (${activePriceBook.code})`}
              >
                <BookOpen className="w-3 h-3 text-[#C8102E] shrink-0" />
                <span className="truncate max-w-[120px] sm:max-w-[160px]">{activePriceBook.name}</span>
              </span>

              {/* Automated Non-Editable Quote Reference Display */}
              <div className="flex items-center gap-1.5 bg-[#F1F5F9] px-2 py-1 border border-[#CBD5E1] shadow-2xs select-none max-w-full min-w-0">
                <span className="text-[11px] font-mono font-black text-slate-500 shrink-0">REF:</span>
                <span
                  className="text-xs font-mono font-black text-[#1A1A1A] bg-white px-2 py-0.5 border border-slate-300 min-w-0 max-w-[180px] sm:max-w-[220px] truncate text-center tracking-tight shadow-inner"
                  title="Automated Quote Reference — changes automatically when loading or revising quotes"
                >
                  {meta.quoteNumber}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(meta.quoteNumber);
                    setCopiedRef(true);
                    setTimeout(() => setCopiedRef(false), 2000);
                  }}
                  className="text-slate-500 hover:text-[#C8102E] transition-colors p-1 shrink-0"
                  title="Copy reference to clipboard"
                >
                  {copiedRef ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Load Quote & New Quote buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenLoadQuoteModal}
                disabled={isLoadingQuote}
                className="px-2.5 py-1 bg-[#1A1A1A] hover:bg-black text-white text-xs font-bold font-['Red_Hat_Display'] uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
                title="Open quote loader to enter reference or search all saved quotes"
              >
                {isLoadingQuote ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#C8102E]" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>Load Quote</span>
              </button>

              <button
                type="button"
                onClick={() => setShowNewQuotePromptModal(true)}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-[#1A1A1A] border border-[#CBD5E1] text-xs font-bold font-['Red_Hat_Display'] uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors"
                title="Start a fresh quotation with a new reference number"
              >
                <FilePlus className="w-3.5 h-3.5 text-slate-700" />
                <span>New Quote</span>
              </button>
            </div>

            {/* Load Feedback Message below buttons */}
            {loadFeedback && (
              <span
                onClick={() => {
                  if (loadFeedback.type === 'error') {
                    const errInfo = getLaymanLoadErrorMessage(loadFeedback.message, meta.quoteNumber);
                    setLoadErrorModal({
                      title: errInfo.title,
                      message: errInfo.explanation,
                      quoteRef: meta.quoteNumber,
                      isPermissionIssue: errInfo.isPermissionIssue,
                    });
                  }
                }}
                className={`text-[11px] font-semibold flex items-center gap-1 max-w-[280px] truncate ${
                  loadFeedback.type === 'success'
                    ? 'text-emerald-700'
                    : 'text-rose-600 hover:text-rose-800 cursor-pointer underline underline-offset-2'
                }`}
                title={loadFeedback.type === 'error' ? `${loadFeedback.message} (Click to view full explanation)` : loadFeedback.message}
              >
                {loadFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                )}
                <span className="truncate">{loadFeedback.message}</span>
              </span>
            )}

            {/* Deal Outcome & Win Likelihood Controls below New Quote button */}
            {(() => {
              const currentLikelihood =
                meta.winLikelihood !== undefined && meta.winLikelihood !== null
                  ? meta.winLikelihood
                  : meta.dealStatus === 'Won'
                  ? 100
                  : meta.dealStatus === 'Lost'
                  ? 0
                  : 50;
              const currentDealStatus = meta.dealStatus || 'Pending';

              const isStatusSaved = Boolean(
                loadedSnapshotRef &&
                lastSavedDealState &&
                lastSavedDealState.dealStatus === currentDealStatus &&
                lastSavedDealState.winLikelihood === currentLikelihood
              );

              const accentColorClass =
                currentLikelihood >= 70
                  ? 'accent-emerald-700'
                  : currentLikelihood >= 40
                  ? 'accent-amber-600'
                  : 'accent-rose-600';
              const textColorClass =
                currentLikelihood >= 70
                  ? 'text-emerald-700'
                  : currentLikelihood >= 40
                  ? 'text-amber-700'
                  : 'text-rose-700';

              return (
                <div className="flex flex-col gap-1.5 bg-[#F8F9FA] px-2.5 py-1.5 border border-[#CBD5E1] shadow-2xs mt-0.5">
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2.5">
                    {/* Outcome Toggle: Won / Lost / Pending */}
                    <div className="inline-flex border border-slate-300 shadow-2xs overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          const newLikelihood = 100;
                          onUpdateMeta({
                            ...meta,
                            dealStatus: 'Won',
                            winLikelihood: newLikelihood,
                          });
                          syncDealStatusToSheet('Won', newLikelihood);
                        }}
                        className={`px-2.5 py-0.5 text-xs font-bold transition-colors ${
                          meta.dealStatus === 'Won'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                        title="Mark quote as Won (updates latest version in sheet, no revision created)"
                      >
                        Won
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newLikelihood = meta.winLikelihood === 0 || meta.winLikelihood === 100 ? 50 : (meta.winLikelihood ?? 50);
                          onUpdateMeta({
                            ...meta,
                            dealStatus: 'Pending',
                            winLikelihood: newLikelihood,
                          });
                          syncDealStatusToSheet('Pending', newLikelihood);
                        }}
                        className={`px-2.5 py-0.5 text-xs font-bold border-x border-slate-300 transition-colors ${
                          meta.dealStatus === 'Pending' || !meta.dealStatus
                            ? 'bg-amber-500 text-white'
                            : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                        title="Mark quote as Pending (updates latest version in sheet, no revision created)"
                      >
                        Pending
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newLikelihood = 0;
                          onUpdateMeta({
                            ...meta,
                            dealStatus: 'Lost',
                            winLikelihood: newLikelihood,
                          });
                          syncDealStatusToSheet('Lost', newLikelihood);
                        }}
                        className={`px-2.5 py-0.5 text-xs font-bold transition-colors ${
                          meta.dealStatus === 'Lost'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                        title="Mark quote as Lost (updates latest version in sheet, no revision created)"
                      >
                        Lost
                      </button>
                    </div>

                    {/* Likelihood of Winning % Sliding Scale Bar */}
                    <div className="flex items-center gap-2 pl-2 border-t sm:border-t-0 sm:border-l border-slate-200">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono whitespace-nowrap">
                        Win %:
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={currentLikelihood}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            let newDealStatus = meta.dealStatus;
                            if (val === 100) newDealStatus = 'Won';
                            else if (val === 0) newDealStatus = 'Lost';
                            else if (newDealStatus === 'Won' || newDealStatus === 'Lost') newDealStatus = 'Pending';
                            onUpdateMeta({
                              ...meta,
                              winLikelihood: val,
                              dealStatus: newDealStatus,
                            });
                            syncDealStatusToSheet(newDealStatus || 'Pending', val);
                          }}
                          className={`w-24 sm:w-28 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer ${accentColorClass}`}
                          title="Adjust likelihood of winning percentage (updates latest version in sheet, no revision created)"
                        />
                        <span className={`text-xs font-mono font-black min-w-[34px] text-right ${textColorClass}`}>
                          {currentLikelihood}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status text inside the same shaded box */}
                  <div className="flex items-center justify-end pt-1 border-t border-slate-200">
                    {isStatusSaved ? (
                      <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Status saved</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSaveDealStatusOnly}
                        disabled={isSavingDealStatus}
                        className="group flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors cursor-pointer font-mono"
                        title="Click to save status change to spreadsheet"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span>{isSavingDealStatus ? 'Saving Status...' : 'Status Unsaved'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Inputs 2x2 Grid: Project Details (Left) & Customer Directory (Right) on Row 1; Dates (Left) & Sizing (Right) on Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Project Details (Left) */}
          <div className="bg-[#F8F9FA] p-4 border border-[#CBD5E1] space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#CBD5E1]">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1A1A1A] font-['Red_Hat_Display']">
                Project Directory & Specification
              </span>
              <span className="text-[10px] font-mono text-[#6B7280]">Projects Tab</span>
            </div>

            {/* Project Directory Dropdown Selector (from spreadsheet 'Projects' tab) */}
            <div>
              <ProjectSelector
                projects={activeProjects}
                currentProjectName={meta.projectName}
                onSelectProject={handleSelectProject}
                onClearProject={handleClearProject}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#1A1A1A] mb-1 flex items-center justify-between font-['Red_Hat_Display']">
                <span>Full Project / Scheme Name</span>
                <span className="text-[10px] text-[#6B7280] font-normal">Quotation schedule</span>
              </label>
              <input
                type="text"
                value={meta.projectName}
                onChange={(e) => onUpdateMeta({ ...meta, projectName: e.target.value })}
                placeholder="Full Project Name (e.g. Park West, Nottingham)"
                className="w-full text-xs font-bold text-[#1A1A1A] px-3 py-2 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>

            {/* Client Name - Directly above Site Location / Address */}
            <div>
              <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Client Name</label>
              <input
                type="text"
                value={meta.clientName}
                onChange={(e) => onUpdateMeta({ ...meta, clientName: e.target.value })}
                placeholder="Client Name (if stated in spec)"
                className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>

            {/* Site Location / Address */}
            <div>
              <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Site Location / Address</label>
              <input
                type="text"
                value={meta.projectLocation}
                onChange={(e) => onUpdateMeta({ ...meta, projectLocation: e.target.value })}
                placeholder="Site Address / City (e.g. 14 High Street, Manchester)"
                className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>

            {/* Project Reference - Directly under Site Location / Address */}
            <div>
              <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Project Reference</label>
              <input
                type="text"
                value={meta.projectReference || ''}
                onChange={(e) => onUpdateMeta({ ...meta, projectReference: e.target.value })}
                placeholder="Project Reference / Spec Ref (e.g. PR-2024-8849)"
                className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>
          </div>

          {/* Customer Directory & Contractor Details (Right - to the right of Project box) */}
          <div className="bg-[#F8F9FA] p-4 border border-[#CBD5E1] space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#CBD5E1]">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1A1A1A] font-['Red_Hat_Display']">
                Contractor Directory
              </span>
              <span className="text-[10px] font-mono text-[#6B7280]">Directory Tab</span>
            </div>

            {/* Customer Directory Dropdown Selector (from spreadsheet 'Customers' tab) */}
            <div>
              <CustomerSelector
                customers={activeCustomers}
                currentClientCompany={meta.clientCompany}
                currentClientName={meta.clientName}
                onSelectCustomer={handleSelectCustomer}
                onClearCustomer={handleClearCustomer}
              />
            </div>

            {/* Customer Company / Contractor */}
            <div>
              <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Customer Company / Contractor</label>
              <input
                type="text"
                value={meta.clientCompany}
                onChange={(e) => onUpdateMeta({ ...meta, clientCompany: e.target.value })}
                placeholder="Company Name (if stated in spec)"
                className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>

            {/* Contact Person - Filled manually or auto-populated from Directory */}
            <div>
              <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Contact Person</label>
              <input
                type="text"
                value={meta.contactPerson ?? ''}
                onChange={(e) => onUpdateMeta({ ...meta, contactPerson: e.target.value })}
                placeholder="Contact Person (e.g. Estimator / Project Lead)"
                className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Customer Email</label>
                <input
                  type="email"
                  value={meta.clientEmail}
                  onChange={(e) => onUpdateMeta({ ...meta, clientEmail: e.target.value })}
                  placeholder="e.g. client@facades.co.uk"
                  className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#4A5568] mb-0.5">Customer Phone</label>
                <input
                  type="tel"
                  value={meta.clientPhone || ''}
                  onChange={(e) => onUpdateMeta({ ...meta, clientPhone: e.target.value })}
                  placeholder="e.g. +44 115 ..."
                  className="w-full text-xs font-medium px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                />
              </div>
            </div>

            {/* Office Address & Technical Sales Manager Readout if linked */}
            {(meta.clientAddress || meta.technicalSalesManager) && (
              <div className="p-2.5 bg-white border border-[#CBD5E1] text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {meta.clientAddress && (
                    <div className="text-slate-600 flex items-center gap-1.5 truncate">
                      <span className="font-bold text-[#1A1A1A]">Registered Office:</span>
                      <span className="truncate">
                        {[meta.clientAddress, meta.clientCity, meta.clientPostcode].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
                  {meta.technicalSalesManager && (
                    <div className="bg-red-50 text-[#C8102E] font-bold px-2 py-0.5 border border-red-200 text-[10px] font-mono shrink-0">
                      Technical Sales Manager: {meta.technicalSalesManager}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Quote Schedule & Validity (Left) & Combined Façade Area & Wastage (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Quote Date & Selectable Expiry Date (Defaults to 30 Days) */}
          <div className="bg-[#F8F9FA] p-4 border border-[#CBD5E1] space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#CBD5E1]">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1A1A1A] font-['Red_Hat_Display']">
                Quote Schedule & Validity
              </span>
              <span className="text-[10px] font-mono text-[#6B7280]">Commercial Rate Book</span>
            </div>

            {/* Commercial Price Book Selector */}
            <div className="bg-white p-2.5 border border-[#CBD5E1] shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#1A1A1A] flex items-center gap-1.5 font-['Red_Hat_Display']">
                  <BookOpen className="w-3.5 h-3.5 text-[#C8102E]" />
                  <span>Commercial Price Book</span>
                </label>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300">
                  {activePriceBook.code}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <select
                  value={activePriceBook.code}
                  onChange={(e) => handlePriceBookChange(e.target.value)}
                  disabled={Boolean(meta.commercialSnapshot)}
                  className="w-full text-xs font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-[#F8F9FA] border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E] disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer"
                  title={meta.commercialSnapshot ? 'Price book is permanently frozen on this historical quote version' : 'Select active price book to apply catalogue pricing'}
                >
                  {availablePriceBooks.map((pb) => (
                    <option key={pb.id} value={pb.code}>
                      {pb.name} ({pb.code}) - {pb.currency}
                    </option>
                  ))}
                </select>

                {meta.commercialSnapshot ? (
                  <span className="shrink-0 text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 border border-slate-300 flex items-center gap-1">
                    Frozen Record
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-1 border border-emerald-300 flex items-center gap-1">
                    {activePriceBook.type === 'customer'
                      ? 'Client Negotiated'
                      : activePriceBook.type === 'special_project'
                      ? 'Project Agreement'
                      : 'Standard Schedule'}
                  </span>
                )}
              </div>


            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-[#4A5568] mb-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#C8102E]" />
                  <span>Quote Date (Issue Date)</span>
                </label>
                <input
                  type="date"
                  value={toInputDateFormat(meta.date)}
                  onChange={(e) => {
                    const newIssueDate = e.target.value;
                    const daysDiff = getDaysDifference(meta.date, meta.validUntil) || 30;
                    const newExpiry = addDaysToDate(newIssueDate, Math.max(1, daysDiff));
                    const autoBook = resolvePriceBookForQuote(newIssueDate);
                    const shouldAutoSwitchBook = 
                      activePriceBook.type === 'standard' && 
                      autoBook.code !== activePriceBook.code;

                    onUpdateMeta({
                      ...meta,
                      date: newIssueDate,
                      validUntil: newExpiry,
                      priceBookCode: shouldAutoSwitchBook ? autoBook.code : (meta.priceBookCode || autoBook.code),
                      priceBookName: shouldAutoSwitchBook ? autoBook.name : (meta.priceBookName || autoBook.name),
                    });

                    if (shouldAutoSwitchBook) {
                      applyPriceBookToQuoteItems(autoBook.code);
                    }
                  }}
                  className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-[#4A5568] flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#C8102E]" />
                    <span>Quote Expiry Date</span>
                  </label>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 bg-red-50 text-[#C8102E] border border-red-200">
                    {(() => {
                      const diff = getDaysDifference(meta.date, meta.validUntil);
                      if (diff > 0) return `${diff} Days Validity`;
                      if (diff === 0) return 'Expires Today';
                      return 'Expired';
                    })()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={toInputDateFormat(meta.validUntil)}
                    onChange={(e) => {
                      const newExpiryDate = e.target.value;
                      onUpdateMeta({
                        ...meta,
                        validUntil: newExpiryDate,
                      });
                    }}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    {[30, 60, 90].map((days) => {
                      const isActive = getDaysDifference(meta.date, meta.validUntil) === days;
                      return (
                        <button
                          key={days}
                          type="button"
                          onClick={() => {
                            const newExpiry = addDaysToDate(meta.date, days);
                            onUpdateMeta({
                              ...meta,
                              validUntil: newExpiry,
                            });
                          }}
                          className={`h-[30px] px-2 text-[11px] font-mono font-bold transition-colors border ${
                            isActive
                              ? 'bg-[#C8102E] text-white border-[#C8102E] shadow-2xs'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-[#CBD5E1]'
                          }`}
                          title={`Set validity to ${days} days from issue date`}
                        >
                          {days === 30 ? '30d' : `${days}d`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Phasing & Start Date Schedule */}
            <div className="pt-2.5 border-t border-[#CBD5E1]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1. Expected Start Date */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A5568] mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#C8102E]" />
                    <span>Expected Start Date</span>
                  </label>
                  <input
                    type="date"
                    value={toInputDateFormat(meta.expectedStartDate || '')}
                    onChange={(e) => {
                      onUpdateMeta({
                        ...meta,
                        expectedStartDate: e.target.value,
                      });
                    }}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                </div>

                {/* 2. # of Phases */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A5568] mb-1 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#C8102E]" />
                    <span># of Phases</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={meta.numberOfPhases ?? 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onUpdateMeta({
                        ...meta,
                        numberOfPhases: isNaN(val) || val < 1 ? 1 : val,
                      });
                    }}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                </div>

                {/* 3. Phase Duration (Months) */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A5568] mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C8102E]" />
                    <span>Phase Duration (Months)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={meta.phaseDurationMonths ?? 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onUpdateMeta({
                        ...meta,
                        phaseDurationMonths: isNaN(val) || val < 1 ? 1 : val,
                      });
                    }}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Combined Façade Area & Wastage Box (Right - 6 cols on lg) */}
          <div className="bg-[#F8F9FA] p-4 border border-[#CBD5E1] shadow-2xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#CBD5E1]">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1A1A1A] font-['Red_Hat_Display']">
                Façade Surface & Wastage Sizing
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Façade Area */}
              <div>
                <label className="block text-[11px] font-bold text-[#1A1A1A] mb-1 font-['Red_Hat_Display']">
                  Façade Area (m²)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="5"
                    value={areaInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAreaInput(val);
                      // If the user overwrites the number that is produced in the Facade Area put these inputs back to blank
                      if (unitCountInput !== '' || unitSizeInput !== '') {
                        setUnitCountInput('');
                        setUnitSizeInput('');
                      }
                      if (val.trim() !== '') {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num > 0) {
                          handleAreaChange(num, { numberOfUnits: undefined, unitSizeM2: undefined });
                        }
                      }
                    }}
                    onBlur={() => {
                      const num = parseFloat(areaInput);
                      if (isNaN(num) || num < 1) {
                        setAreaInput('1');
                        handleAreaChange(1, { numberOfUnits: undefined, unitSizeM2: undefined });
                      } else {
                        setAreaInput(num.toString());
                        handleAreaChange(num, { numberOfUnits: undefined, unitSizeM2: undefined });
                      }
                    }}
                    className="w-full text-xl font-black text-[#C8102E] bg-white px-3 py-1.5 border-2 border-[#CBD5E1] focus:border-[#C8102E] focus:outline-none font-['Red_Hat_Display']"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">m²</span>
                </div>
              </div>

              {/* Wastage */}
              <div>
                <label className="block text-[11px] font-bold text-[#1A1A1A] mb-1 font-['Red_Hat_Display']">
                  Wastage Allowance (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="1"
                    value={wastageInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWastageInput(val);
                      if (val.trim() !== '') {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0) {
                          handleWastageChange(num);
                        }
                      }
                    }}
                    onBlur={() => {
                      const num = parseFloat(wastageInput);
                      if (isNaN(num) || num < 0) {
                        setWastageInput('0');
                        handleWastageChange(0);
                      } else {
                        setWastageInput(num.toString());
                        handleWastageChange(num);
                      }
                    }}
                    className="w-full text-xl font-bold text-[#1A1A1A] bg-white px-3 py-1.5 border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-semibold text-slate-400">%</span>
                </div>
              </div>
            </div>

            {/* Unit-Based Area Sizing (# of Units × Size of Units) */}
            <div className="pt-2.5 border-t border-[#CBD5E1]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. # of Units */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-[#4A5568] flex items-center gap-1.5">
                      <span># of Units</span>
                    </label>
                    {unitCountInput && unitSizeInput && (
                      <span className="text-[10px] font-mono font-bold text-[#C8102E]">
                        {unitCountInput} × {unitSizeInput}m²
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Blank"
                    value={unitCountInput}
                    onChange={(e) => handleUnitCountChange(e.target.value)}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                </div>

                {/* 2. Size of Units (m²) */}
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A5568] mb-1 flex items-center gap-1.5">
                    <span>Size of Units (m²)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Blank"
                    value={unitSizeInput}
                    onChange={(e) => handleUnitSizeChange(e.target.value)}
                    className="w-full text-xs font-mono font-bold text-[#1A1A1A] px-2.5 py-1.5 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E]"
                  />
                </div>
              </div>
            </div>

            {/* Quick Presets & Gross Area readout */}
            <div className="pt-2 border-t border-[#CBD5E1]/70 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#6B7280] font-medium mr-0.5">Presets:</span>
                {[0, 5, 7.5, 10, 15].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => handleWastageChange(pct)}
                    className={`text-[10px] px-1.5 py-0.5 border font-semibold transition-colors ${
                      meta.wasteagePercent === pct
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {pct === 0 ? '0%' : `+${pct}%`}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-[#4A5568] font-medium">
                Gross: <strong className="text-[#1A1A1A]">{(meta.areaM2 * (1 + meta.wasteagePercent / 100)).toFixed(1)} m²</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Global Discount Quick Control Bar in Document Theme */}
        <div className="bg-[#1A1A1A] text-white p-4.5 flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-[#C8102E]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#C8102E] flex items-center justify-center text-white shrink-0">
              <Percent className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-white font-['Red_Hat_Display']">
                Global Discount from List Controller
              </div>
              <div className="text-xs text-[#CBD5E1]">
                Adjust benchmark discount from catalog list price across line items. Each line is dynamically color-coordinated in the schedule.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[#2D3748] p-1 border border-slate-700">
              {[0, 5, 10, 15, 20, 25, 30].map((preset) => (
                <button
                  key={preset}
                  onClick={() => handleApplyOverallDiscount(preset)}
                  className={`text-xs px-2.5 py-1 font-bold transition-all ${
                    activeDiscount === preset
                      ? 'bg-[#C8102E] text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Custom:</span>
              <input
                type="number"
                min="0"
                max="90"
                step="0.5"
                value={customDiscountInput}
                onChange={(e) => setCustomDiscountInput(e.target.value)}
                onBlur={() => handleApplyOverallDiscount(parseFloat(customDiscountInput) || 0)}
                className="w-16 text-xs font-bold px-2 py-1 bg-white border border-slate-300 text-[#1A1A1A] text-center focus:outline-none focus:border-[#C8102E]"
              />
              <button
                onClick={() => handleApplyOverallDiscount(parseFloat(customDiscountInput) || 0)}
                className="text-xs bg-[#C8102E] hover:bg-[#8A1538] text-white px-3 py-1 font-bold transition-colors"
              >
                Apply All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Products Schedule Table - Separated into Main Façade System and Ancillaries */}
      <div className="space-y-6">
        {/* ============================================================== */}
        {/* SECTION 1: MAIN FAÇADE SYSTEM SCHEDULE (CALCULATED PER m²)    */}
        {/* ============================================================== */}
        <div className="bg-white border border-[#E2E8F0] shadow-2xs overflow-hidden">
          {/* Table Header & Controls */}
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8F9FA] flex flex-col gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#C8102E]"></span>
                <h3 className="font-bold text-[#1A1A1A] text-base flex items-center gap-2 font-['Red_Hat_Display']">
                  Main Façade System Schedule ({systemItems.length} Components, Calculated per m²)
                </h3>
              </div>
              <p className="text-xs text-[#6B7280] mt-0.5 ml-4.5">
                System components for the main façade calculated on coverage area.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-[#E2E8F0]">
              <div className="flex flex-wrap items-center gap-3">
                {/* Quick searchable product browser button */}
                <button
                  onClick={() => setShowProductPickerModal(true)}
                  className="text-xs px-3 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white font-bold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Browse All Catalog Products</span>
                </button>

                {/* Admin Users Only: Margin & Gross Profit Controls */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-1 bg-white border border-amber-300/80 shadow-2xs">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-900 font-['Red_Hat_Display'] pr-2 border-r border-amber-200">
                    <Lock className="w-3 h-3 text-[#C8102E] shrink-0" />
                    <span>Admin Users Only</span>
                  </div>

                  {/* Toggle margin column */}
                  <button
                    onClick={() => setShowMarginColumn(!showMarginColumn)}
                    className={`text-xs px-2.5 py-1 border font-semibold flex items-center gap-1.5 transition-colors ${
                      showMarginColumn
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                    title="Toggle visibility of the Margin % column"
                  >
                    <Percent className="w-3.5 h-3.5 text-amber-500" />
                    {showMarginColumn ? 'Hide Margin' : 'Show Margin'}
                  </button>

                  {/* Toggle gross profit column */}
                  <button
                    onClick={() => setShowGrossProfitColumn(!showGrossProfitColumn)}
                    className={`text-xs px-2.5 py-1 border font-semibold flex items-center gap-1.5 transition-colors ${
                      showGrossProfitColumn
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                    title="Toggle visibility of the Gross Profit (£) column"
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    {showGrossProfitColumn ? 'Hide Gross Profit' : 'Show Gross Profit'}
                  </button>
                </div>
              </div>

              {/* Clear All Products Button (Right-aligned) */}
              {items.length > 0 && (
                <div className="flex items-center gap-1.5 ml-auto">
                  {confirmingClearAll ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateItems([]);
                          setConfirmingClearAll(false);
                        }}
                        className="text-xs px-3.5 py-1.5 bg-[#C8102E] hover:bg-[#A00C24] text-white font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer animate-pulse"
                        title="Click to permanently clear all items from quote"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0 text-white" />
                        <span>Confirm Clear All ({items.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingClearAll(false)}
                        className="text-xs px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold transition-colors cursor-pointer"
                        title="Cancel clear action"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingClearAll(true)}
                      className="text-xs px-3.5 py-1.5 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-300 hover:border-rose-600 font-bold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                      title="Clear all line items from quote"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Clear All Products ({items.length})</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Items Table for System Items */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[#F8F9FA] text-[#1A1A1A] font-bold border-b border-[#CBD5E1] uppercase tracking-wider text-[11px] font-['Red_Hat_Display']">
                  <th className="px-3 py-3 text-center w-12">#</th>
                  <th className="px-4 py-3">Product / Specification</th>
                  <th className="px-3 py-3 text-center">Unit</th>
                  <th className="px-3 py-3 text-center">Consumption Rate / m²</th>
                  <th className="px-3 py-3 text-right">
                    <span className="block">Calculated Qty</span>
                    <span className="text-[9px] text-[#00A887] font-bold uppercase tracking-wider">▲ Whole Units</span>
                  </th>
                  <th className="px-3 py-3 text-center">
                    Final Quantity
                  </th>
                  
                  {/* Internal Columns (Toggleable) */}
                  {showInternalFinancials && (
                    <>
                      <th className="px-3 py-3 text-right text-slate-700 bg-slate-100">List Price (£)</th>
                      <th className="px-3 py-3 text-center text-slate-900 bg-slate-200/80">Discount from List (%)</th>
                    </>
                  )}

                  <th className="px-3 py-3 text-right font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                    Unit Price
                  </th>
                  {showMarginColumn && (
                    <th className="px-3 py-3 text-center font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                      <span className="block">Margin (%)</span>
                      <span className="text-[9px] text-[#4A5568] font-normal font-mono">From Cost</span>
                    </th>
                  )}
                  {showGrossProfitColumn && (
                    <th className="px-3 py-3 text-right font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                      <span className="block">Gross Profit (£)</span>
                      <span className="text-[9px] text-emerald-700 font-bold uppercase tracking-wider font-mono">Total Profit</span>
                    </th>
                  )}
                  <th className="px-4 py-3 text-right font-black text-[#1A1A1A] bg-[#F1F3F5]">
                    <span className="block">£/m² Price</span>
                    <span className="text-[9px] text-[#C8102E] font-bold uppercase tracking-wider font-mono">System Rate</span>
                  </th>
                  <th className="px-3 py-3 text-center w-20">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#CBD5E1]/60 bg-white">
                {systemItems.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center bg-slate-50 text-slate-500">
                      <p className="font-bold text-sm text-[#1A1A1A] mb-1">No Main System Products Currently Added</p>
                      <p className="text-xs text-slate-500 mb-3">
                        Browse the product catalog or add custom items to build your quotation.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowProductPickerModal(true)}
                        className="px-3.5 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white font-bold text-xs transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Browse Catalog Products</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  systemItems.map((item, idx) => {
                  const stage = getProductApplicationStage(item);
                  const isLessThanOne = isUnitCoversLessThanOneM2(item);
                  const itemDiscount = item.discountPercent ?? item.marginPercent ?? 0;
                  const discountStyle = getDiscountColorStyle(itemDiscount);
                  const itemPricePerM2 = item.pricePerM2 ?? calculateItemPricePerM2(item.unitSellPrice, item.consumptionRatePerM2 || (isLessThanOne ? 0.72 : 1), false, isLessThanOne);

                  return (
                    <tr 
                      key={item.id} 
                      className={`${discountStyle.rowBg} ${discountStyle.borderLeft} transition-colors border-b border-[#CBD5E1]/60`}
                    >
                      {/* Step Sequence # */}
                      <td className="px-3 py-3 text-center font-mono text-xs font-bold text-slate-600">
                        {idx + 1}
                      </td>

                      {/* Product Details with Category Stage Color Badging */}
                      <td className="px-4 py-3 max-w-sm">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-[11px]">
                          {/* Build-Up Sequence Category Badge */}
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 border ${stage.badgeBg} ${stage.badgeColor} ${stage.badgeBorder} font-['Red_Hat_Display'] shadow-2xs`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${stage.dotColor}`}></span>
                            {stage.stageName}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono font-bold text-black text-xs bg-slate-100 px-1.5 py-0.2 border border-black">
                            {item.sku}
                          </span>
                        </div>
                        <div className="font-bold text-[#1A1A1A] mt-0.5 line-clamp-2 text-xs">
                          {item.description}
                        </div>
                        {item.coverageNotes && (
                          <div className="text-[11px] text-slate-500 mt-0.5 italic flex items-center gap-1.5 flex-wrap">
                            <span>{item.coverageNotes}</span>
                          </div>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-3 text-center font-medium text-slate-700">
                        {item.unit}
                      </td>

                      {/* Consumption Rate per m2 */}
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex items-center justify-center">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={item.consumptionRatePerM2}
                            onChange={(e) => handleLineConsumptionRateChange(item.id, parseFloat(e.target.value) || 0)}
                            className="w-18 text-center text-xs font-mono font-bold py-1 px-1.5 border border-[#CBD5E1] bg-white focus:border-[#C8102E] focus:outline-none"
                          />
                        </div>
                      </td>

                      {/* Calculated Qty (Always whole unit rounded up) */}
                      <td className="px-3 py-3 text-right font-mono text-slate-800 font-bold">
                        {item.calculatedQuantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>

                      {/* Final Quantity (Overrideable by User) */}
                      <td className="px-3 py-3 text-center">
                        <div className="relative inline-block">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined ? item.manualQuantityOverride : item.finalQuantity}
                            onChange={(e) => handleLineQuantityChange(item.id, e.target.value)}
                            className={`w-24 text-center text-xs font-mono font-bold py-1 px-2 border focus:outline-none ${
                              item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
                                ? 'border-amber-500 bg-amber-50 text-amber-900 font-black shadow-2xs'
                                : 'border-[#CBD5E1] bg-white text-[#1A1A1A]'
                            }`}
                          />
                          {item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined && (
                            <button
                              onClick={() => handleLineQuantityChange(item.id, '')}
                              title="Reset to calculated formula quantity"
                              className="absolute -top-1.5 -right-2 w-4 h-4 bg-amber-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs hover:bg-amber-700"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </td>

                      {/* INTERNAL: List Price */}
                      {showInternalFinancials && (
                        <td className="px-3 py-3 text-right font-mono text-slate-700 font-semibold bg-white/40">
                          £{(item.listPrice ?? item.unitCost ?? 0).toFixed(2)}
                        </td>
                      )}

                      {/* INTERNAL: Discount from List % */}
                      {showInternalFinancials && (
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max="99"
                              step="1"
                              value={itemDiscount}
                              onChange={(e) => handleLineDiscountChange(item.id, parseFloat(e.target.value) || 0)}
                              className={`w-14 text-center font-mono font-black text-xs py-1 px-1 border bg-white shadow-2xs focus:outline-none ${discountStyle.inputBorder}`}
                            />
                            <span className="text-[11px] font-black text-slate-700 font-mono">%</span>
                          </div>
                        </td>
                      )}

                      {/* CLIENT Unit Sell Price (Editable) */}
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="inline-flex items-center justify-end gap-1">
                            <span className="text-xs font-mono font-bold text-slate-700">£</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unitSellPrice}
                              onChange={(e) => handleLinePriceChange(item.id, parseFloat(e.target.value) || 0)}
                              className={`w-20 text-right font-mono font-bold text-xs py-1 px-1.5 border ${
                                item.unitSellPrice <= 0
                                  ? 'border-amber-400 bg-amber-50 text-amber-900 focus:border-[#C8102E]'
                                  : 'border-[#CBD5E1] bg-white text-[#1A1A1A] focus:border-[#C8102E]'
                              } shadow-2xs`}
                            />
                          </div>
                          {item.unitSellPrice <= 0 && (
                            <span className="text-[9px] font-bold text-amber-800 uppercase tracking-tight bg-amber-100 px-1 py-0.2 border border-amber-300 font-mono">
                              POA / Set Price
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Margin % from Cost Price (Editable) */}
                      {showMarginColumn && (
                        <td className="px-3 py-3 text-center">
                          {(() => {
                            if (item.costPrice === undefined) {
                              return <span className="text-slate-400 font-mono text-xs" title="No cost price available in catalog">—</span>;
                            }
                            const cost = item.costPrice;
                            const marginVal = item.marginPercent !== undefined 
                              ? Math.round(item.marginPercent * 10) / 10
                              : (item.unitSellPrice > 0 ? Math.round(((item.unitSellPrice - cost) / item.unitSellPrice) * 1000) / 10 : 0);
                            const color = marginVal >= 30 
                              ? 'border-emerald-300 text-emerald-800 bg-emerald-50/50' 
                              : marginVal >= 15 
                                ? 'border-blue-300 text-blue-800 bg-blue-50/50' 
                                : marginVal >= 0 
                                  ? 'border-amber-300 text-amber-800 bg-amber-50/50' 
                                  : 'border-rose-300 text-rose-800 bg-rose-50/50';

                            return (
                              <div className="inline-flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  step="0.1"
                                  max="95"
                                  value={marginVal}
                                  onChange={(e) => handleLineMarginChange(item.id, parseFloat(e.target.value) || 0)}
                                  className={`w-16 text-center font-mono font-bold text-xs py-1 px-1 border bg-white focus:outline-none focus:border-[#C8102E] shadow-2xs ${color}`}
                                />
                                <span className="text-[11px] font-mono font-bold text-slate-600">%</span>
                              </div>
                            );
                          })()}
                        </td>
                      )}

                      {/* Gross Profit (£) */}
                      {showGrossProfitColumn && (
                        <td className="px-3 py-3 text-right font-mono font-bold text-xs">
                          {(() => {
                            if (item.costPrice === undefined) {
                              return <span className="text-slate-400 font-mono text-xs" title="No cost price available in catalog">—</span>;
                            }
                            const cost = item.costPrice;
                            const lineSell = item.finalQuantity * item.unitSellPrice;
                            const lineCost = item.finalQuantity * cost;
                            const profit = Math.round((lineSell - lineCost) * 100) / 100;
                            const isPositive = profit >= 0;

                            return (
                              <div className="flex flex-col items-end">
                                <span className={`font-black ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  £{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <span className="text-[9px] text-slate-500 font-normal">
                                  (£{(item.unitSellPrice - cost).toFixed(2)}/unit)
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                      )}

                      {/* CLIENT £/m² Price */}
                      <td className="px-4 py-3 text-right font-mono font-black text-sm">
                        {item.excludeFromM2Rate ? (
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300">
                              <Ban className="w-3 h-3 text-amber-700" />
                              <span>Excluded</span>
                            </span>
                            <span className="text-[10px] text-slate-500 font-normal mt-0.5">
                              Line: £{(item.finalQuantity * item.unitSellPrice).toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <span className="text-[#1A1A1A]">£{itemPricePerM2.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-500 font-normal ml-1">/ m²</span>
                          </div>
                        )}
                      </td>

                      {/* Action Column: Exclude £/m² Icon & Delete */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleToggleExcludeFromM2Rate(item.id)}
                            title={
                              item.excludeFromM2Rate
                                ? 'Item is excluded from £/m² rate (Click to re-include in rate)'
                                : 'Exclude this item from £/m² rate calculation'
                            }
                            className={`p-1.5 transition-colors ${
                              item.excludeFromM2Rate
                                ? 'text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300'
                                : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                            }`}
                          >
                            <Ban className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDuplicateLineItem(item.id)}
                            title="Duplicate this line item (e.g. for Phase 2 or separate area)"
                            className="text-slate-400 hover:text-blue-600 p-1.5 hover:bg-blue-50 transition-colors"
                          >
                            <Copy className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => onRemoveItem(item.id)}
                            title="Remove product from quote"
                            className="text-slate-400 hover:text-rose-600 p-1.5 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>

          {/* Subtotal Bar for Main System */}
          <div className="px-6 py-3.5 bg-[#F8F9FA] border-t border-[#CBD5E1] flex flex-wrap items-center justify-between gap-4 text-xs font-['Red_Hat_Display']">
            <div className="text-slate-600">
              <span className="font-bold text-[#1A1A1A]">Main System Coverage:</span> {meta.areaM2} m² Façade (+{meta.wasteagePercent}% wastage allowance)
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {showGrossProfitColumn && (() => {
                const itemsWithCost = systemItems.filter((i) => i.costPrice !== undefined);
                if (itemsWithCost.length === 0) {
                  return (
                    <div className="bg-slate-100 px-3.5 py-1.5 border border-slate-300 shadow-2xs flex items-baseline gap-2">
                      <span className="text-sm font-bold text-slate-700 tracking-tight">Main System Profit:</span>
                      <span className="font-mono text-xs text-slate-500 italic">No cost data</span>
                    </div>
                  );
                }
                const profit = itemsWithCost.reduce((acc, i) => acc + (i.finalQuantity * (i.unitSellPrice - (i.costPrice || 0))), 0);
                const isPartial = itemsWithCost.length < systemItems.length;
                return (
                  <div className="bg-emerald-50 px-3.5 py-1.5 border border-emerald-200 shadow-2xs flex items-baseline gap-2">
                    <span className="text-sm font-bold text-emerald-800 tracking-tight">Main System Profit:</span>
                    <span className="font-mono font-black text-base text-emerald-700">
                      £{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {isPartial && <span className="text-[10px] font-normal text-slate-500 ml-1">({itemsWithCost.length}/{systemItems.length} items)</span>}
                    </span>
                  </div>
                );
              })()}
              <div className="bg-red-50/90 px-3.5 py-1.5 border border-red-200 shadow-2xs flex items-baseline gap-2">
                <span className="text-sm font-bold text-[#C8102E] tracking-tight">Total System m² Price:</span>
                <span className="font-mono font-black text-base text-[#C8102E]">
                  £{netRatePerM2.toFixed(2)} <span className="text-xs font-semibold text-red-700 font-sans">/ m²</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* SECTION 2: ANCILLARIES (INDIVIDUAL ITEM PRICING)              */}
        {/* ============================================================== */}
        <div className="bg-white border border-[#E2E8F0] shadow-2xs overflow-hidden">
          {/* Ancillaries Section Header */}
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8F9FA] flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#1A1A1A]"></span>
                <h3 className="font-bold text-[#1A1A1A] text-lg flex items-center gap-2 font-['Red_Hat_Display']">
                  Ancillaries
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-slate-200 text-slate-800">
                  Individual Item Prices · Excluded from m² Rate
                </span>
                <span className="text-xs font-mono text-slate-500 font-bold">
                  ({ancillaryItems.length} {ancillaryItems.length === 1 ? 'item' : 'items'})
                </span>
              </div>
              <p className="text-xs text-[#6B7280] mt-0.5 ml-4.5">
                Perimeter starter rails, stop beads, corner angle beads, expansion joints and sealing tapes cannot be calculated on a m² rate and are treated as individual item prices.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowProductPickerModal(true)}
                className="text-xs px-3 py-1.5 bg-[#1A1A1A] hover:bg-black text-white font-bold flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>+ Add Ancillary from Catalog</span>
              </button>
            </div>
          </div>

          {ancillaryItems.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F8F9FA] text-[#1A1A1A] font-bold border-b border-[#CBD5E1] uppercase tracking-wider text-[11px] font-['Red_Hat_Display']">
                      <th className="px-3 py-3 text-center w-12">#</th>
                      <th className="px-4 py-3">Ancillary Product & Specification</th>
                      <th className="px-3 py-3 text-center">Unit</th>
                      <th className="px-3 py-3 text-center">Quantity</th>
                      
                      {/* Internal Columns (Toggleable) */}
                      {showInternalFinancials && (
                        <>
                          <th className="px-3 py-3 text-right text-slate-700 bg-slate-100">List Price (£)</th>
                          <th className="px-3 py-3 text-center text-slate-900 bg-slate-200/80">Discount from List (%)</th>
                        </>
                      )}

                      <th className="px-3 py-3 text-right font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                        Unit Price
                      </th>
                      {showMarginColumn && (
                        <th className="px-3 py-3 text-center font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                          <span className="block">Margin (%)</span>
                          <span className="text-[9px] text-[#4A5568] font-normal font-mono">From Cost</span>
                        </th>
                      )}
                      {showGrossProfitColumn && (
                        <th className="px-3 py-3 text-right font-bold text-[#1A1A1A] bg-[#F1F3F5]">
                          <span className="block">Gross Profit (£)</span>
                          <span className="text-[9px] text-emerald-700 font-bold uppercase tracking-wider font-mono">Total Profit</span>
                        </th>
                      )}
                      <th className="px-4 py-3 text-right font-black text-[#1A1A1A] bg-[#F1F3F5]">
                        <span className="block">Total Price (£)</span>
                        <span className="text-[9px] text-[#00A887] font-bold uppercase tracking-wider font-mono">Item Total</span>
                      </th>
                      <th className="px-3 py-3 text-center">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#CBD5E1]/60 bg-white">
                    {ancillaryItems.map((item, idx) => {
                      const stage = getProductApplicationStage(item);
                      const itemDiscount = item.discountPercent ?? item.marginPercent ?? 0;
                      const discountStyle = getDiscountColorStyle(itemDiscount);
                      const lineTotal = item.finalQuantity * item.unitSellPrice;

                      return (
                        <tr 
                          key={item.id} 
                          className={`${discountStyle.rowBg} ${discountStyle.borderLeft} transition-colors border-b border-[#CBD5E1]/60`}
                        >
                          {/* Step Sequence # */}
                          <td className="px-3 py-3 text-center font-mono text-xs font-bold text-slate-600">
                            A{idx + 1}
                          </td>

                          {/* Product Details with Stage 7 Color Badge */}
                          <td className="px-4 py-3 max-w-sm">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-[11px]">
                              {/* Build-Up Sequence Category Badge */}
                              <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 border ${stage.badgeBg} ${stage.badgeColor} ${stage.badgeBorder} font-['Red_Hat_Display'] shadow-2xs`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${stage.dotColor}`}></span>
                                {stage.stageName}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="font-mono font-bold text-black text-xs bg-slate-100 px-1.5 py-0.2 border border-black">
                                {item.sku}
                              </span>
                            </div>
                            <div className="font-bold text-[#1A1A1A] mt-0.5 line-clamp-2 text-xs">
                              {item.description}
                            </div>
                            {item.coverageNotes && (
                              <div className="text-[11px] text-slate-500 mt-0.5 italic">
                                {item.coverageNotes}
                              </div>
                            )}
                          </td>

                          {/* Unit */}
                          <td className="px-3 py-3 text-center font-medium text-slate-700">
                            {item.unit}
                          </td>

                          {/* Quantity (Editable input) */}
                          <td className="px-3 py-3 text-center">
                            <div className="relative inline-block">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined ? item.manualQuantityOverride : item.finalQuantity}
                                onChange={(e) => handleLineQuantityChange(item.id, e.target.value)}
                                className="w-22 text-center text-xs font-mono font-bold py-1 px-2 border border-[#CBD5E1] bg-white text-[#1A1A1A] focus:outline-none focus:border-[#C8102E]"
                              />
                            </div>
                          </td>

                          {/* INTERNAL: List Price */}
                          {showInternalFinancials && (
                            <td className="px-3 py-3 text-right font-mono text-slate-700 font-semibold bg-white/40">
                              £{(item.listPrice ?? item.unitCost ?? 0).toFixed(2)}
                            </td>
                          )}

                          {/* INTERNAL: Discount from List % */}
                          {showInternalFinancials && (
                            <td className="px-3 py-3 text-center">
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="99"
                                  step="1"
                                  value={itemDiscount}
                                  onChange={(e) => handleLineDiscountChange(item.id, parseFloat(e.target.value) || 0)}
                                  className={`w-14 text-center font-mono font-black text-xs py-1 px-1 border bg-white shadow-2xs focus:outline-none ${discountStyle.inputBorder}`}
                                />
                                <span className="text-[11px] font-black text-slate-700 font-mono">%</span>
                              </div>
                            </td>
                          )}

                          {/* CLIENT Unit Sell Price (Editable) */}
                          <td className="px-3 py-3 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="inline-flex items-center justify-end gap-1">
                                <span className="text-xs font-mono font-bold text-slate-700">£</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.unitSellPrice}
                                  onChange={(e) => handleLinePriceChange(item.id, parseFloat(e.target.value) || 0)}
                                  className={`w-20 text-right font-mono font-bold text-xs py-1 px-1.5 border ${
                                    item.unitSellPrice <= 0
                                      ? 'border-amber-400 bg-amber-50 text-amber-900 focus:border-[#C8102E]'
                                      : 'border-[#CBD5E1] bg-white text-[#1A1A1A] focus:border-[#C8102E]'
                                  } shadow-2xs`}
                                />
                              </div>
                              {item.unitSellPrice <= 0 && (
                                <span className="text-[9px] font-bold text-amber-800 uppercase tracking-tight bg-amber-100 px-1 py-0.2 border border-amber-300 font-mono">
                                  POA / Set Price
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Margin % from Cost Price (Editable) */}
                          {showMarginColumn && (
                            <td className="px-3 py-3 text-center">
                              {(() => {
                                if (item.costPrice === undefined) {
                                  return <span className="text-slate-400 font-mono text-xs" title="No cost price available in catalog">—</span>;
                                }
                                const cost = item.costPrice;
                                const marginVal = item.marginPercent !== undefined 
                                  ? Math.round(item.marginPercent * 10) / 10
                                  : (item.unitSellPrice > 0 ? Math.round(((item.unitSellPrice - cost) / item.unitSellPrice) * 1000) / 10 : 0);
                                const color = marginVal >= 30 
                                  ? 'border-emerald-300 text-emerald-800 bg-emerald-50/50' 
                                  : marginVal >= 15 
                                    ? 'border-blue-300 text-blue-800 bg-blue-50/50' 
                                    : marginVal >= 0 
                                      ? 'border-amber-300 text-amber-800 bg-amber-50/50' 
                                      : 'border-rose-300 text-rose-800 bg-rose-50/50';

                                return (
                                  <div className="inline-flex items-center justify-center gap-1">
                                    <input
                                      type="number"
                                      step="0.1"
                                      max="95"
                                      value={marginVal}
                                      onChange={(e) => handleLineMarginChange(item.id, parseFloat(e.target.value) || 0)}
                                      className={`w-16 text-center font-mono font-bold text-xs py-1 px-1 border bg-white focus:outline-none focus:border-[#C8102E] shadow-2xs ${color}`}
                                    />
                                    <span className="text-[11px] font-mono font-bold text-slate-600">%</span>
                                  </div>
                                );
                              })()}
                            </td>
                          )}

                          {/* Gross Profit (£) */}
                          {showGrossProfitColumn && (
                            <td className="px-3 py-3 text-right font-mono font-bold text-xs">
                              {(() => {
                                if (item.costPrice === undefined) {
                                  return <span className="text-slate-400 font-mono text-xs" title="No cost price available in catalog">—</span>;
                                }
                                const cost = item.costPrice;
                                const lineSell = item.finalQuantity * item.unitSellPrice;
                                const lineCost = item.finalQuantity * cost;
                                const profit = Math.round((lineSell - lineCost) * 100) / 100;
                                const isPositive = profit >= 0;

                                return (
                                  <div className="flex flex-col items-end">
                                    <span className={`font-black ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                                      £{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[9px] text-slate-500 font-normal">
                                      (£{(item.unitSellPrice - cost).toFixed(2)}/unit)
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>
                          )}

                          {/* CLIENT Total Item Price (£) - Not on m2 rate! */}
                          <td className="px-4 py-3 text-right font-mono font-black text-[#1A1A1A] text-sm">
                            £{lineTotal.toFixed(2)}
                          </td>

                          {/* Delete Action */}
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => onRemoveItem(item.id)}
                              title="Remove ancillary product from quote"
                              className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Subtotal Bar for Ancillaries */}
              <div className="px-6 py-3.5 bg-[#F8F9FA] border-t border-[#CBD5E1] flex flex-wrap items-center justify-between gap-4 text-xs font-['Red_Hat_Display']">
                <div className="text-slate-600">
                  <span className="font-bold text-[#1A1A1A]">Ancillaries Pricing Mode:</span> Individual items priced per unit (independent of square metre surface rate)
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {showGrossProfitColumn && (() => {
                    const itemsWithCost = ancillaryItems.filter((i) => i.costPrice !== undefined);
                    if (itemsWithCost.length === 0) {
                      return (
                        <div className="bg-slate-100 px-3.5 py-1.5 border border-slate-300 shadow-2xs flex items-baseline gap-2">
                          <span className="text-sm font-bold text-slate-700 tracking-tight">Ancillaries Profit:</span>
                          <span className="font-mono text-xs text-slate-500 italic">No cost data</span>
                        </div>
                      );
                    }
                    const profit = itemsWithCost.reduce((acc, i) => acc + (i.finalQuantity * (i.unitSellPrice - (i.costPrice || 0))), 0);
                    const isPartial = itemsWithCost.length < ancillaryItems.length;
                    return (
                      <div className="bg-emerald-50 px-3.5 py-1.5 border border-emerald-200 shadow-2xs flex items-baseline gap-2">
                        <span className="text-sm font-bold text-emerald-800 tracking-tight">Ancillaries Profit:</span>
                        <span className="font-mono font-black text-base text-emerald-700">
                          £{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          {isPartial && <span className="text-[10px] font-normal text-slate-500 ml-1">({itemsWithCost.length}/{ancillaryItems.length} items)</span>}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="bg-slate-100 px-3.5 py-1.5 border border-slate-300 shadow-2xs flex items-baseline gap-2">
                    <span className="text-sm font-bold text-slate-900 tracking-tight">Total Ancillaries:</span>
                    <span className="font-mono font-black text-base text-[#1A1A1A]">
                      £{ancillariesTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-6 text-center bg-slate-50/50 text-slate-500 space-y-2">
              <p className="text-xs">No ancillary items currently in the schedule.</p>
              <p className="text-[11px] text-slate-400">
                Base rails, corner beads, stop beads, movement trims, and expanding tapes can be added and will be priced as individual items.
              </p>
              <button
                onClick={() => setShowProductPickerModal(true)}
                className="text-xs bg-[#1A1A1A] hover:bg-black text-white font-bold px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Ancillaries
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Summary & PDF Export Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Notes and Terms */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] p-6 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2.5 pb-2 border-b border-[#E2E8F0]">
            <span className="w-2.5 h-2.5 bg-[#C8102E]"></span>
            <h3 className="font-bold text-[#1A1A1A] text-sm uppercase tracking-wider font-['Red_Hat_Display']">
              Terms & Technical Notes
            </h3>
          </div>

          {/* Quote Notes for Client PDF */}
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1 font-['Red_Hat_Display']">
              Quotation Compliance Notes (Included on Exported PDF):
            </label>
            <textarea
              rows={14}
              value={meta.notesAndTerms}
              onChange={(e) => onUpdateMeta({ ...meta, notesAndTerms: e.target.value })}
              className="w-full min-h-[260px] text-xs p-3 border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E] font-sans bg-white leading-relaxed resize-y font-normal"
              placeholder="System warranties, technical compliance notes, and validity conditions..."
            />
          </div>

          <div className="p-3 bg-[#F8F9FA] border-l-4 border-l-[#C8102E] border border-[#CBD5E1] flex items-start gap-2.5 text-xs text-[#4A5568]">
            <Info className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-[#1A1A1A]">Pre-Issue Verification Required:</span> Please double check all quantities, m² rates, consumption rates, waste allowances, and prices before issuing a quotation to the client. When exported to PDF, internal wholesale costs and margins are automatically excluded.
            </div>
          </div>
        </div>

        {/* Right: Quotation m2 Rate Summary & PDF Generation Button */}
        <div className="bg-[#1A1A1A] text-white border border-[#1A1A1A] p-6 flex flex-col justify-between space-y-6 shadow-md">
          <div>
            <div className="border-b border-slate-800 pb-3 mb-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 font-['Red_Hat_Display']">
                  Quotation Rate Summary (per m²)
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-[#C8102E] text-white font-bold font-mono">
                  REF: {meta.quoteNumber}
                </span>
              </div>
              <div className="text-xs font-bold text-white break-words font-['Red_Hat_Display']">
                {meta.projectName || 'External Façade Specification'}
              </div>
              <div className="text-[11px] text-slate-300 break-words flex items-center justify-between">
                <span>For: <span className="font-semibold text-white">{meta.clientName || 'Valued Customer'}</span> {meta.clientCompany ? `(${meta.clientCompany})` : ''}</span>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5">{meta.areaM2} m² Façade</span>
              </div>
              {meta.technicalSalesManager && (
                <div className="text-[10px] text-amber-300/90 font-mono flex items-center justify-between">
                  <span>Sales Manager:</span>
                  <span className="font-semibold text-white">{meta.technicalSalesManager}</span>
                </div>
              )}
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/80 font-mono">
                <span>Issued: <span className="text-slate-200 font-medium">{toDisplayDateFormat(meta.date)}</span></span>
                <span>Expires: <span className="text-red-400 font-bold">{toDisplayDateFormat(meta.validUntil)}</span></span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {meta.includeInstallationEstimate && (
                <div className="flex justify-between text-slate-300">
                  <span>Installation Allowance:</span>
                  <span className="font-mono font-semibold text-white">£{installationRatePerM2.toFixed(2)} / m²</span>
                </div>
              )}

              {/* Internal List Rate & Discount Indicator */}
              {showInternalFinancials && (
                <div className="pt-2 border-t border-slate-800 text-[11px] space-y-1 bg-[#2D3748]/50 p-2.5 border border-slate-700">
                  <div className="flex justify-between text-slate-400">
                    <span>Catalog List Rate:</span>
                    <span className="font-mono">£{listRatePerM2.toFixed(2)} / m²</span>
                  </div>
                  <div className="flex justify-between text-[#00A887] font-bold">
                    <span>Discount from List Savings:</span>
                    <span className="font-mono">-£{discountSavingsRate.toFixed(2)} / m² ({averageDiscountPercent.toFixed(1)}%)</span>
                  </div>
                </div>
              )}

              {/* Client Total System m2 Price */}
              <div className="pt-3 border-t border-slate-700 flex justify-between items-baseline">
                <div>
                  <span className="text-sm font-bold text-white font-['Red_Hat_Display'] block">
                    Total System m² Price:
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black font-mono text-[#C8102E]">
                    £{netRatePerM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-300 font-mono block">/ m²</span>
                </div>
              </div>

              {/* System Materials Total (Reflecting wastage, pack rounding & final quantities) */}
              <div className="pt-2 border-t border-slate-800 space-y-0.5">
                <div className="flex justify-between text-slate-300">
                  <span>System Materials Total:</span>
                  <span className="font-mono font-semibold text-white">
                    £{systemItemsTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {meta.wasteagePercent > 0 ? `(Inc. ${meta.wasteagePercent}% wastage & order quantities)` : '(From order quantities)'}
                </div>
              </div>

              {/* Excluded System Items Breakdown */}
              {excludedSystemItemsTotalNet > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 uppercase tracking-wider font-['Red_Hat_Display']">
                    <span>Excluded from £/m² ({systemItems.filter((i) => i.excludeFromM2Rate).length} items)</span>
                    <span className="text-[9px] bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.5">Separate Line Total</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Excluded Items Total:</span>
                    <span className="font-mono font-semibold text-white">
                      £{excludedSystemItemsTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              {/* Ancillaries Breakdown (Treated as individual item prices, NOT on m² rate) */}
              {ancillaryItems.length > 0 && (
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider font-['Red_Hat_Display']">
                    <span>Ancillaries ({ancillaryItems.length} items)</span>
                    <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5">Individual Pricing</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Ancillaries Total:</span>
                    <span className="font-mono font-semibold text-white">
                      £{ancillariesTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              {/* Combined Overall Project Investment */}
              <div className="pt-2 border-t border-slate-700 flex justify-between items-baseline bg-black/40 p-2.5 border border-slate-800 mt-2">
                <div>
                  <span className="text-xs font-bold text-slate-200 font-['Red_Hat_Display'] block">Overall Project Total:</span>
                  <span className="text-[9px] text-slate-400 font-mono">
                    {ancillaryItems.length > 0 || excludedSystemItemsTotalNet > 0
                      ? `(System Materials + ${ancillaryItems.length > 0 && excludedSystemItemsTotalNet > 0 ? 'Ancillaries & Excluded' : ancillaryItems.length > 0 ? 'Ancillaries' : 'Excluded Items'})`
                      : '(Net Project Investment)'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black font-mono text-white">
                    £{totalProjectNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button: Export Client PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExporting || items.length === 0}
            className="w-full bg-[#C8102E] hover:bg-[#8A1538] text-white font-black py-3.5 px-4 text-sm flex items-center justify-center gap-2.5 transition-colors shadow-sm disabled:opacity-50 font-['Red_Hat_Display'] uppercase tracking-wider"
          >
            {isExporting ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <FileDown className="w-5 h-5" />
            )}
            <span>Export Client PDF Quotation</span>
          </button>

          {/* Action Button: Save to Google Sheets (Quotes & Quote Items tabs) */}
          <button
            onClick={() => handleSaveToGoogleSheets(false)}
            disabled={isSaving || items.length === 0}
            className="w-full bg-[#1A1A1A] hover:bg-black text-white font-black py-3 px-4 text-xs flex items-center justify-center gap-2 transition-colors shadow-xs border border-slate-700 disabled:opacity-50 font-['Red_Hat_Display'] uppercase tracking-wider"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin text-[#C8102E]" />
            ) : (
              <Save className="w-4 h-4 text-emerald-400" />
            )}
            <span>Save</span>
          </button>

          {/* Save Status / Feedback Alert */}
          {saveFeedback && (
            <div
              className={`p-2.5 text-xs flex items-center justify-between gap-2 border font-bold transition-all shadow-xs ${
                saveFeedback.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300'
                  : 'bg-red-950/90 border-red-500 text-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {saveFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="font-['Red_Hat_Display'] tracking-wide uppercase text-xs">
                  {saveFeedback.type === 'success' ? 'Successfully Saved' : 'Save Failed'}
                </span>
              </div>
              <button
                onClick={() => setSaveFeedback(null)}
                className="text-slate-400 hover:text-white text-xs px-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. Full Catalog Product Picker Modal with Multi-Search Tick Box Support */}
      {showProductPickerModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white border border-[#CBD5E1] max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-[#1A1A1A] text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-[#C8102E] flex items-center justify-center text-white shrink-0">
                  <PackagePlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm font-['Red_Hat_Display']">
                    Add Products from Google Sheet Catalog ({availableProducts.length} Total)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Tick checkboxes to select multiple items across searches, then add them all together.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {selectedProductsMap.size > 0 && (
                  <button
                    onClick={handleAddAllSelectedToQuote}
                    className="px-3.5 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white text-xs font-black flex items-center gap-1.5 transition-colors shadow-xs uppercase tracking-wider font-['Red_Hat_Display']"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add {selectedProductsMap.size} Selected</span>
                  </button>
                )}
                <button
                  onClick={() => setShowProductPickerModal(false)}
                  className="text-slate-400 hover:text-white text-xs px-2 py-1 border border-slate-700 hover:border-slate-500"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Search Input Bar with Clear and Bulk Selection Controls */}
            <div className="p-3.5 border-b border-slate-200 bg-[#F8F9FA] space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search SKU, name, material, thickness (e.g. 100mm, Silicone, Heck, Mesh, Fixings)..."
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    className="w-full text-xs pl-9 pr-8 py-2 bg-white border border-slate-300 focus:outline-none focus:border-[#C8102E]"
                  />
                  {productSearchQuery && (
                    <button
                      onClick={() => setProductSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs px-1"
                      title="Clear search query"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  onClick={toggleSelectAllFiltered}
                  disabled={filteredAvailableProducts.length === 0}
                  className="px-3 py-2 text-xs border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0 disabled:opacity-50 transition-colors"
                >
                  {filteredAvailableProducts.length > 0 && filteredAvailableProducts.every((p) => selectedProductsMap.has(p.id))
                    ? 'Deselect All Shown'
                    : 'Select All Shown'}
                </button>
              </div>

              {/* Status and count */}
              <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 font-medium">
                <span>
                  Showing {filteredAvailableProducts.length} of {availableProducts.length} products
                  {productSearchQuery && ` for "${productSearchQuery}"`}
                </span>
                <span className="font-mono font-bold text-slate-700">
                  {selectedProductsMap.size} product{selectedProductsMap.size === 1 ? '' : 's'} selected across searches
                </span>
              </div>
            </div>

            {/* Persistent Selected Products Tray across multiple searches */}
            {selectedProductsMap.size > 0 && (
              <div className="p-3 bg-red-50/70 border-b border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 font-bold text-[#C8102E] font-['Red_Hat_Display'] uppercase tracking-wider text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#C8102E]" />
                    <span>Selected Products ({selectedProductsMap.size} ready to add):</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                    {Array.from(selectedProductsMap.values()).map((sp) => (
                      <span
                        key={sp.id}
                        className="inline-flex items-center gap-1.5 bg-white text-[#1A1A1A] border border-black px-2 py-0.5 text-[11px] shadow-2xs"
                      >
                        <strong className="text-black font-mono">{sp.sku}</strong>
                        <span className="truncate max-w-[140px] text-slate-700">{sp.description}</span>
                        <button
                          onClick={() => toggleProductSelection(sp)}
                          className="text-slate-400 hover:text-black text-xs ml-0.5"
                          title="Remove product"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => setSelectedProductsMap(new Map())}
                    className="text-xs text-slate-600 hover:text-red-700 px-2.5 py-1 underline font-medium"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={handleAddAllSelectedToQuote}
                    className="px-3.5 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white text-xs font-black flex items-center gap-1.5 shadow-xs uppercase tracking-wider font-['Red_Hat_Display']"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add All ({selectedProductsMap.size}) to Quote</span>
                  </button>
                </div>
              </div>
            )}

            {/* Scrollable Products List with Tick Boxes */}
            <div className="flex-1 overflow-y-auto p-2 sm:p-3 divide-y divide-slate-100">
              {filteredAvailableProducts.map((p) => {
                const isSelected = selectedProductsMap.has(p.id);
                const isAlreadyInQuote = items.some((i) => i.sku.toLowerCase() === p.sku.toLowerCase());
                const stage = getProductApplicationStage(p);
                const categoryDisplay = stage.stageOrder === 7 ? 'Ancillaries' : stage.categoryDisplay;

                return (
                  <div
                    key={p.id}
                    onClick={() => toggleProductSelection(p)}
                    className={`py-3 px-3 flex items-center justify-between gap-3.5 transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-red-50/60 border-l-4 border-l-[#C8102E] border-slate-200'
                        : 'hover:bg-slate-50 border-transparent border-b-slate-100'
                    }`}
                  >
                    {/* Tick Box Checkbox */}
                    <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <label className="relative flex items-center cursor-pointer p-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProductSelection(p)}
                          className="w-4.5 h-4.5 accent-[#C8102E] text-[#C8102E] border-slate-400 rounded-none cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Product Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1 text-[11px]">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 border ${stage.badgeBg} ${stage.badgeColor} ${stage.badgeBorder} font-['Red_Hat_Display']`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${stage.dotColor}`}></span>
                          {stage.stageName}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono font-bold text-black text-xs bg-slate-100 px-1 py-0.2 border border-black">
                          {p.sku}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          {categoryDisplay}
                        </span>
                        {isAlreadyInQuote && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-[10px] text-[#00A887] font-bold flex items-center gap-0.5 font-mono">
                              <CheckCircle2 className="w-3 h-3 text-[#00A887]" /> IN QUOTE
                            </span>
                          </>
                        )}
                      </div>

                      <div className="text-xs font-bold text-[#1A1A1A] mt-0.5 truncate">
                        {p.description}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Unit: <span className="text-slate-800 font-semibold">{p.unit}</span> | Coverage: {p.coverageNotes}
                      </div>
                    </div>

                    {/* Pricing and Action */}
                    <div className="text-right shrink-0 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <div className="text-right">
                        {p.isPriceOnApplication || p.listPrice <= 0 ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                              POA / Set Price
                            </span>
                            <div className="text-[10px] text-slate-500">per {p.unit}</div>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs font-black text-[#1A1A1A] font-mono">
                              £{p.listPrice.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-500">per {p.unit}</div>
                          </>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          onAddItem(p);
                        }}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-[#C8102E] text-white text-xs font-bold flex items-center gap-1 transition-colors shadow-2xs"
                        title="Add this product immediately"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {filteredAvailableProducts.length === 0 && (
                <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                  <p>No products matched your search "{productSearchQuery}".</p>
                  <p className="text-[11px] text-slate-400">
                    Your {selectedProductsMap.size} previously selected products remain safely saved in the selection tray above.
                  </p>
                  <button
                    onClick={() => setProductSearchQuery('')}
                    className="text-xs text-[#C8102E] underline font-bold"
                  >
                    Clear search filter
                  </button>
                </div>
              )}
            </div>

            {/* Modal Bottom Action Footer */}
            <div className="p-3.5 border-t border-slate-200 bg-[#F8F9FA] flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                {selectedProductsMap.size > 0 ? (
                  <span className="font-semibold text-[#1A1A1A]">
                    <strong>{selectedProductsMap.size}</strong> product{selectedProductsMap.size === 1 ? '' : 's'} ticked and ready to insert into quotation.
                  </span>
                ) : (
                  <span>
                    Tick products above to collect multiple items across searches, then click <strong>Add Selected</strong>.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowProductPickerModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 font-semibold"
                >
                  Close
                </button>
                {selectedProductsMap.size > 0 && (
                  <button
                    onClick={handleAddAllSelectedToQuote}
                    className="px-4 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white text-xs font-black flex items-center gap-1.5 shadow-sm uppercase tracking-wider font-['Red_Hat_Display']"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add {selectedProductsMap.size} Selected to Quote</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unpriced Items Export Warning Modal */}
      {showUnpricedWarningModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 font-['Red_Hat_Display']">
          <div className="bg-white border-2 border-amber-500 max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-900 border-b border-amber-200 pb-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 border border-amber-300">
                <Info className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#1A1A1A]">Unpriced Line Items Found</h3>
                <p className="text-xs text-slate-500">Notice before generating client proposal</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              Your quotation contains <strong>{sortedItems.filter((i) => i.unitSellPrice <= 0).length}</strong> line item(s) with a sell price of <strong>£0.00 / POA</strong>.
            </p>
            <p className="text-xs text-slate-500 italic bg-amber-50 p-2.5 border border-amber-200">
              Exporting now will print these products on the client PDF as £0.00. You can review and enter bespoke prices first, or export anyway.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowUnpricedWarningModal(false)}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100"
              >
                Review & Set Prices
              </button>
              <button
                onClick={() => handleExportPdf(true)}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#C8102E] hover:bg-[#8A1538]"
              >
                Proceed & Export PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Quote Prompt Modal: Clear back to fresh vs. Keep existing items */}
      {showNewQuotePromptModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 font-['Red_Hat_Display']">
          <div className="bg-white border-2 border-[#1A1A1A] max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
              <div className="w-9 h-9 bg-[#1A1A1A] text-white flex items-center justify-center shrink-0">
                <FilePlus className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#1A1A1A]">Start New Quote</h3>
                <p className="text-xs text-slate-500">Configure your new quotation reference</p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
              <p className="font-bold text-sm text-[#1A1A1A]">
                Do you want to clear all of the quote information?
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-start gap-2">
                  <span className="font-bold text-[#C8102E] text-sm leading-none shrink-0">•</span>
                  <span>
                    <strong className="text-slate-900">Yes, Clear All (Fresh Quote):</strong> Resets everything back to fresh blank specifications, removes all products from the quote schedule, and generates a new quote reference.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-slate-700 text-sm leading-none shrink-0">•</span>
                  <span>
                    <strong className="text-slate-900">No, Keep Information:</strong> Preserves all current products, quantities, area sizing, and discounts under a new quote reference number.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowNewQuotePromptModal(false)}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmNewQuote(false)}
                className="px-3.5 py-1.5 text-xs font-bold text-[#1A1A1A] bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center gap-1.5"
                title="Keep current products and specifications under a new quote reference"
              >
                <Copy className="w-3.5 h-3.5 text-slate-600" />
                <span>No, Keep Information</span>
              </button>
              <button
                type="button"
                onClick={() => handleConfirmNewQuote(true)}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#C8102E] hover:bg-[#8A1538] flex items-center gap-1.5 shadow-2xs"
                title="Clear all information and start with a fresh blank quote"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes, Clear All (Fresh)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Quote Modal: Direct Reference Entry OR Search All Saved Quotes */}
      {showLoadQuoteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 font-['Red_Hat_Display']">
          <div className="bg-white border-2 border-[#1A1A1A] max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#1A1A1A] text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-[#C8102E] flex items-center justify-center text-white">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white tracking-wide">
                    Load Quote
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Enter a specific reference or search and browse saved quotations
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLoadQuoteModal(false)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Option 1: Direct Reference Input */}
              <div className="bg-[#F8F9FA] border border-[#CBD5E1] p-4 space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">
                  Enter Quote Reference
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={manualQuoteInput}
                      onChange={(e) => setManualQuoteInput(e.target.value)}
                      placeholder="e.g. RW-QUO-TB-021026-0950 or RW-QUO-TB-021026-0950-R0"
                      className="w-full text-xs font-mono font-bold bg-white text-[#1A1A1A] border border-slate-300 px-3 py-2 focus:outline-none focus:border-[#C8102E]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && manualQuoteInput.trim()) {
                          handleLoadQuoteFromSheet(manualQuoteInput.trim());
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoadQuoteFromSheet(manualQuoteInput.trim())}
                    disabled={isLoadingQuote || !manualQuoteInput.trim()}
                    className="px-4 py-2 bg-[#C8102E] hover:bg-[#8A1538] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
                  >
                    {isLoadingQuote ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Load This Quote</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Tip: Omitting the revision suffix (e.g. entering just base reference without <code className="font-bold">-R0</code>) automatically loads the latest active revision.
                </p>
              </div>

              {/* Divider */}
              <div className="relative flex items-center justify-center my-1">
                <div className="border-t border-slate-200 w-full"></div>
                <span className="bg-white px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest absolute">
                  OR SEARCH ALL SAVED QUOTES
                </span>
              </div>

              {/* Option 2: Search & Browse Sheet Quotes */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={quoteSearchTerm}
                      onChange={(e) => setQuoteSearchTerm(e.target.value)}
                      placeholder="Filter by project name, customer, manager, or reference..."
                      className="w-full text-xs pl-8.5 pr-3 py-1.5 bg-white border border-slate-300 focus:outline-none focus:border-[#C8102E]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showLatestOnly}
                        onChange={(e) => setShowLatestOnly(e.target.checked)}
                        className="accent-[#C8102E]"
                      />
                      <span className="font-medium text-[11px]">Latest Revisions Only</span>
                    </label>
                    <button
                      type="button"
                      onClick={fetchQuotesList}
                      disabled={isFetchingQuotesList}
                      className="p-1.5 text-slate-500 hover:text-[#C8102E] border border-slate-200 hover:bg-slate-50"
                      title="Refresh quotes list"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isFetchingQuotesList ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Quotes List Table / Cards */}
                <div className="border border-slate-200 overflow-hidden min-h-[160px] max-h-[300px] overflow-y-auto">
                  {isFetchingQuotesList ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin text-[#C8102E]" />
                      <span className="text-xs font-semibold">Reading saved quotes...</span>
                    </div>
                  ) : filteredQuotesList.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-1 text-slate-400">
                      <Search className="w-5 h-5 text-slate-300" />
                      <span className="text-xs font-semibold">
                        {sheetQuotesList.length === 0
                          ? 'No saved quotes found.'
                          : 'No quotes match your search filter.'}
                      </span>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredQuotesList.map((q) => (
                        <div
                          key={q.quoteNumber}
                          className="p-3 hover:bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-black text-[#1A1A1A]">
                                {q.quoteNumber}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 border ${
                                  q.isLatest
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : 'bg-slate-100 text-slate-600 border-slate-300'
                                }`}
                              >
                                {q.isLatest ? 'Active' : 'Superseded'} (Rev {q.revision})
                              </span>
                              {q.dealStatus && (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.2 border ${
                                    q.dealStatus === 'Won'
                                      ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
                                      : q.dealStatus === 'Lost'
                                      ? 'bg-rose-100 text-rose-900 border-rose-300'
                                      : 'bg-amber-100 text-amber-900 border-amber-300'
                                  }`}
                                >
                                  {q.dealStatus} ({q.winLikelihood !== undefined ? `${q.winLikelihood}%` : '50%'})
                                </span>
                              )}
                              {q.date && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {q.date}
                                </span>
                              )}
                            </div>

                            <div className="text-xs font-bold text-slate-900 truncate">
                              {q.projectName || 'Untitled Project'}
                              {q.projectLocation ? (
                                <span className="text-slate-400 font-normal"> — {q.projectLocation}</span>
                              ) : null}
                            </div>

                            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              {q.clientCompany && (
                                <span>
                                  Client: <strong className="text-slate-700">{q.clientCompany}</strong>
                                </span>
                              )}
                              {q.salesManager && (
                                <span>
                                  TSM: <span className="text-slate-700">{q.salesManager}</span>
                                </span>
                              )}
                              {q.areaM2 > 0 && (
                                <span>
                                  Area: <span className="text-slate-700 font-mono">{q.areaM2} m²</span>
                                </span>
                              )}
                              {q.totalNet > 0 && (
                                <span className="font-bold text-[#00A887]">
                                  £{q.totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Net
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleLoadQuoteFromSheet(q.quoteNumber)}
                            disabled={isLoadingQuote}
                            className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-black text-white text-xs font-bold font-['Red_Hat_Display'] uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors shrink-0 disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5 text-amber-400" />
                            <span>Load</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-[#F8F9FA] border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                {filteredQuotesList.length} quote{filteredQuotesList.length === 1 ? '' : 's'} available
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLoadQuoteModal(false)}
                  className="px-4 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quote Load Error Pop-up Modal */}
      {loadErrorModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 font-['Red_Hat_Display']">
          <div className="bg-white border-2 border-[#C8102E] max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-rose-100 pb-3">
              <div className="w-9 h-9 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-200">
                <AlertCircle className="w-5 h-5 text-[#C8102E]" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-[#1A1A1A] truncate">{loadErrorModal.title}</h3>
                {loadErrorModal.quoteRef ? (
                  <p className="text-xs font-mono font-bold text-slate-500 truncate">
                    Ref: {loadErrorModal.quoteRef}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">Notice when retrieving quotation</p>
                )}
              </div>
            </div>

            <div className="bg-rose-50/70 border border-rose-200 p-3.5">
              <p className="text-xs text-rose-950 font-semibold leading-relaxed">
                {loadErrorModal.message}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLoadErrorModal(null)}
                className="px-4 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100"
              >
                Close
              </button>
              {loadErrorModal.isPermissionIssue && (
                <button
                  type="button"
                  onClick={() => {
                    setLoadErrorModal(null);
                    handleReconnectGoogle();
                  }}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-[#C8102E] hover:bg-[#8A1538] shadow-2xs"
                >
                  Sign In with Permissions
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
