import { describe, it, expect } from 'vitest';
import { xzzArcSweepDeg, sampleXZZArc, xzzArcSegments } from './xzz-parser';

/**
 * Arc-sweep direction, pinned to a six-arc vector from
 * `Mini4 Pro-PP003675.04 MB PCB layer.pcb` (layer 28 — board outline).
 *
 * Raw fields are as stored: coordinates and angles are integers ÷ 10000, so
 * `1130129` is 113.0129°. Only the *relationships* between the coordinates
 * matter, so they are left in raw units and the helper is exercised directly.
 *
 * The endpoints of an arc are identical under both the correct sweep and its
 * complement — the **midpoint** is what discriminates, which is why "the
 * endpoints look right but the arc bulges the wrong way" is the symptom.
 *
 * Diagnosis, rules, and test vector contributed by Sean Johnson.
 */

const S = 10000;

interface ArcCase {
  id: string;
  cx: number; cy: number; r: number;
  startRaw: number; endRaw: number;
  sweep: number;
  mid: [number, number];
  /** Midpoint that a shortest-arc / swapped normalisation would produce. */
  complementMid: [number, number];
}

/** A and D are a mirror pair, as are B and C: the exporter reflects each angle
 *  AND swaps start/end (mirror(A.end) === D.start, mirror(A.start) === D.end,
 *  about the shared axis x = 516994999.5). That swap is only meaningful if the
 *  stored order encodes a direction — an undirected "shortest arc" reading
 *  would have no reason to reorder the endpoints. */
const ARCS: ArcCase[] = [
  { id: 'A (major, positive delta)', cx: 532474990, cy: 531872990, r: 307610,
    startRaw: 1130129, endRaw: 3472309, sweep: 234.218,
    mid: [532277764, 531636927], complementMid: [532672216, 532109053] },
  { id: 'B (major, wraps negative)', cx: 518264289, cy: 531735380, r: 331240,
    startRaw: 1615879, endRaw: 516079, sweep: 250.020,
    mid: [518358909, 531417942], complementMid: [518169669, 532052818] },
  { id: 'C (major, mirror of B)', cx: 515725710, cy: 531735380, r: 331240,
    startRaw: 1283920, endRaw: 184120, sweep: 250.020,
    mid: [515631090, 531417942], complementMid: [515820330, 532052818] },
  { id: 'D (major, mirror of A)', cx: 501515009, cy: 531872990, r: 307610,
    startRaw: 1927690, endRaw: 669870, sweep: 234.218,
    mid: [501712235, 531636927], complementMid: [501317783, 532109053] },
  { id: 'E (minor, 90° fillet)', cx: 508875000, cy: 533275000, r: 235000,
    startRaw: 0, endRaw: 900000, sweep: 90,
    mid: [509041170, 533441170], complementMid: [508708830, 533108830] },
  { id: 'F (minor, 45° fillet)', cx: 500995000, cy: 501069060, r: 519060,
    startRaw: 2250000, endRaw: 2700000, sweep: 45,
    mid: [500796364, 500589511], complementMid: [501193636, 501548609] },
];

describe('xzzArcSweepDeg (canonical CCW sweep in [0, 360))', () => {
  for (const a of ARCS) {
    it(`sweeps ${a.sweep}° on arc ${a.id}`, () => {
      expect(xzzArcSweepDeg(a.startRaw / S, a.endRaw / S)).toBeCloseTo(a.sweep, 3);
    });
  }

  it('lifts a negative delta instead of leaving it signed', () => {
    expect(xzzArcSweepDeg(161.5879, 51.6079)).toBeCloseTo(250.020, 3);
  });

  it('never reduces a major sweep to its complement', () => {
    // The half that a "shortest arc" clamp destroys and that the negative-lift
    // alone does not rescue: this delta is already positive, so a `+= 360` on
    // negatives is a no-op here and only the absence of the clamp saves it.
    expect(xzzArcSweepDeg(113.0129, 347.2309)).toBeCloseTo(234.218, 3);
    expect(xzzArcSweepDeg(113.0129, 347.2309)).toBeGreaterThan(180);
  });

  it('keeps a full circle at 360° rather than collapsing it to zero', () => {
    expect(xzzArcSweepDeg(0, 360)).toBe(360);
  });
});

describe('sampleXZZArc (linearisation walks the canonical sweep)', () => {
  for (const a of ARCS) {
    it(`draws the intended portion of arc ${a.id}`, () => {
      const pts = sampleXZZArc(a.cx, a.cy, a.r, a.startRaw / S, a.endRaw / S, 8);
      const mid = pts[4];
      expect(Math.round(mid.x)).toBe(a.mid[0]);
      expect(Math.round(mid.y)).toBe(a.mid[1]);
      // Explicit counter-example: the complementary arc shares this arc's
      // endpoints, so only the midpoint rules it out.
      expect(Math.round(mid.x)).not.toBe(a.complementMid[0]);
      expect(Math.round(mid.y)).not.toBe(a.complementMid[1]);
    });
  }

  it('reproduces the stored endpoints exactly', () => {
    const a = ARCS[0];
    const pts = sampleXZZArc(a.cx, a.cy, a.r, a.startRaw / S, a.endRaw / S, 9);
    expect(Math.round(pts[0].x)).toBe(532354733);
    expect(Math.round(pts[0].y)).toBe(532156119);
    expect(Math.round(pts[9].x)).toBe(532774992);
    expect(Math.round(pts[9].y)).toBe(531805001);
  });

  it('gives every segment endpoint its own Point object', () => {
    // The joint between two adjacent segments is geometrically one point but
    // must be two objects: `parseXZZ` mirrors (`p.x = 2 * axis - p.x`) and
    // translates (`p.x -= minX`) by walking the segment list and mutating p1/p2
    // in place, so a shared joint is transformed twice. On
    // Mini4 Pro-PP003675.04 that double-translation threw 304 of 382 outline
    // points ~72,000 mils off the board and stretched the silkscreen bbox from
    // 1627x3255 to 55001x53309.
    const segs = xzzArcSegments(100, 200, 50, 10, 300, 9);
    expect(segs).toHaveLength(9);
    const seen = new Set<object>();
    for (const s of segs) { seen.add(s.p1); seen.add(s.p2); }
    expect(seen.size).toBe(18);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].p1).not.toBe(segs[i - 1].p2);
      expect(segs[i].p1.x).toBeCloseTo(segs[i - 1].p2.x, 9);
      expect(segs[i].p1.y).toBeCloseTo(segs[i - 1].p2.y, 9);
    }
  });

  it('survives a per-endpoint mutation pass without moving joints apart', () => {
    // Exactly what the origin-normalisation loop does.
    const segs = xzzArcSegments(52000, 51000, 176.7, 113.0129, 347.2309, 9);
    for (const s of segs) { s.p1.x -= 1000; s.p1.y -= 1000; s.p2.x -= 1000; s.p2.y -= 1000; }
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].p1.x).toBeCloseTo(segs[i - 1].p2.x, 9);
      expect(segs[i].p1.y).toBeCloseTo(segs[i - 1].p2.y, 9);
    }
    expect(segs[0].p1.x).toBeCloseTo(52000 + 176.7 * Math.cos(113.0129 * Math.PI / 180) - 1000, 6);
  });

  it('traces the same geometry as the raw point sampler', () => {
    const pts = sampleXZZArc(0, 0, 10, 45, 315, 6);
    const segs = xzzArcSegments(0, 0, 10, 45, 315, 6);
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].p1.x).toBeCloseTo(pts[i].x, 9);
      expect(segs[i].p2.x).toBeCloseTo(pts[i + 1].x, 9);
    }
  });

  it('emits points in ascending sweep order for every arc', () => {
    // A reversed walk still hits both endpoints, so ordering is checked
    // separately from position: the outline chainer consumes these in order.
    for (const a of ARCS) {
      const pts = sampleXZZArc(a.cx, a.cy, a.r, a.startRaw / S, a.endRaw / S, 4);
      const start = a.startRaw / S;
      const angles = pts.map(p => {
        const d = Math.atan2(p.y - a.cy, p.x - a.cx) * 180 / Math.PI - start;
        return d < -1e-9 ? d + 360 : d;
      });
      for (let i = 1; i < angles.length; i++) {
        expect(angles[i]).toBeGreaterThan(angles[i - 1] - 1e-6);
      }
    }
  });
});
