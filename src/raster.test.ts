import { describe, expect, it } from 'vitest';
import { computeFitRect, packPixelsToBitmap } from './raster';

describe('computeFitRect', () => {
  it('does not rotate when both SVG and label are landscape', () => {
    const r = computeFitRect(100, 50, 200, 100);
    expect(r.rotate).toBe(false);
    expect(r.scale).toBe(2);
    expect(r.drawW).toBe(200);
    expect(r.drawH).toBe(100);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it('does not rotate when both SVG and label are portrait', () => {
    const r = computeFitRect(50, 100, 100, 200);
    expect(r.rotate).toBe(false);
    expect(r.scale).toBe(2);
  });

  it('rotates when landscape SVG meets portrait label', () => {
    const r = computeFitRect(100, 50, 50, 100);
    expect(r.rotate).toBe(true);
    expect(r.scale).toBe(1); // effW=50, effH=100; min(50/50, 100/100) = 1
    expect(r.drawW).toBe(50);
    expect(r.drawH).toBe(100);
  });

  it('rotates when portrait SVG meets landscape label', () => {
    const r = computeFitRect(50, 100, 200, 100);
    expect(r.rotate).toBe(true);
    expect(r.scale).toBe(2); // effW=100, effH=50; min(200/100, 100/50) = 2
    expect(r.drawW).toBe(200);
    expect(r.drawH).toBe(100);
  });

  it('does not rotate a square SVG', () => {
    const r = computeFitRect(100, 100, 200, 100);
    expect(r.rotate).toBe(false);
  });

  it('letterboxes when aspect ratios mismatch (no rotation case)', () => {
    // 100x50 SVG into 100x100 label: scale=1, drawW=100, drawH=50, dy=25.
    const r = computeFitRect(100, 50, 100, 100);
    expect(r.rotate).toBe(false);
    expect(r.scale).toBe(1);
    expect(r.drawW).toBe(100);
    expect(r.drawH).toBe(50);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(25);
  });

  it('letterboxes correctly after rotation', () => {
    // 100x50 SVG (landscape) into 50x200 label (portrait):
    // effW=50, effH=100. scale = min(50/50, 200/100) = 1.
    // drawW=50, drawH=100. dx=0, dy=50.
    const r = computeFitRect(100, 50, 50, 200);
    expect(r.rotate).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.drawW).toBe(50);
    expect(r.drawH).toBe(100);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(50);
  });
});

function makeRGBA(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4 + 0] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

describe('packPixelsToBitmap', () => {
  it('returns 0xFF for an all-white 8x1 image', () => {
    const data = makeRGBA(new Array(8).fill([255, 255, 255, 255]));
    const out = packPixelsToBitmap(data, 8, 1, 128);
    expect(out.widthBytes).toBe(1);
    expect(out.height).toBe(1);
    expect(Array.from(out.bits)).toEqual([0xff]);
  });

  it('returns 0x00 for an all-black 8x1 image', () => {
    const data = makeRGBA(new Array(8).fill([0, 0, 0, 255]));
    const out = packPixelsToBitmap(data, 8, 1, 128);
    expect(Array.from(out.bits)).toEqual([0x00]);
  });

  it('places the leftmost pixel in bit 7 (MSB-first)', () => {
    // Black pixel at x=0, rest white. Expect: bit 7 cleared -> 0x7F.
    const px: Array<[number, number, number, number]> = new Array(8).fill([255, 255, 255, 255]);
    px[0] = [0, 0, 0, 255];
    const out = packPixelsToBitmap(makeRGBA(px), 8, 1, 128);
    expect(Array.from(out.bits)).toEqual([0x7f]);
  });

  it('pads non-byte-aligned widths with white (1) bits at the row end', () => {
    // 5 black pixels, width=5 -> widthBytes=1. Bits 7..3 cleared, bits 2..0 stay 1.
    // Expected: 0b00000111 = 0x07.
    const px: Array<[number, number, number, number]> = new Array(5).fill([0, 0, 0, 255]);
    const out = packPixelsToBitmap(makeRGBA(px), 5, 1, 128);
    expect(out.widthBytes).toBe(1);
    expect(Array.from(out.bits)).toEqual([0x07]);
  });

  it('applies the luma threshold (mid-gray below threshold is black)', () => {
    // 8 mid-gray pixels (luma 100), threshold=128 -> all black -> 0x00.
    const data = makeRGBA(new Array(8).fill([100, 100, 100, 255]));
    expect(Array.from(packPixelsToBitmap(data, 8, 1, 128).bits)).toEqual([0x00]);
    // Same pixels, threshold=50 -> all white -> 0xFF.
    expect(Array.from(packPixelsToBitmap(data, 8, 1, 50).bits)).toEqual([0xff]);
  });

  it('handles a 2-row image with correct row stride', () => {
    // Row 0: 8 black. Row 1: 8 white.
    const px: Array<[number, number, number, number]> = [
      ...new Array(8).fill([0, 0, 0, 255]),
      ...new Array(8).fill([255, 255, 255, 255]),
    ];
    const out = packPixelsToBitmap(makeRGBA(px), 8, 2, 128);
    expect(out.widthBytes).toBe(1);
    expect(out.height).toBe(2);
    expect(Array.from(out.bits)).toEqual([0x00, 0xff]);
  });
});
