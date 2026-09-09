import { describe, expect, it } from 'vitest';
import { computeSchoolSteer } from '../schooling';
import type { Instance } from '@/lib/types';

let seq = 0;
function fish(over: Partial<Instance> = {}): Instance {
  seq++;
  return {
    updatedAt: 0,
    deletedAt: 0,
    rev: 0,
    id: 'f' + seq,
    spriteId: 'sprite-fish',
    kind: 'fish',
    x: 0,
    y: 0,
    dir: 1,
    vx: 20,
    vy: 8,
    targetY: 0,
    frameIndex: 0,
    frameTimer: 0,
    bobPhase: 0,
    isDragging: false,
    swimSpeed: 'medium',
    groupId: null,
    schoolOffsetY: 0,
    zone: null,
    visible: true,
    bornAt: 0,
    lifespanMs: 1,
    dead: false,
    diedAt: 0,
    hunger: 1,
    starvingSince: 0,
    matureAt: 0,
    wellFedSince: 0,
    ...over,
  };
}

describe('computeSchoolSteer', () => {
  it('averages the depth and takes the majority heading', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: 'g', y: 100, dir: 1 }),
      fish({ groupId: 'g', y: 200, dir: 1 }),
      fish({ groupId: 'g', y: 300, dir: -1 }),
    ]);
    expect(steer.get('g')).toEqual({ dir: 1, centerY: 200 });
  });

  it('breaks a tied heading toward the right, rather than leaving it undecided', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: 'g', y: 0, dir: 1 }),
      fish({ groupId: 'g', y: 40, dir: -1 }),
    ]);
    expect(steer.get('g')?.dir).toBe(1);
  });

  it('gives a school of one no steer at all - that is just a fish', () => {
    // A steer here would pin the fish to its own current depth instead of letting it wander.
    expect(computeSchoolSteer([fish({ groupId: 'g' })]).has('g')).toBe(false);
  });

  it('keeps groups apart', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: 'a', y: 10, dir: 1 }),
      fish({ groupId: 'a', y: 30, dir: 1 }),
      fish({ groupId: 'b', y: 500, dir: -1 }),
      fish({ groupId: 'b', y: 700, dir: -1 }),
    ]);
    expect(steer.get('a')).toEqual({ dir: 1, centerY: 20 });
    expect(steer.get('b')).toEqual({ dir: -1, centerY: 600 });
  });

  it('leaves a dragged fish out, so the school does not chase the cursor', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: 'g', y: 100, dir: 1 }),
      fish({ groupId: 'g', y: 200, dir: 1 }),
      fish({ groupId: 'g', y: 9000, dir: -1, isDragging: true }),
    ]);
    expect(steer.get('g')).toEqual({ dir: 1, centerY: 150 });
  });

  it('drops a group to one member when the other is being dragged, and so gives no steer', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: 'g', y: 100 }),
      fish({ groupId: 'g', y: 200, isDragging: true }),
    ]);
    expect(steer.has('g')).toBe(false);
  });

  it('ignores ungrouped fish and non-fish instances', () => {
    const steer = computeSchoolSteer([
      fish({ groupId: null, y: 1 }),
      fish({ groupId: 'g', kind: 'object', y: 2 }),
      fish({ groupId: 'g', kind: 'object', y: 3 }),
    ]);
    expect(steer.size).toBe(0);
  });

  it('still steers a school whose members are dead - death is handled elsewhere', () => {
    // Documenting the boundary rather than asserting a preference: this function is only about
    // grouping, and the movement code returns early for a dead fish before it ever reads the steer.
    const steer = computeSchoolSteer([
      fish({ groupId: 'g', y: 100, dead: true }),
      fish({ groupId: 'g', y: 300, dead: true }),
    ]);
    expect(steer.get('g')?.centerY).toBe(200);
  });
});
