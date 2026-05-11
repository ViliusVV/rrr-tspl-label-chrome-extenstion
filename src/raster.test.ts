import { describe, expect, it } from 'vitest';
import { computeFitRect } from './raster';

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
