import { ProjectRecord } from '../types/quote';

/**
 * Default verified Project Directory extracted from the 'Projects' tab of the Rockwool specification spreadsheet.
 * Contains initial schemes and development records with site location, client, contractor, reference, and façade surface area.
 */
export const DEFAULT_PROJECTS: ProjectRecord[] = [
  {
    id: 'proj-1',
    projectName: 'Park West Residential Scheme',
    projectReference: 'PR-2026-8849',
    projectLocation: 'Park West, Nottingham, NG1 5FW',
    clientName: 'Wates Construction Ltd',
    clientCompany: 'Build Therm Services Ltd',
    contactPerson: 'Mr Agron Gjoka',
    areaM2: 1250,
    assignedPriceBookCode: 'PB-2026-ROCK-STD',
  },
  {
    id: 'proj-2',
    projectName: 'Grand Central Plaza Development',
    projectReference: 'GCP-2026-9021',
    projectLocation: 'Station Way, Birmingham, B2 4QA',
    clientName: 'Morgan Sindall Group plc',
    clientCompany: 'Eden Facades Ltd',
    contactPerson: 'Mr Anthony Hill',
    areaM2: 3400,
    assignedPriceBookCode: 'PB-TIER1-FRAMEWORK',
  },
  {
    id: 'proj-3',
    projectName: 'St Junction High-Rise Remediation',
    projectReference: 'STJ-2026-4412',
    projectLocation: 'Junction Road, Manchester, M1 3HE',
    clientName: 'Balfour Beatty plc',
    clientCompany: 'A Thomas Acrylic Render Specialist Ltd',
    contactPerson: 'Mr Adrian Thomas',
    areaM2: 2100,
    assignedPriceBookCode: 'PB-2026-ROCK-STD',
  },
  {
    id: 'proj-4',
    projectName: 'Riverfront Apartments Phase 2',
    projectReference: 'RIV-2026-1180',
    projectLocation: 'Embankment East, London, SE1 7PB',
    clientName: 'Kier Group plc',
    clientCompany: 'Complete Rendering Systems Ltd',
    contactPerson: 'Mr Bradley Hall',
    areaM2: 4850,
    assignedPriceBookCode: 'PB-SPEC-PROJECT',
  },
  {
    id: 'proj-5',
    projectName: 'Meadowlands Commercial Centre',
    projectReference: 'MCC-2026-7320',
    projectLocation: 'Meadowlands Park, Leeds, LS11 9BL',
    clientName: 'ISG Construction',
    clientCompany: 'B & G Projects',
    contactPerson: 'Mr Steve Kemp-Thacker',
    areaM2: 1800,
    assignedPriceBookCode: 'PB-2026-ROCK-STD',
  },
];
