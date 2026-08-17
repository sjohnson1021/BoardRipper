import { describe, it, expect } from 'vitest';
import { gencadArcSweep, tessellateArc } from './cad-parser';
import type { Trace } from './types';

/**
 * GenCAD arc-sweep direction, pinned to real `ARC` records from two boards:
 * `2080.cad` (24,450 $ROUTES arcs) and `7523v10.cad` (13,136).
 *
 * `ARC x1 y1 x2 y2 xc yc` carries no direction column — every record in both
 * files has exactly 7 fields — so the sweep normalisation alone decides which
 * of the two candidate arcs is drawn.
 */

const DEG = 180 / Math.PI;

/** Midpoint of the arc as actually tessellated, which is what discriminates the
 *  two candidates — both share the endpoints. */
function tessellatedMid(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number) {
  const out: Trace[] = [];
  tessellateArc(x1, y1, x2, y2, cx, cy, 1, 'N', 0, out);
  const mid = out[Math.floor(out.length / 2)];
  return { x: mid.start.x, y: mid.start.y, segments: out.length };
}

describe('gencadArcSweep (canonical CCW sweep in [0, 2π))', () => {
  it('lifts a negative delta instead of leaving it signed', () => {
    expect(gencadArcSweep(Math.PI, 0) * DEG).toBeCloseTo(180, 6);
    expect(gencadArcSweep(3, -3) * DEG).toBeCloseTo((-6 + 2 * Math.PI) * DEG, 6);
  });

  it('never reduces a major sweep to its complement', () => {
    // 2080.cad's widest arc sweeps 350.908°; a ±π clamp renders it as a 9.09°
    // sliver on the far side of the circle.
    const major = 350.908 / DEG;
    expect(gencadArcSweep(0, major) * DEG).toBeCloseTo(350.908, 3);
    expect(gencadArcSweep(0, major)).toBeGreaterThan(Math.PI);
  });

  it('keeps a full circle at 2π rather than collapsing it', () => {
    expect(gencadArcSweep(0, 2 * Math.PI)).toBeCloseTo(2 * Math.PI, 9);
  });
});

describe('tessellateArc — endpoint-swapped twins tile the circle', () => {
  // 2080.cad emits these two records back to back. They share a centre and
  // swap endpoints; together they are one full circle of r = 85.04 drawn as
  // two half-circles. 3,038 records in 2080.cad and 2,756 in 7523v10.cad have
  // such a twin — under a shortest-arc rule both halves of every pair render
  // as the SAME half, so the circle comes out as a doubled semicircle and the
  // other half is never drawn at all.
  const CX = 8714.567, CY = 4274.409;
  const A = [8799.606, 4274.409, 8629.527, 4274.409] as const;
  const B = [8629.527, 4274.409, 8799.606, 4274.409] as const;

  it('draws the two records on opposite sides of the centre', () => {
    const a = tessellatedMid(A[0], A[1], A[2], A[3], CX, CY);
    const b = tessellatedMid(B[0], B[1], B[2], B[3], CX, CY);
    expect(a.y).toBeGreaterThan(CY);   // upper half
    expect(b.y).toBeLessThan(CY);      // lower half — the ±π clamp put it here too
    expect(a.x).toBeCloseTo(CX, 3);
    expect(b.x).toBeCloseTo(CX, 3);
    // Same radius, mirrored about the centre line. Tolerance is loose because
    // the sampled point nearest the midpoint differs by one step between the
    // two halves; the side of the centre line is the assertion that matters.
    expect(a.y - CY).toBeCloseTo(CY - b.y, 1);
  });

  it('sweeps each twin a half-turn, not a zero-length or full turn', () => {
    for (const [x1, y1, x2, y2] of [A, B]) {
      const s = gencadArcSweep(
        Math.atan2(y1 - CY, x1 - CX),
        Math.atan2(y2 - CY, x2 - CX),
      );
      expect(s * DEG).toBeCloseTo(180, 6);
    }
  });
});

describe('tessellateArc — geometry', () => {
  it('starts and ends on the record\'s own endpoints', () => {
    const out: Trace[] = [];
    tessellateArc(100, 0, -100, 0, 0, 0, 1, 'N', 0, out);
    expect(out[0].start).toEqual({ x: 100, y: 0 });
    expect(out[out.length - 1].end).toEqual({ x: -100, y: 0 });
  });

  it('scales segment count with the true sweep, not the complement', () => {
    // ~10° per segment: a 350° arc must not tessellate like a 10° one.
    const wide: Trace[] = [];
    const a1 = 350 / DEG;
    tessellateArc(100, 0, 100 * Math.cos(a1), 100 * Math.sin(a1), 0, 0, 1, 'N', 0, wide);
    expect(wide.length).toBeGreaterThanOrEqual(35);
  });

  it('degenerate zero-radius records still emit a straight segment', () => {
    const out: Trace[] = [];
    tessellateArc(5, 5, 9, 9, 5, 5, 1, 'N', 0, out);
    expect(out).toEqual([{ start: { x: 5, y: 5 }, end: { x: 9, y: 9 }, width: 1, net: 'N', layer: 0 }]);
  });
});
