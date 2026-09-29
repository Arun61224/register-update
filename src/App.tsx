import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  Upload,
  FileSpreadsheet,
  Copy,
  Check,
  AlertTriangle,
  Eye,
  RefreshCw,
  Trash2,
  FileText,
  ArrowDown,
  Sun,
  Moon,
  Search,
  Crop,
  FileX,
  Plus,
  Layers,
  Images,
  Database,
  ExternalLink,
} from 'lucide-react';

import { InventoryRow, DuplicateWarning, SlipExtractionResult, SectionSummary } from './types/inventory';
import { exportToExcel, copyForExcelClipboard, downloadCSV } from './utils/excelExport';
import { getAgeUnit, parseYearAndQuantity } from './utils/ageClassifier';
import { normalizePrefix } from './utils/prefixClassifier';
import { compressImageForUpload } from './utils/imageCompressor';
import { CameraCapture } from './components/CameraCapture';
import { DuplicateResolverModal } from './components/DuplicateResolverModal';
import { SlipImageModal } from './components/SlipImageModal';
import { ImageCropperModal } from './components/ImageCropperModal';

export default function App() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarning[]>([]);
  const [detectedPrefix, setDetectedPrefix] = useState<string>('');
  const [detectedBin, setDetectedBin] = useState<string>('');
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [uploadedImagesCount, setUploadedImagesCount] = useState<number>(0);
  const [isAppendMode, setIsAppendMode] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Modals
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState<boolean>(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState<boolean>(false);
  const [isCropperOpen, setIsCropperOpen] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<number | 'all'>('all');
  const [filterDuplicateOnly, setFilterDuplicateOnly] = useState<boolean>(false);

  // Master SKU Google Sheet Sync State
  const [masterSkuCount, setMasterSkuCount] = useState<number | null>(null);
  const [isSyncingMasterSkus, setIsSyncingMasterSkus] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const multiFileInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch initial master SKU status
  useEffect(() => {
    fetch('/api/master-skus/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && typeof data.totalCount === 'number') {
          setMasterSkuCount(data.totalCount);
        }
      })
      .catch((err) => console.warn('Could not fetch initial SKU status:', err));
  }, []);

  const refreshMasterSkus = async () => {
    setIsSyncingMasterSkus(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/master-skus/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMasterSkuCount(data.totalCount);
        setSyncMessage(`Synced ${data.totalCount.toLocaleString()} SKUs from Google Sheet!`);
        setTimeout(() => setSyncMessage(null), 4000);
      } else {
        setSyncMessage('Failed to sync master SKUs.');
      }
    } catch (_err) {
      setSyncMessage('Network error syncing Google Sheet.');
    } finally {
      setIsSyncingMasterSkus(false);
    }
  };

  // Start with a clean blank sheet by default.
  // Data will only appear after the user uploads or captures a slip.
  // (Demo slip can still be loaded on-demand via the "Demo Slip" button).

  // Listen for clipboard paste events (e.g. Ctrl+V image)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleFileUpload(file);
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Helper to re-evaluate duplicate status across rows
  const recalculateDuplicates = useCallback((currentRows: InventoryRow[]) => {
    const duplicateMap = new Map<string, number[]>();
    currentRows.forEach((row, index) => {
      const key = `${row.fullCode || `${row.prefix}-${row.itemCode}`}__${row.year}`;
      if (!duplicateMap.has(key)) {
        duplicateMap.set(key, []);
      }
      duplicateMap.get(key)!.push(index + 1);
    });

    const newWarnings: DuplicateWarning[] = [];
    duplicateMap.forEach((indices, key) => {
      if (indices.length > 1) {
        const [fullCode, year] = key.split('__');
        const itemCode = fullCode.replace(/^[^-]+-/, '');
        newWarnings.push({
          id: `dup-${key}`,
          itemCode,
          fullCode,
          year,
          rowIndices: indices,
          message: `${fullCode} (Year ${year}) appears ${indices.length} times in rows [${indices.join(', ')}]`,
          resolved: false,
        });
      }
    });

    setDuplicateWarnings(newWarnings);

    // Update row duplicate flags
    setRows((prev) =>
      prev.map((r) => {
        const key = `${r.fullCode || `${r.prefix}-${r.itemCode}`}__${r.year}`;
        const indices = duplicateMap.get(key) || [];
        return {
          ...r,
          isDuplicate: indices.length > 1,
        };
      })
    );
  }, []);

  // Load Sample Slip Data (4 Sections)
  const loadSampleSlip = async () => {
    setIsLoading(true);
    setLoadingStep('Loading 4-section handwritten page...');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/sample-slip');
      const text = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        console.warn('Sample slip endpoint returned non-JSON:', text.slice(0, 100));
      }
      if (data && data.success && data.data) {
        applyExtractionResult(data.data, null);
      }
    } catch (err: any) {
      console.error('Failed to load sample data', err);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  // Process a single slip image
  const extractSingleSlip = async (base64Image: string): Promise<SlipExtractionResult> => {
    const optimizedBase64 = await compressImageForUpload(base64Image, 1200, 0.82);
    const response = await fetch('/api/extract-slip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64: optimizedBase64,
        defaultPrefix: 'TSUT',
      }),
    });

    const responseText = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(responseText);
    } catch (_parseErr) {
      if (response.status === 413 || responseText.includes('Payload Too Large')) {
        throw new Error('Image size is too large for the mobile network. Please use Crop to select the slip.');
      }
      throw new Error(`Server returned status ${response.status}`);
    }

    if (!response.ok || !json?.success) {
      let rawError = json?.error || `Failed to process slip image (HTTP ${response.status}).`;
      try {
        const parsed = JSON.parse(rawError);
        if (parsed?.error?.message) rawError = parsed.error.message;
        else if (parsed?.message) rawError = parsed.message;
      } catch (_e) {}
      throw new Error(rawError);
    }

    return json.data;
  };

  // Process Slip Image (Single)
  const processSlipImage = async (base64Image: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setBatchProgress(null);
    setLoadingStep('Optimizing photo for mobile scanning...');

    try {
      setLoadingStep('Detecting notebook quadrants & handwritten lines...');
      const data = await extractSingleSlip(base64Image);
      applyExtractionResult(data, base64Image, false);
    } catch (err: any) {
      console.error('OCR Error:', err);
      let displayError = err?.message || 'Error scanning image. Please make sure the photo is clear.';
      if (displayError.includes('high demand') || displayError.includes('503') || displayError.includes('UNAVAILABLE')) {
        displayError = 'Google AI service is experiencing high demand. Please try again in 5-10 seconds.';
      }
      setErrorMessage(displayError);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  // Process Multiple Images in Batch
  const processMultipleImages = async (files: File[]) => {
    if (files.length === 0) return;
    setIsLoading(true);
    setErrorMessage(null);
    setUploadedImagesCount(files.length);

    const total = files.length;
    let successfulCount = 0;
    const combinedRows: InventoryRow[] = isAppendMode ? [...rows] : [];
    const combinedSections: SectionSummary[] = isAppendMode ? [...sections] : [];
    let lastValidImage: string | null = null;
    let detectedPrefixes = new Set<string>();
    let detectedBins = new Set<string>();

    for (let i = 0; i < total; i++) {
      const file = files[i];
      setBatchProgress({ current: i + 1, total });
      setLoadingStep(`Processing Slip ${i + 1} of ${total} (${file.name})...`);

      try {
        const compressedBase64 = await compressImageForUpload(file, 1200, 0.82);
        lastValidImage = compressedBase64;
        let result: any = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            result = await extractSingleSlip(compressedBase64);
            if (result && result.rows) break;
          } catch (slipErr: any) {
            if (attempt === 1) {
              await new Promise((r) => setTimeout(r, 2000));
            } else {
              throw slipErr;
            }
          }
        }

        if (result.detectedPrefix) detectedPrefixes.add(result.detectedPrefix);
        if (result.detectedBinNumber) detectedBins.add(result.detectedBinNumber);

        // Format and append rows with unique IDs and continuous row numbering
        const startingRowNum = combinedRows.length;
        const slipRows: InventoryRow[] = (result.rows || []).map((row: any, idx: number) => {
          const parsedYearQty = parseYearAndQuantity(String(row.year || ''), Number(row.quantity) || 1);
          const yearStr = parsedYearQty.year;
          const quantity = Number(row.quantity) > 1 ? Number(row.quantity) : parsedYearQty.quantity;
          const rowNumber = startingRowNum + idx + 1;
          return {
            id: `batch-${i + 1}-${Date.now()}-${idx + 1}`,
            rowNumber,
            sectionIndex: row.sectionIndex || 1,
            sectionName: `Slip ${i + 1} - Sec ${row.sectionIndex || 1}`,
            rawText: row.rawText || '',
            prefix: row.prefix || 'TSUT',
            itemCode: String(row.itemCode || ''),
            fullCode: row.fullCode || `${row.prefix || 'TSUT'}-${row.itemCode}`,
            year: yearStr,
            ageType: row.ageType || getAgeUnit(yearStr),
            quantity,
            binNumber: String(row.binNumber || ''),
            isCarryForward: Boolean(row.isCarryForward),
            carryForwardFrom: row.carryForwardFrom || '',
            isDuplicate: false,
            matchedSku: row.matchedSku,
            skuCandidates: row.skuCandidates,
            skuStatus: row.skuStatus,
            isNearbyMatch: row.isNearbyMatch,
          };
        });

        combinedRows.push(...slipRows);

        // Collect sections
        if (result.sections) {
          result.sections.forEach((sec: any) => {
            combinedSections.push({
              ...sec,
              title: `Slip ${i + 1} - ${sec.title}`,
            });
          });
        }

        successfulCount++;
      } catch (err: any) {
        console.error(`Failed to process image ${i + 1}:`, err);
        setErrorMessage(`Slip ${i + 1} (${file.name}) process karte samay issue aaya: ${err?.message || 'Error'}`);
      }
    }

    if (combinedRows.length > 0) {
      setRows(combinedRows);
      if (detectedPrefixes.size > 0) {
        setDetectedPrefix(Array.from(detectedPrefixes).join(' / '));
      }
      if (detectedBins.size > 0) {
        setDetectedBin(Array.from(detectedBins).join(' / '));
      }
      if (lastValidImage) {
        setCurrentImage(lastValidImage);
      }
      recalculateDuplicates(combinedRows);
    }

    setIsLoading(false);
    setLoadingStep('');
    setBatchProgress(null);
  };

  const applyExtractionResult = (
    data: SlipExtractionResult,
    imageBase64: string | null,
    append: boolean = false
  ) => {
    setDetectedPrefix(data.detectedPrefix || 'TSUT / PSUT');
    setDetectedBin(data.detectedBinNumber || '2162 / 2352 / 2342 / 2300');
    if (imageBase64) setCurrentImage(imageBase64);

    const baseRowNumber = append ? rows.length : 0;
    const formattedRows: InventoryRow[] = (data.rows || []).map((row, idx) => {
      const parsedYearQty = parseYearAndQuantity(String(row.year || ''), Number(row.quantity) || 1);
      const yearStr = parsedYearQty.year;
      const quantity = Number(row.quantity) > 1 ? Number(row.quantity) : parsedYearQty.quantity;
      return {
        id: row.id || `row-${Date.now()}-${baseRowNumber + idx + 1}`,
        rowNumber: baseRowNumber + idx + 1,
        sectionIndex: row.sectionIndex || 1,
        sectionName: row.sectionName || `Sec ${row.sectionIndex || 1}`,
        rawText: row.rawText || '',
        prefix: row.prefix || 'TSUT',
        itemCode: String(row.itemCode || ''),
        fullCode: row.fullCode || `${row.prefix || 'TSUT'}-${row.itemCode}`,
        year: yearStr,
        ageType: row.ageType || getAgeUnit(yearStr),
        quantity,
        binNumber: String(row.binNumber || ''),
        isCarryForward: Boolean(row.isCarryForward),
        carryForwardFrom: row.carryForwardFrom || '',
        isDuplicate: false,
        matchedSku: row.matchedSku,
        skuCandidates: row.skuCandidates,
        skuStatus: row.skuStatus,
        isNearbyMatch: row.isNearbyMatch,
      };
    });

    const finalRows = append ? [...rows, ...formattedRows] : formattedRows;
    setRows(finalRows);

    // Compute dynamic section breakdown if not present
    if (data.sections && data.sections.length > 0) {
      setSections(append ? [...sections, ...data.sections] : data.sections);
    } else {
      const secMap = new Map<number, { prefix: string; bin: string; count: number; qty: number }>();
      finalRows.forEach((r) => {
        const sIdx = r.sectionIndex || 1;
        if (!secMap.has(sIdx)) {
          secMap.set(sIdx, { prefix: r.prefix, bin: r.binNumber, count: 0, qty: 0 });
        }
        const s = secMap.get(sIdx)!;
        s.count += 1;
        s.qty += Number(r.quantity) || 0;
      });

      const computedSections: SectionSummary[] = Array.from(secMap.entries()).map(([idx, s]) => ({
        sectionIndex: idx,
        title: `Section ${idx}`,
        prefix: s.prefix,
        binNumber: s.bin,
        rowCount: s.count,
        totalQty: s.qty,
      }));
      setSections(computedSections);
    }

    recalculateDuplicates(finalRows);
  };

  const handleMultipleFilesUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));

    if (files.length === 0) {
      setErrorMessage('Please select valid image files (JPG, PNG, JPEG).');
      return;
    }

    if (files.length === 1) {
      handleFileUpload(files[0]);
    } else {
      await processMultipleImages(files);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please upload a valid image file (JPG, PNG, JPEG).');
      return;
    }

    try {
      setIsLoading(true);
      setLoadingStep('Compressing photo for fast mobile upload...');
      const optimizedBase64 = await compressImageForUpload(file, 1600, 0.88);
      processSlipImage(optimizedBase64);
    } catch (err: any) {
      console.error('File compression fallback:', err);
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        if (base64) {
          processSlipImage(base64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Inline Row Editor
  const updateRowField = (id: string, field: keyof InventoryRow, value: any) => {
    setRows((prev) => {
      const updated = prev.map((r) => {
        if (r.id === id) {
          const newRow = { ...r, [field]: value };
          if (field === 'itemCode' || field === 'prefix') {
            newRow.fullCode = `${newRow.prefix}-${newRow.itemCode}`;
          }
          if (field === 'year') {
            const parsed = parseYearAndQuantity(String(value || ''), r.quantity);
            newRow.year = parsed.year;
            if (parsed.quantity > 1) {
              newRow.quantity = parsed.quantity;
            }
            newRow.ageType = getAgeUnit(parsed.year);
          }
          return newRow;
        }
        return r;
      });
      recalculateDuplicates(updated);
      return updated;
    });
  };

  const handleDeleteRow = (id: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      const renumbered = filtered.map((r, i) => ({ ...r, rowNumber: i + 1 }));
      recalculateDuplicates(renumbered);
      return renumbered;
    });
  };

  const handleClearSheet = () => {
    setRows([]);
    setSections([]);
    setDuplicateWarnings([]);
    setCurrentImage(null);
    setSearchQuery('');
    setErrorMessage(null);
  };

  const handleAddNewRow = () => {
    const lastRow = rows[rows.length - 1];
    const newRowNumber = rows.length + 1;
    const newRow: InventoryRow = {
      id: `row-${Date.now()}-${newRowNumber}`,
      rowNumber: newRowNumber,
      sectionIndex: lastRow ? lastRow.sectionIndex : 1,
      sectionName: lastRow ? lastRow.sectionName : 'Sec 1',
      prefix: lastRow ? lastRow.prefix : 'TSUT',
      itemCode: '',
      fullCode: `${lastRow ? lastRow.prefix : 'TSUT'}-`,
      year: '',
      ageType: 'years',
      quantity: 1,
      binNumber: lastRow ? lastRow.binNumber : '2162',
      isCarryForward: false,
      rawText: 'Manual Entry',
    };
    const updated = [...rows, newRow];
    setRows(updated);
    recalculateDuplicates(updated);
  };

  const handleApplyPrefixToAll = (newPrefix: string) => {
    setDetectedPrefix(newPrefix);
    setRows((prev) => {
      const updated = prev.map((r) => ({
        ...r,
        prefix: newPrefix,
        fullCode: `${newPrefix}-${r.itemCode}`,
      }));
      recalculateDuplicates(updated);
      return updated;
    });
  };

  const handleApplyBinToAll = (newBin: string) => {
    setDetectedBin(newBin);
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        binNumber: newBin,
      }))
    );
  };

  const handleKeepBothDuplicates = (warning: DuplicateWarning) => {
    setDuplicateWarnings((prev) =>
      prev.map((w) => (w.id === warning.id ? { ...w, resolved: true, resolutionChoice: 'kept_both' } : w))
    );
  };

  const handleDeleteDuplicateRow = (warning: DuplicateWarning) => {
    const matchingRows = rows.filter(
      (r) => r.itemCode === warning.itemCode && r.year === warning.year
    );
    if (matchingRows.length <= 1) return;

    const duplicateRowsToRemove = new Set(matchingRows.slice(1).map((r) => r.id));

    setRows((prev) => {
      const updated = prev
        .filter((r) => !duplicateRowsToRemove.has(r.id))
        .map((r, i) => ({ ...r, rowNumber: i + 1 }));
      recalculateDuplicates(updated);
      return updated;
    });

    setDuplicateWarnings((prev) =>
      prev.map((w) =>
        w.id === warning.id ? { ...w, resolved: true, resolutionChoice: 'deleted_duplicate' } : w
      )
    );
  };

  const handleResolveAllKeepBoth = () => {
    setDuplicateWarnings((prev) =>
      prev.map((w) => ({ ...w, resolved: true, resolutionChoice: 'kept_both' }))
    );
  };

  // Google Sheet me match mila to wahi SKU, warna handwritten value (same format jo table me dikhta hai)
  const getFinalSku = (row: InventoryRow): string => {
    if (row.matchedSku) return row.matchedSku;
    const unit = row.ageType || getAgeUnit(row.year);
    const unitStr = unit === 'months' ? 'months' : 'years';
    const base = row.fullCode || `${row.prefix}-${row.itemCode}`;
    const cleanYear = row.year ? row.year.replace(/[\s\-_]*(years?|months?)$/i, '').trim() : '';
    return `${base}--${cleanYear}${unitStr}`;
  };

  // Export ke liye rows: unmatched rows me handwritten value matchedSku me daal do
  const withFinalSku = (list: InventoryRow[]): InventoryRow[] =>
    list.map((r) => ({ ...r, matchedSku: getFinalSku(r) }));

  // Export handlers
  const handleExportExcel = () => {
    const rowsToExport = selectedSectionFilter === 'all'
      ? rows
      : rows.filter((r) => r.sectionIndex === selectedSectionFilter);
    exportToExcel(withFinalSku(rowsToExport), 'TSUT', '2162');
  };

  const handleCopyClipboard = async () => {
    const rowsToCopy = selectedSectionFilter === 'all'
      ? rows
      : rows.filter((r) => r.sectionIndex === selectedSectionFilter);
    const success = await copyForExcelClipboard(withFinalSku(rowsToCopy));
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2200);
    }
  };

  const handleDownloadCSV = () => {
    const rowsToCsv = selectedSectionFilter === 'all'
      ? rows
      : rows.filter((r) => r.sectionIndex === selectedSectionFilter);
    downloadCSV(withFinalSku(rowsToCsv), `Stock_Slip_${selectedSectionFilter === 'all' ? 'All_Sections' : `Sec_${selectedSectionFilter}`}.csv`);
  };

  // Filter rows by section and search query
  const filteredRows = rows.filter((r) => {
    if (selectedSectionFilter !== 'all' && r.sectionIndex !== selectedSectionFilter) {
      return false;
    }
    if (filterDuplicateOnly && !r.isDuplicate) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.itemCode.toLowerCase().includes(q) ||
      r.fullCode.toLowerCase().includes(q) ||
      r.year.toLowerCase().includes(q) ||
      r.binNumber.toLowerCase().includes(q) ||
      (r.sectionName && r.sectionName.toLowerCase().includes(q)) ||
      String(r.rowNumber).includes(q)
    );
  });

  const totalQuantity = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const uniqueItemsCount = new Set(rows.map((r) => r.itemCode)).size;
  const unresolvedDupCount = duplicateWarnings.filter((w) => !w.resolved).length;
  const monthsCount = filteredRows.filter((r) => (r.ageType || getAgeUnit(r.year)) === 'months').length;
  const yearsCount = filteredRows.filter((r) => (r.ageType || getAgeUnit(r.year)) === 'years').length;

  return (
    <div className={`min-h-screen flex flex-col antialiased selection:bg-emerald-500 selection:text-white transition-colors duration-150 ${
      isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100/90 text-slate-800'
    }`}>
      {/* Top Navigation */}
      <header className={`border-b sticky top-0 z-40 px-4 lg:px-8 py-3.5 backdrop-blur transition-colors ${
        isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-slate-200/90 bg-white/95 shadow-xs'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-md shadow-emerald-500/20 text-white">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`text-lg font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                  Slip2Excel
                </h1>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium border ${
                  isDarkMode
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  Fast Slip OCR
                </span>
              </div>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Extract handwritten notebook slips into clean, verified Excel (.xlsx) spreadsheets
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCameraOpen(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm hover:shadow transition active:scale-95 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>Capture Photo</span>
            </button>

            {/* Single Slip Upload */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-1.5 border transition cursor-pointer shadow-xs ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
              }`}
            >
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Upload Slip</span>
            </button>

            {/* Multiple Slips (Batch) Upload */}
            <button
              type="button"
              onClick={() => multiFileInputRef.current?.click()}
              title="Upload multiple slip photos at once to merge into one Excel"
              className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 border transition cursor-pointer shadow-xs ${
                isDarkMode
                  ? 'bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border-indigo-700/60'
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
              }`}
            >
              <Images className="w-4 h-4 text-indigo-500" />
              <span>Multiple Slips</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />

            <input
              ref={multiFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleMultipleFilesUpload(e.target.files);
                }
                e.target.value = '';
              }}
            />

            {/* Crop & Adjust Slip (if loaded) */}
            {currentImage && (
              <button
                type="button"
                onClick={() => setIsCropperOpen(true)}
                title="Crop or rotate slip photo"
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer flex items-center gap-1.5 shadow-xs ${
                  isDarkMode
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/50'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <Crop className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Crop Slip</span>
              </button>
            )}

            {/* Inspect Photo (if loaded) */}
            {currentImage && (
              <button
                type="button"
                onClick={() => setIsImageModalOpen(true)}
                title="View uploaded slip photo"
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer flex items-center gap-1 shadow-xs ${
                  isDarkMode
                    ? 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60 hover:bg-indigo-900/50'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Inspect Slip</span>
              </button>
            )}

            {/* Google Sheet Master SKU Sync */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={refreshMasterSkus}
                disabled={isSyncingMasterSkus}
                title="Click to refresh Master SKUs from Google Sheet"
                className={`px-3 py-2 text-xs font-semibold rounded-lg border transition cursor-pointer flex items-center gap-1.5 shadow-xs ${
                  isSyncingMasterSkus
                    ? 'opacity-70 cursor-wait'
                    : isDarkMode
                      ? 'bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border-emerald-800/60'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}
              >
                <Database className={`w-3.5 h-3.5 text-emerald-600 ${isSyncingMasterSkus ? 'animate-spin' : ''}`} />
                <span>
                  {isSyncingMasterSkus
                    ? 'Syncing Sheet...'
                    : masterSkuCount
                      ? `Master SKUs (${masterSkuCount.toLocaleString()})`
                      : 'Sync Master SKUs'}
                </span>
                <RefreshCw className={`w-3 h-3 text-slate-400 ${isSyncingMasterSkus ? 'animate-spin' : ''}`} />
              </button>
              <a
                href="https://docs.google.com/spreadsheets/d/19THmGjzWHJ-G-u0FEoiOBray5ita7OPPXtJaWIu7Hm8/edit?usp=sharing"
                target="_blank"
                rel="noreferrer"
                title="Open Google Sheet in new tab"
                className={`p-2 rounded-lg border transition ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
                    : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-300'
                }`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Blank Sheet (Clear Table) */}
            <button
              type="button"
              onClick={handleClearSheet}
              title="Clear all rows and make spreadsheet blank (Khali sheet)"
              className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer flex items-center gap-1.5 shadow-xs ${
                isDarkMode
                  ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/50'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <FileX className="w-3.5 h-3.5 text-rose-500" />
              <span>Blank Sheet</span>
            </button>

            {/* Reload Sample Slip */}
            <button
              type="button"
              onClick={loadSampleSlip}
              title="Reload sample slip with demo rows (58 rows)"
              className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer flex items-center gap-1.5 shadow-xs ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Demo Slip</span>
            </button>

            {/* Theme Toggle (Dark / Light) */}
            <button
              type="button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to Clean Light Mode' : 'Switch to Dark Mode'}
              className={`p-2 rounded-lg border transition cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300 shadow-xs'
              }`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 flex-1 flex flex-col gap-4">
        {/* Sync notification toast */}
        {syncMessage && (
          <div className="bg-emerald-600 text-white text-xs px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between animate-fade-in font-medium">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{syncMessage}</span>
            </div>
            <button
              onClick={() => setSyncMessage(null)}
              className="text-emerald-100 hover:text-white cursor-pointer text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading State Banner */}
        {isLoading && (
          <div className={`border rounded-xl p-4 flex flex-col gap-2 shadow-xs ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-600 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    {batchProgress ? `Extracting Slips (${batchProgress.current} / ${batchProgress.total})...` : 'Extracting Notebook Slip...'}
                  </p>
                  {batchProgress && (
                    <span className="text-xs font-mono font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                      {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                    </span>
                  )}
                </div>
                <p className="text-xs opacity-80">{loadingStep}</p>
              </div>
            </div>
            {batchProgress && (
              <div className="w-full bg-emerald-200/50 dark:bg-emerald-900/50 rounded-full h-1.5 overflow-hidden mt-1">
                <div
                  className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className={`border rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs ${
            isDarkMode
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Processing Error</p>
                <p className="text-xs opacity-90">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-xs text-rose-600 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Excel Table Section - ONLY element on dashboard */}
        <div className={`border rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1 transition-colors ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/90'
        }`}>
          {/* Table Header with Search & Export Buttons */}
          <div className={`px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${
            isDarkMode ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50/80 border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className={`text-sm font-bold flex items-center gap-2 ${
                isDarkMode ? 'text-white' : 'text-slate-900'
              }`}>
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Excel Preview Grid</span>
                <span className={`text-xs px-2 py-0.5 rounded-md font-mono font-semibold ${
                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200/80 text-slate-700'
                }`}>
                  {filteredRows.length} rows
                </span>
              </h2>

              {/* Quick Search */}
              <div className="relative">
                <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${
                  isDarkMode ? 'text-slate-500' : 'text-slate-400'
                }`} />
                <input
                  type="text"
                  placeholder="Search code, bin, year..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-44 sm:w-52 shadow-xs transition ${
                    isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500'
                      : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-500'
                  }`}
                />
              </div>

              {/* Mode Toggle: Append vs New Sheet */}
              <button
                type="button"
                onClick={() => setIsAppendMode(!isAppendMode)}
                title={isAppendMode ? 'Append Mode: Nayi photos ka data iske niche judega' : 'Replace Mode: Nayi photo lene par sheet reset hogi'}
                className={`px-2.5 py-1 text-[11px] rounded-lg border flex items-center gap-1.5 transition cursor-pointer font-medium ${
                  isAppendMode
                    ? isDarkMode
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : isDarkMode
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                <Layers className="w-3 h-3 text-emerald-500" />
                <span>{isAppendMode ? 'Append Mode ON' : 'Replace Mode'}</span>
              </button>
            </div>

            {/* Export, Add Row & Clear action buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddNewRow}
                title="Add a new blank row manually"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border-slate-700'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-emerald-600" />
                <span>+ Add Row</span>
              </button>

              <button
                type="button"
                onClick={handleCopyClipboard}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
                title="Copy directly to clipboard (ready to paste into Excel or Google Sheets)"
              >
                {copySuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadCSV}
                title="Download CSV in warehouse format (Product Code*, Quantity*, Shelf Code* U-, Adjustment Type* = Add, etc.)"
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm hover:shadow transition active:scale-95 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Download CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
                title="Downloads clean Excel workbook (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel (.xlsx)</span>
              </button>


              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSheet}
                  title="Make table blank (remove all rows)"
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-xs ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-rose-950/60 text-rose-300 border-slate-700 hover:border-rose-700'
                      : 'bg-white hover:bg-rose-50 text-rose-700 border-slate-200 hover:border-rose-300'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Blank</span>
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto flex-1 max-h-[600px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className={`sticky top-0 z-10 border-b font-semibold text-[11px] uppercase tracking-wider ${
                isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}>
                <tr>
                  <th className="py-2.5 px-3 w-12 text-center">#</th>
                  <th className="py-2.5 px-3 w-20">Section</th>
                  <th className="py-2.5 px-3 w-20">Prefix</th>
                  <th className="py-2.5 px-3 w-24">Item Code</th>
                  <th className="py-2.5 px-3 w-56">
                    Product Code*
                    <span className={`block text-[10px] font-normal normal-case ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                      e.g. PSUT-202--5-6years
                    </span>
                  </th>
                  <th className="py-2.5 px-3 w-20 text-center">
                    Unit
                    <span className={`block text-[10px] font-normal normal-case ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                      Months / Years
                    </span>
                  </th>
                  <th className="py-2.5 px-3 w-24 text-center">
                    Quantity*
                    <span className="block text-[10px] text-slate-400 font-normal normal-case">Pcs</span>
                  </th>
                  <th className="py-2.5 px-3 w-28">
                    Shelf Code*
                    <span className={`block text-[10px] font-normal normal-case ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                      U- + Bin
                    </span>
                  </th>
                  <th className="py-2.5 px-3">Status / Origin</th>
                  <th className="py-2.5 px-3 w-16 text-center">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y font-mono ${
                isDarkMode ? 'divide-slate-800/60' : 'divide-slate-100'
              }`}>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-14 px-4 text-center">
                      {rows.length === 0 ? (
                        <div className="max-w-md mx-auto flex flex-col items-center justify-center text-center">
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3.5 shadow-sm border ${
                            isDarkMode
                              ? 'bg-slate-900 border-slate-700 text-emerald-400'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          }`}>
                            <FileSpreadsheet className="w-7 h-7" />
                          </div>
                          <h3 className={`text-base font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            Spreadsheet is Empty
                          </h3>
                          <p className={`text-xs mb-5 max-w-sm font-sans ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            Capture a photo of a notebook slip, upload an image file, or add entries manually.
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => setIsCameraOpen(true)}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
                            >
                              <Camera className="w-4 h-4" />
                              <span>Capture Photo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className={`px-3.5 py-2 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                                isDarkMode
                                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <Upload className="w-4 h-4 text-slate-500" />
                              <span>Upload Slip</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => multiFileInputRef.current?.click()}
                              className={`px-3.5 py-2 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                                isDarkMode
                                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/60 hover:bg-indigo-900/60'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                              }`}
                            >
                              <Images className="w-4 h-4 text-indigo-500" />
                              <span>Multiple Slips</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleAddNewRow}
                              className={`px-3.5 py-2 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                                isDarkMode
                                  ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                              }`}
                            >
                              <Plus className="w-4 h-4 text-emerald-600" />
                              <span>+ Add Blank Row</span>
                            </button>
                            <button
                              type="button"
                              onClick={loadSampleSlip}
                              className={`px-3.5 py-2 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                                isDarkMode
                                  ? 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                              }`}
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                              <span>Load Demo Slip</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 font-sans">
                          <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            No rows found matching "{searchQuery}".
                          </p>
                          <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="mt-2 text-xs text-emerald-600 hover:underline font-semibold cursor-pointer"
                          >
                            Clear Search Filter
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const currentUnit = row.ageType || getAgeUnit(row.year);

                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        {/* Index */}
                        <td className={`py-2.5 px-3 text-center text-[11px] ${
                          isDarkMode ? 'text-slate-500' : 'text-slate-400'
                        }`}>
                          {row.rowNumber}
                        </td>

                        {/* Section Tag */}
                        <td className="py-2.5 px-3 font-sans">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                            isDarkMode
                              ? 'bg-slate-800 text-slate-300 border-slate-700'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            Sec {row.sectionIndex || 1}
                          </span>
                        </td>

                        {/* Prefix */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={row.prefix}
                            onChange={(e) => updateRowField(row.id, 'prefix', e.target.value)}
                            onBlur={(e) => updateRowField(row.id, 'prefix', normalizePrefix(e.target.value))}
                            className={`w-full px-1.5 py-1 rounded border border-transparent font-mono font-bold focus:outline-none transition ${
                              isDarkMode
                                ? 'text-slate-300 hover:bg-slate-950/50 focus:bg-slate-950 focus:border-slate-700'
                                : 'text-slate-800 hover:bg-slate-100 focus:bg-white focus:border-slate-300 focus:shadow-xs'
                            }`}
                          />
                        </td>

                        {/* Item Code */}
                        <td className="py-2.5 px-3 font-semibold">
                          <input
                            type="text"
                            value={row.itemCode}
                            onChange={(e) => updateRowField(row.id, 'itemCode', e.target.value)}
                            className={`w-full px-1.5 py-1 rounded border border-transparent font-mono font-bold focus:outline-none transition ${
                              isDarkMode
                                ? 'text-white hover:bg-slate-950/50 focus:bg-slate-950 focus:border-slate-700'
                                : 'text-slate-900 hover:bg-slate-100 focus:bg-white focus:border-slate-300 focus:shadow-xs'
                            }`}
                          />
                        </td>

                        {/* Product Code* (Auto-Matched with Google Sheet Master SKU) */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className={`font-bold text-xs whitespace-nowrap px-1.5 py-0.5 rounded border ${
                              row.matchedSku
                                ? isDarkMode
                                  ? 'text-emerald-300 bg-emerald-950/60 border-emerald-600/60'
                                  : 'text-emerald-900 bg-emerald-100/80 border-emerald-300 font-extrabold'
                                : isDarkMode
                                  ? 'text-emerald-400 bg-emerald-950/30 border-emerald-800/40'
                                  : 'text-emerald-800 bg-emerald-50 border-emerald-200/80'
                            }`}>
                              {row.matchedSku || (row.fullCode || `${row.prefix}-${row.itemCode}`) + '--' + (row.year ? `${row.year.replace(/[\s\-_]*(years?|months?)$/i, '').trim()}${currentUnit === 'months' ? 'months' : 'years'}` : currentUnit === 'months' ? 'months' : 'years')}
                            </span>
                            <span className={`text-[10px] font-normal ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                              (
                              <input
                                type="text"
                                title="Edit Year / Age"
                                value={row.year}
                                onChange={(e) => updateRowField(row.id, 'year', e.target.value)}
                                className={`w-10 px-1 py-0.5 rounded border text-center font-mono focus:outline-none ${
                                  isDarkMode
                                    ? 'bg-slate-950 border-slate-700 text-sky-300 focus:border-emerald-500'
                                    : 'bg-white border-slate-300 text-slate-800 focus:border-emerald-600'
                                }`}
                              />
                              )
                            </span>
                          </div>
                        </td>

                        {/* Unit (months / years) */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const nextUnit = currentUnit === 'months' ? 'years' : 'months';
                              updateRowField(row.id, 'ageType', nextUnit);
                            }}
                            title="Click to toggle between Months and Years"
                            className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono tracking-wide border transition cursor-pointer shadow-2xs ${
                              currentUnit === 'months'
                                ? isDarkMode
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                                : isDarkMode
                                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                                  : 'bg-sky-50 text-sky-900 border-sky-300 hover:bg-sky-100'
                            }`}
                          >
                            {currentUnit === 'months' ? 'Months' : 'Years'}
                          </button>
                        </td>

                        {/* Quantity* */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateRowField(row.id, 'quantity', Math.max(1, (Number(row.quantity) || 1) - 1))
                              }
                              className={`w-5 h-5 rounded flex items-center justify-center text-xs cursor-pointer border ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={row.quantity}
                              onChange={(e) =>
                                updateRowField(row.id, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))
                              }
                              className={`w-10 text-center rounded py-0.5 font-bold font-mono text-xs focus:outline-none border ${
                                isDarkMode
                                  ? 'bg-slate-950 border-slate-700 text-white focus:border-emerald-500'
                                  : 'bg-white border-slate-200 text-slate-900 focus:border-emerald-600'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateRowField(row.id, 'quantity', (Number(row.quantity) || 1) + 1)
                              }
                              className={`w-5 h-5 rounded flex items-center justify-center text-xs cursor-pointer border ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                            >
                              +
                            </button>
                          </div>
                        </td>

                        {/* Shelf Code* (e.g. U-2770) */}
                        <td className="py-2.5 px-3 font-bold">
                          <div className="flex items-center gap-1">
                            <span className={`text-xs font-mono font-bold ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                              {row.binNumber?.toUpperCase().startsWith('U-') ? '' : 'U-'}
                            </span>
                            <input
                              type="text"
                              value={row.binNumber}
                              onChange={(e) => updateRowField(row.id, 'binNumber', e.target.value)}
                              className={`w-full px-1.5 py-1 rounded border border-transparent font-mono font-bold focus:outline-none transition ${
                                isDarkMode
                                  ? 'text-indigo-300 hover:bg-slate-950/50 focus:bg-slate-950 focus:border-slate-700'
                                  : 'text-indigo-900 hover:bg-slate-100 focus:bg-white focus:border-slate-300 focus:shadow-xs'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Slip Status Badge / Carry forward indicator / Master SKU match */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.matchedSku && (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border ${
                                  row.isNearbyMatch
                                    ? isDarkMode
                                      ? 'bg-amber-950/80 text-amber-300 border-amber-700/50'
                                      : 'bg-amber-50 text-amber-800 border-amber-300'
                                    : isDarkMode
                                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                                      : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                }`}
                                title={
                                  row.isNearbyMatch
                                    ? `Exact size not found in sheet; closest matching Master SKU selected: ${row.matchedSku}`
                                    : 'Exact Master SKU matched with Google Sheet'
                                }
                              >
                                <Check className={`w-2.5 h-2.5 ${row.isNearbyMatch ? 'text-amber-500' : 'text-emerald-600'}`} />
                                <span>{row.isNearbyMatch ? 'Nearby Size Matched' : 'Sheet Matched'}</span>
                              </span>
                            )}
                            {row.isCarryForward ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans border ${
                                  isDarkMode
                                    ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/40'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                }`}
                                title={`Blank on slip, inherited from above (${row.carryForwardFrom || row.itemCode})`}
                              >
                                <ArrowDown className="w-2.5 h-2.5 text-indigo-500" />
                                <span>Inherited Blank ({row.carryForwardFrom || row.itemCode})</span>
                              </span>
                            ) : (
                              !row.matchedSku && (
                                <span className={`text-[10px] font-sans ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                  Written
                                </span>
                              )
                            )}
                          </div>
                        </td>

                        {/* Action: Delete */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row.id)}
                            title="Delete this row"
                            className={`p-1.5 rounded transition cursor-pointer ${
                              isDarkMode
                                ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/30'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer Total Bar */}
          <div className={`px-5 py-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
            isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className={`flex flex-wrap items-center gap-3 ${
              isDarkMode ? 'text-slate-400' : 'text-slate-600'
            }`}>
              <span>Total Items: <strong className={`font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{filteredRows.length}</strong></span>
              <span>•</span>
              <span>
                Total Qty: <strong className="text-emerald-600 font-mono font-bold">
                  {filteredRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0)} pcs
                </strong>
              </span>
              <span>•</span>
              <span className={`px-2 py-0.5 rounded border text-[11px] font-mono ${
                isDarkMode ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                Months: <strong>{monthsCount}</strong>
              </span>
              <span className={`px-2 py-0.5 rounded border text-[11px] font-mono ${
                isDarkMode ? 'bg-sky-500/10 text-sky-300 border-sky-500/30' : 'bg-sky-50 text-sky-800 border-sky-200'
              }`}>
                Years: <strong>{yearsCount}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm hover:shadow transition cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel (.xlsx)
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Camera Capture Modal */}
      <CameraCapture
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(base64) => {
          processSlipImage(base64);
        }}
      />

      {/* Duplicate Details Modal */}
      <DuplicateResolverModal
        isOpen={isDuplicateModalOpen}
        warnings={duplicateWarnings}
        rows={rows}
        onClose={() => setIsDuplicateModalOpen(false)}
        onKeepBoth={handleKeepBothDuplicates}
        onDeleteDuplicate={handleDeleteDuplicateRow}
        onResolveAllKeepBoth={handleResolveAllKeepBoth}
      />

      {/* Original Slip Zoom Modal */}
      <SlipImageModal
        isOpen={isImageModalOpen}
        imageUrl={currentImage}
        onClose={() => setIsImageModalOpen(false)}
        detectedBin={detectedBin}
        detectedPrefix={detectedPrefix}
      />

      {/* Interactive Image Cropper Modal */}
      <ImageCropperModal
        isOpen={isCropperOpen}
        imageSrc={currentImage}
        onClose={() => setIsCropperOpen(false)}
        onApplyCrop={(croppedBase64) => {
          processSlipImage(croppedBase64);
        }}
      />
    </div>
  );
}
