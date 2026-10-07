import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CustomerRecord } from '../types/quote';
import { Users, Search, Check, X, MapPin, Phone, Mail, UserCheck, ChevronDown, BookOpen } from 'lucide-react';

interface CustomerSelectorProps {
  customers: CustomerRecord[];
  currentClientCompany: string;
  currentClientName?: string;
  onSelectCustomer: (customer: CustomerRecord) => void;
  onClearCustomer: () => void;
}

export const CustomerSelector: React.FC<CustomerSelectorProps> = ({
  customers,
  currentClientCompany,
  onSelectCustomer,
  onClearCustomer,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Filter customers by search term
  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 50); // Show top 50 by default

    return customers.filter((c) => {
      return (
        c.companyName.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q) ||
        c.cityCounty.toLowerCase().includes(q) ||
        c.postcode.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.telephone.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q) ||
        (c.technicalSalesManager && c.technicalSalesManager.toLowerCase().includes(q))
      );
    });
  }, [customers, searchQuery]);

  // Check if current form is linked to a customer record
  const matchingCustomer = useMemo(() => {
    if (!currentClientCompany) return null;
    return customers.find(
      (c) => c.companyName.toLowerCase() === currentClientCompany.toLowerCase()
    );
  }, [customers, currentClientCompany]);

  const handleSelect = (customer: CustomerRecord) => {
    onSelectCustomer(customer);
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#1A1A1A] flex items-center gap-1.5 font-['Red_Hat_Display']">
          <Users className="w-3.5 h-3.5 text-[#C8102E]" />
          <span>Contractor Directory</span>
          <span className="text-[10px] font-mono text-slate-500 font-normal">
            ({customers.length} from "Contractors" tab)
          </span>
        </label>

        {matchingCustomer ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <button
              type="button"
              onClick={onClearCustomer}
              className="text-slate-500 hover:text-[#C8102E] flex items-center gap-1 transition-colors px-1.5 py-0.5 border border-slate-300 hover:border-[#C8102E] bg-white font-bold"
              title="Clear selected customer"
            >
              <X className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Search and Selection Trigger Bar */}
      <div className="relative">
        <div
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className={`flex items-center justify-between w-full px-3 py-2 bg-white border text-xs cursor-pointer transition-colors shadow-2xs ${
            isOpen ? 'border-[#C8102E] ring-1 ring-[#C8102E]' : 'border-[#CBD5E1] hover:border-slate-400'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {matchingCustomer ? (
              <div className="flex items-center gap-2 truncate">
                <span className="font-bold text-[#1A1A1A]">{matchingCustomer.companyName}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{matchingCustomer.contactPerson}</span>
                {matchingCustomer.cityCounty && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500 font-mono text-[11px]">{matchingCustomer.cityCounty}</span>
                  </>
                )}
              </div>
            ) : (
              <span className="text-slate-400">
                Click or search by company, contact person, location, email, or sales manager...
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-slate-200">
            <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5">
              Select
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-[#CBD5E1] shadow-xl max-h-96 flex flex-col">
            {/* Search Input Box */}
            <div className="p-2.5 bg-[#F8F9FA] border-b border-[#CBD5E1] flex items-center gap-2">
              <Search className="w-4 h-4 text-[#C8102E] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type to filter by company name, contact, city, postcode, phone, TSM..."
                className="w-full text-xs bg-white px-2.5 py-1.5 border border-[#CBD5E1] focus:outline-none focus:border-[#C8102E] font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Customer List */}
            <div className="overflow-y-auto divide-y divide-[#E2E8F0] flex-1">
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((cust) => {
                  const isSelected =
                    matchingCustomer && matchingCustomer.companyName.toLowerCase() === cust.companyName.toLowerCase();

                  return (
                    <div
                      key={cust.id}
                      onClick={() => handleSelect(cust)}
                      className={`p-3 cursor-pointer text-xs transition-colors hover:bg-red-50/60 ${
                        isSelected ? 'bg-red-50/80 border-l-4 border-l-[#C8102E]' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#1A1A1A] text-xs font-['Red_Hat_Display']">
                              {cust.companyName}
                            </span>
                            {cust.technicalSalesManager && (
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 bg-slate-100 text-slate-700 border border-slate-200">
                                TSM: {cust.technicalSalesManager}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-800 flex items-center gap-1">
                              <UserCheck className="w-3 h-3 text-[#C8102E]" />
                              {cust.contactPerson}
                            </span>

                            {(cust.cityCounty || cust.postcode) && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="flex items-center gap-1 text-slate-500 font-mono">
                                  <MapPin className="w-3 h-3 text-slate-400" />
                                  {[cust.cityCounty, cust.postcode].filter(Boolean).join(', ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <span className="text-[#C8102E] font-bold text-xs flex items-center gap-1 shrink-0">
                            <Check className="w-4 h-4" />
                            <span>Selected</span>
                          </span>
                        )}
                      </div>

                      {/* Contact Channels */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-500 font-mono">
                        {(cust.mobile || cust.telephone) && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-2.5 h-2.5 text-slate-400" />
                            {cust.mobile || cust.telephone}
                          </span>
                        )}
                        {cust.email && (
                          <span className="flex items-center gap-1 truncate max-w-xs">
                            <Mail className="w-2.5 h-2.5 text-slate-400" />
                            {cust.email}
                          </span>
                        )}
                        {cust.assignedPriceBookCode && (
                          <span className="flex items-center gap-1 text-[#C8102E] font-bold">
                            <BookOpen className="w-2.5 h-2.5" />
                            <span>Price Book: {cust.assignedPriceBookCode}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No customers found matching "<span className="font-semibold text-[#1A1A1A]">{searchQuery}</span>".
                </div>
              )}
            </div>

            {/* Dropdown Footer */}
            <div className="p-2 bg-[#F8F9FA] border-t border-[#CBD5E1] flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Showing {filteredCustomers.length} of {customers.length} customer records</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[#C8102E] hover:underline font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
