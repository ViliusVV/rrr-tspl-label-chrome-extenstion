import type { FitRect } from './types';

export function computeFitRect(
  svgW: number,
  svgH: number,
  labelDotsW: number,
  labelDotsH: number,
): FitRect {
  const svgIsLandscape = svgW > svgH;
  const labelIsLandscape = labelDotsW > labelDotsH;
  const rotate =
    svgW !== svgH &&
    labelDotsW !== labelDotsH &&
    svgIsLandscape !== labelIsLandscape;
  const effW = rotate ? svgH : svgW;
  const effH = rotate ? svgW : svgH;
  const scale = Math.min(labelDotsW / effW, labelDotsH / effH);
  const drawW = effW * scale;
  const drawH = effH * scale;
  const dx = (labelDotsW - drawW) / 2;
  const dy = (labelDotsH - drawH) / 2;
  return { rotate, dx, dy, drawW, drawH, scale };
}

export interface PackedBitmap {
  bits: Uint8Array;
  widthBytes: number;
  height: number;
}

export function packPixelsToBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): PackedBitmap {
  const widthBytes = (width + 7) >> 3;
  const bits = new Uint8Array(widthBytes * height).fill(0xff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      // Rec. 601 luma. Faster than sRGB-correct and good enough for binary thresholding.
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < threshold) {
        const byteIdx = y * widthBytes + (x >> 3);
        const bitMask = 0x80 >> (x & 7);
        bits[byteIdx] &= ~bitMask & 0xff;
      }
    }
  }
  return { bits, widthBytes, height };
}
