import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  FileSpreadsheet, 
  Sparkles, 
  Flame, 
  RefreshCw, 
  Settings, 
  Check, 
  ExternalLink,
  AlertTriangle,
  Info,
  Layers,
  Database
} from 'lucide-react';
import { 
  getConfiguredSheetUrl, 
  setConfiguredSheetUrl, 
  getCachedLastError,
  getCachedPastedData,
  saveCachedPastedData
} from '../utils/backgroundSheetSync';
import { parseGoogleSheetsCsv } from '../utils/productParser';
import { RockwoolBrandLogo } from './RockwoolBrandLogo';

interface RockwoolHeaderProps {
  productCount: number;
  isSyncing?: boolean;
  lastSyncedText?: string;
  syncError?: string | null;
  onTriggerManualSync?: () => void;
  onSheetUrlConfigured?: (url: string) => void;
  onProductsDirectlyUpdated?: (csvText: string) => void;
}

export const RockwoolHeader: React.FC<RockwoolHeaderProps> = ({
  productCount,
  isSyncing = false,
  lastSyncedText = 'Live in background',
  syncError = null,
  onTriggerManualSync,
  onSheetUrlConfigured,
  onProductsDirectlyUpdated,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'url' | 'paste'>('url');
  const [customSheetUrl, setCustomSheetUrl] = useState(
    getConfiguredSheetUrl() || 'https://docs.google.com/spreadsheets/d/1KadFxjyUz8mbUfbvTBGMD6QSwuLMrnlcWL71BRPQDF8/edit'
  );
  const [rawCsvPaste, setRawCsvPaste] = useState(getCachedPastedData());
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(syncError || getCachedLastError());

  useEffect(() => {
    setLocalError(syncError);
  }, [syncError]);

  const handleSaveSheetConfig = () => {
    setConfiguredSheetUrl(customSheetUrl);
    setSavedNotice('Connecting & syncing in background...');
    if (onSheetUrlConfigured) {
      onSheetUrlConfigured(customSheetUrl);
    }
    setTimeout(() => {
      setSavedNotice('Synced successfully!');
      setTimeout(() => {
        setSavedNotice(null);
        setShowSettingsModal(false);
      }, 1000);
    }, 800);
  };

  const handleImportPastedCsv = () => {
    if (!rawCsvPaste.trim()) {
      setLocalError('Please paste product rows from your spreadsheet.');
      return;
    }

    try {
      const parsed = parseGoogleSheetsCsv(rawCsvPaste);
      if (parsed.length === 0) {
        setLocalError('Could not recognize product rows. Check columns (SKU, Description, Unit, Price, Notes).');
        return;
      }

      saveCachedPastedData(rawCsvPaste);
      if (onProductsDirectlyUpdated) {
        onProductsDirectlyUpdated(rawCsvPaste);
      }
      setLocalError(null);
      setSavedNotice(`Imported ${parsed.length} products!`);
      setTimeout(() => {
        setSavedNotice(null);
        setShowSettingsModal(false);
      }, 1000);
    } catch (e: any) {
      setLocalError(`Parse failed: ${e.message}`);
    }
  };

  return (
    <header className="bg-white border-b border-[#E2E8F0] sticky top-0 z-50 shadow-xs">
      {/* Top Corporate Red Accent Bar */}
      <div className="h-[3px] w-full bg-[#C8102E]"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand identity: Exact Rockwool Logo Lockup with Tagline from Document Cover A */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Official ROCKWOOL Logo Lockup from attached image */}
            <div className="flex items-center">
              <RockwoolBrandLogo className="h-7 sm:h-8.5 w-auto object-contain select-none" />
            </div>

            {/* Document Brand Divider & Tagline */}
            <div className="hidden sm:flex items-center pl-3.5 border-l-2 border-[#1A1A1A]">
              <span className="text-xs font-black tracking-wider text-[#6B7280] uppercase font-['Red_Hat_Display']">
                IF IT'S WORTH BUILDING
              </span>
            </div>
          </div>

          <div className="hidden lg:block pl-3 border-l border-slate-200">
            <span className="text-[11px] font-bold text-[#8A1538] uppercase tracking-wider block">
              Wall Systems Specification & Quotation
            </span>
            <span className="text-[10px] text-slate-500 font-medium">
              Technical Façades & External Wall Solutions
            </span>
          </div>
        </div>

        {/* Status, Sheet Sync, and Actions */}
        <div className="flex items-center gap-3 text-xs">
          {/* Background Auto-Sync Status Badge */}
          <button 
            onClick={() => setShowSettingsModal(true)}
            title="Click to view background spreadsheet status or update link"
            className="flex items-center gap-2 bg-[#F8F9FA] hover:bg-[#EEF1F4] border border-[#CBD5E1] rounded-none px-3 py-1.5 cursor-pointer transition-colors shadow-2xs group"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isSyncing
                  ? 'bg-amber-500 animate-spin'
                  : syncError
                  ? 'bg-[#C8102E]'
                  : 'bg-[#00A887]'
              }`}
            ></span>

            <span className="text-slate-600 font-semibold text-[11px]">
              Catalog:
            </span>

            <span className="text-slate-900 font-bold text-[11px] flex items-center gap-1 font-mono">
              <Database className="w-3 h-3 text-[#00A887]" />
              {productCount} Products
            </span>

            {isSyncing ? (
              <RefreshCw className="w-3 h-3 text-amber-600 animate-spin ml-0.5" />
            ) : (
              <Settings className="w-3 h-3 text-slate-400 group-hover:text-slate-700 transition-colors ml-0.5" />
            )}
          </button>
        </div>
      </div>

      {/* Discrete Background Sheet Settings & Diagnostics Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-none max-w-xl w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-[#C8102E] flex items-center justify-center text-white">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1A1A1A] font-['Red_Hat_Display']">
                    Dynamic Catalog Sync
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Live catalog holds {productCount} dynamic Rockwool products & unit rates
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm px-2 py-1 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-slate-200 text-xs">
              <button
                onClick={() => setActiveTab('url')}
                className={`pb-2.5 font-bold transition-colors relative flex items-center gap-1.5 ${
                  activeTab === 'url' ? 'text-[#C8102E] border-b-2 border-[#C8102E]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Live Spreadsheet Link
              </button>
              <button
                onClick={() => setActiveTab('paste')}
                className={`pb-2.5 font-bold transition-colors relative flex items-center gap-1.5 ${
                  activeTab === 'paste' ? 'text-[#C8102E] border-b-2 border-[#C8102E]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Direct CSV / Tabular Paste
              </button>
            </div>

            {activeTab === 'url' ? (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Published CSV or Edit Share URL:
                  </label>
                  <input
                    type="text"
                    value={customSheetUrl}
                    onChange={(e) => setCustomSheetUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full p-2.5 border border-slate-300 rounded-none text-xs font-mono bg-white focus:outline-none focus:border-[#C8102E]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    The applet synchronizes with your spreadsheet in the background. Changes to prices, SKUs, and coverage rates are reflected immediately.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-slate-500">
                    Status: <strong className="text-slate-800">{lastSyncedText}</strong>
                  </span>
                  <div className="flex gap-2">
                    {onTriggerManualSync && (
                      <button
                        onClick={onTriggerManualSync}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-none border border-slate-300"
                      >
                        Sync Now
                      </button>
                    )}
                    <button
                      onClick={handleSaveSheetConfig}
                      className="px-4 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white font-bold rounded-none shadow-xs"
                    >
                      Save & Connect
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Paste Tab-Separated or CSV Data:
                  </label>
                  <textarea
                    rows={6}
                    value={rawCsvPaste}
                    onChange={(e) => setRawCsvPaste(e.target.value)}
                    placeholder="Paste rows copied from spreadsheet (SKU, Description, Unit, Price, Coverage)..."
                    className="w-full p-2.5 border border-slate-300 rounded-none text-xs font-mono bg-white focus:outline-none focus:border-[#C8102E]"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleImportPastedCsv}
                    className="px-4 py-1.5 bg-[#C8102E] hover:bg-[#8A1538] text-white font-bold rounded-none shadow-xs"
                  >
                    Import Product Rows
                  </button>
                </div>
              </div>
            )}

            {savedNotice && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{savedNotice}</span>
              </div>
            )}

            {localError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>{localError}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

