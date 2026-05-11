import type { CaptureResult } from './types';

// IMPORTANT: This function runs in the active tab via chrome.scripting.executeScript.
// It MUST be self-contained — no imports, no closures over popup-side variables.
// The CaptureResult import above is type-only and stripped at compile time.
export function captureSvg(): CaptureResult {
  const svg = document.querySelector('svg.label-body');
  if (!svg) return { ok: false, error: 'No svg.label-body found on this page' };

  const vbAttr = svg.getAttribute('viewBox');
  let svgWidth = 0;
  let svgHeight = 0;
  if (vbAttr) {
    const parts = vbAttr.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      svgWidth = parts[2];
      svgHeight = parts[3];
    }
  }
  if (!svgWidth || !svgHeight) {
    const w = Number(svg.getAttribute('width'));
    const h = Number(svg.getAttribute('height'));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svgWidth = w;
      svgHeight = h;
    }
  }
  if (!svgWidth || !svgHeight) {
    const r = svg.getBoundingClientRect();
    svgWidth = r.width;
    svgHeight = r.height;
  }
  if (!svgWidth || !svgHeight) {
    return { ok: false, error: 'svg.label-body has no resolvable size' };
  }

  return { ok: true, svgString: svg.outerHTML, svgWidth, svgHeight };
}
