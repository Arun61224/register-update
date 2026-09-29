import React from 'react';
import { CheckCircle, Trash2, X, Layers } from 'lucide-react';
import { DuplicateWarning, InventoryRow } from '../types/inventory';

interface DuplicateResolverModalProps {
  isOpen: boolean;
  warnings: DuplicateWarning[];
  rows: InventoryRow[];
  onClose: () => void;
  onKeepBoth: (warning: DuplicateWarning) => void;
  onDeleteDuplicate: (warning: DuplicateWarning) => void;
  onResolveAllKeepBoth: () => void;
}

export const DuplicateResolverModal: React.FC<DuplicateResolverModalProps> = ({
  isOpen,
  warnings,
  rows,
  onClose,
  onKeepBoth,
  onDeleteDuplicate,
  onResolveAllKeepBoth,
}) => {
  if (!isOpen || warnings.length === 0) return null;

  const unresolvedWarnings = warnings.filter((w) => !w.resolved);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-lg">
                Duplicate Entries (Kept As Separate Rows)
              </h3>
              <p className="text-xs text-slate-400">
                As configured, repeated entries are saved as distinct individual rows in the table and Excel export:
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Batch Actions */}
        {unresolvedWarnings.length > 1 && (
          <div className="px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span>Confirm all {unresolvedWarnings.length} duplicates as separate rows:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResolveAllKeepBoth}
                className="px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded border border-emerald-500/30 transition flex items-center gap-1 cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Keep All As Separate Rows
              </button>
            </div>
          </div>
        )}

        {/* Warnings List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {warnings.map((warning) => {
            const matchedRows = rows.filter(
              (r) =>
                r.itemCode === warning.itemCode &&
                r.year === warning.year
            );

            return (
              <div
                key={warning.id}
                className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 transition shadow"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sky-400 text-base">
                        {warning.fullCode || `TSUT-${warning.itemCode}`}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                        Year: {warning.year}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700/40">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Preserved in Separate Rows
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      This item with year {warning.year} appears in <strong className="text-white">{warning.rowIndices.length} separate rows</strong> (Row #{warning.rowIndices.join(', ')}).
                    </p>
                  </div>
                </div>

                {/* Row breakdown preview */}
                <div className="bg-slate-900/80 rounded-lg p-3 mb-3 border border-slate-800 text-xs font-mono space-y-1.5">
                  {matchedRows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-slate-200">
                      <span>Row #{r.rowNumber}: {r.fullCode} (Year {r.year})</span>
                      <div className="flex items-center gap-3">
                        {r.isCarryForward && (
                          <span className="text-[10px] text-indigo-300 bg-indigo-950/50 px-1.5 rounded">
                            Inherited blank
                          </span>
                        )}
                        <span className="text-emerald-400 font-bold">Qty: {r.quantity}</span>
                        <span className="text-slate-400">Bin: {r.binNumber}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onKeepBoth(warning)}
                    className="px-3.5 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 font-medium text-xs rounded-lg flex items-center gap-1.5 transition border border-emerald-500/40 cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    Keep Both Rows Separate ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDuplicate(warning)}
                    className="px-3.5 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 text-xs rounded-lg flex items-center gap-1.5 transition border border-rose-800/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Duplicate Row
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Both rows will export as separate individual records in the Excel spreadsheet.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-lg transition cursor-pointer"
          >
            Done / View Table
          </button>
        </div>
      </div>
    </div>
  );
};
