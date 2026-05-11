import type { FitRect, ManualTransform, RasterInput, RasterResult } from './types';

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

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function loadSvgImage(svgString: string): Promise<HTMLImageElement> {
  const dataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svgString)}`;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

export async function rasterize(input: RasterInput): Promise<RasterResult> {
  const { svgString, svgWidth, svgHeight, labelDotsW, labelDotsH, threshold, manual } = input;
  const img = await loadSvgImage(svgString);

  const canvas = new OffscreenCanvas(labelDotsW, labelDotsH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, labelDotsW, labelDotsH);
  ctx.imageSmoothingEnabled = false;

  if (manual) {
    // Manual transform: user-controlled scale + offset + rotation.
    const effW = manual.rotate ? svgHeight : svgWidth;
    const effH = manual.rotate ? svgWidth : svgHeight;
    const drawW = manual.width * labelDotsW;
    const drawH = drawW * (effH / effW);
    const dx = manual.x * labelDotsW;
    const dy = manual.y * labelDotsH;

    if (manual.rotate) {
      ctx.save();
      ctx.translate(dx + drawW, dy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, drawH, drawW);
      ctx.restore();
    } else {
      ctx.drawImage(img, dx, dy, drawW, drawH);
    }
  } else {
    // Auto-fit: rotate (if orientations differ) + scale to fit + center.
    const fit = computeFitRect(svgWidth, svgHeight, labelDotsW, labelDotsH);
    if (fit.rotate) {
      ctx.save();
      ctx.translate(labelDotsW, 0);
      ctx.rotate(Math.PI / 2);
      // In the rotated frame, local x maps to physical y, local y maps to physical -x.
      // To place a centred drawW x drawH rect in physical space, in local coords that's
      // origin (dy, dx) with extents (drawH, drawW).
      ctx.drawImage(img, fit.dy, fit.dx, fit.drawH, fit.drawW);
      ctx.restore();
    } else {
      ctx.drawImage(img, fit.dx, fit.dy, fit.drawW, fit.drawH);
    }
  }

  const imageData = ctx.getImageData(0, 0, labelDotsW, labelDotsH);
  const packed = packPixelsToBitmap(imageData.data, labelDotsW, labelDotsH, threshold);

  const previewBlob = await canvas.convertToBlob({ type: 'image/png' });
  const previewDataUrl = await blobToDataUrl(previewBlob);

  return {
    bits: packed.bits,
    widthBytes: packed.widthBytes,
    height: packed.height,
    previewDataUrl,
  };
}

// Compute the manual-transform default by mapping the auto-fit result to normalised
// coords. Used when the user first toggles auto-fit off — gives them a sensible
// starting frame they can adjust from.
export function manualDefaultsFromAutoFit(
  svgW: number,
  svgH: number,
  labelDotsW: number,
  labelDotsH: number,
): ManualTransform {
  const fit = computeFitRect(svgW, svgH, labelDotsW, labelDotsH);
  return {
    rotate: fit.rotate,
    x: fit.dx / labelDotsW,
    y: fit.dy / labelDotsH,
    width: fit.drawW / labelDotsW,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
    fr.readAsDataURL(blob);
  });
}
