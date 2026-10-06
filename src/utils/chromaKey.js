/**
 * Green / Blue screen key (same algorithm as server/main.py -> process_chroma_key).
 *
 * A pixel is removed ONLY when
 *   1. the screen channel (G for a green screen) clearly dominates R and B, AND
 *   2. its hue is close to the screen's hue.
 * So yellow, lime, teal, cyan, skin, white, black … are never removed.
 * (The old version used plain RGB distance from #00ff00, which also removed
 *  teal / lime / dark tones.)
 *
 * Size optimisation: small alpha noise is snapped to 0/255 and fully transparent
 * pixels are painted flat black so the encoder doesn't waste bits on hidden green.
 */

export function hexToRgb(hex) {
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * @param {ImageData} imageData
 * @param {Object} options
 * @param {string} options.keyColor   - '#00ff00'
 * @param {number} options.similarity - 0..1 tolerance
 * @param {number} options.smoothness - 0..1 edge softness
 * @param {number} options.spill      - 0..1 edge despill strength
 */
export function applyChromaKey(imageData, { keyColor = '#00ff00', similarity = 0.35, smoothness = 0.1, spill = 0.3 }) {
  const data = imageData.data;
  const len = data.length;
  const { r: kr, g: kg, b: kb } = hexToRgb(keyColor);

  let mainIdx, a1Idx, a2Idx, kOff;
  if (kg >= kr && kg >= kb) {          // green screen: hue offset from (B - R)
    mainIdx = 1; a1Idx = 0; a2Idx = 2;
    kOff = 60 * (kb - kr) / Math.max(kg - Math.min(kr, kb), 1);
  } else if (kb >= kr && kb >= kg) {   // blue screen: hue offset from (R - G)
    mainIdx = 2; a1Idx = 1; a2Idx = 0;
    kOff = 60 * (kr - kg) / Math.max(kb - Math.min(kr, kg), 1);
  } else {
    return applyDistanceKey(imageData, { kr, kg, kb, similarity, smoothness });
  }

  const dLo = 40 * (1 - similarity);
  const dHi = dLo + 10 + smoothness * 60;
  const dRange = dHi - dLo;
  const tol = 8 + similarity * 30;
  const feather = 6 + smoothness * 30;

  for (let i = 0; i < len; i += 4) {
    const main = data[i + mainIdx];
    const a1 = data[i + a1Idx];
    const a2 = data[i + a2Idx];
    const otherMax = a1 > a2 ? a1 : a2;
    const dom = main - otherMax;
    if (dom <= 0) continue;                         // not screen-coloured -> keep as is

    let domF = (dom - dLo) / dRange;
    if (domF <= 0) continue;
    if (domF > 1) domF = 1;

    const otherMin = a1 < a2 ? a1 : a2;
    const off = 60 * (a2 - a1) / Math.max(main - otherMin, 1);
    let hueF = 1 - (Math.abs(off - kOff) - tol) / feather;
    if (hueF <= 0) continue;
    if (hueF > 1) hueF = 1;

    let alpha = 1 - domF * hueF;
    if (alpha < 0.06) alpha = 0;
    else if (alpha > 0.94) alpha = 1;

    if (alpha === 0) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
      continue;
    }
    if (alpha < 1 && spill > 0) {
      data[i + mainIdx] = (otherMax + (1 - spill) * dom) | 0;
    }
    data[i + 3] = (data[i + 3] * alpha) | 0;
  }
  return imageData;
}

/** Fallback for key colours that are neither green nor blue. */
function applyDistanceKey(imageData, { kr, kg, kb, similarity, smoothness }) {
  const data = imageData.data;
  const thresh = Math.max(0.03, similarity * 0.5);
  const featherEnd = thresh + Math.max(0.01, smoothness);
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - kr, dg = data[i + 1] - kg, db = data[i + 2] - kb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
    let alpha = (d - thresh) / (featherEnd - thresh);
    if (alpha < 0.06) alpha = 0; else if (alpha > 0.94) alpha = 1;
    if (alpha === 0) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; }
    else if (alpha < 1) data[i + 3] = (data[i + 3] * alpha) | 0;
  }
  return imageData;
}
