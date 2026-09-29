/**
 * Resizes and compresses image to ensure it is optimal for fast mobile upload,
 * rapid OCR processing, and high OCR recognition speed.
 * maxDimension: 1200px (sufficient for high-res handwriting, 40-50% faster upload and inference)
 * quality: 0.82
 */
export async function compressImageForUpload(
  input: string | File,
  maxDimension = 1200,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const processDataUrl = (dataUrl: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          resolve(dataUrl);
          return;
        }

        // Scale down if larger than maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // Fill white background in case of transparent PNG/HEIC
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };

      img.onerror = () => {
        // Fallback to original if compression fails
        resolve(dataUrl);
      };

      img.src = dataUrl;
    };

    if (typeof input === 'string') {
      processDataUrl(input);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) {
          processDataUrl(result);
        } else {
          reject(new Error('Failed to read image file.'));
        }
      };
      reader.onerror = () => reject(new Error('Error reading image file.'));
      reader.readAsDataURL(input);
    }
  });
}
