import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { QuoteLineItem, QuoteMeta } from '../types/quote';
import { 
  sortQuoteItemsByApplicationOrder, 
  getProductApplicationStage, 
  separateSystemAndAncillaryItems,
  isUnitCoversLessThanOneM2,
  calculateItemPricePerM2
} from './applicationOrder';
import { toDisplayDateFormat, getDaysDifference } from './dateUtils';
import { DEFAULT_STANDARD_TERMS } from '../constants/terms';

/**
 * Official ROCKWOOL Brand Red (#D20014) from the logo specification
 */
export const ROCKWOOL_RED = [210, 0, 20]; // #D20014
export const ROCKWOOL_DARK = [26, 26, 26]; // #1A1A1A
export const ROCKWOOL_SLATE = [74, 85, 104]; // #4A5568
export const ROCKWOOL_LIGHT = [248, 249, 250]; // #F8F9FA
export const ROCKWOOL_BORDER = [226, 232, 240]; // #E2E8F0

/**
 * Loads the official ROCKWOOL logo as a high-resolution PNG data URL for jsPDF embedding
 */
export async function getRockwoolLogoDataUrl(): Promise<string> {
  if (typeof window === 'undefined') return '';

  return new Promise((resolve) => {
    try {
      const svg = `<svg version="1.0" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 836.8 153.1">
        <g>
          <rect fill="#D20014" width="153.1" height="153.1" />
          <polygon fill="#FFFFFF" points="70.8,86.1 53.6,114.8 15.3,114.8 61.2,38.3 70.8,38.3" />
          <polygon fill="#FFFFFF" points="99.5,114.8 82.3,86.1 82.3,38.3 91.9,38.3 137.7,114.8" />
          <path fill="#D20014" d="M191.3,38.3h33c3.7,0,7.5,0.4,11.2,1.1c3.7,0.8,7,2.1,9.9,4c2.9,1.9,5.3,4.5,7.1,7.7c1.8,3.2,2.7,7.2,2.7,12.1 c0,4.7-1.2,8.8-3.5,12.4c-2.3,3.6-5.6,6.3-9.9,8.3l19.4,31h-29.6L217,87.4h-0.8v27.3h-25V38.3z M216.1,70.6h5 c0.9,0,1.8-0.1,2.8-0.2c1-0.1,2-0.4,2.9-0.9c0.9-0.5,1.6-1.1,2.3-1.9c0.6-0.8,0.9-1.9,0.9-3.3c0-1.4-0.3-2.4-0.8-3.2 c-0.5-0.8-1.1-1.4-1.9-1.8c-0.8-0.4-1.6-0.6-2.6-0.8c-0.9-0.1-1.8-0.2-2.6-0.2h-6.1V70.6z"/>
          <path fill="#D20014" d="M258,76.1c0-6.1,1.1-11.7,3.2-16.6s5.1-9.1,8.9-12.6s8.3-6.1,13.5-8c5.2-1.9,10.8-2.8,16.9-2.8 c6.1,0,11.7,0.9,16.9,2.8c5.2,1.9,9.7,4.5,13.5,8c3.8,3.5,6.8,7.7,9,12.6s3.2,10.5,3.2,16.6c0,6.1-1.1,11.7-3.2,16.8 c-2.2,5-5.2,9.3-9,12.9c-3.8,3.6-8.3,6.3-13.5,8.3c-5.2,1.9-10.8,2.9-16.9,2.9c-6.1,0-11.7-1-16.9-2.9c-5.2-1.9-9.7-4.7-13.5-8.3 c-3.8-3.6-6.8-7.9-8.9-12.9C259.1,87.8,258,82.2,258,76.1z M285.4,76.1c0,2.5,0.4,4.8,1.1,6.9c0.8,2.1,1.8,3.9,3.1,5.4 c1.3,1.5,2.9,2.7,4.8,3.5c1.9,0.8,3.9,1.2,6.1,1.2c2.2,0,4.2-0.4,6-1.2c1.8-0.8,3.4-2,4.8-3.5c1.4-1.5,2.4-3.3,3.2-5.4 c0.8-2.1,1.1-4.4,1.1-6.9c0-2.4-0.4-4.7-1.1-6.8c-0.8-2.1-1.8-3.8-3.2-5.2c-1.4-1.4-3-2.5-4.8-3.3c-1.8-0.8-3.8-1.2-6-1.2 c-2.2,0-4.2,0.4-6.1,1.2c-1.9,0.8-3.5,1.9-4.8,3.3c-1.3,1.4-2.4,3.1-3.1,5.2C285.8,71.4,285.4,73.6,285.4,76.1z"/>
          <path fill="#D20014" d="M346,76.5c0-6.1,1.1-11.7,3.2-16.6c2.2-5,5.1-9.2,8.9-12.8c3.7-3.5,8.2-6.3,13.2-8.2 c5.1-1.9,10.5-2.9,16.3-2.9c5.9,0,11.5,1,16.8,2.9c5.3,1.9,9.7,4.5,13.2,7.7l-15.8,19c-1.4-1.9-3.2-3.3-5.4-4.3 c-2.2-1-4.6-1.5-7.2-1.5c-2.2,0-4.2,0.4-6.1,1.1c-1.9,0.8-3.5,1.9-4.9,3.3c-1.4,1.4-2.5,3.2-3.3,5.2c-0.8,2.1-1.2,4.3-1.2,6.9 c0,2.5,0.4,4.8,1.2,6.8c0.8,2,1.9,3.7,3.4,5.1c1.4,1.4,3,2.5,4.9,3.3c1.9,0.8,3.9,1.1,5.9,1.1c3,0,5.5-0.6,7.6-1.8 c2.1-1.2,3.8-2.7,5-4.3l15.8,18.9c-3.5,3.5-7.7,6.2-12.8,8.3c-5,2.1-10.8,3.1-17.2,3.1c-5.8,0-11.2-1-16.3-2.9 c-5.1-1.9-9.5-4.7-13.2-8.3c-3.7-3.6-6.7-7.8-8.9-12.8C347,88.1,346,82.6,346,76.5z"/>
          <path fill="#D20014" d="M445.8,84.3h-0.2v30.5h-25V38.3h24.9v28.2h0.2l20.4-28.2h30.3l-28.8,35l30.2,41.5h-31.6L445.8,84.3z"/>
          <path fill="#D20014" d="M542.4,114.8h-25.9l-20.9-76.5h27.2l8.2,43h0.4l8.9-43h26.9l9.6,43h0.4l8.3-43h26.4l-21.3,76.5h-25.9L554,71.6 h-0.4L542.4,114.8z"/>
          <path fill="#D20014" d="M608,76.1c0-6.1,1.1-11.7,3.2-16.6c2.2-4.9,5.1-9.1,8.9-12.6s8.3-6.1,13.5-8c5.2-1.9,10.8-2.8,16.9-2.8 c6.1,0,11.7,0.9,16.9,2.8c5.2,1.9,9.7,4.5,13.5,8c3.8,3.5,6.8,7.7,9,12.6c2.2,4.9,3.2,10.5,3.2,16.6c0,6.1-1.1,11.7-3.2,16.8 c-2.2,5-5.2,9.3-9,12.9c-3.8,3.6-8.3,6.3-13.5,8.3c-5.2,1.9-10.8,2.9-16.9,2.9c-6.1,0-11.7-1-16.9-2.9c-5.2-1.9-9.7-4.7-13.5-8.3 c-3.8-3.6-6.8-7.9-8.9-12.9C609.1,87.8,608,82.2,608,76.1z M635.3,76.1c0,2.5,0.4,4.8,1.1,6.9c0.8,2.1,1.8,3.9,3.1,5.4 c1.3,1.5,2.9,2.7,4.8,3.5c1.9,0.8,3.9,1.2,6.1,1.2s4.2-0.4,6-1.2c1.8-0.8,3.4-2,4.8-3.5c1.4-1.5,2.4-3.3,3.2-5.4 c0.8-2.1,1.1-4.4,1.1-6.9c0-2.4-0.4-4.7-1.1-6.8c-0.8-2.1-1.8-3.8-3.2-5.2c-1.4-1.4-3-2.5-4.8-3.3c-1.8-0.8-3.8-1.2-6-1.2 s-4.2,0.4-6.1,1.2c-1.9,0.8-3.5,1.9-4.8,3.3c-1.3,1.4-2.4,3.1-3.1,5.2C635.7,71.4,635.3,73.6,635.3,76.1z"/>
          <path fill="#D20014" d="M695.9,76.1c0-6.1,1.1-11.7,3.2-16.6s5.1-9.1,8.9-12.6c3.8-3.5,8.3-6.1,13.5-8c5.2-1.9,10.8-2.8,16.9-2.8 c6.1,0,11.7,0.9,16.9,2.8c5.2,1.9,9.7,4.5,13.5,8c3.8,3.5,6.8,7.7,9,12.6c2.2,4.9,3.2,10.5,3.2,16.6c0,6.1-1.1,11.7-3.2,16.8 c-2.2,5-5.2,9.3-9,12.9c-3.8,3.6-8.3,6.3-13.5,8.3c-5.2,1.9-10.8,2.9-16.9,2.9c-6.1,0-11.7-1-16.9-2.9c-5.2-1.9-9.7-4.7-13.5-8.3 c-3.8-3.6-6.8-7.9-8.9-12.9C697,87.8,695.9,82.2,695.9,76.1z M723.3,76.1c0,2.5,0.4,4.8,1.1,6.9c0.8,2.1,1.8,3.9,3.1,5.4 c1.3,1.5,2.9,2.7,4.8,3.5c1.9,0.8,3.9,1.2,6.1,1.2c2.2,0,4.2-0.4,6-1.2c1.8-0.8,3.4-2,4.8-3.5c1.4-1.5,2.4-3.3,3.2-5.4 c0.8-2.1,1.1-4.4,1.1-6.9c0-2.4-0.4-4.7-1.1-6.8c-0.8-2.1-1.8-3.8-3.2-5.2c-1.4-1.4-3-2.5-4.8-3.3c-1.8-0.8-3.8-1.2-6-1.2 c-2.2,0-4.2,0.4-6.1,1.2c-1.9,0.8-3.5,1.9-4.8,3.3c-1.3,1.4-2.4,3.1-3.1,5.2C723.6,71.4,723.3,73.6,723.3,76.1z"/>
          <path fill="#D20014" d="M785.4,38.3h25.9v54.4h25.4v22.2h-51.3V38.3z"/>
          <path fill="#D20014" d="M818.3,47.3c0-1.3,0.2-2.5,0.7-3.7c0.5-1.1,1.2-2.1,2-2.9c0.8-0.8,1.8-1.5,2.9-1.9c1.1-0.5,2.3-0.7,3.6-0.7 c1.2,0,2.4,0.2,3.6,0.7c1.1,0.5,2.1,1.1,2.9,1.9c0.8,0.8,1.5,1.8,2,2.9c0.5,1.1,0.7,2.3,0.7,3.6c0,1.3-0.2,2.5-0.7,3.7 c-0.5,1.1-1.2,2.1-2,2.9c-0.8,0.8-1.8,1.5-2.9,1.9c-1.1,0.5-2.3,0.7-3.6,0.7c-1.3,0-2.5-0.2-3.6-0.7c-1.1-0.5-2.1-1.1-2.9-1.9 c-0.8-0.8-1.5-1.8-2-2.9C818.6,49.8,818.3,48.6,818.3,47.3z M819.8,47.3c0,1.1,0.2,2.1,0.6,3.1c0.4,0.9,1,1.8,1.7,2.5 c0.7,0.7,1.5,1.2,2.5,1.6c0.9,0.4,1.9,0.6,3,0.6s2.1-0.2,3-0.6c0.9-0.4,1.8-1,2.5-1.7c0.7-0.7,1.3-1.5,1.7-2.5c0.4-1,0.6-2,0.6-3.1 c0-1.1-0.2-2.1-0.6-3.1c-0.4-1-1-1.8-1.7-2.5s-1.5-1.2-2.5-1.6c-0.9-0.4-1.9-0.6-3-0.6s-2.1,0.2-3,0.6c-0.9,0.4-1.8,1-2.5,1.6 c-0.7,0.7-1.3,1.5-1.7,2.5C820,45.1,819.8,46.2,819.8,47.3z M824.1,42h3.9c1.3,0,2.2,0.2,2.8,0.7c0.6,0.5,0.9,1.3,0.9,2.3 c0,1-0.3,1.6-0.8,2.1c-0.5,0.4-1.2,0.7-2,0.8l3.1,4.7h-1.6l-2.9-4.5h-1.9v4.5h-1.5V42z M825.6,46.7h1.8c0.4,0,0.7,0,1.1,0 c0.3,0,0.7-0.1,0.9-0.2s0.5-0.3,0.6-0.5c0.2-0.2,0.2-0.6,0.2-1c0-0.4-0.1-0.7-0.2-0.9c-0.1-0.2-0.3-0.4-0.6-0.5 c-0.2-0.1-0.5-0.2-0.8-0.2c-0.3,0-0.6,0-0.8,0h-2.3V46.7z"/>
        </g>
      </svg>`;

      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1674;
        canvas.height = 306;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 1674, 306);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(url);
          resolve('');
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('');
      };
      img.src = url;
    } catch {
      resolve('');
    }
  });
}

/**
 * Generates an official, client-ready Rockwool Wall Systems quotation PDF
 * incorporating the official logo and Rockwool brand design language:
 * - Official ROCKWOOL Logo lockup (Signature red icon & red wordmark)
 * - Brand Red (#D20014), Charcoal (#1A1A1A), and Slate design accents
 * - Strictly separates Main System items (calculated per m²) from Ancillaries (individual item pricing)
 * - Ancillaries are excluded from the m² rate and presented in a dedicated section
 * - Strictly stripped of internal margins and wholesale costs
 */
export async function exportQuoteToClientPdf(meta: QuoteMeta, items: QuoteLineItem[]): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Load official Rockwool logo as high-res PNG data URL
  const logoDataUrl = await getRockwoolLogoDataUrl();

  // 1. Top Architectural Brand Stripe (Pantone 186 C / Rockwool Red #D20014)
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(0, 0, pageWidth, 3.5, 'F');

  // Header background (Clean white engineering presentation)
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 3.5, pageWidth, 26.5, 'F');

  // Official Logo Placement on Left
  const logoWidth = 54;
  const logoHeight = logoWidth / 5.4657; // 9.88 mm
  const logoX = 14;
  const logoY = 8;

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight);
  } else {
    // Crisp vector fallback for Rockwool logo
    doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
    doc.rect(logoX, logoY, logoHeight, logoHeight, 'F');
    doc.setFillColor(255, 255, 255);
    doc.triangle(logoX + 2, logoY + 7.5, logoX + 5, logoY + 2.5, logoX + 4.5, logoY + 7.5, 'F');
    doc.triangle(logoX + 8, logoY + 7.5, logoX + 5.5, logoY + 2.5, logoX + 5.8, logoY + 7.5, 'F');

    doc.setTextColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('ROCKWOOL', logoX + 12, logoY + 7.5);
  }

  // System subtitle below logo
  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('WALL SYSTEMS SPECIFICATION & QUOTATION', logoX, logoY + logoHeight + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text('STONE WOOL EXTERNAL INSULATION & FAÇADE SOLUTIONS', logoX, logoY + logoHeight + 8);

  // Right-side Reference Badge in Rockwool Red design
  const badgeWidth = 62;
  const badgeX = pageWidth - 14 - badgeWidth;
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.roundedRect(badgeX, 7.5, badgeWidth, 7, 1, 1, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`REF: ${meta.quoteNumber}`, badgeX + badgeWidth / 2, 12.2, { align: 'center' });

  // Date and Validity info on right
  const formattedIssueDate = toDisplayDateFormat(meta.date) || meta.date;
  const formattedExpiryDate = toDisplayDateFormat(meta.validUntil) || meta.validUntil;
  const validityDays = getDaysDifference(meta.date, meta.validUntil);

  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Date of Issue: ${formattedIssueDate}`, pageWidth - 14, 18.5, { align: 'right' });
  doc.text(`Valid Until: ${formattedExpiryDate} (${validityDays > 0 ? `${validityDays} Days` : '30 Days'})`, pageWidth - 14, 22.5, { align: 'right' });

  // Sleek dual-line header divider
  doc.setDrawColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.setLineWidth(0.7);
  doc.line(14, 28.5, pageWidth - 14, 28.5);

  doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
  doc.setLineWidth(0.2);
  doc.line(14, 29.5, pageWidth - 14, 29.5);

  // 2. Client & Project Specification Cards
  let currentY = 34;
  const colWidth = (pageWidth - 28) / 2 - 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const projectLines: string[] = doc.splitTextToSize(meta.projectName || 'External Façade Specification', colWidth - 8);
  const customerCompany = meta.clientCompany || 'Estimating / Commercial Team';
  const customerLines: string[] = doc.splitTextToSize(customerCompany, colWidth - 8);

  const customerFullAddress = [meta.clientAddress, meta.clientCity, meta.clientPostcode].filter(Boolean).join(', ');
  let extraCustomerLines = 2;
  if (customerFullAddress) extraCustomerLines += 1;
  if (meta.technicalSalesManager) extraCustomerLines += 1;

  let extraProjectLines = 2; // location + area
  if (meta.clientName) extraProjectLines += 1;
  if (meta.projectReference) extraProjectLines += 1;
  if (meta.priceBookName || meta.priceBookCode) extraProjectLines += 1;

  const leftHeight = 12 + projectLines.length * 4.2 + extraProjectLines * 4.5 + 4;
  const rightHeight = 12 + customerLines.length * 4.2 + extraCustomerLines * 4.2 + 8;
  const cardHeight = Math.max(42, Math.max(leftHeight, rightHeight));

  // --- Left Card: Project Details ---
  doc.setFillColor(ROCKWOOL_LIGHT[0], ROCKWOOL_LIGHT[1], ROCKWOOL_LIGHT[2]);
  doc.rect(14, currentY, colWidth, cardHeight, 'F');
  doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
  doc.rect(14, currentY, colWidth, cardHeight, 'S');

  // Solid Rockwool Red left accent bar
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(14, currentY, 3, cardHeight, 'F');

  doc.setTextColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('PROJECT & SPECIFICATION DETAILS', 20, currentY + 7);

  doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  let pY = currentY + 13;
  doc.text(projectLines, 20, pY);
  pY += projectLines.length * 4.2 + 1.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
  if (meta.clientName) {
    doc.text(`Client Name: ${meta.clientName}`, 20, pY);
    pY += 4.5;
  }
  doc.text(`Location: ${meta.projectLocation || 'United Kingdom Façade Site'}`, 20, pY);
  pY += 4.5;
  if (meta.projectReference) {
    doc.text(`Project Reference: ${meta.projectReference}`, 20, pY);
    pY += 4.5;
  }
  if (meta.priceBookName || meta.priceBookCode) {
    doc.text(`Commercial Price Book: ${meta.priceBookName || meta.priceBookCode}`, 20, pY);
    pY += 4.5;
  }
  doc.text(`Net Façade Surface Area: ${meta.areaM2} m² (+${meta.wasteagePercent}% wastage allowance)`, 20, pY);

  // --- Right Card: Customer Info ---
  const rightColX = pageWidth / 2 + 3;
  doc.setFillColor(ROCKWOOL_LIGHT[0], ROCKWOOL_LIGHT[1], ROCKWOOL_LIGHT[2]);
  doc.rect(rightColX, currentY, colWidth, cardHeight, 'F');
  doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
  doc.rect(rightColX, currentY, colWidth, cardHeight, 'S');

  // Solid Rockwool Red left accent bar
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(rightColX, currentY, 3, cardHeight, 'F');

  doc.setTextColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('QUOTATION PREPARED FOR', rightColX + 6, currentY + 7);

  doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  let cY = currentY + 13;
  doc.text(customerLines, rightColX + 6, cY);
  cY += customerLines.length * 4.2 + 1.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
  if (customerFullAddress) {
    const addressLines: string[] = doc.splitTextToSize(`Address: ${customerFullAddress}`, colWidth - 12);
    doc.text(addressLines, rightColX + 6, cY);
    cY += addressLines.length * 3.8 + 0.5;
  }
  if (meta.clientEmail) {
    doc.text(`Email: ${meta.clientEmail}`, rightColX + 6, cY);
    cY += 4.0;
  }
  if (meta.clientPhone) {
    doc.text(`Phone: ${meta.clientPhone}`, rightColX + 6, cY);
    cY += 4.0;
  }
  if (meta.technicalSalesManager) {
    doc.text(`Technical Sales Manager: ${meta.technicalSalesManager}`, rightColX + 6, cY);
    cY += 4.0;
  }
  doc.text(`Quote Ref: ${meta.quoteNumber}  |  Valid Until: ${formattedExpiryDate}`, rightColX + 6, cY);

  currentY += cardHeight + 6;

  // =========================================================================
  // SEPARATE SYSTEM PRODUCTS FROM ANCILLARIES
  // Ancillaries cannot be calculated on a m² rate and are priced as individual items!
  // =========================================================================
  const { systemItems, ancillaryItems } = separateSystemAndAncillaryItems(items);
  const area = Math.max(1, meta.areaM2);

  // 3. SECTION 1: MAIN FAÇADE SYSTEM PRODUCTS (CALCULATED PER m²)
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(14, currentY - 3, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
  doc.text('MAIN FAÇADE SYSTEM SPECIFICATION (CALCULATED PER m²)', 20, currentY);

  currentY += 4;

  // Main System Table Rows
  const systemTableRows = systemItems.map((item, idx) => {
    const stage = getProductApplicationStage(item);
    const isLessThanOne = isUnitCoversLessThanOneM2(item);
    const itemPricePerM2 = item.pricePerM2 ?? calculateItemPricePerM2(item.unitSellPrice, item.consumptionRatePerM2 || (isLessThanOne ? 0.72 : 1), false, isLessThanOne);

    return [
      idx + 1,
      `${stage.categoryDisplay}\n${item.sku}`,
      `${item.description}\n(${item.coverageNotes || 'Standard consumption rate'})`,
      item.unit,
      Math.ceil(item.finalQuantity).toLocaleString(undefined, { maximumFractionDigits: 0 }),
      `£${item.unitSellPrice.toFixed(2)}`,
      item.excludeFromM2Rate ? 'Excluded' : `£${itemPricePerM2.toFixed(2)} / m²`,
    ];
  });

  const materialsRatePerM2 = systemItems.reduce((sum, i) => {
    if (i.excludeFromM2Rate) return sum;
    const isLessThanOne = isUnitCoversLessThanOneM2(i);
    return sum + (i.pricePerM2 ?? calculateItemPricePerM2(i.unitSellPrice, i.consumptionRatePerM2 || (isLessThanOne ? 0.72 : 1), false, isLessThanOne));
  }, 0);
  const installationRatePerM2 = meta.includeInstallationEstimate
    ? meta.installationRatePerM2
    : 0;
  const systemNetRate = materialsRatePerM2 + installationRatePerM2;

  autoTable(doc, {
    startY: currentY,
    head: [['#', 'Category / SKU', 'Product & System Specification', 'Unit', 'Quantity', 'Unit Price (£)', '£/m² Price']],
    body: systemTableRows,
    foot: [
      ['', '', 'Total System m² Price:', '', '', '', `£${systemNetRate.toFixed(2)} / m²`],
    ],
    showFoot: 'lastPage',
    theme: 'grid',
    headStyles: {
      fillColor: [ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
    },
    footStyles: {
      fillColor: [248, 249, 250],
      textColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]],
      fontStyle: 'bold',
      fontSize: 7.8,
      halign: 'right',
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 26, fontSize: 7.2, fontStyle: 'bold', textColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]] },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 18, halign: 'center', fontSize: 7.2, textColor: [ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]] },
      4: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 25, halign: 'right', fontStyle: 'bold', textColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]] },
    },
    margin: { top: 16, bottom: 20, left: 14, right: 14 },
    styles: {
      fontSize: 7.8,
      cellPadding: 2.8,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    alternateRowStyles: {
      fillColor: [251, 252, 253],
    },
  });

  let nextSectionY = (doc as any).lastAutoTable.finalY + 7;

  // =========================================================================
  // 4. SECTION 2: ANCILLARIES (INDIVIDUAL ITEM PRICING)
  // Strictly separated out of the m² rate!
  // =========================================================================
  const ancillariesTotalNet = ancillaryItems.reduce((sum, i) => sum + (i.finalQuantity * i.unitSellPrice), 0);

  if (ancillaryItems.length > 0) {
    // Check if new page is needed for Ancillaries section
    if (nextSectionY > pageHeight - 55) {
      doc.addPage();
      nextSectionY = 20;
    }

    doc.setFillColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.rect(14, nextSectionY - 3, 3, 3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.text('ANCILLARIES', 20, nextSectionY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
    doc.text('Ancillaries cannot be calculated on a m² rate and are treated as individual item prices (trims, base rails, beads, sealing tapes)', 14, nextSectionY + 4.5);

    nextSectionY += 8;

    const ancillaryTableRows = ancillaryItems.map((item, idx) => {
      const lineTotal = item.finalQuantity * item.unitSellPrice;

      return [
        idx + 1,
        `Ancillaries\n${item.sku}`,
        `${item.description}${item.coverageNotes ? `\n(${item.coverageNotes})` : ''}`,
        item.unit,
        Math.ceil(item.finalQuantity).toLocaleString(undefined, { maximumFractionDigits: 0 }),
        `£${item.unitSellPrice.toFixed(2)}`,
        `£${lineTotal.toFixed(2)}`,
      ];
    });

    autoTable(doc, {
      startY: nextSectionY,
      head: [['#', 'Category / SKU', 'Ancillary Product & Specification', 'Unit', 'Quantity', 'Unit Price (£)', 'Total Price (£)']],
      body: ancillaryTableRows,
      foot: [
        ['', '', 'Subtotal: Ancillaries Total (Individual Item Prices):', '', '', '', `£${ancillariesTotalNet.toFixed(2)}`],
      ],
      showFoot: 'lastPage',
      theme: 'grid',
      headStyles: {
        fillColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'left',
      },
      footStyles: {
        fillColor: [248, 249, 250],
        textColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]],
        fontStyle: 'bold',
        fontSize: 7.8,
        halign: 'right',
      },
      columnStyles: {
        0: { cellWidth: 7, halign: 'center' },
        1: { cellWidth: 26, fontSize: 7.2, fontStyle: 'bold', textColor: [ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]] },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 18, halign: 'center', fontSize: 7.2, textColor: [ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]] },
        4: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 25, halign: 'right', fontStyle: 'bold', textColor: [ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]] },
      },
      margin: { top: 16, bottom: 20, left: 14, right: 14 },
      styles: {
        fontSize: 7.8,
        cellPadding: 2.8,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        overflow: 'linebreak',
      },
      alternateRowStyles: {
        fillColor: [251, 252, 253],
      },
    });

    nextSectionY = (doc as any).lastAutoTable.finalY + 7;
  }

  // Position after all tables
  const finalY = nextSectionY;

  // 5. Financial Summary Card (Right aligned - Rate per m² specification & Ancillaries item totals)
  const summaryWidth = 86;
  const summaryX = pageWidth - 14 - summaryWidth;
  const hasAncillaries = ancillaryItems.length > 0;
  const excludedSystemItems = systemItems.filter((i) => i.excludeFromM2Rate);
  const excludedSystemTotalNet = excludedSystemItems.reduce((sum, i) => sum + (i.finalQuantity * i.unitSellPrice), 0);
  const hasExcludedItems = excludedSystemItems.length > 0;
  const summaryBoxHeight = (meta.includeInstallationEstimate ? 6 : 0) + (hasAncillaries ? 10 : 0) + (hasExcludedItems ? 10 : 0) + 14;

  // Check if summary card and notes fit on page, else break cleanly to next page
  let summaryStartY = finalY;
  if (summaryStartY + summaryBoxHeight > pageHeight - 20) {
    doc.addPage();
    summaryStartY = 16;
  }

  doc.setFillColor(ROCKWOOL_LIGHT[0], ROCKWOOL_LIGHT[1], ROCKWOOL_LIGHT[2]);
  doc.rect(summaryX, summaryStartY, summaryWidth, summaryBoxHeight, 'F');
  doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
  doc.rect(summaryX, summaryStartY, summaryWidth, summaryBoxHeight, 'S');

  doc.setFontSize(7.8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);

  let sumRowY = summaryStartY + 5.5;

  if (meta.includeInstallationEstimate) {
    doc.text('Installation Allowance:', summaryX + 4, sumRowY);
    doc.text(`£${installationRatePerM2.toFixed(2)} / m²`, summaryX + summaryWidth - 4, sumRowY, { align: 'right' });
    sumRowY += 5.5;
  }

  // Prominent Total System m² Price highlight banner in Rockwool Red
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(summaryX, sumRowY - 4.2, summaryWidth, 8.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text('TOTAL SYSTEM m² PRICE:', summaryX + 4, sumRowY + 1.2);
  doc.text(`£${systemNetRate.toFixed(2)} / m²`, summaryX + summaryWidth - 4, sumRowY + 1.2, { align: 'right' });

  // If items excluded from £/m² rate exist, show Excluded Items Total
  if (hasExcludedItems) {
    sumRowY += 9.5;
    doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text('Excluded System Items:', summaryX + 4, sumRowY);
    doc.text(`£${excludedSystemTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, summaryX + summaryWidth - 4, sumRowY, { align: 'right' });
  }

  // If Ancillaries exist, show Ancillaries Total (Individual Item Pricing)
  if (hasAncillaries) {
    sumRowY += 9.5;
    doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text('Ancillaries Total:', summaryX + 4, sumRowY);
    doc.text(`£${ancillariesTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, summaryX + summaryWidth - 4, sumRowY, { align: 'right' });
  }

  // 6. Terms & Technical Notes (Spread across the full page width below summary card)
  const notesX = 14;
  const notesWidth = pageWidth - 28;
  const notesInnerPadding = 6;
  const notesTextWidth = notesWidth - (notesInnerPadding * 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);

  const defaultTerms = meta.notesAndTerms || DEFAULT_STANDARD_TERMS;

  const splitNotes = doc.splitTextToSize(defaultTerms, notesTextWidth);
  const lineSpacingMm = (6.2 * 1.15) / 2.8346;
  const notesTextHeight = (splitNotes.length - 1) * lineSpacingMm;
  const totalNotesBoxHeight = notesTextHeight + 13;

  const footerLineY = pageHeight - 16;
  let notesStartY = summaryStartY + summaryBoxHeight + 5;

  // If notes exceed page limit before footer, start cleanly on next page
  if (notesStartY + totalNotesBoxHeight > footerLineY - 3) {
    doc.addPage();
    notesStartY = 16;
  }

  // Draw clean full-width bordered container for Terms & Technical Notes
  doc.setFillColor(ROCKWOOL_LIGHT[0], ROCKWOOL_LIGHT[1], ROCKWOOL_LIGHT[2]);
  doc.rect(notesX, notesStartY, notesWidth, totalNotesBoxHeight, 'F');
  doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
  doc.setLineWidth(0.2);
  doc.rect(notesX, notesStartY, notesWidth, totalNotesBoxHeight, 'S');

  // Left red accent indicator
  doc.setFillColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.rect(notesX, notesStartY, 2.5, totalNotesBoxHeight, 'F');

  // Title: Terms & Technical Notes
  doc.setTextColor(ROCKWOOL_RED[0], ROCKWOOL_RED[1], ROCKWOOL_RED[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0);
  doc.text('Terms & Technical Notes', notesX + notesInnerPadding, notesStartY + 5.2);

  // Notes body text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
  doc.text(splitNotes, notesX + notesInnerPadding, notesStartY + 9.5);

  // 7. Footer on all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerLineY = pageHeight - 16;
    doc.setDrawColor(ROCKWOOL_BORDER[0], ROCKWOOL_BORDER[1], ROCKWOOL_BORDER[2]);
    doc.setLineWidth(0.2);
    doc.line(14, footerLineY, pageWidth - 14, footerLineY);

    // Company Title (Left)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.text('ROCKWOOL Wall Systems Ltd', 14, footerLineY + 3.8);

    // Address (Line 2)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(ROCKWOOL_SLATE[0], ROCKWOOL_SLATE[1], ROCKWOOL_SLATE[2]);
    doc.text('1 Kid Glove Road, Golborne Enterprise Park, Golborne, Greater Manchester, WA3 3GS', 14, footerLineY + 7.2);

    // Telephone, Fax, Website, and Registration (Line 3)
    doc.text('Tel: 01942 717100 | Fax: 01942 717101 | www.wall-systems.co.uk | Reg. in England: 3621726', 14, footerLineY + 10.5);

    // Page Number (Right aligned)
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(ROCKWOOL_DARK[0], ROCKWOOL_DARK[1], ROCKWOOL_DARK[2]);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - 14, footerLineY + 3.8, { align: 'right' });
  }

  // Save PDF named with project and customer
  const cleanProject = (meta.projectName || 'Quotation').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 45);
  const cleanCustomer = (meta.clientName || meta.clientCompany || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  doc.save(`Rockwool_Quote_${cleanProject}_${cleanCustomer}_${meta.quoteNumber}.pdf`);
}
