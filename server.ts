import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/**
 * Automatically separates year/age range and quantity if trailing quantity was included in year
 * e.g. "2-3-2" -> year: "2-3", quantity: 2
 * "12-18-1" -> year: "12-18", quantity: 1
 * "4-5-2years" -> year: "4-5", quantity: 2
 */
function parseYearAndQuantity(rawYear: string, existingQty: number = 1): { year: string; quantity: number } {
  if (!rawYear) return { year: '', quantity: existingQty || 1 };

  const clean = rawYear.replace(/[\s\-_]*(years?|months?)$/i, '').trim();

  // If clean is "2-3-2", "4-5-1", "12-18-2", "697-2-3-2", etc.
  const parts = clean.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    // If the last part is a single or small number (likely quantity: 1, 2, 3, etc.)
    if (/^\d+$/.test(lastPart)) {
      const qty = parseInt(lastPart, 10);
      const ageParts = parts.slice(0, parts.length - 1);
      // If more than 2 parts remain, take the last 2 for age range
      let yearParts = ageParts;
      if (ageParts.length > 2) {
        yearParts = ageParts.slice(-2);
      }
      return {
        year: yearParts.join('-'),
        quantity: !isNaN(qty) && qty > 0 ? qty : existingQty || 1,
      };
    }
  }

  return {
    year: clean,
    quantity: existingQty || 1,
  };
}

/**
 * Determines whether size is 'months' or 'years'
 * Months: 0-3, 3-6, 6-9, 9-12, 6-12, 12-18, 18-24
 * Years: 1-2, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8, 8-9, 9-10, 11-12, 13-14, 15-16
 */
function getAgeUnit(range: string): 'months' | 'years' {
  if (!range) return 'years';
  const { year } = parseYearAndQuantity(range, 1);
  const clean = year.trim().toLowerCase().replace(/\s+/g, '');
  const months = new Set([
    '0-3', '3-6', '6-9', '9-12', '6-12', '12-18', '18-24',
    '0/3', '3/6', '6/9', '9/12', '6/12', '12/18', '18/24'
  ]);
  if (months.has(clean) || /^(0-3|3-6|6-9|9-12|6-12|12-18|18-24)(m|months?)?$/i.test(clean)) {
    return 'months';
  }
  return 'years';
}

/**
 * Normalizes prefixes including:
 * - TS / T-S / Tshrt / 1shrt / lshrt / Ishrt -> Tshrt
 * - TSUT
 * - PSUT
 * - NSUT
 * - YKTs / YKT/s (meaning YK Tshrt / YK T-shirt)
 */
function normalizePrefix(raw: string): string {
  if (!raw) return 'TSUT';
  const clean = raw.trim();
  // Match TS, T-S, T/S, Tshrt, T-shrt, T-shirt, 1shrt, lshrt, Ishrt, |shrt (alone as prefix)
  if (/^(ts|t[\s\/\-_]s|[t1li|][\s\-_]?sh[ir]*t|tshirt)$/i.test(clean)) {
    return 'Tshrt';
  }
  // Match YKTs, YKT/s, YKT/S, YKTS, YK Tshrt, YK T-shirt, YK 1shrt
  if (/^ykt[\s\/\-_]?s?$/i.test(clean) || /yk\s*[t1li|][\s\-_]?sh[ir]*t/i.test(clean)) {
    return 'YKTs';
  }
  // Match YK NSUT, YK-NSUT, YKNSUT
  if (/^yk[\s\-_]?nsut$/i.test(clean)) {
    return 'YK NSUT';
  }
  // Match YK PSUT, YK-PSUT, YKPSUT
  if (/^yk[\s\-_]?psut$/i.test(clean)) {
    return 'YK PSUT';
  }
  // Match YK TSUT, YK-TSUT, YKTSUT
  if (/^yk[\s\-_]?tsut$/i.test(clean)) {
    return 'YK TSUT';
  }
  if (/^nsut$/i.test(clean)) return 'NSUT';
  if (/^tsut$/i.test(clean)) return 'TSUT';
  if (/^psut$/i.test(clean)) return 'PSUT';
  return clean;
}

// Full 4-section dataset corresponding to handwritten.jpeg (58 rows across 4 sections)
const SAMPLE_4_SECTION_DATA = {
  detectedPrefix: 'TSUT / PSUT',
  detectedBinNumber: '2162 / 2352 / 2342 / 2300',
  sections: [
    {
      sectionIndex: 1,
      title: 'Section 1 (Top-Left)',
      prefix: 'TSUT',
      binNumber: '2162',
      rowCount: 15,
      totalQty: 16,
    },
    {
      sectionIndex: 2,
      title: 'Section 2 (Top-Right)',
      prefix: 'PSUT',
      binNumber: '2352',
      rowCount: 15,
      totalQty: 15,
    },
    {
      sectionIndex: 3,
      title: 'Section 3 (Bottom-Left)',
      prefix: 'PSUT',
      binNumber: '2342',
      rowCount: 14,
      totalQty: 14,
    },
    {
      sectionIndex: 4,
      title: 'Section 4 (Bottom-Right)',
      prefix: 'PSUT',
      binNumber: '2300',
      rowCount: 14,
      totalQty: 14,
    },
  ],
  rows: [
    // --- SECTION 1: TOP-LEFT (TSUT [2162]) ---
    { id: 'sec1-1', rowNumber: 1, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: 'TSUT- 126 - 11 - 12 - 1', prefix: 'TSUT', itemCode: '126', fullCode: 'TSUT-126', year: '11-12', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-2', rowNumber: 2, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '- 4 - 5 - 1', prefix: 'TSUT', itemCode: '126', fullCode: 'TSUT-126', year: '4-5', quantity: 1, binNumber: '2162', isCarryForward: true, carryForwardFrom: '126' },
    { id: 'sec1-3', rowNumber: 3, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '117 - 4 - 5 - 1', prefix: 'TSUT', itemCode: '117', fullCode: 'TSUT-117', year: '4-5', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-4', rowNumber: 4, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '120 - 3 - 4 - 1', prefix: 'TSUT', itemCode: '120', fullCode: 'TSUT-120', year: '3-4', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-5', rowNumber: 5, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '127 - 7 - 8 - 1', prefix: 'TSUT', itemCode: '127', fullCode: 'TSUT-127', year: '7-8', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-6', rowNumber: 6, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '- 11 - 12 - 2', prefix: 'TSUT', itemCode: '127', fullCode: 'TSUT-127', year: '11-12', quantity: 2, binNumber: '2162', isCarryForward: true, carryForwardFrom: '127' },
    { id: 'sec1-7', rowNumber: 7, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '125 - 2 - 3 - 1', prefix: 'TSUT', itemCode: '125', fullCode: 'TSUT-125', year: '2-3', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-8', rowNumber: 8, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '121 - 13 - 14 - 1', prefix: 'TSUT', itemCode: '121', fullCode: 'TSUT-121', year: '13-14', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-9', rowNumber: 9, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '129 - 4 - 5 - 1', prefix: 'TSUT', itemCode: '129', fullCode: 'TSUT-129', year: '4-5', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-10', rowNumber: 10, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '103 - 3 - 4 - 1', prefix: 'TSUT', itemCode: '103', fullCode: 'TSUT-103', year: '3-4', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-11', rowNumber: 11, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '129 - 3 - 4 - 1', prefix: 'TSUT', itemCode: '129', fullCode: 'TSUT-129', year: '3-4', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-12', rowNumber: 12, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '108 - 4 - 5 - 1', prefix: 'TSUT', itemCode: '108', fullCode: 'TSUT-108', year: '4-5', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-13', rowNumber: 13, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '115 - 9 - 10 - 1', prefix: 'TSUT', itemCode: '115', fullCode: 'TSUT-115', year: '9-10', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-14', rowNumber: 14, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '108 - 1 - 2 - 1', prefix: 'TSUT', itemCode: '108', fullCode: 'TSUT-108', year: '1-2', quantity: 1, binNumber: '2162', isCarryForward: false },
    { id: 'sec1-15', rowNumber: 15, sectionIndex: 1, sectionName: 'Sec 1 (Top-Left)', rawText: '- 4 - 5 - 1', prefix: 'TSUT', itemCode: '108', fullCode: 'TSUT-108', year: '4-5', quantity: 1, binNumber: '2162', isCarryForward: true, carryForwardFrom: '108' },

    // --- SECTION 2: TOP-RIGHT (PSUT [2352]) ---
    { id: 'sec2-16', rowNumber: 16, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: 'PSUT- 223 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '223', fullCode: 'PSUT-223', year: '6-7', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-17', rowNumber: 17, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '195 - 2 - 3 - 1', prefix: 'PSUT', itemCode: '195', fullCode: 'PSUT-195', year: '2-3', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-18', rowNumber: 18, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '166 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '166', fullCode: 'PSUT-166', year: '6-12', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-19', rowNumber: 19, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '170 - 2 - 3 - 1', prefix: 'PSUT', itemCode: '170', fullCode: 'PSUT-170', year: '2-3', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-20', rowNumber: 20, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '102 - 4 - 5 - 1', prefix: 'PSUT', itemCode: '102', fullCode: 'PSUT-102', year: '4-5', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-21', rowNumber: 21, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '169 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '6-12', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-22', rowNumber: 22, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '103 - 18 - 24 - 1', prefix: 'PSUT', itemCode: '103', fullCode: 'PSUT-103', year: '18-24', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-23', rowNumber: 23, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '206 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '206', fullCode: 'PSUT-206', year: '6-7', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-24', rowNumber: 24, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '139 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '139', fullCode: 'PSUT-139', year: '6-12', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-25', rowNumber: 25, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '235 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '235', fullCode: 'PSUT-235', year: '6-12', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-26', rowNumber: 26, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '170 - 3 - 4 - 1', prefix: 'PSUT', itemCode: '170', fullCode: 'PSUT-170', year: '3-4', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-27', rowNumber: 27, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '- 6 - 7 - 1', prefix: 'PSUT', itemCode: '170', fullCode: 'PSUT-170', year: '6-7', quantity: 1, binNumber: '2352', isCarryForward: true, carryForwardFrom: '170' },
    { id: 'sec2-28', rowNumber: 28, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '163 - 12 - 18 - 1', prefix: 'PSUT', itemCode: '163', fullCode: 'PSUT-163', year: '12-18', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-29', rowNumber: 29, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '223 - 4 - 5 - 1', prefix: 'PSUT', itemCode: '223', fullCode: 'PSUT-223', year: '4-5', quantity: 1, binNumber: '2352', isCarryForward: false },
    { id: 'sec2-30', rowNumber: 30, sectionIndex: 2, sectionName: 'Sec 2 (Top-Right)', rawText: '141 - 9 - 10 - 1', prefix: 'PSUT', itemCode: '141', fullCode: 'PSUT-141', year: '9-10', quantity: 1, binNumber: '2352', isCarryForward: false },

    // --- SECTION 3: BOTTOM-LEFT (PSUT [2342]) ---
    { id: 'sec3-31', rowNumber: 31, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: 'PSUT- 170 - 3 - 4 - 1', prefix: 'PSUT', itemCode: '170', fullCode: 'PSUT-170', year: '3-4', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-32', rowNumber: 32, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '151 - 2 - 3 - 1', prefix: 'PSUT', itemCode: '151', fullCode: 'PSUT-151', year: '2-3', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-33', rowNumber: 33, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '113 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '113', fullCode: 'PSUT-113', year: '6-12', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-34', rowNumber: 34, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '239 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '239', fullCode: 'PSUT-239', year: '6-7', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-35', rowNumber: 35, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '171 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '171', fullCode: 'PSUT-171', year: '6-7', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-36', rowNumber: 36, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '104 - 2 - 3 - 1', prefix: 'PSUT', itemCode: '104', fullCode: 'PSUT-104', year: '2-3', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-37', rowNumber: 37, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '147 - 12 - 18 - 1', prefix: 'PSUT', itemCode: '147', fullCode: 'PSUT-147', year: '12-18', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-38', rowNumber: 38, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '133 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '133', fullCode: 'PSUT-133', year: '6-7', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-39', rowNumber: 39, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '169 - 3 - 4 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '3-4', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-40', rowNumber: 40, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '222 - 6 - 12 - 1', prefix: 'PSUT', itemCode: '222', fullCode: 'PSUT-222', year: '6-12', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-41', rowNumber: 41, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '232 - 12 - 18 - 1', prefix: 'PSUT', itemCode: '232', fullCode: 'PSUT-232', year: '12-18', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-42', rowNumber: 42, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '235 - 4 - 5 - 1', prefix: 'PSUT', itemCode: '235', fullCode: 'PSUT-235', year: '4-5', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-43', rowNumber: 43, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '223 - 5 - 6 - 1', prefix: 'PSUT', itemCode: '223', fullCode: 'PSUT-223', year: '5-6', quantity: 1, binNumber: '2342', isCarryForward: false },
    { id: 'sec3-44', rowNumber: 44, sectionIndex: 3, sectionName: 'Sec 3 (Bottom-Left)', rawText: '105 - 12 - 18 - 1', prefix: 'PSUT', itemCode: '105', fullCode: 'PSUT-105', year: '12-18', quantity: 1, binNumber: '2342', isCarryForward: false },

    // --- SECTION 4: BOTTOM-RIGHT (PSUT [2300]) ---
    { id: 'sec4-45', rowNumber: 45, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: 'PSUT- 169 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '6-7', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-46', rowNumber: 46, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '- 5 - 6 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '5-6', quantity: 1, binNumber: '2300', isCarryForward: true, carryForwardFrom: '169' },
    { id: 'sec4-47', rowNumber: 47, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '- 2 - 3 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '2-3', quantity: 1, binNumber: '2300', isCarryForward: true, carryForwardFrom: '169' },
    { id: 'sec4-48', rowNumber: 48, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '188 - 5 - 6 - 1', prefix: 'PSUT', itemCode: '188', fullCode: 'PSUT-188', year: '5-6', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-49', rowNumber: 49, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '- 4 - 5 - 1', prefix: 'PSUT', itemCode: '188', fullCode: 'PSUT-188', year: '4-5', quantity: 1, binNumber: '2300', isCarryForward: true, carryForwardFrom: '188' },
    { id: 'sec4-50', rowNumber: 50, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '216 - 12 - 18 - 1', prefix: 'PSUT', itemCode: '216', fullCode: 'PSUT-216', year: '12-18', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-51', rowNumber: 51, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '170 - 18 - 24 - 1', prefix: 'PSUT', itemCode: '170', fullCode: 'PSUT-170', year: '18-24', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-52', rowNumber: 52, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '169 - 3 - 4 - 1', prefix: 'PSUT', itemCode: '169', fullCode: 'PSUT-169', year: '3-4', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-53', rowNumber: 53, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '196 - 5 - 6 - 1', prefix: 'PSUT', itemCode: '196', fullCode: 'PSUT-196', year: '5-6', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-54', rowNumber: 54, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '227 - 5 - 6 - 1', prefix: 'PSUT', itemCode: '227', fullCode: 'PSUT-227', year: '5-6', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-55', rowNumber: 55, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '171 - 4 - 5 - 1', prefix: 'PSUT', itemCode: '171', fullCode: 'PSUT-171', year: '4-5', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-56', rowNumber: 56, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '- 2 - 3 - 1', prefix: 'PSUT', itemCode: '171', fullCode: 'PSUT-171', year: '2-3', quantity: 1, binNumber: '2300', isCarryForward: true, carryForwardFrom: '171' },
    { id: 'sec4-57', rowNumber: 57, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '274 - 6 - 7 - 1', prefix: 'PSUT', itemCode: '274', fullCode: 'PSUT-274', year: '6-7', quantity: 1, binNumber: '2300', isCarryForward: false },
    { id: 'sec4-58', rowNumber: 58, sectionIndex: 4, sectionName: 'Sec 4 (Bottom-Right)', rawText: '162 - 4 - 5 - 1', prefix: 'PSUT', itemCode: '162', fullCode: 'PSUT-162', year: '4-5', quantity: 1, binNumber: '2300', isCarryForward: false },
  ],
  duplicateWarnings: [
    {
      id: 'dup-TSUT-108__4-5',
      itemCode: '108',
      fullCode: 'TSUT-108',
      year: '4-5',
      rowIndices: [12, 15],
      message: 'TSUT-108 (Year 4-5) appears in rows [12, 15]',
      resolved: false,
    },
    {
      id: 'dup-PSUT-170__3-4',
      itemCode: '170',
      fullCode: 'PSUT-170',
      year: '3-4',
      rowIndices: [26, 31],
      message: 'PSUT-170 (Year 3-4) appears in rows [26, 31]',
      resolved: false,
    },
    {
      id: 'dup-PSUT-169__3-4',
      itemCode: '169',
      fullCode: 'PSUT-169',
      year: '3-4',
      rowIndices: [39, 52],
      message: 'PSUT-169 (Year 3-4) appears in rows [39, 52]',
      resolved: false,
    },
    {
      id: 'dup-PSUT-171__2-3',
      itemCode: '171',
      fullCode: 'PSUT-171',
      year: '2-3',
      rowIndices: [36, 56],
      message: 'PSUT-171 / PSUT-104 (Year 2-3) repeats',
      resolved: false,
    },
  ],
};

// ---------------- MASTER SKU CATALOG SYNC (Google Sheets) ----------------
const MASTER_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/19THmGjzWHJ-G-u0FEoiOBray5ita7OPPXtJaWIu7Hm8/export?format=csv';

interface MasterSkuCatalog {
  skus: string[];
  lastFetched: number;
  totalCount: number;
}

let masterCatalogCache: MasterSkuCatalog | null = null;
let isFetchingCatalog = false;

async function fetchMasterSkusFromSheet(forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  // Cache for 10 minutes unless forced
  if (!forceRefresh && masterCatalogCache && now - masterCatalogCache.lastFetched < 10 * 60 * 1000) {
    return masterCatalogCache.skus;
  }

  if (isFetchingCatalog && masterCatalogCache) {
    return masterCatalogCache.skus;
  }

  isFetchingCatalog = true;
  try {
    console.log('[MasterSKU] Fetching latest SKUs from Google Sheet...');
    const response = await fetch(MASTER_SHEET_URL, {
      headers: {
        'User-Agent': 'Slip2Excel/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Google Sheet: HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const lines = csvText.split(/\r?\n/);
    const skuList: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Skip header row if it is "Sku Code" or contains headers
      if (i === 0 && line.toLowerCase().includes('sku')) continue;
      const cleanSku = line.replace(/^["']|["']$/g, '').trim();
      if (cleanSku) {
        skuList.push(cleanSku);
      }
    }

    masterCatalogCache = {
      skus: skuList,
      lastFetched: Date.now(),
      totalCount: skuList.length,
    };
    console.log(`[MasterSKU] Successfully cached ${skuList.length} SKUs from Google Sheet.`);
    return skuList;
  } catch (err: any) {
    console.error('[MasterSKU] Error fetching master SKUs:', err?.message || err);
    return masterCatalogCache ? masterCatalogCache.skus : [];
  } finally {
    isFetchingCatalog = false;
  }
}

// Prefetch catalog on server startup
fetchMasterSkusFromSheet(false).catch((e) => console.warn('Prefetch error:', e));

/**
 * List of ordered fallback age alternatives when a specific age is missing in the master catalog.
 * STRICT LIMIT: Only for baby/toddler sizes up to 1-2 years (0-24 months).
 * 2-3 years and above will NOT be auto-shifted; they must match exactly.
 *
 * Priority Rule for 0-24 months / 1-2 years:
 * Check smaller adjacent size first (18-24m -> 12-18m -> 9-12m).
 * If smaller is not found in master sheet, check next larger size (2-3years).
 */
const AGE_NEAR_FALLBACKS: Record<string, string[]> = {
  // Baby & Toddler (0 to 24 months / 1-2 years only)
  '0-3': ['3-6', '6-12'],
  '3-6': ['0-3', '6-12', '6-9', '9-12'],
  '6-9': ['3-6', '0-3', '6-12', '9-12'],
  '6-12': ['3-6', '0-3', '9-12', '12-18'],
  '9-12': ['6-12', '3-6', '12-18', '18-24', '1-2'],
  '12-18': ['9-12', '6-12', '18-24', '1-2', '2-3'],
  '18-24': ['12-18', '1-2', '9-12', '6-12', '2-3'],
  '1-2': ['18-24', '12-18', '9-12', '6-12', '2-3'],
  '1-2years': ['18-24months', '12-18months', '9-12months', '6-12months', '2-3years'],
};

/**
 * Match a raw prefix, itemCode, and year against master SKUs
 * If exact year is not available (e.g. 1-2years for 638), falls back to nearby age
 * priority: 18-24months -> 12-18months -> 2-3years
 */
function findBestSkuMatches(
  prefix: string,
  itemCode: string,
  year: string,
  ageType: 'months' | 'years',
  catalog: string[],
  rawText?: string
): {
  matchedSku: string | null;
  candidates: string[];
  status: 'matched' | 'multiple' | 'unmatched';
  isNearbyMatch?: boolean;
} {
  if (!catalog || catalog.length === 0 || !itemCode) {
    return { matchedSku: null, candidates: [], status: 'unmatched' };
  }

  const cleanItem = String(itemCode).trim().toLowerCase();
  const cleanYear = String(year || '')
    .replace(/[\s\-_]*(years?|months?)$/i, '')
    .trim()
    .toLowerCase();

  // Determine if this row has "YK" pattern in prefix, itemCode, or rawText
  const prefixLower = prefix.toLowerCase();
  const rawTextLower = String(rawText || '').toLowerCase();
  const hasYkPattern =
    prefixLower.includes('yk') ||
    cleanItem.startsWith('yk') ||
    /\byk\b/i.test(rawTextLower) ||
    /yk[\s\/\-_]?/i.test(rawTextLower);

  // Normalize prefix variations for matching
  // (e.g. "YK NSUT" -> base garment "nsut", "YKTs" -> base garment "tshrt")
  let garmentBase = prefixLower.replace(/^yk[\s\/\-_]?/i, '').trim();
  const possiblePrefixes: string[] = [];

  if (
    garmentBase === 'ts' ||
    garmentBase === 'tshrt' ||
    garmentBase === 't' ||
    garmentBase === '1shrt' ||
    garmentBase === 'lshrt' ||
    garmentBase === 'ishrt' ||
    garmentBase === 'tshirt' ||
    prefixLower === 'ykts'
  ) {
    possiblePrefixes.push('tshrt', 'ts', 'tshirt');
  } else if (garmentBase === 'tsut') {
    possiblePrefixes.push('tsut');
  } else if (garmentBase === 'psut') {
    possiblePrefixes.push('psut');
  } else if (garmentBase === 'nsut') {
    possiblePrefixes.push('nsut');
  } else if (garmentBase === 'bsut') {
    possiblePrefixes.push('bsut');
  } else if (garmentBase === 'paj') {
    possiblePrefixes.push('paj');
  } else if (garmentBase === 'sht') {
    possiblePrefixes.push('sht');
  } else if (garmentBase) {
    possiblePrefixes.push(garmentBase);
  }

  const isMonths = ageType === 'months';

  /**
   * Helper to search catalog with specific item code variation:
   * e.g. for item 152:
   * targetItemVariation = "yk152" (Priority 1 for YK slips)
   * or "152" (Priority 2 / regular)
   */
  const searchInCatalogWithItem = (
    targetItem: string,
    targetYear: string,
    targetIsMonths: boolean,
    isYkItemSearch: boolean
  ) => {
    const found: string[] = [];
    for (const sku of catalog) {
      const lowerSku = sku.toLowerCase();

      // Check item code
      let itemMatch = false;
      if (isYkItemSearch) {
        // Must match YK + itemCode e.g. "--yk152--" or "-yk152-" or "-yk152"
        itemMatch =
          lowerSku.includes(`--${targetItem}--`) ||
          lowerSku.includes(`-${targetItem}--`) ||
          lowerSku.includes(`-${targetItem}-`) ||
          lowerSku.endsWith(`-${targetItem}`);
      } else {
        // Regular item code match e.g. "-152--" or "-152-"
        itemMatch =
          lowerSku.includes(`-${targetItem}--`) ||
          lowerSku.includes(`-${targetItem}-`) ||
          lowerSku.endsWith(`-${targetItem}`);
      }

      if (!itemMatch) continue;

      // Check year part
      if (targetYear) {
        const yearWithUnit = `${targetYear}${targetIsMonths ? 'months' : 'years'}`;
        const yearWithHyphen = `${targetYear}-${targetIsMonths ? 'months' : 'years'}`;
        if (
          !lowerSku.includes(`--${targetYear}`) &&
          !lowerSku.includes(`-${targetYear}`) &&
          !lowerSku.includes(yearWithUnit) &&
          !lowerSku.includes(yearWithHyphen)
        ) {
          continue;
        }
      }

      // Check garment prefix
      const prefixMatch = possiblePrefixes.some((p) => {
        return (
          lowerSku.includes(`-${p}-`) ||
          lowerSku.includes(`-${p}--`) ||
          lowerSku.includes(`-${p}`) ||
          lowerSku.startsWith(`${p}-`)
        );
      });

      if (prefixMatch || possiblePrefixes.length === 0) {
        found.push(sku);
      }
    }

    // Fallback: match item code + year without strict garment prefix if not found
    if (found.length === 0 && targetYear) {
      for (const sku of catalog) {
        const lowerSku = sku.toLowerCase();
        let itemMatch = false;
        if (isYkItemSearch) {
          itemMatch = lowerSku.includes(`--${targetItem}--`) || lowerSku.includes(`-${targetItem}-`);
        } else {
          itemMatch = lowerSku.includes(`-${targetItem}--`) || lowerSku.includes(`-${targetItem}-`);
        }

        if (itemMatch && (lowerSku.includes(targetYear) || lowerSku.includes(`--${targetYear}`))) {
          found.push(sku);
        }
      }
    }

    return found;
  };

  /**
   * Search step that applies YK priority rules:
   * If slip has YK pattern:
   *   Step 1: Search using YK<itemCode> (e.g. "yk152") -> matches KYK-NSUT--YK152--9-10years
   *   Step 2: If not found, search using <itemCode> (e.g. "152") -> matches KUC-NSUT-152--9-10years
   * If slip does NOT have YK pattern:
   *   Standard search with cleanItem.
   */
  const executeSearch = (targetYear: string, targetIsMonths: boolean) => {
    if (hasYkPattern) {
      const ykCodeItem = cleanItem.startsWith('yk') ? cleanItem : `yk${cleanItem}`;
      // Priority 1: Search for YK + itemCode
      const ykMatches = searchInCatalogWithItem(ykCodeItem, targetYear, targetIsMonths, true);
      if (ykMatches.length > 0) {
        return ykMatches;
      }

      // Priority 2: Fallback to item code without YK (e.g. NSUT-152)
      const baseItemCode = cleanItem.replace(/^yk/i, '');
      const fallbackMatches = searchInCatalogWithItem(baseItemCode, targetYear, targetIsMonths, false);
      if (fallbackMatches.length > 0) {
        return fallbackMatches;
      }
      return [];
    }

    // Regular non-YK search
    return searchInCatalogWithItem(cleanItem, targetYear, targetIsMonths, false);
  };

  // 1. Try EXACT year match first
  let matches = executeSearch(cleanYear, isMonths);

  // If multiple candidates exist, prioritize and filter to match the garment type (e.g. Tshrt vs PSUT/NSUT/HOD)
  if (possiblePrefixes.length > 0 && matches.length > 0) {
    const garmentMatches = matches.filter((m) => {
      const lower = m.toLowerCase();
      return possiblePrefixes.some((p) =>
        lower.includes(`-${p}-`) || lower.includes(`-${p}--`) || lower.startsWith(`${p}-`)
      );
    });
    if (garmentMatches.length > 0) {
      matches = garmentMatches;
    }
  }

  if (matches.length > 0) {
    if (matches.length === 1) {
      return { matchedSku: matches[0], candidates: matches, status: 'matched' };
    }
    // Prefer KYK- for YK patterns, otherwise prefer KUC-
    const preferredMatch = hasYkPattern
      ? matches.find((m) => m.toUpperCase().startsWith('KYK-') || m.toUpperCase().startsWith('DYK-'))
      : matches.find((m) => m.toUpperCase().startsWith('KUC-'));

    return {
      matchedSku: preferredMatch || matches[0],
      candidates: matches,
      status: 'multiple',
    };
  }

  // 2. NEARBY AGE FALLBACK (Only for 0-24m / 1-2y)
  const nearbyList = AGE_NEAR_FALLBACKS[cleanYear] || [];
  for (const altAge of nearbyList) {
    const isAltMonths =
      altAge.includes('months') ||
      altAge === '18-24' ||
      altAge === '12-18' ||
      altAge === '6-12' ||
      altAge === '3-6' ||
      altAge === '0-3';
    const cleanAlt = altAge.replace(/[\s\-_]*(years?|months?)$/i, '').trim();
    let altMatches = executeSearch(cleanAlt, isAltMonths);
    if (possiblePrefixes.length > 0 && altMatches.length > 0) {
      const garmentMatches = altMatches.filter((m) => {
        const lower = m.toLowerCase();
        return possiblePrefixes.some((p) =>
          lower.includes(`-${p}-`) || lower.includes(`-${p}--`) || lower.startsWith(`${p}-`)
        );
      });
      if (garmentMatches.length > 0) {
        altMatches = garmentMatches;
      }
    }
    if (altMatches.length > 0) {
      const preferredMatch = hasYkPattern
        ? altMatches.find((m) => m.toUpperCase().startsWith('KYK-') || m.toUpperCase().startsWith('DYK-'))
        : altMatches.find((m) => m.toUpperCase().startsWith('KUC-'));

      return {
        matchedSku: preferredMatch || altMatches[0],
        candidates: altMatches,
        status: 'matched',
        isNearbyMatch: true,
      };
    }
  }

  return { matchedSku: null, candidates: [], status: 'unmatched' };
}

app.get('/api/master-skus/status', async (_req: Request, res: Response) => {
  const skus = await fetchMasterSkusFromSheet(false);
  res.json({
    success: true,
    totalCount: skus.length,
    lastFetched: masterCatalogCache ? new Date(masterCatalogCache.lastFetched).toISOString() : null,
  });
});

app.post('/api/master-skus/refresh', async (_req: Request, res: Response) => {
  const skus = await fetchMasterSkusFromSheet(true);
  res.json({
    success: true,
    totalCount: skus.length,
    lastFetched: masterCatalogCache ? new Date(masterCatalogCache.lastFetched).toISOString() : null,
    message: `Refreshed successfully! Loaded ${skus.length} SKUs from Google Sheet.`,
  });
});

app.get('/api/sample-slip', async (_req: Request, res: Response) => {
  const masterSkus = await fetchMasterSkusFromSheet(false);

  const enrichedRows = SAMPLE_4_SECTION_DATA.rows.map((r) => {
    const ageUnit = getAgeUnit(r.year);
    const skuResult = findBestSkuMatches(r.prefix, r.itemCode, r.year, ageUnit, masterSkus, r.rawText);
    return {
      ...r,
      ageType: ageUnit,
      matchedSku: skuResult.matchedSku || undefined,
      skuCandidates: skuResult.candidates,
      skuStatus: skuResult.status,
    };
  });

  res.json({
    success: true,
    data: {
      ...SAMPLE_4_SECTION_DATA,
      rows: enrichedRows,
    },
  });
});

app.post('/api/extract-slip', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', defaultPrefix = 'TSUT' } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: 'Image data is required (imageBase64)' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in your Vercel Project Settings > Environment Variables, or in your .env file.',
      });
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const promptText = `
You are an expert OCR & inventory data extraction engine specializing in handwritten inventory, warehouse stock, and bin slips.

IMPORTANT MULTI-SECTION SHEET LAYOUT:
A notebook page often has 4 SEPARATE QUADRANTS / SECTIONS:
- Section 1: Top-Left (e.g. starts with TSUT-126..., has its own bottom bin number like [2162])
- Section 2: Top-Right (e.g. starts with PSUT-223..., has its own bottom bin number like [2352])
- Section 3: Bottom-Left (e.g. starts with PSUT-170..., has its own bottom bin number like [2342])
- Section 4: Bottom-Right (e.g. starts with PSUT-169..., has its own bottom bin number like [2300])

CRITICAL RULES:
1. DETECT ALL SECTIONS ON THE PAGE:
   - Identify each section (typically 1 to 4 sections).
   - For each section, find:
     a) Its section prefix (written at the top of that section, e.g. TSUT, PSUT, or YKTs / YKT/s).
     b) Its rows, read line-by-line from top to bottom within that column.
     c) Its bin number enclosed in a bracket/box at the bottom of THAT SPECIFIC column (e.g. [2162], [2352], [2342], [2300]).

2. CRITICAL PREFIX DETECTION RULES:
   Prefixes written at the top of a column/section, or in the left margin or header indicate garment/part type:
   - "Tshrt" / "tshrt" / "1shrt" / "lshrt" / "Ishrt" / "TS" / "T-S" / "T-shirt":
     * Handwritten "Tshrt" often has a vertical stroke resembling "1shrt", "lshrt", or "Ishrt" in the left margin!
     * ALWAYS recognize and normalize this strictly to "Tshrt" (garment: T-shirt).
     * Output prefix as "Tshrt", and fullCode as "Tshrt-<itemCode>".
   - "TSUT" (T-Shirt Suit / T-Suit)
   - "PSUT" (Pant Suit)
   - "NSUT" (Night Suit)
   - "YKTs" or "YKT/s" (stands for "YK Tshrt" / YK T-shirt)
     * NOTE: When you see "YKTs", "YKT/s", "YKT/S", "YKTS", or "YK Tshrt", recognize it as the prefix "YKTs".
     * Do NOT confuse "YKT/s" with a date or fraction; it is the garment prefix for YK Tshrt!
     * Output prefix as "YKTs", and fullCode as "YKTs-<itemCode>" (e.g. YKTs-697).
   - "YK NSUT" or "YK-NSUT" or "YKNSUT" -> Output prefix as "YK NSUT".
   - "YK PSUT" or "YK-PSUT" or "YKPSUT" -> Output prefix as "YK PSUT".
   - "YK TSUT" or "YK-TSUT" or "YKTSUT" -> Output prefix as "YK TSUT".

3. QUANTITY VS AGE/YEAR DISCRIMINATION RULE:
   - In warehouse inventory slips, every line follows:
     [Item Code] - [Age Range] - [Quantity]
     (or "- [Age Range] - [Quantity]" if item code is inherited)
   - The LAST number on each line is ALWAYS the Quantity!
   - Examples:
     * "697 - 2 - 3 - 2" -> Item Code: "697", Year: "2-3", Quantity: 2 (CRITICAL: Do NOT output year as "2-3-2"! The last 2 is quantity!)
     * "- 2 - 3 - 2" -> Year: "2-3", Quantity: 2
     * "232 - 13 - 14 - 1" -> Item Code: "232", Year: "13-14", Quantity: 1
     * "541 - 6 - 12 - 1" -> Item Code: "541", Year: "6-12", Quantity: 1
   - Never put 3 numbers in the year field (e.g. "2-3-2" is invalid; split into year: "2-3", quantity: 2).

4. CARRY-FORWARD BLANK RULE (LOCAL TO EACH SECTION):
   - When an item code is omitted/blank at the start of a line (e.g. "- 4 - 5 - 1" or "- 11 - 12 - 2"):
   - INHERIT the item code from the line immediately above it within the SAME section!
   - Mark isCarryForward = true, and carryForwardFrom = the inherited code.

5. ROW FIELDS:
   - Prefix: Section prefix (e.g. Tshrt, TSUT, PSUT, or YKTs)
   - Item Code: e.g. 126, 223, 170, 169, 697
   - Full Code: PREFIX-ITEMCODE (e.g. Tshrt-232, TSUT-126, PSUT-223, YKTs-697)
   - Year: The dash-separated year range e.g. "11-12", "6-7", "6-12", "18-24", "4-5", "2-3"
   - Quantity: The last number in the line (e.g. 1, 2)
   - Bin Number: The bin number for THIS section (e.g. 2162 for Section 1, 2352 for Section 2, etc.)
   - Section Index: 1, 2, 3, or 4

6. DO NOT MERGE DUPLICATES:
   - Every single line written on paper must be an individual row in the output array. Keep all duplicate lines as separate rows!

Extract all rows from all sections systematically. Return strictly JSON matching the response schema.
`;

    // Primary fast & reliable models
    const candidateModels = [
      'gemini-2.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ];

    let response: any = null;
    let lastError: any = null;

    for (const modelName of candidateModels) {
      // Try each model with up to 2 attempts with exponential backoff on 503 / high demand
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Slip2Excel] Attempting OCR with model: ${modelName} (attempt ${attempt})`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    data: cleanBase64,
                    mimeType,
                  },
                },
                {
                  text: promptText,
                },
              ],
            },
            config: {
              thinkingConfig: {
                thinkingBudget: 0,
              },
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detectedPrefix: {
                    type: Type.STRING,
                    description: 'Primary or combined prefixes detected (e.g. TSUT / PSUT)',
                  },
                  detectedBinNumber: {
                    type: Type.STRING,
                    description: 'List of bin numbers detected (e.g. 2162 / 2352 / 2342 / 2300)',
                  },
                  sections: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        sectionIndex: { type: Type.INTEGER },
                        title: { type: Type.STRING },
                        prefix: { type: Type.STRING },
                        binNumber: { type: Type.STRING },
                        rowCount: { type: Type.INTEGER },
                        totalQty: { type: Type.INTEGER },
                      },
                      required: ['sectionIndex', 'prefix', 'binNumber'],
                    },
                  },
                  rows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        rowNumber: { type: Type.INTEGER },
                        sectionIndex: { type: Type.INTEGER },
                        sectionName: { type: Type.STRING },
                        rawText: { type: Type.STRING },
                        prefix: { type: Type.STRING },
                        itemCode: { type: Type.STRING },
                        fullCode: { type: Type.STRING },
                        year: { type: Type.STRING },
                        quantity: { type: Type.NUMBER },
                        binNumber: { type: Type.STRING },
                        isCarryForward: { type: Type.BOOLEAN },
                        carryForwardFrom: { type: Type.STRING },
                      },
                      required: ['itemCode', 'year', 'quantity', 'isCarryForward', 'binNumber'],
                    },
                  },
                  duplicateWarnings: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        itemCode: { type: Type.STRING },
                        fullCode: { type: Type.STRING },
                        year: { type: Type.STRING },
                        rowIndices: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                        },
                        message: { type: Type.STRING },
                      },
                      required: ['itemCode', 'year', 'rowIndices', 'message'],
                    },
                  },
                },
                required: ['rows'],
              },
            },
          });

          if (response && response.text) {
            console.log(`[Slip2Excel] Successfully extracted data with ${modelName}`);
            break;
          }
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          console.warn(`[Slip2Excel] Model ${modelName} attempt ${attempt} failed:`, errMsg);

          // If high demand or 503, wait briefly before retrying or switching
          if (attempt < 2 && (errMsg.includes('high demand') || errMsg.includes('503') || errMsg.includes('UNAVAILABLE'))) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      if (response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('All AI models are currently busy. Please try again in a few moments.');
    }

    const parsedJsonText = response.text?.trim() || '{}';
    const result = JSON.parse(parsedJsonText);

    // Fetch or use cached master SKUs from Google Sheet
    const masterSkus = await fetchMasterSkusFromSheet(false);

    // Number rows sequentially, normalize prefixes, match with Master SKUs and assign IDs
    if (result.rows && Array.isArray(result.rows)) {
      result.rows = result.rows.map((row: any, idx: number) => {
        const normalizedPrefix = normalizePrefix(row.prefix || defaultPrefix);
        let cleanItemCode = String(row.itemCode || '').trim();
        
        // Strip embedded prefix if present in itemCode (e.g. "TS-126", "Tshrt 126", "YKTs-126" or "YKT/s 126")
        const embeddedMatch = cleanItemCode.match(/^(TSUT|PSUT|TSHRT|T[\s\-_]?SH[IR]*T|TS|T\-S|YKT[\s\/\-_]?S?|YK\s*T[\s\-_]?SH[IR]*T)[\s\-_:]*(.+)$/i);
        if (embeddedMatch) {
          cleanItemCode = embeddedMatch[2].trim();
        }

        const fullCode = `${normalizedPrefix}-${cleanItemCode}`;
        const rawQty = typeof row.quantity === 'number' ? row.quantity : parseInt(row.quantity, 10) || 1;
        const parsedYearQty = parseYearAndQuantity(String(row.year || ''), rawQty);
        const yearStr = parsedYearQty.year;
        const finalQuantity = rawQty > 1 ? rawQty : parsedYearQty.quantity;
        const ageUnit = getAgeUnit(yearStr);

        // Find matches in Master Sheet
        const skuMatchResult = findBestSkuMatches(
          normalizedPrefix,
          cleanItemCode,
          yearStr,
          ageUnit,
          masterSkus,
          row.rawText
        );

        return {
          id: `row-${Date.now()}-${idx + 1}`,
          rowNumber: idx + 1,
          sectionIndex: row.sectionIndex || 1,
          sectionName: row.sectionName || `Section ${row.sectionIndex || 1}`,
          rawText: row.rawText || '',
          prefix: normalizedPrefix,
          itemCode: cleanItemCode,
          fullCode,
          year: yearStr,
          ageType: ageUnit,
          quantity: finalQuantity,
          binNumber: String(row.binNumber || ''),
          isCarryForward: Boolean(row.isCarryForward),
          carryForwardFrom: row.carryForwardFrom || '',
          matchedSku: skuMatchResult.matchedSku || undefined,
          skuCandidates: skuMatchResult.candidates,
          skuStatus: skuMatchResult.status,
          isNearbyMatch: Boolean(skuMatchResult.isNearbyMatch),
        };
      });
    }

    // Calculate duplicate entries across all rows
    const duplicateMap = new Map<string, number[]>();
    (result.rows || []).forEach((row: any) => {
      const key = `${row.fullCode || row.itemCode}__${row.year}`;
      if (!duplicateMap.has(key)) {
        duplicateMap.set(key, []);
      }
      duplicateMap.get(key)!.push(row.rowNumber);
    });

    const detectedDuplicates: any[] = [];
    duplicateMap.forEach((rowNumbers, key) => {
      if (rowNumbers.length > 1) {
        const [fullCode, year] = key.split('__');
        detectedDuplicates.push({
          id: `dup-${key}`,
          fullCode,
          itemCode: fullCode.replace(/^[^-]+-/, ''),
          year,
          rowIndices: rowNumbers,
          message: `${fullCode} (Year ${year}) appears ${rowNumbers.length} times in rows [${rowNumbers.join(', ')}]`,
          resolved: false,
        });
      }
    });

    result.duplicateWarnings = detectedDuplicates;

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error processing multi-section slip image with Gemini:', error);
    res.status(500).json({
      error: error?.message || 'Failed to extract data from multi-section slip image.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Slip2Excel server listening on http://0.0.0.0:${port}`);
  });
}

// Export for serverless environments (e.g. Vercel)
export default app;

if (!process.env.VERCEL) {
  startServer();
}
