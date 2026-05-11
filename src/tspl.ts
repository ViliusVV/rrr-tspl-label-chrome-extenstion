import type { PrintSettings, RasterResult } from './types';

const CRLF = new Uint8Array([0x0d, 0x0a]);
const enc = new TextEncoder();

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function line(text: string): Uint8Array {
  return concat([enc.encode(text), CRLF]);
}

export function buildTspl(raster: RasterResult, settings: PrintSettings): Uint8Array {
  const header = concat([
    line(`SIZE ${settings.widthMm} mm,${settings.heightMm} mm`),
    line(`GAP ${settings.gapMm} mm,0 mm`),
    line(`DENSITY ${settings.density}`),
    line(`SPEED ${settings.speed}`),
    line('DIRECTION 1'),
    line('REFERENCE 0,0'),
    line('CLS'),
  ]);
  const bitmapHeader = enc.encode(
    `BITMAP 0,0,${raster.widthBytes},${raster.height},0,`,
  );
  const print = line(`PRINT 1,${settings.copies}`);
  return concat([header, bitmapHeader, raster.bits, CRLF, print]);
}
