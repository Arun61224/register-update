import * as XLSX from 'xlsx';
import { InventoryRow } from '../types/inventory';
import { getAgeUnit, parseYearAndQuantity } from './ageClassifier';

/**
 * Creates a formatted worksheet from rows.
 * Column structure:
 * A: S.No
 * B: Prefix
 * C: Item Code
 * D: Part Code -- Year (e.g. TSUT-126--11-12)
 * E: Unit ('months' if 0-3, 3-6, 6-9, 9-12, 6-12, 12-18, 18-24; 'years' if 1-2, 2-3, 3-4, etc.)
 * F: Qty
 * G: Bin No
 * Text format (@) is enforced so Excel never auto-converts to dates.
 */
function createFormattedSheet(rows: InventoryRow[], label: string) {
  const headers = [
    'S.No',
    'Prefix',
    'Item Code',
    'Part Code -- Year',
    'Unit',
    'Qty',
    'Bin No',
  ];

  const dataRows = rows.map((row, index) => {
    const partCodeWithYear = formatProductCodeWithUnit(row);
    const unit = row.ageType || getAgeUnit(row.year);

    return [
      index + 1,
      row.prefix,
      row.itemCode,
      partCodeWithYear, // e.g. PSUT-202--5-6years
      unit,             // Column: months or years
      Number(row.quantity) || 1,
      row.binNumber,
    ];
  });

  const totalQty = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const summaryRow = ['TOTAL', '', '', `${rows.length} Items`, '', totalQty, label];

  const worksheetData = [headers, ...dataRows, summaryRow];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  worksheet['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 10 }, // Prefix
    { wch: 12 }, // Item Code
    { wch: 24 }, // Part Code -- Year
    { wch: 12 }, // Unit (months / year)
    { wch: 8 },  // Qty
    { wch: 12 }, // Bin No
  ];

  // Force string format on text columns
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:G1');
  for (let R = 1; R <= range.e.r; ++R) {
    // Column 3 is Part Code -- Year (0-indexed: 3)
    const codeYearCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 3 })];
    if (codeYearCell && codeYearCell.v !== undefined && R <= rows.length) {
      codeYearCell.t = 's';
      codeYearCell.z = '@';
    }

    // Column 4 is Unit (0-indexed: 4)
    const unitCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 4 })];
    if (unitCell && unitCell.v !== undefined && R <= rows.length) {
      unitCell.t = 's';
      unitCell.z = '@';
    }

    // Column 1 is Prefix (0-indexed: 1)
    const prefixCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 1 })];
    if (prefixCell && prefixCell.v !== undefined && R <= rows.length) {
      prefixCell.t = 's';
      prefixCell.z = '@';
    }

    // Column 2 is Item Code (0-indexed: 2)
    const itemCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 2 })];
    if (itemCell && itemCell.v !== undefined && R <= rows.length) {
      itemCell.t = 's';
      itemCell.z = '@';
    }

    // Column 6 is Bin No (0-indexed: 6)
    const binCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 6 })];
    if (binCell && binCell.v !== undefined && R <= rows.length) {
      binCell.t = 's';
      binCell.z = '@';
    }
  }

  return worksheet;
}

/**
 * Exports inventory rows to a well-formatted .xlsx file with D and E joined by '--',
 * and the Unit ('months' / 'year') column placed right before Qty.
 */
export function exportToExcel(
  rows: InventoryRow[],
  defaultPrefix: string = 'TSUT',
  defaultBin: string = '2162',
  filename?: string
) {
  if (!rows || rows.length === 0) {
    return;
  }

  const workbook = XLSX.utils.book_new();

  // 1. All Sections combined sheet
  const allSheet = createFormattedSheet(rows, 'All Bins');
  XLSX.utils.book_append_sheet(workbook, allSheet, 'All_Sections');

  // 2. Separate sheet per bin if multiple bins exist
  const binsMap = new Map<string, InventoryRow[]>();
  rows.forEach((r) => {
    const bin = r.binNumber || defaultBin;
    if (!binsMap.has(bin)) {
      binsMap.set(bin, []);
    }
    binsMap.get(bin)!.push(r);
  });

  if (binsMap.size > 1) {
    binsMap.forEach((binRows, bin) => {
      const sheetName = `Bin_${bin}`.slice(0, 31);
      const binSheet = createFormattedSheet(binRows, `Bin ${bin}`);
      XLSX.utils.book_append_sheet(workbook, binSheet, sheetName);
    });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = filename || `Stock_Slip_${dateStr}.xlsx`;
  XLSX.writeFile(workbook, defaultFilename);
}

/**
 * Copies rows to clipboard in the exact warehouse adjustment format.
 */
export async function copyForExcelClipboard(rows: InventoryRow[]): Promise<boolean> {
  try {
    const headers = [
      'Product Code*',
      'Quantity*',
      'Shelf Code*',
      'Adjustment Type*',
      'Inventory Type',
      'Transfer to Shelf Code',
      'Sla',
      'Source Batch Code',
      'Remarks',
      'Force Allocate',
    ].join('\t');

    const lines = rows.map((r) => {
      const productCode = formatProductCodeWithUnit(r);
      const quantity = Number(r.quantity) || 1;
      const shelfCode = formatShelfCode(r.binNumber);
      return [
        productCode,
        quantity,
        shelfCode,
        'Add',
        '',
        '',
        '',
        '',
        '',
        '',
      ].join('\t');
    });

    const tsvContent = [headers, ...lines].join('\n');
    await navigator.clipboard.writeText(tsvContent);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard', err);
    return false;
  }
}


/**
 * Generates and downloads a CSV file with exact warehouse inventory adjustment format:
 * Columns:
 * Product Code* | Quantity* | Shelf Code* | Adjustment Type* | Inventory Type | Transfer to Shelf Code | Sla | Source Batch Code | Remarks | Force Allocate
 *
 * Rules:
 * - Product Code*: e.g. PSUT-202--5-6years (or PSUT-202--6-12months)
 * - Quantity*: row.quantity
 * - Shelf Code*: 2770 -> U-2770 (adds 'U-' prefix if not already present)
 * - Adjustment Type*: "Add"
 * - Inventory Type: ""
 * - Transfer to Shelf Code: ""
 * - Sla: ""
 * - Source Batch Code: ""
 * - Remarks: ""
 * - Force Allocate: ""
 */
export function formatProductCodeWithUnit(row: InventoryRow): string {
  // If matched directly with Master SKU from Google Sheet, use that official Master SKU!
  if (row.matchedSku && row.matchedSku.trim()) {
    return row.matchedSku.trim();
  }

  const prefix = row.prefix || 'TSUT';
  const itemCode = row.itemCode || '';
  const parsed = parseYearAndQuantity(String(row.year || ''), row.quantity || 1);
  const rawYear = parsed.year;
  const unit = (row.ageType || getAgeUnit(rawYear)).toLowerCase();
  const unitSuffix = unit === 'months' ? 'months' : 'years';

  // Merge year and age directly e.g. "5-6years" or "0-3months"
  let cleanYear = rawYear.replace(/[\s\-_]*(years?|months?)$/i, '').trim();
  const mergedYearAge = cleanYear ? `${cleanYear}${unitSuffix}` : unitSuffix;

  return `${prefix}-${itemCode}--${mergedYearAge}`;
}

export function formatShelfCode(binNumber: string | undefined): string {
  if (!binNumber) return 'U-';
  const clean = String(binNumber).trim();
  if (clean.toUpperCase().startsWith('U-')) {
    return clean;
  }
  return `U-${clean}`;
}

export function downloadCSV(rows: InventoryRow[], filename: string = 'inventory_adjustment.csv') {
  // Required exact headers
  const headers = [
    'Product Code*',
    'Quantity*',
    'Shelf Code*',
    'Adjustment Type*',
    'Inventory Type',
    'Transfer to Shelf Code',
    'Sla',
    'Source Batch Code',
    'Remarks',
    'Force Allocate',
  ];

  const lines = rows.map((r) => {
    const parsed = parseYearAndQuantity(String(r.year || ''), Number(r.quantity) || 1);
    const productCode = formatProductCodeWithUnit(r);
    const quantity = Number(r.quantity) > 1 ? Number(r.quantity) : parsed.quantity;
    const shelfCode = formatShelfCode(r.binNumber);
    const adjustmentType = 'Add';
    const inventoryType = '';
    const transferToShelfCode = '';
    const sla = '';
    const sourceBatchCode = '';
    const remarks = '';
    const forceAllocate = '';

    // CSV escape helper
    const esc = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;

    return [
      esc(productCode),
      quantity,
      esc(shelfCode),
      esc(adjustmentType),
      esc(inventoryType),
      esc(transferToShelfCode),
      esc(sla),
      esc(sourceBatchCode),
      esc(remarks),
      esc(forceAllocate),
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...lines].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

