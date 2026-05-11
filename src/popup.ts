import interact from 'interactjs';
import { captureSvg } from './capture';
import { manualDefaultsFromAutoFit, rasterize } from './raster';
import { buildTspl } from './tspl';
import { getCurrentPort, sendBytes } from './serial';
import { DEFAULTS, loadSettings, saveSettings } from './settings';
import type { CaptureResult, ManualTransform, Settings } from './types';

const DOTS_PER_MM = 8;
const PREVIEW_CSS_WIDTH = 320;
const MIN_MANUAL_WIDTH_FRAC = 0.05; // don't let the user shrink the SVG to nothing

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
};

const numericFields = {
  widthMm: $<HTMLInputElement>('widthMm'),
  heightMm: $<HTMLInputElement>('heightMm'),
  gapMm: $<HTMLInputElement>('gapMm'),
  density: $<HTMLInputElement>('density'),
  speed: $<HTMLInputElement>('speed'),
  baud: $<HTMLSelectElement>('baud'),
  threshold: $<HTMLInputElement>('threshold'),
  copies: $<HTMLInputElement>('copies'),
} as const;
const autoFitField = $<HTMLInputElement>('autoFit');

const statusEl = $('status');
const previewMsgEl = $('previewMsg');
const previewFrameEl = $('previewFrame');
const previewRasterEl = $<HTMLImageElement>('previewRaster');
const manualLayerEl = $('manualLayer');
const manualSvgEl = $<HTMLImageElement>('manualSvg');
const rotateBtn = $<HTMLButtonElement>('rotateBtn');
const connectBtn = $<HTMLButtonElement>('connect');
const changePortBtn = $<HTMLButtonElement>('changePort');
const printBtn = $<HTMLButtonElement>('print');

let port: SerialPort | null = null;
let saveTimer: number | undefined;
let previewTimer: number | undefined;
let cachedCapture: CaptureResult | null = null;
let previewSeq = 0;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setPreviewMsg(text: string, isError = false): void {
  previewMsgEl.textContent = text;
  previewMsgEl.classList.toggle('error', isError);
}

function populateForm(s: Settings): void {
  numericFields.widthMm.value = String(s.widthMm);
  numericFields.heightMm.value = String(s.heightMm);
  numericFields.gapMm.value = String(s.gapMm);
  numericFields.density.value = String(s.density);
  numericFields.speed.value = String(s.speed);
  numericFields.baud.value = String(s.baud);
  numericFields.threshold.value = String(s.threshold);
  numericFields.copies.value = String(s.copies);
  autoFitField.checked = s.autoFit;
}

function readForm(prev: Settings): Settings {
  const num = (k: keyof typeof numericFields) =>
    Number((numericFields[k] as HTMLInputElement | HTMLSelectElement).value);
  // Manual transform fields aren't directly user-edited via the form — they're
  // updated by interact.js handlers — so carry them through from prev.
  return {
    widthMm: num('widthMm'),
    heightMm: num('heightMm'),
    gapMm: num('gapMm'),
    density: num('density'),
    speed: num('speed'),
    baud: num('baud'),
    threshold: num('threshold'),
    copies: num('copies'),
    autoFit: autoFitField.checked,
    manualRotate: prev.manualRotate,
    manualX: prev.manualX,
    manualY: prev.manualY,
    manualWidth: prev.manualWidth,
  };
}

let currentSettings: Settings = { ...DEFAULTS };

// ---------- Capture ----------

async function captureFromActiveTab(): Promise<CaptureResult> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return { ok: false, error: 'No active tab' };
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureSvg,
    });
    const result = injection[0]?.result as CaptureResult | undefined;
    return result ?? { ok: false, error: 'Capture script returned no result' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------- Preview frame sizing ----------

function frameDims(): { w: number; h: number } {
  const w = PREVIEW_CSS_WIDTH;
  const aspect = currentSettings.heightMm / currentSettings.widthMm;
  const h = Math.max(40, w * aspect);
  return { w, h };
}

function applyFrameSize(): void {
  const { w, h } = frameDims();
  previewFrameEl.style.width = `${w}px`;
  previewFrameEl.style.height = `${h}px`;
}

// ---------- Manual layer (SVG with interact.js handles) ----------

function svgEffDims(): { effW: number; effH: number } {
  if (!cachedCapture || !cachedCapture.ok) return { effW: 1, effH: 1 };
  if (currentSettings.manualRotate) {
    return { effW: cachedCapture.svgHeight, effH: cachedCapture.svgWidth };
  }
  return { effW: cachedCapture.svgWidth, effH: cachedCapture.svgHeight };
}

function manualHeightFrac(): number {
  // height fraction in label-height units, derived from current width fraction
  // and SVG effective aspect ratio.
  const { effW, effH } = svgEffDims();
  const aspect = effH / effW;
  // width-in-label-dots = manualWidth * labelDotsW
  // height-in-label-dots = width-in-label-dots * aspect
  // labelDotsH cancels label dimensions cleanly when normalised:
  const labelAspect = currentSettings.heightMm / currentSettings.widthMm;
  return (currentSettings.manualWidth * aspect) / labelAspect;
}

function applyManualLayoutFromSettings(): void {
  if (!cachedCapture || !cachedCapture.ok) return;
  const { w, h } = frameDims();
  const wCss = currentSettings.manualWidth * w;
  const hCss = manualHeightFrac() * h;
  const xCss = currentSettings.manualX * w;
  const yCss = currentSettings.manualY * h;
  manualSvgEl.style.width = `${wCss}px`;
  manualSvgEl.style.height = `${hCss}px`;
  manualSvgEl.style.left = `${xCss}px`;
  manualSvgEl.style.top = `${yCss}px`;
  manualSvgEl.style.transform = currentSettings.manualRotate ? 'rotate(90deg)' : 'none';
  manualSvgEl.style.transformOrigin = 'center center';
}

function updateManualSvgImage(): void {
  if (!cachedCapture || !cachedCapture.ok) return;
  const dataUrl = svgStringToDataUrl(cachedCapture.svgString);
  manualSvgEl.src = dataUrl;
}

function svgStringToDataUrl(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

let interactInstalled = false;
function installInteractHandlers(): void {
  if (interactInstalled) return;
  interactInstalled = true;
  interact(manualSvgEl)
    .draggable({
      listeners: {
        move(event) {
          const { w, h } = frameDims();
          const newLeft = manualSvgEl.offsetLeft + event.dx;
          const newTop = manualSvgEl.offsetTop + event.dy;
          manualSvgEl.style.left = `${newLeft}px`;
          manualSvgEl.style.top = `${newTop}px`;
          currentSettings.manualX = newLeft / w;
          currentSettings.manualY = newTop / h;
          scheduleSave();
          schedulePreview();
        },
      },
    })
    .resizable({
      edges: { left: true, right: true, top: true, bottom: true },
      modifiers: [
        interact.modifiers.aspectRatio({
          ratio: 'preserve',
        }),
        interact.modifiers.restrictSize({
          min: { width: PREVIEW_CSS_WIDTH * MIN_MANUAL_WIDTH_FRAC, height: 10 },
        }),
      ],
      listeners: {
        move(event) {
          const { w, h } = frameDims();
          const newWidth = event.rect.width;
          const newHeight = event.rect.height;
          const newLeft = manualSvgEl.offsetLeft + event.deltaRect.left;
          const newTop = manualSvgEl.offsetTop + event.deltaRect.top;
          manualSvgEl.style.width = `${newWidth}px`;
          manualSvgEl.style.height = `${newHeight}px`;
          manualSvgEl.style.left = `${newLeft}px`;
          manualSvgEl.style.top = `${newTop}px`;
          currentSettings.manualWidth = newWidth / w;
          currentSettings.manualX = newLeft / w;
          currentSettings.manualY = newTop / h;
          scheduleSave();
          schedulePreview();
        },
      },
    });
}

function setManualMode(enabled: boolean): void {
  manualLayerEl.hidden = !enabled;
  rotateBtn.hidden = !enabled;
  previewFrameEl.classList.toggle('manual', enabled);
  if (enabled) {
    updateManualSvgImage();
    installInteractHandlers();
    applyManualLayoutFromSettings();
  }
}

// ---------- Background rasterise (for preview-raster img) ----------

function currentManualTransform(): ManualTransform {
  return {
    rotate: currentSettings.manualRotate,
    x: currentSettings.manualX,
    y: currentSettings.manualY,
    width: currentSettings.manualWidth,
  };
}

async function refreshPreview(): Promise<void> {
  const seq = ++previewSeq;
  if (!cachedCapture || !cachedCapture.ok) {
    cachedCapture = await captureFromActiveTab();
    if (seq !== previewSeq) return;
    if (cachedCapture.ok) updateManualSvgImage();
  }

  if (!cachedCapture.ok) {
    previewRasterEl.removeAttribute('src');
    setPreviewMsg(cachedCapture.error, true);
    return;
  }

  const labelDotsW = Math.round(currentSettings.widthMm * DOTS_PER_MM);
  const labelDotsH = Math.round(currentSettings.heightMm * DOTS_PER_MM);
  if (!labelDotsW || !labelDotsH) {
    setPreviewMsg('Enter valid label width and height.', true);
    return;
  }

  try {
    const raster = await rasterize({
      svgString: cachedCapture.svgString,
      svgWidth: cachedCapture.svgWidth,
      svgHeight: cachedCapture.svgHeight,
      labelDotsW,
      labelDotsH,
      threshold: currentSettings.threshold,
      manual: currentSettings.autoFit ? undefined : currentManualTransform(),
    });
    if (seq !== previewSeq) return;
    previewRasterEl.src = raster.previewDataUrl;
    setPreviewMsg(
      `Preview: ${cachedCapture.svgWidth}x${cachedCapture.svgHeight} → ${labelDotsW}x${labelDotsH} dots${currentSettings.autoFit ? ' (auto-fit)' : ' (manual)'}`,
    );
  } catch (e) {
    if (seq !== previewSeq) return;
    setPreviewMsg(`Rasterise failed: ${(e as Error).message}`, true);
  }
}

// ---------- Persistence ----------

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveSettings(currentSettings).catch((e) => console.error('saveSettings failed', e));
  }, 200);
}

function schedulePreview(): void {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    refreshPreview().catch((e) => console.error('refreshPreview failed', e));
  }, 150);
}

// ---------- Form / mode handlers ----------

function onFormChange(): void {
  currentSettings = readForm(currentSettings);
  applyFrameSize();
  if (!currentSettings.autoFit) applyManualLayoutFromSettings();
  scheduleSave();
  schedulePreview();
}

function onAutoFitToggle(): void {
  const becameManual = !autoFitField.checked && currentSettings.autoFit;
  currentSettings.autoFit = autoFitField.checked;

  if (becameManual && cachedCapture && cachedCapture.ok) {
    // First-time-off this session: if the user hasn't established a manual frame yet
    // (defaults all 0 / width 1 left from DEFAULTS or previous full-fit), seed it
    // from the auto-fit result so the SVG starts in a sane place to drag from.
    const looksLikeDefault =
      currentSettings.manualWidth === DEFAULTS.manualWidth &&
      currentSettings.manualX === DEFAULTS.manualX &&
      currentSettings.manualY === DEFAULTS.manualY &&
      currentSettings.manualRotate === DEFAULTS.manualRotate;
    if (looksLikeDefault) {
      const labelDotsW = Math.round(currentSettings.widthMm * DOTS_PER_MM);
      const labelDotsH = Math.round(currentSettings.heightMm * DOTS_PER_MM);
      const seed = manualDefaultsFromAutoFit(
        cachedCapture.svgWidth,
        cachedCapture.svgHeight,
        labelDotsW,
        labelDotsH,
      );
      currentSettings.manualRotate = seed.rotate;
      currentSettings.manualX = seed.x;
      currentSettings.manualY = seed.y;
      currentSettings.manualWidth = seed.width;
    }
  }

  setManualMode(!currentSettings.autoFit);
  scheduleSave();
  schedulePreview();
}

function onRotateClick(): void {
  currentSettings.manualRotate = !currentSettings.manualRotate;
  applyManualLayoutFromSettings();
  scheduleSave();
  schedulePreview();
}

// ---------- Port / print ----------

async function refreshPortState(): Promise<void> {
  port = await getCurrentPort();
  if (port) {
    connectBtn.hidden = true;
    changePortBtn.hidden = false;
    printBtn.disabled = false;
    setStatus('Printer connected. Ready.');
  } else {
    connectBtn.hidden = false;
    changePortBtn.hidden = true;
    printBtn.disabled = true;
    setStatus('Click "Connect printer" to choose a COM port.');
  }
}

async function onConnect(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('connect.html') });
  } catch (e) {
    setStatus(`Could not open connect tab: ${(e as Error).message}`, true);
    console.error(e);
  }
}

async function onPrint(): Promise<void> {
  if (!port) {
    setStatus('No printer connected', true);
    return;
  }
  printBtn.disabled = true;
  await saveSettings(currentSettings);

  try {
    if (!cachedCapture || !cachedCapture.ok) {
      setStatus('Capturing SVG…');
      cachedCapture = await captureFromActiveTab();
      if (!cachedCapture.ok) throw new Error(cachedCapture.error);
    }

    const labelDotsW = Math.round(currentSettings.widthMm * DOTS_PER_MM);
    const labelDotsH = Math.round(currentSettings.heightMm * DOTS_PER_MM);

    setStatus(`Rasterising ${cachedCapture.svgWidth}x${cachedCapture.svgHeight} -> ${labelDotsW}x${labelDotsH}…`);
    const raster = await rasterize({
      svgString: cachedCapture.svgString,
      svgWidth: cachedCapture.svgWidth,
      svgHeight: cachedCapture.svgHeight,
      labelDotsW,
      labelDotsH,
      threshold: currentSettings.threshold,
      manual: currentSettings.autoFit ? undefined : currentManualTransform(),
    });
    previewRasterEl.src = raster.previewDataUrl;

    const bytes = buildTspl(raster, {
      widthMm: currentSettings.widthMm,
      heightMm: currentSettings.heightMm,
      gapMm: currentSettings.gapMm,
      density: currentSettings.density,
      speed: currentSettings.speed,
      copies: currentSettings.copies,
    });

    setStatus(`Sending ${bytes.length} bytes to printer…`);
    await sendBytes(port, currentSettings.baud, bytes);
    setStatus(`Sent ${bytes.length} bytes. Done.`);
  } catch (e) {
    setStatus((e as Error).message, true);
    console.error(e);
  } finally {
    printBtn.disabled = false;
  }
}

// ---------- Init ----------

async function init(): Promise<void> {
  currentSettings = await loadSettings().catch(() => DEFAULTS);
  populateForm(currentSettings);
  applyFrameSize();

  for (const el of Object.values(numericFields)) {
    el.addEventListener('change', onFormChange);
    el.addEventListener('input', onFormChange);
  }
  autoFitField.addEventListener('change', onAutoFitToggle);
  rotateBtn.addEventListener('click', onRotateClick);
  connectBtn.addEventListener('click', onConnect);
  changePortBtn.addEventListener('click', onConnect);
  printBtn.addEventListener('click', onPrint);

  await refreshPortState();

  setPreviewMsg('Loading preview…');
  await refreshPreview();
  setManualMode(!currentSettings.autoFit);
}

init().catch((e) => {
  setStatus(`Init failed: ${(e as Error).message}`, true);
  console.error(e);
});
