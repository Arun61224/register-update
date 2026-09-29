import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Crop, RotateCw, Check, X, Undo, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageCropperModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onApplyCrop: (croppedImageBase64: string) => void;
}

interface CropBox {
  x: number; // percentage 0 - 100
  y: number; // percentage 0 - 100
  width: number; // percentage 0 - 100
  height: number; // percentage 0 - 100
}

const DEFAULT_CROP: CropBox = {
  x: 5,
  y: 5,
  width: 90,
  height: 90,
};

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onApplyCrop,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [cropBox, setCropBox] = useState<CropBox>(DEFAULT_CROP);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragAction, setDragAction] = useState<string | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; box: CropBox } | null>(null);

  // Reset state when a new image is provided
  useEffect(() => {
    if (isOpen) {
      setCropBox(DEFAULT_CROP);
      setRotation(0);
    }
  }, [isOpen, imageSrc]);

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setCropBox(DEFAULT_CROP);
  };

  const handleResetCrop = () => {
    setCropBox(DEFAULT_CROP);
  };

  // Section Quadrant Presets
  const setQuadrant = (quadrant: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'full') => {
    switch (quadrant) {
      case 'top-left':
        setCropBox({ x: 2, y: 2, width: 47, height: 47 });
        break;
      case 'top-right':
        setCropBox({ x: 51, y: 2, width: 47, height: 47 });
        break;
      case 'bottom-left':
        setCropBox({ x: 2, y: 51, width: 47, height: 47 });
        break;
      case 'bottom-right':
        setCropBox({ x: 51, y: 51, width: 47, height: 47 });
        break;
      case 'full':
        setCropBox(DEFAULT_CROP);
        break;
    }
  };

  // Pointer drag start
  const handlePointerDown = (action: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    setIsDragging(true);
    setDragAction(action);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  // Pointer drag move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !dragStartRef.current || !imageRef.current) return;

      const rect = imageRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const deltaXPercent = ((e.clientX - dragStartRef.current.mouseX) / rect.width) * 100;
      const deltaYPercent = ((e.clientY - dragStartRef.current.mouseY) / rect.height) * 100;

      const orig = dragStartRef.current.box;
      const MIN_SIZE = 10; // minimum 10% width/height

      let newBox = { ...orig };

      if (dragAction === 'move') {
        let newX = orig.x + deltaXPercent;
        let newY = orig.y + deltaYPercent;
        newX = Math.max(0, Math.min(100 - orig.width, newX));
        newY = Math.max(0, Math.min(100 - orig.height, newY));
        newBox.x = newX;
        newBox.y = newY;
      } else if (dragAction === 'nw') {
        const newX = Math.max(0, Math.min(orig.x + orig.width - MIN_SIZE, orig.x + deltaXPercent));
        const newY = Math.max(0, Math.min(orig.y + orig.height - MIN_SIZE, orig.y + deltaYPercent));
        newBox.width = orig.width + (orig.x - newX);
        newBox.height = orig.height + (orig.y - newY);
        newBox.x = newX;
        newBox.y = newY;
      } else if (dragAction === 'ne') {
        const newY = Math.max(0, Math.min(orig.y + orig.height - MIN_SIZE, orig.y + deltaYPercent));
        const newWidth = Math.max(MIN_SIZE, Math.min(100 - orig.x, orig.width + deltaXPercent));
        newBox.y = newY;
        newBox.height = orig.height + (orig.y - newY);
        newBox.width = newWidth;
      } else if (dragAction === 'sw') {
        const newX = Math.max(0, Math.min(orig.x + orig.width - MIN_SIZE, orig.x + deltaXPercent));
        const newHeight = Math.max(MIN_SIZE, Math.min(100 - orig.y, orig.height + deltaYPercent));
        newBox.x = newX;
        newBox.width = orig.width + (orig.x - newX);
        newBox.height = newHeight;
      } else if (dragAction === 'se') {
        const newWidth = Math.max(MIN_SIZE, Math.min(100 - orig.x, orig.width + deltaXPercent));
        const newHeight = Math.max(MIN_SIZE, Math.min(100 - orig.y, orig.height + deltaYPercent));
        newBox.width = newWidth;
        newBox.height = newHeight;
      } else if (dragAction === 'n') {
        const newY = Math.max(0, Math.min(orig.y + orig.height - MIN_SIZE, orig.y + deltaYPercent));
        newBox.height = orig.height + (orig.y - newY);
        newBox.y = newY;
      } else if (dragAction === 's') {
        newBox.height = Math.max(MIN_SIZE, Math.min(100 - orig.y, orig.height + deltaYPercent));
      } else if (dragAction === 'w') {
        const newX = Math.max(0, Math.min(orig.x + orig.width - MIN_SIZE, orig.x + deltaXPercent));
        newBox.width = orig.width + (orig.x - newX);
        newBox.x = newX;
      } else if (dragAction === 'e') {
        newBox.width = Math.max(MIN_SIZE, Math.min(100 - orig.x, orig.width + deltaXPercent));
      }

      setCropBox(newBox);
    },
    [isDragging, dragAction]
  );

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      setDragAction(null);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Perform canvas crop
  const handleConfirmCrop = () => {
    if (!imageSrc) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Step 1: Create rotation canvas
      const rotCanvas = document.createElement('canvas');
      const isQuarterTurn = rotation === 90 || rotation === 270;
      rotCanvas.width = isQuarterTurn ? img.height : img.width;
      rotCanvas.height = isQuarterTurn ? img.width : img.height;

      const rotCtx = rotCanvas.getContext('2d');
      if (!rotCtx) return;

      rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      rotCtx.rotate((rotation * Math.PI) / 180);
      rotCtx.drawImage(img, -img.width / 2, -img.height / 2);

      // Step 2: Crop according to cropBox
      const sourceW = rotCanvas.width;
      const sourceH = rotCanvas.height;

      const cropPxX = Math.round((cropBox.x / 100) * sourceW);
      const cropPxY = Math.round((cropBox.y / 100) * sourceH);
      const cropPxW = Math.round((cropBox.width / 100) * sourceW);
      const cropPxH = Math.round((cropBox.height / 100) * sourceH);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.max(1, cropPxW);
      cropCanvas.height = Math.max(1, cropPxH);

      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) return;

      cropCtx.drawImage(
        rotCanvas,
        cropPxX,
        cropPxY,
        cropPxW,
        cropPxH,
        0,
        0,
        cropPxW,
        cropPxH
      );

      const croppedDataUrl = cropCanvas.toDataURL('image/jpeg', 0.94);
      onApplyCrop(croppedDataUrl);
      onClose();
    };
    img.src = imageSrc;
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-4">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm sm:text-base">Crop Slip Image</h3>
              <p className="text-xs text-slate-400">
                Drag corners or select a quadrant to crop specific sections or clean borders
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Rotation & Quadrant Shortcuts */}
        <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 text-[11px] font-medium mr-1">Quadrants:</span>
            <button
              type="button"
              onClick={() => setQuadrant('full')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] transition cursor-pointer border border-slate-700"
            >
              Full Slip
            </button>
            <button
              type="button"
              onClick={() => setQuadrant('top-left')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] transition cursor-pointer border border-slate-700"
            >
              Sec 1 (Top-L)
            </button>
            <button
              type="button"
              onClick={() => setQuadrant('top-right')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] transition cursor-pointer border border-slate-700"
            >
              Sec 2 (Top-R)
            </button>
            <button
              type="button"
              onClick={() => setQuadrant('bottom-left')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] transition cursor-pointer border border-slate-700"
            >
              Sec 3 (Btm-L)
            </button>
            <button
              type="button"
              onClick={() => setQuadrant('bottom-right')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] transition cursor-pointer border border-slate-700"
            >
              Sec 4 (Btm-R)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRotate}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px] flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
              title="Rotate image 90 degrees clockwise"
            >
              <RotateCw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Rotate 90° {rotation > 0 && `(${rotation}°)`}</span>
            </button>

            <button
              type="button"
              onClick={handleResetCrop}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium text-[11px] flex items-center gap-1 transition cursor-pointer border border-slate-700"
              title="Reset crop selection to default"
            >
              <Undo className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Crop Viewport */}
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative flex-1 bg-black flex items-center justify-center min-h-[380px] max-h-[58vh] overflow-hidden select-none p-4"
        >
          {/* Target Image with Rotation */}
          <div className="relative inline-block max-h-full max-w-full">
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Slip to Crop"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease',
              }}
              className="max-h-[52vh] max-w-full object-contain pointer-events-none rounded shadow"
            />

            {/* Dark Mask Outside Crop Box */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${cropBox.x}% ${cropBox.y}%,
                  ${cropBox.x}% ${cropBox.y + cropBox.height}%,
                  ${cropBox.x + cropBox.width}% ${cropBox.y + cropBox.height}%,
                  ${cropBox.x + cropBox.width}% ${cropBox.y}%,
                  ${cropBox.x}% ${cropBox.y}%
                )`,
              }}
            />

            {/* Interactive Crop Box Overlay */}
            <div
              style={{
                left: `${cropBox.x}%`,
                top: `${cropBox.y}%`,
                width: `${cropBox.width}%`,
                height: `${cropBox.height}%`,
              }}
              className="absolute border-2 border-emerald-400 bg-emerald-500/10 cursor-move touch-none"
              onPointerDown={(e) => handlePointerDown('move', e)}
            >
              {/* Rule of Thirds Grid Lines */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="w-full h-full grid grid-cols-3 grid-rows-3">
                  <div className="border-r border-b border-emerald-400/25"></div>
                  <div className="border-r border-b border-emerald-400/25"></div>
                  <div className="border-b border-emerald-400/25"></div>
                  <div className="border-r border-b border-emerald-400/25"></div>
                  <div className="border-r border-b border-emerald-400/25"></div>
                  <div className="border-b border-emerald-400/25"></div>
                  <div className="border-r border-emerald-400/25"></div>
                  <div className="border-r border-emerald-400/25"></div>
                  <div></div>
                </div>
              </div>

              {/* Corner Handles */}
              {/* NW */}
              <div
                onPointerDown={(e) => handlePointerDown('nw', e)}
                className="absolute -top-2 -left-2 w-4 h-4 bg-emerald-400 rounded-sm shadow-md cursor-nwse-resize border-2 border-slate-900"
              />
              {/* NE */}
              <div
                onPointerDown={(e) => handlePointerDown('ne', e)}
                className="absolute -top-2 -right-2 w-4 h-4 bg-emerald-400 rounded-sm shadow-md cursor-nesw-resize border-2 border-slate-900"
              />
              {/* SW */}
              <div
                onPointerDown={(e) => handlePointerDown('sw', e)}
                className="absolute -bottom-2 -left-2 w-4 h-4 bg-emerald-400 rounded-sm shadow-md cursor-nesw-resize border-2 border-slate-900"
              />
              {/* SE */}
              <div
                onPointerDown={(e) => handlePointerDown('se', e)}
                className="absolute -bottom-2 -right-2 w-4 h-4 bg-emerald-400 rounded-sm shadow-md cursor-nwse-resize border-2 border-slate-900"
              />

              {/* Edge Handles */}
              {/* North */}
              <div
                onPointerDown={(e) => handlePointerDown('n', e)}
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-emerald-400 rounded shadow cursor-ns-resize border border-slate-900"
              />
              {/* South */}
              <div
                onPointerDown={(e) => handlePointerDown('s', e)}
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-emerald-400 rounded shadow cursor-ns-resize border border-slate-900"
              />
              {/* West */}
              <div
                onPointerDown={(e) => handlePointerDown('w', e)}
                className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2.5 h-6 bg-emerald-400 rounded shadow cursor-ew-resize border border-slate-900"
              />
              {/* East */}
              <div
                onPointerDown={(e) => handlePointerDown('e', e)}
                className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2.5 h-6 bg-emerald-400 rounded shadow cursor-ew-resize border border-slate-900"
              />

              {/* Dimension label */}
              <div className="absolute top-1 left-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[10px] text-emerald-300 font-mono pointer-events-none">
                {Math.round(cropBox.width)}% × {Math.round(cropBox.height)}%
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Tip: Crop removes unwanted borders, shadows, or focuses on 1 section.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition border border-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmCrop}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-md shadow-emerald-900/40 transition active:scale-95 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Apply Crop</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
