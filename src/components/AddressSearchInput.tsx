import React, { useState, useEffect, useRef, useId } from 'react';
import { MapPin, Search, Loader2, X, Check, Globe } from 'lucide-react';

interface AddressSuggestion {
  id: string;
  formattedAddress: string;
  primaryLine: string;
  secondaryLine: string;
  postcode?: string;
  city?: string;
}

interface AddressSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const AddressSearchInput: React.FC<AddressSearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search site address or postcode, or type manually...',
  className = '',
}) => {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uniqueId = useId();

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Debounced address search
  useEffect(() => {
    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timer = setTimeout(async () => {
      setIsLoading(true);
      const query = value.trim();

      try {
        const results: AddressSuggestion[] = [];

        // 1. Check if query is UK postcode format (e.g. SW1A 1AA, M1 1AD, NG7 1LU)
        const cleanPostcode = query.replace(/\s+/g, '').toUpperCase();
        const ukPostcodePattern = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
        const isPostcodeMatch = ukPostcodePattern.test(query.trim()) || (cleanPostcode.length >= 5 && cleanPostcode.length <= 7 && /^[A-Z]{1,2}[0-9]/.test(cleanPostcode));

        if (isPostcodeMatch) {
          try {
            const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`, {
              signal: abortController.signal,
            });
            if (pcRes.ok) {
              const pcData = await pcRes.json();
              if (pcData.result) {
                const r = pcData.result;
                const cityTown = r.admin_district || r.parish || r.region || '';
                const county = r.admin_county || r.region || '';
                const postcodeFormatted = r.postcode;
                const secondary = [cityTown, county, postcodeFormatted, r.country].filter(Boolean).join(', ');
                results.push({
                  id: `pc-${r.postcode}`,
                  primaryLine: `${postcodeFormatted} (${cityTown})`,
                  secondaryLine: secondary,
                  formattedAddress: `${cityTown ? `${cityTown}, ` : ''}${county ? `${county}, ` : ''}${postcodeFormatted}`,
                  postcode: postcodeFormatted,
                  city: cityTown,
                });
              }
            }
          } catch (e) {
            // Ignore abort or network errors
          }
        }

        // 2. Query OpenStreetMap Nominatim for street/site addresses
        try {
          const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            query
          )}&addressdetails=1&countrycodes=gb,ie&limit=5`;
          const nomRes = await fetch(nomUrl, {
            headers: {
              'User-Agent': 'RockwoolQuotationEngine/1.0',
            },
            signal: abortController.signal,
          });

          if (nomRes.ok) {
            const nomData = await nomRes.json();
            if (Array.isArray(nomData)) {
              for (const item of nomData) {
                const addr = item.address || {};
                const name = item.name || addr.building || addr.amenity || addr.road || '';
                const road = addr.road || '';
                const suburb = addr.suburb || addr.neighbourhood || addr.village || '';
                const city = addr.city || addr.town || addr.municipality || addr.county || '';
                const postcode = addr.postcode || '';

                const primaryParts = [name !== road ? name : '', road].filter(Boolean);
                const primary = primaryParts.length > 0 ? primaryParts.join(', ') : item.display_name.split(',')[0];
                const secondaryParts = [suburb, city, postcode].filter(Boolean);
                const secondary = secondaryParts.join(', ') || item.display_name;

                // Format clean full address string
                const cleanParts = [primary, suburb, city, postcode].filter(Boolean);
                const cleanAddress = cleanParts.length > 0 ? cleanParts.join(', ') : item.display_name;

                if (!results.some(r => r.formattedAddress.toLowerCase() === cleanAddress.toLowerCase())) {
                  results.push({
                    id: `osm-${item.place_id || Math.random()}`,
                    primaryLine: primary,
                    secondaryLine: secondary,
                    formattedAddress: cleanAddress,
                    postcode,
                    city,
                  });
                }
              }
            }
          }
        } catch (e) {
          // Ignore abort
        }

        if (!abortController.signal.aborted) {
          setSuggestions(results);
          setIsLoading(false);
          if (results.length > 0) {
            setIsOpen(true);
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [value]);

  const handleSelectSuggestion = (suggestion: AddressSuggestion) => {
    onChange(suggestion.formattedAddress);
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
      } else {
        // Keep current custom text
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative flex items-center">
        <input
          id={uniqueId}
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSelectedIndex(-1);
            if (!isOpen && e.target.value.length >= 2) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full text-xs font-medium px-2.5 py-1.5 pr-8 bg-white border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E] ${className}`}
        />

        <div className="absolute right-2 flex items-center gap-1">
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 text-[#C8102E] animate-spin" />
          ) : value ? (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setSuggestions([]);
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="text-slate-400 hover:text-[#C8102E] p-0.5"
              title="Clear address"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          )}
        </div>
      </div>

      {/* Autocomplete Dropdown List */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-[#CBD5E1] shadow-xl max-h-64 overflow-y-auto divide-y divide-[#E2E8F0]">
          {suggestions.length > 0 ? (
            <>
              <div className="p-1.5 bg-[#F8F9FA] text-[10px] font-mono text-slate-500 font-bold uppercase flex items-center justify-between border-b border-[#E2E8F0]">
                <span className="flex items-center gap-1">
                  <Globe className="w-3 h-3 text-[#C8102E]" />
                  <span>Address Suggestions ({suggestions.length})</span>
                </span>
                <span className="text-[9px] text-slate-400 font-normal">Click or press Enter</span>
              </div>

              {suggestions.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectSuggestion(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`px-3 py-2 cursor-pointer text-xs transition-colors flex items-start gap-2.5 ${
                      isSelected ? 'bg-red-50 text-[#1A1A1A] border-l-3 border-l-[#C8102E]' : 'hover:bg-slate-50 text-[#1A1A1A]'
                    }`}
                  >
                    <MapPin className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isSelected ? 'text-[#C8102E]' : 'text-slate-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs leading-tight font-['Red_Hat_Display'] truncate">
                        {item.primaryLine}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                        {item.secondaryLine}
                      </div>
                    </div>
                    {item.postcode && (
                      <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 border border-slate-200 shrink-0">
                        {item.postcode}
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          ) : !isLoading && value && value.length >= 2 ? (
            <div className="p-3 text-xs text-slate-500 flex items-center justify-between">
              <span>No matching address found.</span>
              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 text-slate-600">
                Manual entry accepted
              </span>
            </div>
          ) : null}

          {/* Manual Entry Confirmation Bar */}
          {value && (
            <div
              onClick={() => setIsOpen(false)}
              className="p-2 bg-[#F8F9FA] hover:bg-slate-100 cursor-pointer text-[10px] font-mono text-slate-600 flex items-center justify-between transition-colors border-t border-[#CBD5E1]"
            >
              <span className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-[#00A887]" />
                <span>Keep manual entry: <strong className="text-[#1A1A1A]">"{value}"</strong></span>
              </span>
              <span className="text-slate-400 text-[9px]">[Esc to dismiss]</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
