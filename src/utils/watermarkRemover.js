/**
 * Watermark & Logo Removal processing module for Canvas context.
 * Supports multiple ROI boxes with Blur, Pixelate, and Inpaint Fill modes,
 * plus edge cropping.
 */

/**
 * Apply watermark removal filters to a 2D rendering canvas context
 * @param {CanvasRenderingContext2D} ctx 
 * @param {HTMLCanvasElement} canvas 
 * @param {Array<{id: string, x: number, y: number, w: number, h: number, mode: string, blurRadius: number, pixelSize: number}>} regions 
 */
export function applyWatermarkRemoval(ctx, canvas, regions = []) {
  if (!regions || regions.length === 0) return;

  regions.forEach(region => {
    const { x, y, w, h, mode = 'blur', blurRadius = 15, pixelSize = 10 } = region;
    if (w <= 0 || h <= 0) return;

    // Constrain bounds to canvas dimensions
    const rx = Math.max(0, Math.min(canvas.width, x));
    const ry = Math.max(0, Math.min(canvas.height, y));
    const rw = Math.min(canvas.width - rx, w);
    const rh = Math.min(canvas.height - ry, h);

    if (rw <= 0 || rh <= 0) return;

    ctx.save();

    if (mode === 'blur') {
      // Gaussian Blur using SVG filter or Canvas filter
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.filter = `blur(${blurRadius}px)`;
      ctx.drawImage(canvas, 0, 0);
    } else if (mode === 'pixelate') {
      // Pixelate / Mosaic effect
      const block = Math.max(2, pixelSize);
      const smallW = Math.ceil(rw / block);
      const smallH = Math.ceil(rh / block);

      // Offscreen canvas for downscaling & upscaling
      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.max(1, smallW);
      offCanvas.height = Math.max(1, smallH);
      const offCtx = offCanvas.getContext('2d');

      offCtx.imageSmoothingEnabled = false;
      offCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, smallW, smallH);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offCanvas, 0, 0, smallW, smallH, rx, ry, rw, rh);
    } else if (mode === 'inpaint' || mode === 'patch') {
      // Smart non-destructive Telea-style texture inpainting
      // Samples border colors and isolates watermark text contrast to preserve underlying object
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      const data = imgData.data;
      const totalPixels = rw * rh;
      
      // Calculate mean luminance inside ROI
      let sumLum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const avgLum = sumLum / totalPixels;

      // Sample border pixels around the ROI for texture background fill
      const sampleMargin = 4;
      const srcX = Math.max(0, rx - sampleMargin);
      const srcY = Math.max(0, ry - sampleMargin);
      const srcW = Math.min(canvas.width - srcX, rw + sampleMargin * 2);
      const srcH = Math.min(canvas.height - srcY, rh + sampleMargin * 2);

      // Create temporary blended background patch
      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = rw;
      patchCanvas.height = rh;
      const patchCtx = patchCanvas.getContext('2d');
      patchCtx.filter = `blur(${Math.max(8, blurRadius)}px)`;
      patchCtx.drawImage(canvas, srcX, srcY, srcW, srcH, -sampleMargin, -sampleMargin, rw + sampleMargin * 2, rh + sampleMargin * 2);
      
      const patchData = patchCtx.getImageData(0, 0, rw, rh).data;

      // Selective alpha blend: replace ONLY high-contrast text/watermark pixels
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const diff = Math.abs(lum - avgLum);
        
        // If pixel is part of text/watermark contrast, blend seamlessly with patch background
        if (diff > 12) {
          const factor = Math.min(1.0, (diff - 12) / 25);
          data[i] = Math.round(data[i] * (1 - factor) + patchData[i] * factor);
          data[i + 1] = Math.round(data[i + 1] * (1 - factor) + patchData[i + 1] * factor);
          data[i + 2] = Math.round(data[i + 2] * (1 - factor) + patchData[i + 2] * factor);
        }
      }

      ctx.putImageData(imgData, rx, ry);
    }

    ctx.restore();
  });
}

/**
 * Apply margin cropping to final canvas
 * @param {HTMLCanvasElement} sourceCanvas 
 * @param {Object} crop - { top: number, bottom: number, left: number, right: number } (percentages 0..50)
 * @returns {HTMLCanvasElement} cropped canvas
 */
export function createCroppedCanvas(sourceCanvas, crop = { top: 0, bottom: 0, left: 0, right: 0 }) {
  const { top = 0, bottom = 0, left = 0, right = 0 } = crop;
  
  if (top === 0 && bottom === 0 && left === 0 && right === 0) {
    return sourceCanvas;
  }

  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;

  const cropX = Math.round((left / 100) * origW);
  const cropY = Math.round((top / 100) * origH);
  const cropW = Math.max(1, origW - cropX - Math.round((right / 100) * origW));
  const cropH = Math.max(1, origH - cropY - Math.round((bottom / 100) * origH));

  const destCanvas = document.createElement('canvas');
  destCanvas.width = cropW;
  destCanvas.height = cropH;

  const destCtx = destCanvas.getContext('2d');
  destCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return destCanvas;
}
