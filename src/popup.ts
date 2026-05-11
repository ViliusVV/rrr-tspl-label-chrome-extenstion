import { captureSvg } from './capture';
import { rasterize } from './raster';
import { buildTspl } from './tspl';
import { getCurrentPort, sendBytes } from './serial';
import { DEFAULTS, loadSettings, saveSettings } from './settings';
import type { CaptureResult, Settings } from './types';

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
const connectBtn = $<HTMLButtonElement>('connect');
const printBtn = $<HTMLButtonElement>('print');

let port: SerialPort | null = null;
let saveTimer: number | undefined;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
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

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveSettings(readForm()).catch((e) => console.error('saveSettings failed', e));
  }, 200);
}

async function refreshPortState(): Promise<void> {
  port = await getCurrentPort();
  if (port) {
    connectBtn.textContent = 'Change port';
    printBtn.disabled = false;
    setStatus('Printer connected. Ready.');
  } else {
    connectBtn.textContent = 'Connect printer';
    printBtn.disabled = true;
    setStatus('Click "Connect printer" to choose a COM port.');
  }
}

async function onConnect(): Promise<void> {
  // Open the connect page as a real Chrome tab — the only extension surface where
  // Chrome will host the Web Serial picker. The popup will dismiss as focus moves
  // to the new tab; no point updating its status (it won't render in time).
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
    setStatus('Capturing SVG…');
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('No active tab');

    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureSvg,
    });
    const result = injection[0]?.result as CaptureResult | undefined;
    if (!result) throw new Error('Capture script returned no result');
    if (!result.ok) throw new Error(result.error);

    const labelDotsW = Math.round(settings.widthMm * DOTS_PER_MM);
    const labelDotsH = Math.round(settings.heightMm * DOTS_PER_MM);

    setStatus(`Rasterising ${result.svgWidth}x${result.svgHeight} -> ${labelDotsW}x${labelDotsH}…`);
    const raster = await rasterize({
      svgString: result.svgString,
      svgWidth: result.svgWidth,
      svgHeight: result.svgHeight,
      labelDotsW,
      labelDotsH,
      threshold: settings.threshold,
    });
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
    el.addEventListener('change', scheduleSave);
    el.addEventListener('input', scheduleSave);
  }
  connectBtn.addEventListener('click', onConnect);
  printBtn.addEventListener('click', onPrint);
  await refreshPortState();
}

init().catch((e) => {
  setStatus(`Init failed: ${(e as Error).message}`, true);
  console.error(e);
});
