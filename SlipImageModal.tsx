import React, { useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

interface SlipImageModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  onClose: () => void;
  detectedBin?: string;
  detectedPrefix?: string;
}

export const SlipImageModal: React.FC<SlipImageModalProps> = ({
  isOpen,
  imageUrl,
  onClose,
  detectedBin,
  detectedPrefix,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[85vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-white text-sm">Original Handwritten Slip</span>
            {detectedPrefix && (
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                Prefix: {detectedPrefix}
              </span>
            )}
            {detectedBin && (
              <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-700/50">
                Bin No: [{detectedBin}]
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleZoomOut}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-slate-400 w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleRotate}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition"
              title="Rotate"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg ml-2 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 overflow-auto bg-slate-950 flex items-center justify-center p-4">
          <div
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transition: 'transform 0.15s ease-out',
            }}
            className="origin-center"
          >
            <img
              src={imageUrl}
              alt="Handwritten Slip Original"
              className="max-h-[70vh] max-w-full object-contain rounded shadow-lg border border-slate-800"
            />
          </div>
        </div>

        {/* Footer info */}
        <div className="px-5 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Tip: You can zoom and rotate the slip image to verify handwriting details.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
