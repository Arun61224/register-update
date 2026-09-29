/**
 * Helper to normalize inventory prefix codes.
 * Supports:
 * - TS / T-S / Tshrt / 1shrt / lshrt / Ishrt -> Tshrt
 * - TSUT (T-Shirt Suit / T-Suit)
 * - PSUT (Pant Suit)
 * - NSUT (Night Suit)
 * - YKTs / YKT/s (meaning YK Tshrt / YK T-shirt)
 */
export function normalizePrefix(raw: string): string {
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
  if (/^yk[\s\-_]?nsut$/i.test(clean)) return 'YK NSUT';
  if (/^yk[\s\-_]?psut$/i.test(clean)) return 'YK PSUT';
  if (/^yk[\s\-_]?tsut$/i.test(clean)) return 'YK TSUT';
  if (/^tsut$/i.test(clean)) return 'TSUT';
  if (/^psut$/i.test(clean)) return 'PSUT';
  if (/^nsut$/i.test(clean)) return 'NSUT';
  return clean;
}
