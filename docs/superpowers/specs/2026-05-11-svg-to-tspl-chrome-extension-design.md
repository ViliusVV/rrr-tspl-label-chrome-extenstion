# SVG → TSPL Chrome Extension — Design

Date: 2026-05-11
Status: Approved for implementation

## Goal

A Chrome extension that captures a specific `<svg>` from the active tab, rasterizes it to a 1-bit bitmap sized to a user-configured label, encodes it as a TSPL print job, and sends it to a label printer over a Bluetooth-paired virtual COM port via Web Serial.

Initial target page: Ovoko/rrr.lt label-paper view. Target SVG: `svg.label-body` (single class, hyphen).

Reference implementation: `~/repos/home-app/apps/label-printer/src/label_printer/printer.py` (`TSPLPrinter`) — informs wire format, not code structure. TS code does not mirror Python class shape.

## Scope

In-scope (this spec):

- Chrome extension (Manifest V3), popup-only UI.
- One-click: capture the first `svg.label-body` on the active tab → rasterize → print one label.
- Configurable label dimensions, gap, density, speed, baud, threshold, copies.
- Web Serial port selection and persistence across popup opens.
- Preview canvas of the rasterized bitmap.

Out of scope (deferred):

- Multi-label / batch printing.
- Side panel or content-script-injected UI.
- CSV-driven workflows (the Python tool's job).
- Font embedding (`@font-face` base64 inlining of Roboto). Text renders with the system sans-serif fallback in v1.
- Stretch-to-fill fit mode. Letterbox is the only mode.
- Per-tab origin permissions. We rely on `activeTab` + `chrome.scripting.executeScript` for on-demand injection.

## Target page reality check

Inspection of `target_source.html` (hydrated DOM dump):

- `svg.label-body` is `381 × 219` units, `viewBox="0 0 381 219"` — landscape, ~1.74:1 aspect.
- The SVG carries its own `<defs><style>` with `font-family: Roboto, sans-serif` and class rules. Page CSS does not bleed into it, so `outerHTML` is fully self-contained.
- Content mixes native `<text>` and `<foreignObject>` containing `<div xmlns="http://www.w3.org/1999/xhtml">` for text wrapping. The XHTML namespace declaration is what lets modern Chrome render `<foreignObject>` HTML when the SVG is loaded as `<img>`. Flagged as a known fragility (see Risks).

## Architecture

Popup-only Chrome extension. The popup is both the UI and the Web Serial host. No persistent content script; capture runs on demand via `chrome.scripting.executeScript`.

```
   ┌─ active tab ──────────────────┐     ┌─ extension popup ─────────────────────────┐
   │  Ovoko page, with svg.label-  │     │  popup.html / popup.ts                    │
   │  body in the live DOM         │ ←─── chrome.scripting.executeScript({func})    │
   │  → captureSvg() runs in tab,  │ ───→ { svgString, svgWidth, svgHeight }        │
   │    returns outerHTML + dims   │     │     ↓                                     │
   └───────────────────────────────┘     │  raster.ts: SVG → 1-bit grid              │
                                         │     ↓                                     │
                                         │  tspl.ts: grid + settings → Uint8Array    │
                                         │     ↓                                     │
                                         │  serial.ts: open → write → close          │
                                         │     ↓                                     │
                                         │  Web Serial → virtual COM (BT SPP)        │
                                         └───────────────────────────────────────────┘
```

## Module layout

```
src/
  popup.html             # popup UI
  popup.ts               # glue: capture → raster → tspl → serial
  capture.ts             # exported captureSvg() injected via executeScript
  raster.ts              # pure: (svgString, dims, threshold) → { bits, widthBytes, height }
  tspl.ts                # pure: (rasterResult, settings) → Uint8Array
  serial.ts              # Web Serial wrapper: getOrRequestPort, sendBytes
  settings.ts            # chrome.storage.local load/save with defaults
  types.ts               # shared Settings, RasterResult, CaptureResult types
public/
  manifest.json
  icons/icon-16.png      # reuse or generate; existing public/*.svg can be repurposed
  icons/icon-48.png
  icons/icon-128.png
```

Replace the existing `index.html` / `src/main.ts` (Vite counter demo) — repurpose `index.html` as the popup entry by renaming and rewriting.

## Build setup

`vite.config.ts`:

- `build.rollupOptions.input = { popup: 'popup.html' }`.
- A `vite-plugin-static-copy` (or a tiny custom plugin) copies `public/manifest.json` and `public/icons/` into `dist/`.
- `build.target = 'esnext'` — extension runtime is current Chrome.
- No code-splitting tweaks needed; single-page popup.

`package.json`:

- Add `@types/chrome` to `devDependencies`.
- Add `vitest` to `devDependencies` for `tspl.ts` / `raster.ts` unit tests.
- Scripts: keep `dev` / `build` / `preview` from Vite; add `test` → `vitest`.

## Manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "Label SVG → TSPL Printer",
  "version": "0.1.0",
  "description": "Captures svg.label-body from the active tab and prints to a TSPL Bluetooth label printer.",
  "permissions": ["activeTab", "scripting", "storage"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

No `host_permissions`, no declared `content_scripts`. `activeTab` + `scripting` is enough to inject `captureSvg` into the current tab on user click. Web Serial uses runtime permission via the picker — no manifest entry.

## Component contracts

### `capture.ts`

Exports a single function intended to be passed to `chrome.scripting.executeScript({ func: captureSvg })`. Runs in the page's main world (not isolated), so it can read the live DOM with current rendered state. Self-contained — no imports, no closures over popup state, because `executeScript` serialises only the function source.

```ts
// runs IN THE TARGET TAB
function captureSvg(): CaptureResult {
  const svg = document.querySelector('svg.label-body');
  if (!svg) return { ok: false, error: 'No svg.label-body on this page' };
  // Use viewBox if present, else width/height attributes
  const vb = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
  const w = vb?.[2] ?? Number(svg.getAttribute('width')) ?? svg.getBoundingClientRect().width;
  const h = vb?.[3] ?? Number(svg.getAttribute('height')) ?? svg.getBoundingClientRect().height;
  return { ok: true, svgString: svg.outerHTML, svgWidth: w, svgHeight: h };
}
```

`CaptureResult = { ok: true; svgString: string; svgWidth: number; svgHeight: number } | { ok: false; error: string }`.

### `raster.ts`

Pure (no `chrome.*`, no `document` from a specific tab, but uses popup-side `Image` / `OffscreenCanvas`).

```ts
export interface RasterInput {
  svgString: string;
  svgWidth: number;     // SVG logical units
  svgHeight: number;
  labelDotsW: number;   // target bitmap width in printer dots
  labelDotsH: number;
  threshold: number;    // 0-255 luma cutoff
}

export interface RasterResult {
  bits: Uint8Array;     // packed 1-bit, MSB-first within each byte (leftmost pixel = bit 7);
                        // raster initialised to 0xFF (white), bits cleared where black.
                        // Byte layout: row-major, widthBytes bytes per row, last byte's
                        // trailing pad bits remain 1 (white).
  widthBytes: number;   // (labelDotsW + 7) >> 3
  height: number;       // labelDotsH
  previewDataUrl: string; // PNG of the rasterized bitmap (1-bit upscaled) for UI preview
}

export async function rasterize(input: RasterInput): Promise<RasterResult>;
```

Implementation:

1. Encode `svgString` to base64 via `TextEncoder` (handles non-ASCII like `Pečiuko`) → `data:image/svg+xml;base64,...`. Decode via `await img.decode()`. `img.width`/`img.height` are unreliable across browsers for SVG without intrinsic size, so we use the SVG dimensions from `RasterInput`.
2. Compute fit rectangle with auto-rotate:
   - `rotate = (svgWidth > svgHeight) !== (labelDotsW > labelDotsH)` (square SVG → no rotate).
   - `effW = rotate ? svgHeight : svgWidth`; `effH = rotate ? svgWidth : svgHeight`.
   - `scale = min(labelDotsW / effW, labelDotsH / effH)`.
   - `drawW = effW * scale`; `drawH = effH * scale`.
   - `dx = (labelDotsW - drawW) / 2`; `dy = (labelDotsH - drawH) / 2`.
3. Create `OffscreenCanvas(labelDotsW, labelDotsH)`. `ctx.fillStyle = 'white'; ctx.fillRect(0, 0, labelDotsW, labelDotsH)`.
4. If `rotate`: `ctx.translate(labelDotsW, 0); ctx.rotate(Math.PI / 2)`. Then `ctx.drawImage(img, dy, dx, drawH, drawW)` in the rotated frame (axes swap). Else `ctx.drawImage(img, dx, dy, drawW, drawH)`.
5. `getImageData(0, 0, labelDotsW, labelDotsH)` → iterate pixels, compute luma `0.299r + 0.587g + 0.114b`, threshold to bit.
6. Pack bits into `bits` (`width_bytes × height`), MSB-first, init `0xFF`, clear bits where black. Last byte of each row carries padding white bits (set, since `0xFF` init).
7. Produce `previewDataUrl` by drawing the same canvas content into a second canvas after thresholding, scaled up via `image-rendering: pixelated` for the UI.

### `tspl.ts`

Pure. No DOM, no `chrome.*`.

```ts
export interface PrintSettings {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;   // 1-15
  speed: number;     // 1-10
  copies: number;    // ≥ 1
}

export function buildTspl(raster: RasterResult, settings: PrintSettings): Uint8Array;
```

Output stream:

```
SIZE {widthMm} mm,{heightMm} mm\r\n
GAP {gapMm} mm,0 mm\r\n
DENSITY {density}\r\n
SPEED {speed}\r\n
DIRECTION 1\r\n
REFERENCE 0,0\r\n
CLS\r\n
BITMAP 0,0,{widthBytes},{height},0,<raster.bits raw bytes>\r\n
PRINT 1,{copies}\r\n
```

Implementation notes:

- Build a `TextEncoder` for the ASCII headers, concatenate `Uint8Array`s.
- TSPL `BITMAP` mode 0: bit `0` = black, bit `1` = white. `raster.bits` is already in this layout — pass through unchanged.
- The trailing `\r\n` after the raster bytes is required (matches TSPL parsers' line-based input model).
- No `FORMFEED`; `PRINT` advances paper.

### `serial.ts`

Thin Web Serial wrapper.

```ts
export async function getOrRequestPort(): Promise<SerialPort | null>;
// returns a previously-granted port if available, else opens picker (caller must
// be in a user-gesture context — the popup button click qualifies).

export async function sendBytes(port: SerialPort, baudRate: number, bytes: Uint8Array): Promise<void>;
// open with { baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }
// write all bytes, await writer.ready, releaseLock, port.close.
```

Open-per-print (Bluetooth SPP serial behaves poorly with long-lived handles).

### `settings.ts`

`chrome.storage.local` with defaults. Single key `'settings'` → JSON blob.

```ts
export const DEFAULTS: Settings = {
  widthMm: 40,
  heightMm: 30,
  gapMm: 2,
  density: 8,
  speed: 4,
  baud: 9600,
  threshold: 128,
  copies: 1,
};

export async function loadSettings(): Promise<Settings>;
export async function saveSettings(s: Settings): Promise<void>;
```

`widthDots = round(widthMm * 8)`, `heightDots = round(heightMm * 8)` — computed in `popup.ts`, not stored. The `8 dots/mm` constant matches the XP-D463B and standard 203-dpi TSPL printers; treated as a hardcoded constant in `popup.ts` (`DOTS_PER_MM = 8`), not a setting.

### `popup.ts`

Glue, in order on Print click:

1. Disable Print button, show "Capturing…".
2. `chrome.tabs.query({ active: true, currentWindow: true })` → tabId.
3. `chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: captureSvg })`. `world: 'MAIN'` ensures the script sees the page's React-rendered DOM directly (isolated world also works for `document.querySelector`, but `MAIN` avoids any future surprise).
4. If `!result.ok`, surface the error and stop.
5. `rasterize({ svgString, svgWidth, svgHeight, labelDotsW, labelDotsH, threshold })` → preview to `<img>`, status "Rasterized W×H".
6. `buildTspl(rasterResult, settings)` → `Uint8Array`.
7. `sendBytes(port, settings.baud, bytes)`. Status "Sent N bytes ✓" or `Error: <message>`.
8. Re-enable Print.

On popup load:

- `loadSettings()` → populate inputs.
- `navigator.serial.getPorts()` → if non-empty, hide Connect button, enable Print.
- Settings inputs `change` → `saveSettings` (debounced 200 ms).

## Settings UI

| Field | Type | Default | Range |
|---|---|---|---|
| Width (mm) | number | 40 | 5–80 |
| Height (mm) | number | 30 | 5–200 |
| Gap (mm) | number | 2 | 0–10 |
| Density | number | 8 | 1–15 |
| Speed | number | 4 | 1–10 |
| Baud | select | 9600 | 9600/19200/38400/57600/115200 |
| Threshold | number | 128 | 0–255 |
| Copies | number | 1 | 1–99 |

Buttons:

- **Connect printer** — visible only when no remembered port; calls `requestPort()`.
- **Print** — disabled until a port is known.

Status area:

- One-line status: e.g. `"Captured 381×219 → rasterized 320×240 → sent 9712 bytes ✓"` or red error message. (Byte count ≈ `widthBytes × heightDots + ~100` for the ASCII header lines.)
- Preview canvas: rasterized 1-bit bitmap shown at 1:1, with `image-rendering: pixelated` CSS so dots are crisp.

## Error handling

Surface every failure as a single human-readable line in the status area:

| Failure | Status message |
|---|---|
| No `svg.label-body` on active tab | "No label SVG found on this page" |
| Tab is `chrome://`, `chrome-extension://`, or other restricted URL | "Cannot access this page (restricted URL)" |
| `requestPort()` rejected by user | "No printer selected" |
| `port.open()` throws (busy / disconnected) | "Could not open COM port — is another app using it?" |
| `img.decode()` throws (malformed SVG) | "SVG could not be rendered: <message>" |
| Bitmap raster sanity check fails (zero size) | "Rasterized bitmap is empty" |
| `sendBytes` write rejects | "Write failed: <message>" |

No `try/catch` swallowing — every catch logs to `console.error` for devtools debugging.

## Testing

- `tspl.ts` — `vitest` unit tests:
  - Small known input (e.g. 8×2 grid, all black) → byte-exact expected output. Locks in wire format.
  - Header lines are CR/LF terminated and ASCII-only.
  - `widthBytes` byte count matches `ceil(widthDots / 8)`.
- `raster.ts` — `vitest` unit tests:
  - Tiny synthetic SVG (`<svg viewBox="0 0 2 2"><rect x="0" y="0" width="1" height="1" fill="black"/></svg>`) at 2×2 dots → asserts specific pixels are black/white.
  - Auto-rotate logic: feed 100×50 SVG into a 50×100 label → assert `rotate = true`.
  - Letterbox math: feed 100×50 into 200×200 → assert `dy > 0`, `drawH < 200`.
- `capture.ts` / `serial.ts` / `popup.ts` — manual integration against the real Ovoko page + real printer. Hardware-coupled; not worth mocking.

## Risks and contingencies

1. **`<foreignObject>` HTML may not rasterize in some Chrome versions.** Mitigation: keep `worker: 'MAIN'` and pass the SVG outerHTML verbatim. If this proves broken in practice, the next-step fallback is to render the SVG into a hidden container in the *page's* DOM, use the page's own canvas with `ctx.drawImage` on the SVG-as-`<img>` there (same renderer, same restriction — so this isn't actually better), or adopt `html-to-image` / similar DOM rasterizer. None of those are in v1; we ship and see.
2. **Roboto fallback to system sans-serif.** Visual difference, not a blocker for legibility. Adding `@font-face` with base64 woff2 inlined into the SVG `<defs>` before rasterization is the fix; deferred.
3. **Popup closes mid-print.** The full print path is `await`ed end-to-end inside the click handler; the popup stays open until the promise resolves. Worst-case (user closes popup while printer is mid-write) results in a truncated job — the printer will time out and reset. Acceptable for v1.
4. **Web Serial unavailable.** Web Serial requires desktop Chromium-family browsers. Show a hard-fail message on popup load if `navigator.serial === undefined`.
5. **Aspect-ratio mismatch after auto-rotate.** Letterbox pads with white; no content loss. User can match label size to SVG aspect (~50×29 mm) for full-bleed if desired.
