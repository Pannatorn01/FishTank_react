import { describe, expect, it } from 'vitest';
import {
  ALGAE_BASE_FULL_MS,
  ALGAE_WASTE_SPEEDUP_PER_ITEM,
  WATER_FULL_TO_EMPTY_MS,
  decayWaterLevel,
  growAlgae,
} from '../vitals';

const DAY = 24 * 60 * 60 * 1000;

describe('decayWaterLevel', () => {
  it('empties a full tank over exactly WATER_FULL_TO_EMPTY_MS', () => {
    expect(decayWaterLevel(1, WATER_FULL_TO_EMPTY_MS)).toBeCloseTo(0, 6);
    expect(decayWaterLevel(1, WATER_FULL_TO_EMPTY_MS / 2)).toBeCloseTo(0.5, 6);
  });

  it('stops at empty rather than going negative', () => {
    expect(decayWaterLevel(0.1, WATER_FULL_TO_EMPTY_MS * 10)).toBe(0);
    expect(decayWaterLevel(0, DAY)).toBe(0);
  });

  it('is a no-op for a zero or negative step - a clock that jumped backwards must not refill the tank', () => {
    expect(decayWaterLevel(0.4, 0)).toBe(0.4);
    expect(decayWaterLevel(0.4, -DAY)).toBe(0.4);
  });

  it('reaches the same level in one lump sum as in many small steps', () => {
    // The property the whole elapsed-duration shape exists for: replaying a closed-app gap in one go
    // has to land where running it live would have.
    let stepped = 1;
    for (let i = 0; i < 48; i++) stepped = decayWaterLevel(stepped, DAY / 48);
    expect(stepped).toBeCloseTo(decayWaterLevel(1, DAY), 10);
  });
});

describe('growAlgae', () => {
  it('covers clean glass over exactly ALGAE_BASE_FULL_MS when there is no waste', () => {
    expect(growAlgae(0, ALGAE_BASE_FULL_MS, 0)).toBeCloseTo(1, 6);
    expect(growAlgae(0, ALGAE_BASE_FULL_MS / 4, 0)).toBeCloseTo(0.25, 6);
  });

  it('grows faster with waste in the tank, by the documented per-item rate', () => {
    const clean = growAlgae(0, DAY, 0);
    const dirty = growAlgae(0, DAY, 3);
    expect(dirty).toBeCloseTo(clean * (1 + 3 * ALGAE_WASTE_SPEEDUP_PER_ITEM), 10);
    expect(dirty).toBeGreaterThan(clean);
  });

  it('stops at fully covered rather than exceeding 1', () => {
    expect(growAlgae(0.9, ALGAE_BASE_FULL_MS, 5)).toBe(1);
    expect(growAlgae(1, DAY, 0)).toBe(1);
  });

  it('is a no-op for a zero or negative step', () => {
    expect(growAlgae(0.3, 0, 4)).toBe(0.3);
    expect(growAlgae(0.3, -DAY, 4)).toBe(0.3);
  });

  it('reaches the same coverage in one lump sum as in many small steps', () => {
    let stepped = 0;
    for (let i = 0; i < 60; i++) stepped = growAlgae(stepped, DAY / 60, 2);
    expect(stepped).toBeCloseTo(growAlgae(0, DAY, 2), 10);
  });
});
