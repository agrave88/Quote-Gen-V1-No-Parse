import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RockwoolHeader } from './components/RockwoolHeader';
import { QuoteEditor } from './components/QuoteEditor';
import { 
  RockwoolProduct, 
  QuoteLineItem, 
  QuoteMeta,
  CustomerRecord,
  ProjectRecord,
  PriceBook
} from './types/quote';
import { 
  getInitialProducts, 
  syncFromGoogleSheetBackground, 
  saveCachedProducts,
  getCachedLastSyncTime,
  getCachedLastError 
} from './utils/backgroundSheetSync';
import { parseGoogleSheetsCsv } from './utils/productParser';
import { addDaysToDate, getLocalIsoDate } from './utils/dateUtils';
import { DEFAULT_STANDARD_TERMS } from './constants/terms';
import { generateFormattedQuoteNumber } from './utils/quoteNumber';
import { 
  getInitialCustomers, 
  syncCustomersFromSheet 
} from './utils/customerSync';
import { 
  getInitialProjects, 
  syncProjectsFromSheet 
} from './utils/projectSync';
import { 
  resolvePriceBookForQuote, 
  resolveProductPricing,
  getAllPriceBooks,
  syncPriceBooksFromSheet,
  syncPriceEntriesFromSheet
} from './utils/priceBookManager';
import { 
  sortQuoteItemsByApplicationOrder, 
  isAncillaryItem,
  isUnitCoversLessThanOneM2,
  calculateItemPricePerM2,
  calculateItemQuantity,
  isWasherProduct,
  isFixingProduct,
  getIndividualFixingsPerM2,
  calculateWasherRate
} from './utils/applicationOrder';

export default function App() {
  // 1. Dynamic Products Catalog sourced and maintained in the background
  const [products, setProducts] = useState<RockwoolProduct[]>(getInitialProducts);
  // 1b. Customer Directory from "Customers" tab in spreadsheet
  const [customers, setCustomers] = useState<CustomerRecord[]>(getInitialCustomers);
  // 1c. Project Directory from "Projects" tab in spreadsheet
  const [projects, setProjects] = useState<ProjectRecord[]>(getInitialProjects);
  // 1d. Price Books directory from "Price Books" tab in spreadsheet
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>(getAllPriceBooks);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(() => getCachedLastError());
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    const cached = getCachedLastSyncTime();
    if (cached) {
      try {
        const d = new Date(cached);
        return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (Cached)`;
      } catch {
        return 'Cached Catalog';
      }
    }
    return 'Permanent Sheet Catalog';
  });
  const [pendingPriceUpdates, setPendingPriceUpdates] = useState<{
    count: number;
    newProducts: RockwoolProduct[];
    signature?: string;
  } | null>(null);

  // 2. Quote Metadata - Start with clean initial values
  const [quoteMeta, setQuoteMeta] = useState<QuoteMeta>(() => {
    const today = getLocalIsoDate();
    const defaultExpiry = addDaysToDate(today, 30);
    const initialPriceBook = resolvePriceBookForQuote(today);
    return {
      quoteNumber: generateFormattedQuoteNumber(),
      date: today,
      validUntil: defaultExpiry,
      clientName: '',
      contactPerson: '',
      clientCompany: '',
      clientEmail: '',
      clientPhone: '',
      projectName: '',
      projectReference: '',
      projectLocation: '',
      areaM2: 1, // Default 1 m²
      wasteagePercent: 0, // Default 0% wastage
      overallDiscountPercent: 0, // Default 0% discount from list
      overallMarginPercent: 0, // Backward compatibility
      notesAndTerms: DEFAULT_STANDARD_TERMS,
      includeInstallationEstimate: false,
      installationRatePerM2: 45.0,
      expectedStartDate: '',
      numberOfPhases: 1,
      phaseDurationMonths: 1,
      numberOfUnits: undefined,
      unitSizeM2: undefined,
      dealStatus: 'Pending',
      winLikelihood: 50,
      priceBookCode: initialPriceBook.code,
      priceBookName: initialPriceBook.name,
    };
  });

  const quoteMetaRef = useRef<QuoteMeta>(quoteMeta);
  quoteMetaRef.current = quoteMeta;

  // 3. Quotation Line Items
  const [quoteItems, setQuoteItems] = useState<QuoteLineItem[]>([]);
  const quoteItemsRef = useRef<QuoteLineItem[]>(quoteItems);
  quoteItemsRef.current = quoteItems;
  const dismissedPriceSignatureRef = useRef<string | null>(null);

  // Build line items from selected catalog products
  const populateQuoteItemsFromProducts = useCallback((
    selectedProducts: RockwoolProduct[], 
    currentArea: number, 
    wastagePct: number, 
    discountPct: number,
    preserveOrder = false
  ) => {
    const grossArea = currentArea <= 1 ? 1 : currentArea * (1 + wastagePct / 100);
    const validDiscount = Math.min(99, Math.max(0, discountPct));
    const discountFactor = (100 - validDiscount) / 100;

    const newItems: QuoteLineItem[] = selectedProducts.map((p, idx) => {
      const isAncillary = isAncillaryItem(p);
      const isLessThanOne = isUnitCoversLessThanOneM2(p);
      const rate = p.ratePerM2 ?? (isLessThanOne ? 0.72 : 1.0);
      const calculatedQuantity = calculateItemQuantity(grossArea, rate, isAncillary, isLessThanOne);
      const listPrice = p.listPrice;
      const costPrice = p.costPrice !== undefined ? p.costPrice : undefined;
      const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
      const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
        ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
        : undefined;
      const pricePerM2 = calculateItemPricePerM2(unitSellPrice, rate, isAncillary, isLessThanOne);

      return {
        id: `item-${idx}-${p.sku.toLowerCase()}-${Date.now()}`,
        productId: p.id,
        sku: p.sku,
        description: p.description,
        category: p.category,
        unit: p.unit,
        costPrice,
        listPrice,
        isPriceOnApplication: p.isPriceOnApplication || (p.listPrice <= 0),
        unitCost: listPrice,
        consumptionRatePerM2: isAncillary ? 0 : rate,
        coverageNotes: p.coverageNotes,
        calculatedQuantity,
        finalQuantity: calculatedQuantity,
        manualQuantityOverride: null,
        discountPercent: validDiscount,
        marginPercent,
        unitSellPrice,
        pricePerM2,
        totalCost: Math.round(calculatedQuantity * listPrice * 100) / 100,
        totalSell: Math.round(calculatedQuantity * unitSellPrice * 100) / 100,
        isCustomOrAdded: false,
      };
    });

    const finalItems = preserveOrder ? newItems : sortQuoteItemsByApplicationOrder(newItems);
    setQuoteItems(finalItems);
  }, []);

  // Background Auto-Sync Function
  const runBackgroundSync = useCallback(async (customUrl?: string) => {
    setIsSyncing(true);
    try {
      const result = await syncFromGoogleSheetBackground(customUrl);
      if (result.success && result.products && result.products.length > 0) {
        setProducts(result.products);
        setSyncError(null);
        setLastSyncTime(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${result.source || 'Live Spreadsheet Catalog'})`);

        // Check if catalog price changes affect any products currently in the active quote
        // CRITICAL COMMERCIAL RULE: Never recalculate an old or saved quote from today's product database.
        // A saved quote is an immutable commercial record frozen to its creation snapshot.
        const currentMeta = quoteMetaRef.current;
        const currentItems = quoteItemsRef.current;
        const isHistoricalCommercialRecord = Boolean(
          currentMeta.commercialSnapshot || 
          currentItems.some((i) => i.commercialSnapshot)
        );

        if (isHistoricalCommercialRecord) {
          // Commercial record is frozen: skip all price update checks!
          setPendingPriceUpdates(null);
          return;
        }

        const updatedProds = result.products;
        const changed = currentItems.filter((item) => {
          if (item.commercialSnapshot) return false;
          const up = updatedProds.find((p) => p.sku.toLowerCase() === item.sku.toLowerCase());
          return up && Math.abs(up.listPrice - item.listPrice) > 0.01;
        });

        if (changed.length > 0) {
          const signature = changed
            .map((item) => {
              const up = updatedProds.find((p) => p.sku.toLowerCase() === item.sku.toLowerCase());
              return `${item.sku.toLowerCase()}:${up?.listPrice}`;
            })
            .sort()
            .join('|');

          // Only prompt if this exact price update signature hasn't been dismissed by the estimator
          if (signature !== dismissedPriceSignatureRef.current) {
            setPendingPriceUpdates({
              count: changed.length,
              newProducts: updatedProds,
              signature,
            });
          }
        } else {
          setPendingPriceUpdates(null);
          dismissedPriceSignatureRef.current = null;
        }
      } else if (!result.success) {
        setSyncError(result.error || 'Sync failed');
      }
    } catch (err: any) {
      console.warn('Background Google Sheet sync error:', err);
      setSyncError(err?.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Estimator Action: Apply live sheet price updates to current quote schedule
  const handleApplyPendingPriceUpdates = () => {
    if (!pendingPriceUpdates) return;
    const { newProducts } = pendingPriceUpdates;
    setQuoteItems((prevItems) => {
      return prevItems.map((item) => {
        if (item.commercialSnapshot) return item;
        const updatedProd = newProducts.find((p) => p.sku.toLowerCase() === item.sku.toLowerCase());
        if (!updatedProd) return item;

        const isAncillary = isAncillaryItem(item);
        const isLessThanOne = isUnitCoversLessThanOneM2(item);
        const listPrice = updatedProd.listPrice;
        const itemDiscount = item.discountPercent ?? item.marginPercent ?? 0;
        const discountFactor = (100 - itemDiscount) / 100;
        const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
        const rate = item.consumptionRatePerM2 || updatedProd.ratePerM2 || (isLessThanOne ? 0.72 : 1);
        const pricePerM2 = calculateItemPricePerM2(unitSellPrice, rate, isAncillary, isLessThanOne);
        const meta = quoteMetaRef.current;
        const grossArea = meta.areaM2 <= 1 ? 1 : meta.areaM2 * (1 + meta.wasteagePercent / 100);
        const calculatedQuantity = calculateItemQuantity(grossArea, rate, isAncillary, isLessThanOne);
        const finalQuantity = item.manualQuantityOverride !== null && item.manualQuantityOverride !== undefined
          ? item.manualQuantityOverride
          : calculatedQuantity;

        const costPrice = updatedProd.costPrice !== undefined ? updatedProd.costPrice : item.costPrice;
        const marginPercent = unitSellPrice > 0 && costPrice !== undefined
          ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
          : item.marginPercent;

        return {
          ...item,
          costPrice,
          marginPercent,
          listPrice,
          unitCost: listPrice,
          description: updatedProd.description,
          unit: updatedProd.unit,
          coverageNotes: updatedProd.coverageNotes,
          discountPercent: itemDiscount,
          unitSellPrice,
          pricePerM2,
          calculatedQuantity,
          finalQuantity,
          totalCost: Math.round(finalQuantity * listPrice * 100) / 100,
          totalSell: Math.round(finalQuantity * unitSellPrice * 100) / 100,
        };
      });
    });
    dismissedPriceSignatureRef.current = null;
    setPendingPriceUpdates(null);
  };

  const handleDismissPendingPriceUpdates = () => {
    if (pendingPriceUpdates?.signature) {
      dismissedPriceSignatureRef.current = pendingPriceUpdates.signature;
    }
    setPendingPriceUpdates(null);
  };

  // Handle direct paste or manual spreadsheet update from header
  const handleProductsDirectlyUpdated = (csvText: string) => {
    const parsed = parseGoogleSheetsCsv(csvText);
    if (parsed.length > 0) {
      setProducts(parsed);
      saveCachedProducts(parsed);
      setSyncError(null);
      setLastSyncTime(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (Direct Update)`);
    }
  };

  // Initial Background Sync Setup
  useEffect(() => {
    // Initial background silent sync for products, customers & projects
    runBackgroundSync();
    syncCustomersFromSheet().then((res) => {
      if (res.customers && res.customers.length > 0) {
        setCustomers(res.customers);
      }
    });
    syncProjectsFromSheet().then((res) => {
      if (res.projects && res.projects.length > 0) {
        setProjects(res.projects);
      }
    });
    syncPriceBooksFromSheet().then((res) => {
      if (res.books && res.books.length > 0) {
        setPriceBooks(res.books);
      }
    });
    syncPriceEntriesFromSheet();

    // Regular background sync poll every 5 minutes (300,000ms)
    const interval = setInterval(() => {
      runBackgroundSync();
      syncCustomersFromSheet().then((res) => {
        if (res.customers && res.customers.length > 0) {
          setCustomers(res.customers);
        }
      });
      syncProjectsFromSheet().then((res) => {
        if (res.projects && res.projects.length > 0) {
          setProjects(res.projects);
        }
      });
      syncPriceBooksFromSheet().then((res) => {
        if (res.books && res.books.length > 0) {
          setPriceBooks(res.books);
        }
      });
      syncPriceEntriesFromSheet();
    }, 300000);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Duplicate Merge Notification State
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  // Add individual product from the dynamic sheet list to quote
  const handleAddItem = (product: RockwoolProduct) => {
    const isAncillary = isAncillaryItem(product);
    const isLessThanOne = isUnitCoversLessThanOneM2(product);
    const grossArea = quoteMeta.areaM2 <= 1 ? 1 : quoteMeta.areaM2 * (1 + quoteMeta.wasteagePercent / 100);

    // Default Duplicate Check: If product SKU already exists in quote, consolidate quantity
    const existingIndex = quoteItems.findIndex(
      (item) => item.sku.toLowerCase() === product.sku.toLowerCase()
    );

    if (existingIndex !== -1) {
      if (!isAncillary) {
        setMergeNotice(`${product.sku} is already in the quote. Use Duplicate for a second line.`);
        setTimeout(() => setMergeNotice(null), 4000);
        return;
      }

      // Ancillaries only: consolidate quantity on existing line item
      const existingItem = quoteItems[existingIndex];
      let rate = product.ratePerM2 ?? existingItem.consumptionRatePerM2 ?? (isLessThanOne ? 0.72 : 1.0);
      const addQty = calculateItemQuantity(grossArea, rate, true, isLessThanOne);
      
      const currentQty = existingItem.manualQuantityOverride !== null && existingItem.manualQuantityOverride !== undefined
        ? existingItem.manualQuantityOverride
        : existingItem.finalQuantity;
      
      const updatedQty = currentQty + addQty;
      const listPrice = existingItem.listPrice ?? product.listPrice;
      const unitSellPrice = existingItem.unitSellPrice;

      const updatedItems = [...quoteItems];
      updatedItems[existingIndex] = {
        ...existingItem,
        manualQuantityOverride: updatedQty,
        finalQuantity: updatedQty,
        totalCost: Math.round(updatedQty * listPrice * 100) / 100,
        totalSell: Math.round(updatedQty * unitSellPrice * 100) / 100,
      };

      setQuoteItems(sortQuoteItemsByApplicationOrder(updatedItems));
      setMergeNotice(`Ancillary product ${product.sku} is already in quote — consolidated quantity on existing line item.`);
      setTimeout(() => setMergeNotice(null), 4000);
      return;
    }

    // Washer rate calculation: 1 washer per fixing, accounting for washer box packaging size
    let rate = product.ratePerM2 ?? (isLessThanOne ? 0.72 : 1.0);
    let coverageNotes = product.coverageNotes;

    if (isWasherProduct(product)) {
      const existingFixing = quoteItems.find(isFixingProduct);
      const fixingsPerM2 = existingFixing ? getIndividualFixingsPerM2(existingFixing) : 5;
      const washerInfo = calculateWasherRate(fixingsPerM2, product);
      rate = washerInfo.consumptionRatePerM2;
      coverageNotes = washerInfo.coverageNotes;
    }

    const calculatedQuantity = calculateItemQuantity(grossArea, rate, isAncillary, isLessThanOne);
    const pricing = resolveProductPricing(product, quoteMeta.priceBookCode);
    const listPrice = pricing.listPrice;
    const costPrice = pricing.costPrice !== undefined ? pricing.costPrice : product.costPrice;
    const discount = quoteMeta.overallDiscountPercent ?? quoteMeta.overallMarginPercent ?? 0;
    const discountFactor = (100 - discount) / 100;
    const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
    const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
      ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
      : undefined;
    const pricePerM2 = calculateItemPricePerM2(unitSellPrice, rate, isAncillary, isLessThanOne);

    const newItem: QuoteLineItem = {
      id: `item-${Date.now()}-${product.sku.toLowerCase()}`,
      productId: product.id,
      sku: product.sku,
      description: product.description,
      category: product.category,
      unit: product.unit,
      costPrice,
      listPrice,
      isPriceOnApplication: product.isPriceOnApplication || (product.listPrice <= 0),
      unitCost: listPrice,
      consumptionRatePerM2: isAncillary ? 0 : rate,
      coverageNotes,
      calculatedQuantity,
      finalQuantity: calculatedQuantity,
      manualQuantityOverride: null,
      discountPercent: discount,
      marginPercent,
      unitSellPrice,
      pricePerM2,
      totalCost: Math.round(calculatedQuantity * listPrice * 100) / 100,
      totalSell: Math.round(calculatedQuantity * unitSellPrice * 100) / 100,
      isCustomOrAdded: true,
    };

    // If adding a fixing, check if there are existing washers in the quote and sync their rates
    let currentItems = [...quoteItems];
    if (isFixingProduct(product)) {
      const newFixingsPerM2 = getIndividualFixingsPerM2({ ...product, consumptionRatePerM2: rate });
      currentItems = currentItems.map(item => {
        if (!isWasherProduct(item)) return item;
        const wInfo = calculateWasherRate(newFixingsPerM2, item);
        const wRate = wInfo.consumptionRatePerM2;
        const wCalcQty = calculateItemQuantity(grossArea, wRate, false, false);
        const wSell = Math.round((item.listPrice ?? item.unitCost ?? 0) * discountFactor * 100) / 100;
        const wM2Price = calculateItemPricePerM2(wSell, wRate, false, false);
        return {
          ...item,
          consumptionRatePerM2: wRate,
          coverageNotes: wInfo.coverageNotes,
          calculatedQuantity: wCalcQty,
          finalQuantity: item.manualQuantityOverride ?? wCalcQty,
          pricePerM2: wM2Price,
          totalCost: Math.round((item.manualQuantityOverride ?? wCalcQty) * (item.listPrice ?? 0) * 100) / 100,
          totalSell: Math.round((item.manualQuantityOverride ?? wCalcQty) * wSell * 100) / 100,
        };
      });
    }

    setQuoteItems(sortQuoteItemsByApplicationOrder([...currentItems, newItem]));
  };

  // Add multiple products to quote in a single batch with duplicate SKU check
  const handleAddMultipleItems = (newProducts: RockwoolProduct[]) => {
    if (!newProducts || newProducts.length === 0) return;
    const grossArea = quoteMeta.areaM2 <= 1 ? 1 : quoteMeta.areaM2 * (1 + quoteMeta.wasteagePercent / 100);
    const discount = quoteMeta.overallDiscountPercent ?? quoteMeta.overallMarginPercent ?? 0;
    const discountFactor = (100 - discount) / 100;

    let mergedCount = 0;
    let currentList = [...quoteItems];

    for (let i = 0; i < newProducts.length; i++) {
      const product = newProducts[i];
      const isAncillary = isAncillaryItem(product);
      const isLessThanOne = isUnitCoversLessThanOneM2(product);
      let rate = product.ratePerM2 ?? (isLessThanOne ? 0.72 : 1.0);
      let coverageNotes = product.coverageNotes;

      const existingIdx = currentList.findIndex(
        (item) => item.sku.toLowerCase() === product.sku.toLowerCase()
      );

      const addQty = calculateItemQuantity(grossArea, rate, isAncillary, isLessThanOne);

      if (existingIdx !== -1) {
        if (!isAncillary) {
          // System items are already present; do not merge or lock system items with manual overrides
          continue;
        }

        // Merge into existing row for ancillaries only
        const existingItem = currentList[existingIdx];
        const currentQty = existingItem.manualQuantityOverride !== null && existingItem.manualQuantityOverride !== undefined
          ? existingItem.manualQuantityOverride
          : existingItem.finalQuantity;
        const newQty = currentQty + addQty;
        const listPrice = existingItem.listPrice ?? product.listPrice;
        const unitSellPrice = existingItem.unitSellPrice;

        currentList[existingIdx] = {
          ...existingItem,
          manualQuantityOverride: newQty,
          finalQuantity: newQty,
          totalCost: Math.round(newQty * listPrice * 100) / 100,
          totalSell: Math.round(newQty * unitSellPrice * 100) / 100,
        };
        mergedCount++;
      } else {
        // Append as new line item
        if (isWasherProduct(product)) {
          const fixingInBatch = newProducts.find(isFixingProduct);
          const existingFixing = currentList.find(isFixingProduct);
          const activeFixingsPerM2 = fixingInBatch 
            ? getIndividualFixingsPerM2(fixingInBatch) 
            : (existingFixing ? getIndividualFixingsPerM2(existingFixing) : 5);
          const washerInfo = calculateWasherRate(activeFixingsPerM2, product);
          rate = washerInfo.consumptionRatePerM2;
          coverageNotes = washerInfo.coverageNotes;
        }

        const calculatedQuantity = addQty;
        const pricing = resolveProductPricing(product, quoteMeta.priceBookCode);
        const listPrice = pricing.listPrice;
        const costPrice = pricing.costPrice !== undefined ? pricing.costPrice : product.costPrice;
        const unitSellPrice = Math.round(listPrice * discountFactor * 100) / 100;
        const marginPercent = (costPrice !== undefined && unitSellPrice > 0)
          ? Math.round(((unitSellPrice - costPrice) / unitSellPrice) * 1000) / 10
          : undefined;
        const pricePerM2 = calculateItemPricePerM2(unitSellPrice, rate, isAncillary, isLessThanOne);

        currentList.push({
          id: `item-${Date.now()}-${i}-${product.sku.toLowerCase()}`,
          productId: product.id,
          sku: product.sku,
          description: product.description,
          category: product.category,
          unit: product.unit,
          costPrice,
          listPrice,
          isPriceOnApplication: product.isPriceOnApplication || (product.listPrice <= 0),
          unitCost: listPrice,
          consumptionRatePerM2: isAncillary ? 0 : rate,
          coverageNotes,
          calculatedQuantity,
          finalQuantity: calculatedQuantity,
          manualQuantityOverride: null,
          discountPercent: discount,
          marginPercent,
          unitSellPrice,
          pricePerM2,
          totalCost: Math.round(calculatedQuantity * listPrice * 100) / 100,
          totalSell: Math.round(calculatedQuantity * unitSellPrice * 100) / 100,
          isCustomOrAdded: true,
        });
      }
    }

    setQuoteItems(sortQuoteItemsByApplicationOrder(currentList));

    if (mergedCount > 0) {
      setMergeNotice(`Consolidated ${mergedCount} duplicate product${mergedCount > 1 ? 's' : ''} into existing quote line items.`);
      setTimeout(() => setMergeNotice(null), 4000);
    }
  };

  // Remove individual item
  const handleRemoveItem = (id: string) => {
    setQuoteItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1A1A] font-['Inter',sans-serif] flex flex-col antialiased selection:bg-[#C8102E] selection:text-white">
      {/* Top Rockwool Branding Banner with Background Auto-Sync Status & Diagnostics */}
      <RockwoolHeader
        productCount={products.length}
        isSyncing={isSyncing}
        lastSyncedText={lastSyncTime}
        syncError={syncError}
        onTriggerManualSync={() => runBackgroundSync()}
        onSheetUrlConfigured={(url) => runBackgroundSync(url)}
        onProductsDirectlyUpdated={handleProductsDirectlyUpdated}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Architectural Hero Banner with Red Block */}
        <div className="relative bg-white border border-[#E2E8F0] shadow-xs overflow-hidden">
          {/* Subtle architectural geometric grid pattern background */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#1A1A1A_1px,transparent_1px)] [background-size:16px_16px]"></div>
          
          <div className="relative px-5 py-4 sm:px-6 sm:py-4.5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              {/* Document-themed Header Tag & Red Signature Color Block */}
              <div className="flex items-center gap-2.5">
                <span className="w-4 h-2.5 bg-[#C8102E] block"></span>
                <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-[#6B7280] font-['Red_Hat_Display']">
                  Rockwool Wall Systems | Technical Estimation
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#1A1A1A] font-['Red_Hat_Display'] leading-tight">
                External Wall Insulation & Façade Quotation Engine
              </h1>
            </div>
          </div>
        </div>

        {/* Duplicate Product Consolidated Notice Banner */}
        {mergeNotice && (
          <div className="bg-emerald-50 border border-emerald-300 p-3.5 flex items-center justify-between gap-4 shadow-2xs transition-all">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 bg-emerald-600 rounded-full shrink-0"></span>
              <p className="text-xs font-bold text-emerald-900 font-['Red_Hat_Display']">
                {mergeNotice}
              </p>
            </div>
            <button
              onClick={() => setMergeNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold px-2 py-0.5 hover:bg-emerald-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Live Catalog Price Update Notice Banner */}
        {pendingPriceUpdates && (
          <div className="bg-amber-50 border border-amber-300 p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
              <div>
                <p className="text-xs font-bold text-amber-900 font-['Red_Hat_Display']">
                  Catalog prices updated for {pendingPriceUpdates.count} product{pendingPriceUpdates.count > 1 ? 's' : ''} in your active quote
                </p>
                <p className="text-[11px] text-amber-800">
                  New list prices are available in your catalog. Would you like to recalculate active lines with the new prices or keep your current quotation figures?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleApplyPendingPriceUpdates}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
              >
                Update Quote Lines
              </button>
              <button
                onClick={handleDismissPendingPriceUpdates}
                className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 text-xs font-semibold border border-amber-300 transition-colors cursor-pointer"
              >
                Keep Current Prices
              </button>
            </div>
          </div>
        )}

        {/* Interactive Quotation Editor, Margin Calculator & Client PDF Exporter */}
        <QuoteEditor
          items={quoteItems}
          meta={quoteMeta}
          availableProducts={products}
          customers={customers}
          projects={projects}
          priceBooks={priceBooks}
          onUpdateMeta={setQuoteMeta}
          onUpdateItems={setQuoteItems}
          onAddItem={handleAddItem}
          onAddMultipleItems={handleAddMultipleItems}
          onRemoveItem={handleRemoveItem}
        />

      </main>

      {/* Footer matching Document Final Page (Thank you & Confidential note) */}
      <footer className="bg-white border-t border-[#E2E8F0] py-6 text-xs text-[#6B7280] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 bg-[#C8102E] flex items-center justify-center text-white text-[10px] font-black">
              R
            </div>
            <span className="font-bold text-[#1A1A1A] tracking-tight font-['Red_Hat_Display']">
              ROCKWOOL Wall Systems
            </span>
            <span className="text-slate-300">|</span>
            <span>IF IT'S WORTH BUILDING</span>
          </div>

          <div className="text-[11px] font-mono tracking-wider text-slate-500 uppercase">
            CONFIDENTIAL | Commercial & Technical Quotation | ROCKWOOL A/S
          </div>

          <div className="text-slate-500 text-[11px]">
            Google Sheets Background Sync Active ({products.length} Products · {customers.length} Customers)
          </div>
        </div>
      </footer>
    </div>
  );
}
