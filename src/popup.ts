import { captureSvg } from './capture';
import { rasterize } from './raster';
import { buildTspl } from './tspl';
import { getCurrentPort, sendBytes } from './serial';
import { DEFAULTS, loadSettings, saveSettings } from './settings';
import type { CaptureResult, RasterResult, Settings } from './types';

const DOTS_PER_MM = 8;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
};

const fields: Record<keyof Settings, HTMLInputElement | HTMLSelectElement> = {
  widthMm: $<HTMLInputElement>('widthMm'),
  heightMm: $<HTMLInputElement>('heightMm'),
  gapMm: $<HTMLInputElement>('gapMm'),
  density: $<HTMLInputElement>('density'),
  speed: $<HTMLInputElement>('speed'),
  baud: $<HTMLSelectElement>('baud'),
  threshold: $<HTMLInputElement>('threshold'),
  copies: $<HTMLInputElement>('copies'),
};

const statusEl = $('status');
const previewEl = $<HTMLImageElement>('preview');
const previewMsgEl = $('previewMsg');
const connectBtn = $<HTMLButtonElement>('connect');
const changePortBtn = $<HTMLButtonElement>('changePort');
const printBtn = $<HTMLButtonElement>('print');

let port: SerialPort | null = null;
let saveTimer: number | undefined;
let previewTimer: number | undefined;
let cachedCapture: CaptureResult | null = null;
let lastRaster: RasterResult | null = null;
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
  fields.widthMm.value = String(s.widthMm);
  fields.heightMm.value = String(s.heightMm);
  fields.gapMm.value = String(s.gapMm);
  fields.density.value = String(s.density);
  fields.speed.value = String(s.speed);
  fields.baud.value = String(s.baud);
  fields.threshold.value = String(s.threshold);
  fields.copies.value = String(s.copies);
}

function readForm(): Settings {
  const num = (k: keyof Settings) => Number((fields[k] as HTMLInputElement | HTMLSelectElement).value);
  return {
    widthMm: num('widthMm'),
    heightMm: num('heightMm'),
    gapMm: num('gapMm'),
    density: num('density'),
    speed: num('speed'),
    baud: num('baud'),
    threshold: num('threshold'),
    copies: num('copies'),
  };
}

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

async function refreshPreview(settings: Settings): Promise<void> {
  const seq = ++previewSeq;

  // Capture only if we don't already have a successful capture cached.
  if (!cachedCapture || !cachedCapture.ok) {
    cachedCapture = await captureFromActiveTab();
    if (seq !== previewSeq) return;
  }

  if (!cachedCapture.ok) {
    previewEl.removeAttribute('src');
    lastRaster = null;
    setPreviewMsg(cachedCapture.error, true);
    return;
  }

  const labelDotsW = Math.round(settings.widthMm * DOTS_PER_MM);
  const labelDotsH = Math.round(settings.heightMm * DOTS_PER_MM);
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
      threshold: settings.threshold,
    });
    if (seq !== previewSeq) return;
    lastRaster = raster;
    previewEl.src = raster.previewDataUrl;
    setPreviewMsg(
      `Preview: ${cachedCapture.svgWidth}x${cachedCapture.svgHeight} → ${labelDotsW}x${labelDotsH} dots`,
    );
  } catch (e) {
    if (seq !== previewSeq) return;
    setPreviewMsg(`Rasterise failed: ${(e as Error).message}`, true);
    lastRaster = null;
  }
}

function schedulePreview(): void {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    refreshPreview(readForm()).catch((e) => console.error('refreshPreview failed', e));
  }, 200);
}

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveSettings(readForm()).catch((e) => console.error('saveSettings failed', e));
  }, 200);
}

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
  // Web Serial picker can only be hosted from a real Chrome tab. The popup
  // dismisses on focus-loss when the tab opens; status updates here wouldn't
  // render anyway.
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
  const settings = readForm();
  await saveSettings(settings);

  try {
    // Use the already-captured + rasterised preview when it matches current settings.
    // For correctness, just re-rasterise fresh — settings may have changed since the
    // last preview tick. The capture is cheap (cached) and rasterise is ~50-100ms.
    if (!cachedCapture || !cachedCapture.ok) {
      setStatus('Capturing SVG…');
      cachedCapture = await captureFromActiveTab();
      if (!cachedCapture.ok) throw new Error(cachedCapture.error);
    }

    const labelDotsW = Math.round(settings.widthMm * DOTS_PER_MM);
    const labelDotsH = Math.round(settings.heightMm * DOTS_PER_MM);

    setStatus(`Rasterising ${cachedCapture.svgWidth}x${cachedCapture.svgHeight} -> ${labelDotsW}x${labelDotsH}…`);
    const raster = await rasterize({
      svgString: cachedCapture.svgString,
      svgWidth: cachedCapture.svgWidth,
      svgHeight: cachedCapture.svgHeight,
      labelDotsW,
      labelDotsH,
      threshold: settings.threshold,
    });
    lastRaster = raster;
    previewEl.src = raster.previewDataUrl;

    const bytes = buildTspl(raster, {
      widthMm: settings.widthMm,
      heightMm: settings.heightMm,
      gapMm: settings.gapMm,
      density: settings.density,
      speed: settings.speed,
      copies: settings.copies,
    });

    setStatus(`Sending ${bytes.length} bytes to printer…`);
    await sendBytes(port, settings.baud, bytes);
    setStatus(`Sent ${bytes.length} bytes. Done.`);
  } catch (e) {
    setStatus((e as Error).message, true);
    console.error(e);
  } finally {
    printBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  populateForm(await loadSettings().catch(() => DEFAULTS));
  for (const el of Object.values(fields)) {
    el.addEventListener('change', () => {
      scheduleSave();
      schedulePreview();
    });
    el.addEventListener('input', () => {
      scheduleSave();
      schedulePreview();
    });
  }
  connectBtn.addEventListener('click', onConnect);
  changePortBtn.addEventListener('click', onConnect);
  printBtn.addEventListener('click', onPrint);

  await refreshPortState();

  // Always-visible preview: kick off capture+rasterise on popup open.
  setPreviewMsg('Loading preview…');
  refreshPreview(readForm()).catch((e) => console.error('initial preview failed', e));
}

init().catch((e) => {
  setStatus(`Init failed: ${(e as Error).message}`, true);
  console.error(e);
});

// Silence unused-variable warnings for state we hold for future use (e.g., to
// avoid re-rasterising on Print when settings haven't changed since preview).
void lastRaster;
