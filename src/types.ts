export interface Settings {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;   // 1-15
  speed: number;     // 1-10
  baud: number;
  threshold: number; // 0-255 luma cutoff
  copies: number;    // >= 1
  autoFit: boolean;  // true = auto rotate/scale/center; false = use manual transform
  manualRotate: boolean; // 90° rotation in manual mode
  manualX: number;   // normalised fraction of label width (may be <0 or >1 when cropping)
  manualY: number;   // normalised fraction of label height
  manualWidth: number;  // normalised — SVG effective width as fraction of label width
  manualHeight: number; // normalised — SVG effective height as fraction of label height
}

export interface ManualTransform {
  rotate: boolean;
  x: number;      // normalised, fraction of label width
  y: number;      // normalised, fraction of label height
  width: number;  // normalised, SVG effective width as fraction of label width
  height: number; // normalised, SVG effective height as fraction of label height
}

export type CaptureResult =
  | { ok: true; svgString: string; svgWidth: number; svgHeight: number }
  | { ok: false; error: string };

export interface RasterInput {
  svgString: string;
  svgWidth: number;
  svgHeight: number;
  labelDotsW: number;
  labelDotsH: number;
  threshold: number;
  manual?: ManualTransform; // when present, skip auto-fit and use this transform
}

export interface RasterResult {
  bits: Uint8Array;       // packed 1-bit, MSB-first, init 0xFF, cleared where black
  widthBytes: number;     // (labelDotsW + 7) >> 3
  height: number;         // labelDotsH
  previewDataUrl: string; // PNG of the rasterized bitmap, for UI preview
}

export interface FitRect {
  rotate: boolean;
  dx: number;
  dy: number;
  drawW: number;
  drawH: number;
  scale: number;
}

export interface PrintSettings {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;
  speed: number;
  copies: number;
}
