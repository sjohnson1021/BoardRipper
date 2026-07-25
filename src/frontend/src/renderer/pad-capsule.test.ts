import { describe, it, expect } from 'vitest';
import { capsuleParams, isOblongRoundPad } from './pad-capsule';

describe('isOblongRoundPad', () => {
  it('is true for a round pad with padWidth != padHeight (capsule/stadium)', () => {
    expect(isOblongRoundPad({ padShape: 'round', padWidth: 71, padHeight: 20 })).toBe(true);
    expect(isOblongRoundPad({ padShape: 'round', padWidth: 20, padHeight: 71 })).toBe(true);
  });

  it('is false for a square round pad (plain circle)', () => {
    expect(isOblongRoundPad({ padShape: 'round', padWidth: 15, padHeight: 15 })).toBe(false);
  });

  it('is false for non-round pad shapes', () => {
    expect(isOblongRoundPad({ padShape: 'rect', padWidth: 71, padHeight: 20 })).toBe(false);
    expect(isOblongRoundPad({ padShape: 'poly', padWidth: 71, padHeight: 20 })).toBe(false);
  });

  it('is false when dimensions are missing or non-positive', () => {
    expect(isOblongRoundPad({ padShape: 'round' })).toBe(false);
    expect(isOblongRoundPad({ padShape: 'round', padWidth: 0, padHeight: 20 })).toBe(false);
    expect(isOblongRoundPad({ padShape: 'round', padWidth: 71, padHeight: -1 })).toBe(false);
  });
});

describe('capsuleParams (oblong round-pad stadium geometry)', () => {
  it('returns null for square round pads (circle path)', () => {
    expect(capsuleParams(10, 20, 15, 15, 0, 0)).toBeNull();
  });

  it('vertical capsule at angle 0 when h > w', () => {
    const c = capsuleParams(100, 200, 15, 60, 0, 0)!;
    expect(c).not.toBeNull();
    expect(c.r).toBeCloseTo(7.5);
    // long axis = +Y; cap centres at cy ± (30 − 7.5)
    expect(c.c1x).toBeCloseTo(100);
    expect(c.c2x).toBeCloseTo(100);
    expect(Math.abs(c.c1y - 200)).toBeCloseTo(22.5);
    expect(Math.abs(c.c2y - 200)).toBeCloseTo(22.5);
    expect(c.c1y).not.toBeCloseTo(c.c2y);
  });

  it('rotating 90° turns the capsule horizontal (EC1 lead)', () => {
    const c = capsuleParams(100, 200, 15, 60, 90, 0)!;
    expect(c.r).toBeCloseTo(7.5);
    expect(c.c1y).toBeCloseTo(200);
    expect(c.c2y).toBeCloseTo(200);
    expect(Math.abs(c.c1x - 100)).toBeCloseTo(22.5);
    expect(Math.abs(c.c2x - 100)).toBeCloseTo(22.5);
  });

  it('w > h lies along X at angle 0', () => {
    const c = capsuleParams(0, 0, 60, 15, 0, 0)!;
    expect(c.r).toBeCloseTo(7.5);
    expect(c.c1y).toBeCloseTo(0);
    expect(c.c2y).toBeCloseTo(0);
    expect(Math.abs(c.c1x)).toBeCloseTo(22.5);
  });

  it('grow expands both radius and length', () => {
    const c = capsuleParams(0, 0, 15, 60, 0, 2)!;
    expect(c.r).toBeCloseTo(9.5);
    // half-length = (60/2 + 2) − 9.5 = 22.5
    expect(Math.abs(c.c1y)).toBeCloseTo(22.5);
  });

  it('degenerates to null when grow shrinks the capsule below a circle', () => {
    // negative grow can make the long dim shorter than the diameter
    expect(capsuleParams(0, 0, 15, 16, 0, -8)).toBeNull();
  });
});
