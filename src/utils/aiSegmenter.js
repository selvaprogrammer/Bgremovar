/**
 * High-Performance Smart Background Segmentation & Deep AI Removal.
 * Combines fast 60 FPS distance matting and @imgly/background-removal deep neural model.
 */

import { removeBackground } from '@imgly/background-removal';

/**
 * Perform deep neural network background removal using @imgly/background-removal (ONNX ISNet model)
 * @param {HTMLCanvasElement | ImageBitmap | ImageData | Blob} imageSource 
 * @param {Object} options 
 * @returns {Promise<Blob>} Transparent PNG blob
 */
export async function removeBackgroundAI(imageSource, options = {}) {
  try {
    const blob = await removeBackground(imageSource, {
      model: 'medium', // 'small' or 'medium'
      output: { format: 'image/png', quality: 1.0 },
      progress: options.onProgress,
      ...options
    });
    return blob;
  } catch (error) {
    console.error("Deep AI background removal failed:", error);
    throw error;
  }
}

/**
 * Fast 60 FPS Smart Background Segmentation
 */
export function applySmartSegmentation(imageData, { threshold = 0.4, edgeFeather = 0.15, mode = 'auto', bgSampleColor = null }) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const totalPixels = width * height;

  if (totalPixels === 0) return imageData;

  let bgR = 255, bgG = 255, bgB = 255;
  if (bgSampleColor) {
    const bigint = parseInt(bgSampleColor.replace('#', ''), 16);
    bgR = (bigint >> 16) & 255;
    bgG = (bigint >> 8) & 255;
    bgB = 255 & bigint;
  } else {
    // Auto sample 4 corners
    const corners = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      (totalPixels - 1) * 4
    ];
    let sumR = 0, sumG = 0, sumB = 0;
    corners.forEach(idx => {
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
    });
    bgR = sumR / 4;
    bgG = sumG / 4;
    bgB = sumB / 4;
  }

  const threshSq = (Math.max(0.05, threshold) * 1.73205) ** 2 * (255 * 255);
  const featherSq = (Math.max(0.05, threshold + edgeFeather) * 1.73205) ** 2 * (255 * 255);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;

    const distSq = dr * dr + dg * dg + db * db;

    if (distSq < threshSq) {
      data[i + 3] = 0;
    } else if (distSq < featherSq) {
      const alphaNorm = (distSq - threshSq) / (featherSq - threshSq);
      data[i + 3] = (data[i + 3] * alphaNorm) | 0;
    }
  }

  return imageData;
}

