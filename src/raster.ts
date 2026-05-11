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
