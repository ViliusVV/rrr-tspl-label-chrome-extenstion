import interact from 'interactjs';
import { captureSvg } from './capture';
import { manualDefaultsFromAutoFit, rasterize } from './raster';
import { buildTspl } from './tspl';
import { getCurrentPort, sendBytes } from './serial';
import { DEFAULTS, loadSettings, saveSettings } from './settings';
import type { CaptureResult, ManualTransform, Settings } from './types';

const DOTS_PER_MM = 8;
const PREVIEW_MAX_LABEL_CSS = 220;
const WORKAREA_PAD = 70;

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
const previewWorkareaEl = $('previewWorkarea');
const labelBoundsEl = $('labelBounds');
const previewRasterEl = $<HTMLImageElement>('previewRaster');
const manualSvgWrapperEl = $('manualSvgWrapper');
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
let currentSettings: Settings = { ...DEFAULTS };

// ---------- Layout math ----------

interface FrameDims {
  labelW: number;     // CSS px
  labelH: number;
  pad: number;
  workareaW: number;
  workareaH: number;
}

function frameDims(): FrameDims {
  const aspect = currentSettings.heightMm / currentSettings.widthMm;
  let labelW: number;
  let labelH: number;
  if (aspect <= 1) {
    labelW = PREVIEW_MAX_LABEL_CSS;
    labelH = PREVIEW_MAX_LABEL_CSS * aspect;
  } else {
    labelH = PREVIEW_MAX_LABEL_CSS;
    labelW = PREVIEW_MAX_LABEL_CSS / aspect;
  }
  return {
    labelW,
    labelH,
    pad: WORKAREA_PAD,
    workareaW: labelW + 2 * WORKAREA_PAD,
    workareaH: labelH + 2 * WORKAREA_PAD,
  };
}

function applyFrameSize(): void {
  const d = frameDims();
  previewWorkareaEl.style.width = `${d.workareaW}px`;
  previewWorkareaEl.style.height = `${d.workareaH}px`;
  labelBoundsEl.style.width = `${d.labelW}px`;
  labelBoundsEl.style.height = `${d.labelH}px`;
  labelBoundsEl.style.left = `${d.pad}px`;
  labelBoundsEl.style.top = `${d.pad}px`;
  applyManualLayoutFromSettings();
}

function applyManualLayoutFromSettings(): void {
  if (!cachedCapture || !cachedCapture.ok) return;
  const d = frameDims();
  const wCss = currentSettings.manualWidth * d.labelW;
  const hCss = currentSettings.manualHeight * d.labelH;
  const xCss = d.pad + currentSettings.manualX * d.labelW;
  const yCss = d.pad + currentSettings.manualY * d.labelH;
  manualSvgWrapperEl.style.width = `${wCss}px`;
  manualSvgWrapperEl.style.height = `${hCss}px`;
  manualSvgWrapperEl.style.left = `${xCss}px`;
  manualSvgWrapperEl.style.top = `${yCss}px`;
  applyImgTransform(wCss, hCss);
}

function applyImgTransform(wCss: number, hCss: number): void {
  if (currentSettings.manualRotate) {
    // Wrapper is at (wCss x hCss); we want the SVG content rotated 90° inside it.
    // Sizing the img to (hCss x wCss) and rotating 90° around centre maps it back
    // to fit (wCss x hCss) visually with rotated SVG content.
    manualSvgEl.style.width = `${hCss}px`;
    manualSvgEl.style.height = `${wCss}px`;
    manualSvgEl.style.left = '50%';
    manualSvgEl.style.top = '50%';
    manualSvgEl.style.transformOrigin = 'center center';
    manualSvgEl.style.transform = 'translate(-50%, -50%) rotate(90deg)';
  } else {
    manualSvgEl.style.width = `${wCss}px`;
    manualSvgEl.style.height = `${hCss}px`;
    manualSvgEl.style.left = '0';
    manualSvgEl.style.top = '0';
    manualSvgEl.style.transform = 'none';
  }
}

function cssRectToManual(left: number, top: number, width: number, height: number) {
  const d = frameDims();
  return {
    manualX: (left - d.pad) / d.labelW,
    manualY: (top - d.pad) / d.labelH,
    manualWidth: width / d.labelW,
    manualHeight: height / d.labelH,
  };
}

// Force manualHeight to match the SVG's effective aspect (after any rotation) at
// the current label aspect. Defensive: keeps the wrapper rect visually equal to
// what rasterise will actually produce on print, even if stale settings or label-
// dimension changes pushed the ratio off.
function snapManualHeightToAspect(): void {
  if (!cachedCapture || !cachedCapture.ok) return;
  const effW = currentSettings.manualRotate
    ? cachedCapture.svgHeight
    : cachedCapture.svgWidth;
  const effH = currentSettings.manualRotate
    ? cachedCapture.svgWidth
    : cachedCapture.svgHeight;
  // wrapperAspect_css = (manualHeight * labelH) / (manualWidth * labelW)
  //                   = (manualHeight / manualWidth) * (heightMm / widthMm)
  // want wrapperAspect_css = effH / effW
  //   => manualHeight = manualWidth * (effH / effW) * (widthMm / heightMm)
  const labelAspect = currentSettings.heightMm / currentSettings.widthMm;
  currentSettings.manualHeight =
    (currentSettings.manualWidth * (effH / effW)) / labelAspect;
}

// ---------- SVG image source ----------

function svgStringToDataUrl(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

function updateManualSvgImage(): void {
  if (!cachedCapture || !cachedCapture.ok) return;
  manualSvgEl.src = svgStringToDataUrl(cachedCapture.svgString);
}

// ---------- interact.js ----------

let interactInstalled = false;
function installInteractHandlers(): void {
  if (interactInstalled) return;
  interactInstalled = true;
  interact(manualSvgWrapperEl)
    .draggable({
      listeners: {
        start() {
          previewWorkareaEl.classList.add('editing');
        },
        move(event) {
          const newLeft = manualSvgWrapperEl.offsetLeft + event.dx;
          const newTop = manualSvgWrapperEl.offsetTop + event.dy;
          manualSvgWrapperEl.style.left = `${newLeft}px`;
          manualSvgWrapperEl.style.top = `${newTop}px`;
          const m = cssRectToManual(
            newLeft,
            newTop,
            manualSvgWrapperEl.offsetWidth,
            manualSvgWrapperEl.offsetHeight,
          );
          currentSettings.manualX = m.manualX;
          currentSettings.manualY = m.manualY;
          scheduleSave();
          schedulePreview();
        },
        end() {
          previewWorkareaEl.classList.remove('editing');
        },
      },
    })
    .resizable({
      edges: { left: true, right: true, top: true, bottom: true },
      margin: 12,
      modifiers: [
        interact.modifiers.aspectRatio({ ratio: 'preserve' }),
        interact.modifiers.restrictSize({ min: { width: 24, height: 12 } }),
      ],
      listeners: {
        start() {
          previewWorkareaEl.classList.add('editing');
        },
        move(event) {
          const newWidth = event.rect.width;
          const newHeight = event.rect.height;
          const newLeft = manualSvgWrapperEl.offsetLeft + event.deltaRect.left;
          const newTop = manualSvgWrapperEl.offsetTop + event.deltaRect.top;
          manualSvgWrapperEl.style.width = `${newWidth}px`;
          manualSvgWrapperEl.style.height = `${newHeight}px`;
          manualSvgWrapperEl.style.left = `${newLeft}px`;
          manualSvgWrapperEl.style.top = `${newTop}px`;
          applyImgTransform(newWidth, newHeight);
          const m = cssRectToManual(newLeft, newTop, newWidth, newHeight);
          currentSettings.manualX = m.manualX;
          currentSettings.manualY = m.manualY;
          currentSettings.manualWidth = m.manualWidth;
          currentSettings.manualHeight = m.manualHeight;
          scheduleSave();
          schedulePreview();
        },
        end() {
          previewWorkareaEl.classList.remove('editing');
        },
      },
    });
}

// ---------- Mode toggle ----------

function setManualMode(enabled: boolean): void {
  manualSvgWrapperEl.hidden = !enabled;
  rotateBtn.hidden = !enabled;
  previewWorkareaEl.classList.toggle('manual', enabled);
  if (enabled) {
    updateManualSvgImage();
    installInteractHandlers();
    applyManualLayoutFromSettings();
  }
}

// ---------- Capture & preview ----------

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

function currentManualTransform(): ManualTransform {
  return {
    rotate: currentSettings.manualRotate,
    x: currentSettings.manualX,
    y: currentSettings.manualY,
    width: currentSettings.manualWidth,
    height: currentSettings.manualHeight,
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

// ---------- UI helpers ----------

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

function readFormInto(s: Settings): Settings {
  const num = (k: keyof typeof numericFields) =>
    Number((numericFields[k] as HTMLInputElement | HTMLSelectElement).value);
  return {
    ...s,
    widthMm: num('widthMm'),
    heightMm: num('heightMm'),
    gapMm: num('gapMm'),
    density: num('density'),
    speed: num('speed'),
    baud: num('baud'),
    threshold: num('threshold'),
    copies: num('copies'),
    autoFit: autoFitField.checked,
  };
}

// ---------- Event handlers ----------

function onFormChange(): void {
  currentSettings = readFormInto(currentSettings);
  snapManualHeightToAspect();
  applyFrameSize();
  scheduleSave();
  schedulePreview();
}

function onAutoFitToggle(): void {
  const becameManual = !autoFitField.checked && currentSettings.autoFit;
  currentSettings.autoFit = autoFitField.checked;

  if (becameManual && cachedCapture && cachedCapture.ok) {
    // First time going manual this session, OR previously-stored manual values
    // look like defaults — seed from auto-fit so the SVG starts in a sane place.
    const looksLikeDefault =
      currentSettings.manualWidth === DEFAULTS.manualWidth &&
      currentSettings.manualHeight === DEFAULTS.manualHeight &&
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
      currentSettings.manualHeight = seed.height;
    }
  }

  // Stale stored values from before manualHeight existed (or after label dim
  // changes) can leave the wrapper at the wrong aspect — snap it back to SVG.
  snapManualHeightToAspect();
  setManualMode(!currentSettings.autoFit);
  scheduleSave();
  schedulePreview();
}

function onRotateClick(): void {
  // Swap effective W/H so the visual roughly stays in the same on-screen footprint:
  //   oldHCss = manualHeight * labelHCss
  //   newWCss := oldHCss
  //   newManualWidth = newWCss / labelWCss = manualHeight * labelHCss / labelWCss
  //                  = manualHeight * (heightMm / widthMm)
  // Symmetric for newManualHeight.
  const labelAspect = currentSettings.heightMm / currentSettings.widthMm;
  const newWidth = currentSettings.manualHeight * labelAspect;
  const newHeight = currentSettings.manualWidth / labelAspect;
  currentSettings.manualWidth = newWidth;
  currentSettings.manualHeight = newHeight;
  currentSettings.manualRotate = !currentSettings.manualRotate;
  // Defensive: after the rotate, force aspect to the rotated SVG aspect so the
  // wrapper rect matches the rasterised output exactly.
  snapManualHeightToAspect();
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
  // refreshPreview captures the SVG (when first run) → we now know its aspect.
  // Snap manualHeight so the wrapper matches what rasterise produces.
  snapManualHeightToAspect();
  setManualMode(!currentSettings.autoFit);
}

init().catch((e) => {
  setStatus(`Init failed: ${(e as Error).message}`, true);
  console.error(e);
});
