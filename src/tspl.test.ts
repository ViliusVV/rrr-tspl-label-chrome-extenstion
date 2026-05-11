import { describe, expect, it } from 'vitest';
import { buildTspl } from './tspl';
import type { PrintSettings, RasterResult } from './types';

const settings: PrintSettings = {
  widthMm: 40,
  heightMm: 30,
  gapMm: 2,
  density: 8,
  speed: 4,
  copies: 1,
};

function decode(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

describe('buildTspl', () => {
  it('emits the init sequence in the expected order with CR/LF line endings', () => {
    const raster: RasterResult = {
      bits: new Uint8Array([0xff]),
      widthBytes: 1,
      height: 1,
      previewDataUrl: '',
    };
    const out = decode(buildTspl(raster, settings));
    expect(out.startsWith('SIZE 40 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDENSITY 8\r\nSPEED 4\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\n')).toBe(true);
  });

  it('includes the BITMAP header with widthBytes,height and PRINT 1,copies', () => {
    const raster: RasterResult = {
      bits: new Uint8Array([0xff, 0xff]),
      widthBytes: 1,
      height: 2,
      previewDataUrl: '',
    };
    const out = decode(buildTspl(raster, { ...settings, copies: 3 }));
    expect(out).toContain('BITMAP 0,0,1,2,0,');
    expect(out).toContain('\r\nPRINT 1,3\r\n');
  });

  it('passes raster bytes through verbatim between the BITMAP header and the trailing CR/LF', () => {
    const bits = new Uint8Array([0xab, 0xcd, 0xef, 0x12]);
    const raster: RasterResult = { bits, widthBytes: 2, height: 2, previewDataUrl: '' };
    const out = buildTspl(raster, settings);
    // Find the BITMAP header end and verify the next 4 bytes are exactly bits.
    const headerNeedle = new TextEncoder().encode('BITMAP 0,0,2,2,0,');
    let headerStart = -1;
    outer: for (let i = 0; i <= out.length - headerNeedle.length; i++) {
      for (let j = 0; j < headerNeedle.length; j++) {
        if (out[i + j] !== headerNeedle[j]) continue outer;
      }
      headerStart = i;
      break;
    }
    expect(headerStart).toBeGreaterThan(-1);
    const rasterStart = headerStart + headerNeedle.length;
    expect(Array.from(out.slice(rasterStart, rasterStart + 4))).toEqual([0xab, 0xcd, 0xef, 0x12]);
    expect(out[rasterStart + 4]).toBe(0x0d);
    expect(out[rasterStart + 5]).toBe(0x0a);
  });

  it('produces a complete byte stream for an all-white 8x2 grid', () => {
    const raster: RasterResult = {
      bits: new Uint8Array([0xff, 0xff]),
      widthBytes: 1,
      height: 2,
      previewDataUrl: '',
    };
    const expected =
      'SIZE 40 mm,30 mm\r\n' +
      'GAP 2 mm,0 mm\r\n' +
      'DENSITY 8\r\n' +
      'SPEED 4\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'BITMAP 0,0,1,2,0,\xff\xff\r\n' +
      'PRINT 1,1\r\n';
    expect(decode(buildTspl(raster, settings))).toBe(expected);
  });
});
