/**
 * Automatically separates year/age range and quantity if trailing quantity was included in year
 * e.g. "2-3-2" -> year: "2-3", quantity: 2
 * "12-18-1" -> year: "12-18", quantity: 1
 * "4-5-2years" -> year: "4-5", quantity: 2
 */
export function parseYearAndQuantity(rawYear: string, existingQty: number = 1): { year: string; quantity: number } {
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
 * Automatically classifies age / size into 'months' or 'years'.
 * 
 * Months:
 * 0-3, 3-6, 6-9, 9-12, 6-12, 12-18, 18-24
 * 
 * Years:
 * 1-2, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8, 8-9, 9-10, 11-12, 13-14, 15-16, etc.
 */
export function getAgeUnit(value: string): 'months' | 'years' {
  if (!value) return 'years';
  const { year } = parseYearAndQuantity(value, 1);
  const clean = year.trim().toLowerCase().replace(/\s+/g, '');

  // Exact months patterns
  const monthsPatterns = new Set([
    '0-3',
    '3-6',
    '6-9',
    '9-12',
    '6-12',
    '12-18',
    '18-24',
    '0/3',
    '3/6',
    '6/9',
    '9/12',
    '6/12',
    '12/18',
    '18/24',
    '0-3m',
    '3-6m',
    '6-9m',
    '9-12m',
    '12-18m',
    '18-24m',
  ]);

  if (monthsPatterns.has(clean)) {
    return 'months';
  }

  // Match month ranges if written with spaces or suffixes
  if (/^(0-3|3-6|6-9|9-12|6-12|12-18|18-24)(m|months?)?$/i.test(clean)) {
    return 'months';
  }

  return 'years';
}
