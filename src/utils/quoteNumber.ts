/**
 * Utilities for generating unique, standardized Rockwool quote reference numbers
 * Format: RW-QUO-[TSM_INITIALS]-[DDMMYY]-[HHMM]-R[REV]
 * Example: RW-QUO-TB-021026-0950-R0
 */

export function getSalesManagerInitials(name?: string, fallback = 'RW'): string {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDdMmYy(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

export function formatHhMm(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}${minutes}`;
}

/**
 * Parses a quote reference number into base reference and numeric revision
 * e.g. "RW-QUO-TB-021026-0950-R1" -> { baseReference: "RW-QUO-TB-021026-0950", revision: 1, fullReference: "RW-QUO-TB-021026-0950-R1" }
 * e.g. "RW-QUO-TB-021026-0950" -> { baseReference: "RW-QUO-TB-021026-0950", revision: 0, fullReference: "RW-QUO-TB-021026-0950-R0" }
 */
export function parseQuoteReference(ref: string): {
  baseReference: string;
  revision: number;
  fullReference: string;
} {
  const trimmed = (ref || '').trim();
  if (!trimmed) {
    return { baseReference: '', revision: 0, fullReference: '' };
  }
  const revMatch = trimmed.match(/^(.*?)-R(\d+)$/i);
  if (revMatch) {
    const base = revMatch[1];
    const rev = parseInt(revMatch[2], 10);
    const validRev = isNaN(rev) ? 0 : rev;
    return {
      baseReference: base,
      revision: validRev,
      fullReference: `${base}-R${validRev}`,
    };
  }
  return {
    baseReference: trimmed,
    revision: 0,
    fullReference: `${trimmed}-R0`,
  };
}

/**
 * Returns the next revision reference for a given quote reference
 * e.g. "RW-QUO-TB-021026-0950-R0" -> "RW-QUO-TB-021026-0950-R1"
 * e.g. "RW-QUO-TB-021026-0950" -> "RW-QUO-TB-021026-0950-R1"
 */
export function incrementQuoteRevision(ref: string): string {
  const { baseReference, revision } = parseQuoteReference(ref);
  const nextRev = revision + 1;
  return `${baseReference}-R${nextRev}`;
}

/**
 * Formats or normalizes a quote reference to ensure it has -R0 if no revision suffix exists
 */
export function normalizeQuoteReference(ref: string, defaultRev = 0): string {
  const trimmed = (ref || '').trim();
  if (!trimmed) return '';
  if (/^.*-R\d+$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}-R${defaultRev}`;
}

export function generateFormattedQuoteNumber(
  tsmName?: string,
  date: Date = new Date(),
  revision = 0
): string {
  const initials = getSalesManagerInitials(tsmName, 'RW');
  const ddmmyy = formatDdMmYy(date);
  const hhmm = formatHhMm(date);
  return `RW-QUO-${initials}-${ddmmyy}-${hhmm}-R${revision}`;
}

/**
 * Updates the TSM initials portion of an existing formatted quote number while preserving revision
 */
export function updateQuoteNumberInitials(currentQuoteNumber: string, newTsmName?: string): string {
  const newInitials = getSalesManagerInitials(newTsmName, 'RW');
  const { baseReference, revision } = parseQuoteReference(currentQuoteNumber);
  const pattern = /^RW-QUO-([A-Z0-9]{2,3})-(\d{6}-\d{4})$/;
  const match = baseReference.match(pattern);
  if (match) {
    return `RW-QUO-${newInitials}-${match[2]}-R${revision}`;
  }
  // If it didn't match the new timestamped format, generate a fresh one
  return generateFormattedQuoteNumber(newTsmName, new Date(), revision);
}
