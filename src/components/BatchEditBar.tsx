import React, { useState } from 'react';
import { Layers, Plus, Search, Check, RefreshCw } from 'lucide-react';

interface BatchEditBarProps {
  currentPrefix: string;
  currentBin: string;
  onApplyPrefixToAll: (newPrefix: string) => void;
  onApplyBinToAll: (newBin: string) => void;
  onAddNewRow: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const BatchEditBar: React.FC<BatchEditBarProps> = ({
  currentPrefix,
  currentBin,
  onApplyPrefixToAll,
  onApplyBinToAll,
  onAddNewRow,
  searchQuery,
  setSearchQuery,
}) => {
  const [prefixInput, setPrefixInput] = useState(currentPrefix);
  const [binInput, setBinInput] = useState(currentBin);
  const [prefixApplied, setPrefixApplied] = useState(false);
  const [binApplied, setBinApplied] = useState(false);

  // Sync inputs if props change
  React.useEffect(() => {
    setPrefixInput(currentPrefix);
  }, [currentPrefix]);

  React.useEffect(() => {
    setBinInput(currentBin);
  }, [currentBin]);

  const handleApplyPrefix = () => {
    if (prefixInput.trim()) {
      onApplyPrefixToAll(prefixInput.trim());
      setPrefixApplied(true);
      setTimeout(() => setPrefixApplied(false), 2000);
    }
  };

  const handleApplyBin = () => {
    if (binInput.trim()) {
      onApplyBinToAll(binInput.trim());
      setBinApplied(true);
      setTimeout(() => setBinApplied(false), 2000);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search code, year, bin..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 w-48 text-xs font-mono"
          />
        </div>

        {/* Global Prefix Editor */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
          <span className="text-slate-400 text-[11px]">Prefix:</span>
          <input
            type="text"
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value.toUpperCase())}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white font-mono uppercase text-xs focus:outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={handleApplyPrefix}
            title="Apply this prefix to all rows"
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition flex items-center gap-1 cursor-pointer"
          >
            {prefixApplied ? <Check className="w-3 h-3 text-emerald-400" /> : <RefreshCw className="w-3 h-3" />}
            {prefixApplied ? 'Applied' : 'Apply All'}
          </button>
        </div>

        {/* Global Bin Editor */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
          <span className="text-slate-400 text-[11px]">Bin No:</span>
          <input
            type="text"
            value={binInput}
            onChange={(e) => setBinInput(e.target.value)}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-indigo-300 font-mono text-xs focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleApplyBin}
            title="Apply this Bin Number to all rows"
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition flex items-center gap-1 cursor-pointer"
          >
            {binApplied ? <Check className="w-3 h-3 text-emerald-400" /> : <Layers className="w-3 h-3" />}
            {binApplied ? 'Applied' : 'Apply All'}
          </button>
        </div>
      </div>

      {/* Add New Row button */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAddNewRow}
          className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Custom Row</span>
        </button>
      </div>
    </div>
  );
};
