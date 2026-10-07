/**
 * Date formatting and calculation utilities for Rockwool quotations
 */

/**
 * Returns a YYYY-MM-DD string in the user's local timezone (prevents BST/timezone date shifts)
 */
export function getLocalIsoDate(dateObj: Date = new Date()): string {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converts any date string (ISO YYYY-MM-DD, UK format, or Date object) into YYYY-MM-DD format suitable for <input type="date">
 */
export function toInputDateFormat(dateInput?: string | Date | null): string {
  if (!dateInput) {
    return getLocalIsoDate();
  }
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    // Attempt standard parse
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return getLocalIsoDate(parsed);
    }
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return getLocalIsoDate(dateInput);
  }
  return getLocalIsoDate();
}

/**
 * Formats any date string or Date object into standard UK display format (e.g., '31 Oct 2026')
 */
export function toDisplayDateFormat(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    // If in YYYY-MM-DD format, parse as UTC/local parts to avoid timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return trimmed;
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return '';
}

/**
 * Calculates a future date in YYYY-MM-DD format by adding specified number of days from baseDate
 */
export function addDaysToDate(baseDateInput: string | Date | undefined, daysToAdd: number = 30): string {
  const baseIso = toInputDateFormat(baseDateInput);
  const [year, month, day] = baseIso.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  dateObj.setDate(dateObj.getDate() + daysToAdd);
  
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Calculates the number of days between two dates
 */
export function getDaysDifference(startDateInput?: string, endDateInput?: string): number {
  const startIso = toInputDateFormat(startDateInput);
  const endIso = toInputDateFormat(endDateInput);
  
  const [sY, sM, sD] = startIso.split('-').map(Number);
  const [eY, eM, eD] = endIso.split('-').map(Number);
  
  const start = new Date(sY, sM - 1, sD).getTime();
  const end = new Date(eY, eM - 1, eD).getTime();
  
  const diffTime = end - start;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}
