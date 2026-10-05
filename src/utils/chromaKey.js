/**
 * High-Performance Chroma Key (Color Removal) Algorithm
 * Accurately isolates background color and creates clean transparent alpha channel.
 */

export function hexToRgb(hex) {
  const cleanHex = hex.replace('#', '');
  const bigint = parseInt(cleanHex, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: 255 & bigint
  };
}

/**
 * Apply Chroma Key transparency to ImageData in-place
 * @param {ImageData} imageData 
 * @param {Object} options
 * @param {string} options.keyColor - Hex color string '#00ff00'
 * @param {number} options.similarity - 0 to 1 (tolerance)
 * @param {number} options.smoothness - 0 to 1 (edge softness)
 * @param {number} options.spill - 0 to 1 (spill suppression strength)
 */
export function applyChromaKey(imageData, { keyColor = '#00ff00', similarity = 0.35, smoothness = 0.1, spill = 0.3 }) {
  const data = imageData.data;
  const len = data.length;
  const target = hexToRgb(keyColor);

  const tR = target.r;
  const tG = target.g;
  const tB = target.b;

  // Maximum distance squared in 0..255 space is 3 * 255 * 255 = 195075
  const maxDistSq = 195075;
  const simThresholdSq = Math.max(1, (similarity * 0.75) ** 2 * maxDistSq);
  const smoothRangeSq = Math.max(1, ((similarity + smoothness) * 0.75) ** 2 * maxDistSq);

  const isGreenTarget = tG > tR && tG > tB;
  const isBlueTarget = tB > tR && tB > tG;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const dr = r - tR;
    const dg = g - tG;
    const db = b - tB;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq < simThresholdSq) {
      data[i + 3] = 0; // Fully transparent alpha
    } else if (distSq < smoothRangeSq) {
      const alphaNorm = (distSq - simThresholdSq) / (smoothRangeSq - simThresholdSq);
      data[i + 3] = (data[i + 3] * alphaNorm) | 0;
    }

    // Spill suppression on subject edges
    if (spill > 0 && data[i + 3] > 0) {
      if (isGreenTarget) {
        const maxOther = r > b ? r : b;
        if (g > maxOther) {
          data[i + 1] = (maxOther + (1 - spill) * (g - maxOther)) | 0;
        }
      } else if (isBlueTarget) {
        const maxOther = r > g ? r : g;
        if (b > maxOther) {
          data[i + 2] = (maxOther + (1 - spill) * (b - maxOther)) | 0;
        }
      }
    }
  }

  return imageData;
}
