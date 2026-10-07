import { ProjectRecord } from '../types/quote';
import { DEFAULT_PROJECTS } from './defaultProjects';
import { PERMANENT_SHEET_ID } from './backgroundSheetSync';

const STORAGE_KEY_PROJECTS = 'rockwool_sheet_projects_directory_v1';
const STORAGE_KEY_PROJECTS_LAST_SYNC = 'rockwool_sheet_projects_last_sync_timestamp';

// Projects tab export URL (defaults to permanent spreadsheet ID)
export const PROJECTS_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERMANENT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Projects`;

/**
 * Returns initial list of projects, preferring cached version if valid, otherwise DEFAULT_PROJECTS
 */
export function getInitialProjects(): ProjectRecord[] {
  if (typeof window === 'undefined') return DEFAULT_PROJECTS;
  try {
    const cached = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load cached projects:', e);
  }
  return DEFAULT_PROJECTS;
}

/**
 * Saves project records to localStorage
 */
export function saveCachedProjects(projects: ProjectRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    localStorage.setItem(STORAGE_KEY_PROJECTS_LAST_SYNC, new Date().toISOString());
  } catch (e) {
    console.warn('Failed to cache projects:', e);
  }
}

/**
 * Parses raw CSV from the Projects tab
 */
export function parseProjectsCsv(csvText: string): ProjectRecord[] {
  if (!csvText || typeof csvText !== 'string') return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.toLowerCase().trim());

  // 1. Project Name / Scheme / Title
  let colName = header.findIndex(
    (h) => h === 'project' || h === 'project name' || h === 'project title' || h === 'scheme' || h === 'scheme name' || h === 'development' || h.includes('project title') || h.includes('project name')
  );
  if (colName === -1) {
    colName = header.findIndex((h) => h.includes('project') || h.includes('scheme') || h.includes('development') || h.includes('title'));
  }

  // 2. Project Reference / ID / #
  const colRef = header.findIndex(
    (h) => h.includes('reference') || h.includes('spec ref') || h.includes('project ref') || h === 'ref' || h === 'code' || h === '#'
  );

  // 3. Location / Address
  const colLoc = header.findIndex(
    (h) => h.includes('address') || h.includes('location') || h.includes('site') || h.includes('city') || h.includes('territory')
  );

  // 4. Client Name / Architect / Developer
  const colClient = header.findIndex(
    (h) => h.includes('client') || h.includes('architect') || h.includes('developer') || h.includes('employer')
  );

  // 5. Customer Company / Main Contractor / Specialist Contractor
  const colContractor = header.findIndex(
    (h) => h.includes('main contractor') || h.includes('specialist contractor') || h.includes('contractor') || h.includes('subcontractor') || h.includes('company')
  );

  // 6. Contact Person / Contacts
  const colContact = header.findIndex(
    (h) => h.includes('contacts') || h.includes('contact') || h.includes('person') || h.includes('lead') || h.includes('estimator')
  );

  // 7. Area m2
  const colArea = header.findIndex(
    (h) => h.includes('area') || h.includes('m2') || h.includes('sqm') || h.includes('size') || h.includes('surface')
  );

  // 8. Assigned Price Book
  const colPriceBook = header.findIndex(
    (h) => h.includes('price book') || h.includes('rate book') || h.includes('pricebook') || h.includes('rate')
  );

  const projects: ProjectRecord[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const projectName = colName >= 0 && row[colName] ? row[colName].trim() : '';
    if (!projectName) continue;

    const projectReference = colRef >= 0 && row[colRef] ? row[colRef].trim() : undefined;
    const projectLocation = colLoc >= 0 && row[colLoc] ? row[colLoc].trim() : undefined;
    const clientName = colClient >= 0 && row[colClient] ? row[colClient].trim() : undefined;
    const clientCompany = colContractor >= 0 && row[colContractor] ? row[colContractor].trim() : undefined;
    const contactPerson = colContact >= 0 && row[colContact] ? row[colContact].trim() : undefined;
    
    let areaM2: number | undefined;
    if (colArea >= 0 && row[colArea]) {
      const parsedArea = parseFloat(row[colArea].replace(/[^\d.-]/g, ''));
      if (!isNaN(parsedArea) && parsedArea > 0) {
        areaM2 = parsedArea;
      }
    }

    const assignedPriceBookCode = colPriceBook >= 0 && row[colPriceBook] ? row[colPriceBook].trim() : undefined;

    projects.push({
      id: `proj-${r}`,
      projectName,
      projectReference,
      projectLocation,
      clientName,
      clientCompany,
      contactPerson,
      areaM2,
      assignedPriceBookCode,
    });
  }

  return projects;
}

/**
 * Silently syncs project directory from the Google Sheet "Projects" tab
 */
export async function syncProjectsFromSheet(): Promise<{
  success: boolean;
  projects: ProjectRecord[];
  source: string;
}> {
  try {
    const res = await fetch(PROJECTS_SHEET_CSV_URL);
    if (!res.ok) {
      return { success: false, projects: getInitialProjects(), source: 'Spreadsheet Fallback Projects' };
    }

    const csvText = await res.text();
    if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
      return { success: false, projects: getInitialProjects(), source: 'Spreadsheet Fallback Projects' };
    }

    const parsed = parseProjectsCsv(csvText);
    if (parsed.length > 0) {
      saveCachedProjects(parsed);
      return { success: true, projects: parsed, source: 'Live Google Sheet (Projects tab)' };
    }

    return { success: false, projects: getInitialProjects(), source: 'Spreadsheet Fallback Projects' };
  } catch (e) {
    return { success: false, projects: getInitialProjects(), source: 'Spreadsheet Fallback Projects' };
  }
}
