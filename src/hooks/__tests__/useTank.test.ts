import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOOD_HUNGER_GAIN,
  HUNGER_FULL_TO_EMPTY_MS,
  STARVATION_DEATH_MS,
  TankEngine,
} from '../useTank';
import type { Instance, Sprite, TankGroup } from '@/lib/types';

/** vitest's node env has no localStorage - a minimal in-memory stand-in (copied from storage.test.ts).
 *  useTank never calls init() in these tests, but undo()/redo()/refresh() and persist paths still
 *  reach storage.load*(). */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const NOW = 1_700_000_000_000;

let idc = 0;
function fish(over: Partial<Instance> = {}): Instance {
  idc++;
  return {
    updatedAt: NOW,
    deletedAt: 0,
    rev: 0,
    id: 'f' + idc,
    spriteId: 'sprite-fish',
    kind: 'fish',
    x: 100,
    y: 100,
    dir: 1,
    vx: 20,
    vy: 8,
    targetY: 100,
    frameIndex: 0,
    frameTimer: 0,
    bobPhase: 0,
    isDragging: false,
    swimSpeed: 'medium',
    groupId: null,
    schoolOffsetY: 0,
    zone: null,
    visible: true,
    bornAt: NOW,
    lifespanMs: 20 * 24 * 60 * 60 * 1000,
    dead: false,
    diedAt: 0,
    hunger: 1,
    starvingSince: 0,
    matureAt: NOW,
    wellFedSince: 0,
    ...over,
  };
}

const FISH_SPRITE: Sprite = {
  updatedAt: NOW,
  deletedAt: 0,
  rev: 0,
  id: 'sprite-fish',
  name: 'Fish',
  type: 'fish',
  width: 16,
  height: 16,
  frameMs: 120,
  frames: [[{ id: 'l', name: 'l', visible: true, opacity: 1, cells: new Array(256).fill('#3ba') }]],
};

/** A headless engine: a fake 800x600 canvas, sprites seeded, marked as already sized so update() runs. */
function makeEngine(instances: Instance[] = [], groups: TankGroup[] = []) {
  const engine = new TankEngine();
  const e = engine as unknown as Record<string, unknown>;
  e.canvas = {
    width: 800,
    height: 600,
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    style: {},
  };
  e.hasSized = true;
  engine.sprites = [FISH_SPRITE];
  engine.instances = instances;
  engine.groups = groups;
  return engine;
}

/** Call a private method by name. */
function call<T = unknown>(engine: TankEngine, name: string, ...args: unknown[]): T {
  return (engine as unknown as Record<string, (...a: unknown[]) => T>)[name](...args);
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  idc = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 - hunger / starvation catch-up (tickHunger)
// ─────────────────────────────────────────────────────────────────────────────
describe('tickHunger', () => {
  it('decays hunger linearly with elapsed real time', () => {
    const f = fish({ hunger: 1 });
    const engine = makeEngine([f]);
    call(engine, 'tickHunger', HUNGER_FULL_TO_EMPTY_MS / 2);
    expect(f.hunger).toBeCloseTo(0.5, 5);
    expect(f.dead).toBe(false);
    expect(f.starvingSince).toBe(0);
  });

  it('is a no-op for elapsed <= 0 (guards a negative dt when the tab regains focus)', () => {
    const f = fish({ hunger: 0.5 });
    const engine = makeEngine([f]);
    call(engine, 'tickHunger', 0);
    call(engine, 'tickHunger', -1000);
    expect(f.hunger).toBe(0.5);
  });

  it('records starvingSince at the real moment hunger crossed zero, not "now"', () => {
    // hunger 0.1, then a step 10x the full decay time -> it hits 0 one tenth of the way through.
    const f = fish({ hunger: 0.1 });
    const engine = makeEngine([f]);
    const step = HUNGER_FULL_TO_EMPTY_MS * 10;
    call(engine, 'tickHunger', step);
    expect(f.hunger).toBe(0);
    // fracToZero = 0.1 / (step/FULL) = 0.1/10 = 0.01 -> stepStart + 0.01*step
    const stepStart = NOW - step;
    expect(f.starvingSince).toBeCloseTo(stepStart + 0.01 * step, 0);
  });

  it('a single catch-up step can both empty hunger and kill the fish (closed-tab replay)', () => {
    const f = fish({ hunger: 0.1, groupId: 'g1' });
    const engine = makeEngine([f], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);
    call(engine, 'tickHunger', 6 * 24 * 60 * 60 * 1000); // 6 days
    expect(f.dead).toBe(true);
    expect(f.diedAt).toBe(NOW);
    expect(f.groupId).toBeNull();
  });

  it('kills a fish that was already at hunger 0 with a stale starvingSince (persisted, then reloaded)', () => {
    const f = fish({ hunger: 0, starvingSince: NOW - STARVATION_DEATH_MS - 1000 });
    const engine = makeEngine([f]);
    call(engine, 'tickHunger', 16); // one ordinary frame
    expect(f.dead).toBe(true);
  });

  it('does not kill a fish that has been starving for less than STARVATION_DEATH_MS', () => {
    const f = fish({ hunger: 0, starvingSince: NOW - STARVATION_DEATH_MS + 60_000 });
    const engine = makeEngine([f]);
    call(engine, 'tickHunger', 16);
    expect(f.dead).toBe(false);
  });

  it('ignores dead fish and non-fish instances', () => {
    const dead = fish({ dead: true, hunger: 0.5 });
    const decor = fish({ kind: 'object', hunger: 0.5 });
    const engine = makeEngine([dead, decor]);
    call(engine, 'tickHunger', HUNGER_FULL_TO_EMPTY_MS);
    expect(dead.hunger).toBe(0.5);
    expect(decor.hunger).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 - undo / redo
// ─────────────────────────────────────────────────────────────────────────────
describe('undo/redo', () => {
  it('removeInstance is undoable and redoable, restoring group membership', () => {
    const a = fish({ id: 'a', groupId: 'g1' });
    const b = fish({ id: 'b', groupId: 'g1' });
    const engine = makeEngine([a, b], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);

    engine.removeInstance('a');
    expect(engine.instances.map((i) => i.id)).toEqual(['b']);
    expect(engine.canUndo).toBe(true);

    engine.undo();
    expect(engine.instances.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(engine.instances.find((i) => i.id === 'a')!.groupId).toBe('g1');

    engine.redo();
    expect(engine.instances.map((i) => i.id)).toEqual(['b']);
  });

  it('undo clears the current selection', () => {
    const engine = makeEngine([fish({ id: 'a' }), fish({ id: 'b' })]);
    engine.selectInstance('a');
    engine.removeInstance('b');
    engine.selectInstance('a');
    engine.undo();
    expect(engine.selectedId).toBeNull();
    expect(engine.marqueeIds).toBeNull();
  });

  it('a snapshot is a deep copy - mutating an instance afterwards does not corrupt history', () => {
    const a = fish({ id: 'a', x: 10 });
    const engine = makeEngine([a]);
    engine.removeInstance('a'); // pushes a snapshot of [{a, x:10}]
    a.x = 999; // mutate the original object after it was snapshotted
    engine.undo();
    expect(engine.instances[0].x).toBe(10);
  });

  it('caps the undo stack at UNDO_LIMIT (50) entries', () => {
    const engine = makeEngine(Array.from({ length: 60 }, (_, i) => fish({ id: 'f' + i })));
    for (let i = 0; i < 55; i++) call(engine, 'pushUndo');
    expect((engine as unknown as { undoStack: unknown[] }).undoStack.length).toBe(50);
  });

  it('a new action clears the redo stack', () => {
    const engine = makeEngine([fish({ id: 'a' }), fish({ id: 'b' }), fish({ id: 'c' })]);
    engine.removeInstance('a');
    engine.undo();
    expect(engine.canRedo).toBe(true);
    engine.removeInstance('b');
    expect(engine.canRedo).toBe(false);
  });

  it('grouping is deliberately NOT undoable (only delete + drag are)', () => {
    const engine = makeEngine([fish({ id: 'a' }), fish({ id: 'b' })]);
    engine.toggleMarqueeSelect(['a', 'b']);
    engine.groupMarquee();
    expect(engine.groups).toHaveLength(1);
    expect(engine.canUndo).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 - grouping / schooling
// ─────────────────────────────────────────────────────────────────────────────
describe('grouping', () => {
  it('groupMarquee makes the selected instances one contiguous z-order block with a shared groupId', () => {
    const engine = makeEngine(['a', 'b', 'c', 'd', 'e'].map((id) => fish({ id })));
    engine.toggleMarqueeSelect(['b', 'd']);
    engine.groupMarquee();

    const g = engine.groups[0];
    const members = engine.instances.filter((i) => i.groupId === g.id).map((i) => i.id);
    expect(members.sort()).toEqual(['b', 'd']);
    // b and d are now adjacent in instances (a contiguous block), non-members keep their order
    const order = engine.instances.map((i) => i.id);
    const bi = order.indexOf('b');
    const di = order.indexOf('d');
    expect(Math.abs(bi - di)).toBe(1);
    expect(order.filter((id) => id === 'a' || id === 'c' || id === 'e')).toEqual(['a', 'c', 'e']);
    expect(engine.marqueeIds).toBeNull();
  });

  it('groupMarquee needs at least two members', () => {
    const engine = makeEngine([fish({ id: 'a' }), fish({ id: 'b' })]);
    engine.toggleMarqueeSelect(['a']);
    engine.groupMarquee();
    expect(engine.groups).toHaveLength(0);
  });

  it('pruneEmptyGroups dissolves a group left with fewer than two members', () => {
    const a = fish({ id: 'a', groupId: 'g1' });
    const b = fish({ id: 'b', groupId: 'g1' });
    const engine = makeEngine([a, b], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);
    engine.removeInstance('b'); // g1 now has one member -> should dissolve
    expect(engine.groups).toHaveLength(0);
    expect(engine.instances.find((i) => i.id === 'a')!.groupId).toBeNull();
  });

  it('deleteGroup removes both the members and the group entry', () => {
    const engine = makeEngine(
      [fish({ id: 'a', groupId: 'g1' }), fish({ id: 'b', groupId: 'g1' }), fish({ id: 'c' })],
      [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }],
    );
    engine.deleteGroup('g1');
    expect(engine.instances.map((i) => i.id)).toEqual(['c']);
    expect(engine.groups).toHaveLength(0);
  });

  it('ungroup keeps the instances and only clears membership + the group entry', () => {
    const engine = makeEngine(
      [fish({ id: 'a', groupId: 'g1' }), fish({ id: 'b', groupId: 'g1' })],
      [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }],
    );
    engine.ungroup('g1');
    expect(engine.instances).toHaveLength(2);
    expect(engine.instances.every((i) => i.groupId === null)).toBe(true);
    expect(engine.groups).toHaveLength(0);
  });

  it('coMoversFor: group members, else the rest of a multi-select marquee, else nothing', () => {
    const a = fish({ id: 'a', groupId: 'g1' });
    const b = fish({ id: 'b', groupId: 'g1' });
    const c = fish({ id: 'c' });
    const engine = makeEngine([a, b, c], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);
    expect(call<string[]>(engine, 'coMoversFor', a)).toEqual(['b']);
    expect(call<string[]>(engine, 'coMoversFor', c)).toEqual([]);

    engine.marqueeIds = ['b', 'c'];
    expect(call<string[]>(engine, 'coMoversFor', c).sort()).toEqual(['b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 - z-order
// ─────────────────────────────────────────────────────────────────────────────
describe('z-order', () => {
  it('bringToFront / sendToBack move an ungrouped instance to the end / start of the draw order', () => {
    const engine = makeEngine(['a', 'b', 'c'].map((id) => fish({ id })));
    engine.bringToFront('a');
    expect(engine.instances.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    engine.sendToBack('a');
    expect(engine.instances.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('bringToFront on a grouped instance raises the whole group block, order within it kept', () => {
    const engine = makeEngine([
      fish({ id: 'a', groupId: 'g1' }),
      fish({ id: 'x' }),
      fish({ id: 'b', groupId: 'g1' }),
      fish({ id: 'y' }),
    ], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);
    engine.bringToFront('a');
    expect(engine.instances.map((i) => i.id)).toEqual(['x', 'y', 'a', 'b']);
  });

  it('visibleDrawOrder is stable when nothing is being dragged', () => {
    const engine = makeEngine(['a', 'b', 'c'].map((id) => fish({ id })));
    expect(engine.visibleDrawOrder().map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('a dragged instance (and its co-movers) sort to the front of the draw order', () => {
    const engine = makeEngine([
      fish({ id: 'a', groupId: 'g1' }),
      fish({ id: 'x' }),
      fish({ id: 'b', groupId: 'g1' }),
    ], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: null }]);
    (engine as unknown as { draggingInstance: Instance | null }).draggingInstance =
      engine.instances.find((i) => i.id === 'a')!;
    expect(engine.visibleDrawOrder().map((i) => i.id)).toEqual(['x', 'a', 'b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 - swim bounds
// ─────────────────────────────────────────────────────────────────────────────
describe('swimBoundsFor', () => {
  it('no zone: x/y range is the canvas minus the sprite footprint and the sand strip', () => {
    const engine = makeEngine([fish()]);
    const b = call<{ xMin: number; xMax: number; yMin: number; yMax: number }>(
      engine,
      'swimBoundsFor',
      engine.instances[0],
    );
    // sprite 16*DISPLAY_SCALE(4) = 64px; sand = max(18, 600*0.08) = 48
    expect(b.xMin).toBe(0);
    expect(b.xMax).toBe(800 - 64);
    expect(b.yMin).toBe(0);
    expect(b.yMax).toBe(600 - 48 - 64);
  });

  it('a zone that has drifted partly off-canvas still yields a reachable range (never traps the fish)', () => {
    const f = fish({ zone: { x0: 700, y0: 0, x1: 2000, y1: 2000 } });
    const engine = makeEngine([f]);
    const b = call<{ xMin: number; xMax: number; yMin: number; yMax: number }>(engine, 'swimBoundsFor', f);
    expect(b.xMin).toBeLessThanOrEqual(b.xMax);
    expect(b.yMin).toBeLessThanOrEqual(b.yMax);
    expect(b.xMax).toBeLessThanOrEqual(800 - 64);
  });

  it('zoneFor prefers the group zone over the instance zone', () => {
    const gz = { x0: 10, y0: 10, x1: 100, y1: 100 };
    const iz = { x0: 500, y0: 500, x1: 600, y1: 600 };
    const f = fish({ groupId: 'g1', zone: iz });
    const engine = makeEngine([f], [{ updatedAt: NOW, deletedAt: 0, rev: 0, id: 'g1', name: 'G', zone: gz }]);
    expect(call(engine, 'zoneFor', f)).toEqual(gz);
    f.groupId = null;
    expect(call(engine, 'zoneFor', f)).toEqual(iz);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 - update() physics
// ─────────────────────────────────────────────────────────────────────────────
describe('update', () => {
  it('bounces a fish off the left wall: clamps x and flips dir to +1', () => {
    const f = fish({ x: -50, dir: -1, vx: 100 });
    const engine = makeEngine([f]);
    call(engine, 'update', 0.1);
    expect(f.x).toBe(0);
    expect(f.dir).toBe(1);
  });

  it('bounces a fish off the right wall: clamps x and flips dir to -1', () => {
    const f = fish({ x: 5000, dir: 1, vx: 100 });
    const engine = makeEngine([f]);
    call(engine, 'update', 0.1);
    expect(f.x).toBe(800 - 64);
    expect(f.dir).toBe(-1);
  });

  it('a dead fish floats up toward the surface and does not swim horizontally', () => {
    const f = fish({ dead: true, x: 300, y: 400 });
    const engine = makeEngine([f]);
    call(engine, 'update', 0.1);
    expect(f.x).toBe(300);
    expect(f.y).toBeLessThan(400);
  });

  it('marks a fish dead once it has outlived its lifespan', () => {
    const f = fish({ bornAt: NOW - 1000, lifespanMs: 500 });
    const engine = makeEngine([f]);
    call(engine, 'update', 0.016);
    expect(f.dead).toBe(true);
    expect(f.diedAt).toBe(NOW);
  });

  it('does nothing until the canvas has been sized at least once', () => {
    const f = fish({ x: 5000, dir: 1 });
    const engine = makeEngine([f]);
    (engine as unknown as { hasSized: boolean }).hasSized = false;
    call(engine, 'update', 1);
    expect(f.x).toBe(5000); // untouched - not clamped against the 300x150 default
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 - food
// ─────────────────────────────────────────────────────────────────────────────
describe('food', () => {
  it('feedAt drops a pellet clamped to the canvas, falling at FOOD_FALL_SPEED', () => {
    const engine = makeEngine();
    call(engine, 'feedAt', -100, -100);
    call(engine, 'feedAt', 5000, 300);
    expect(engine.foodItems).toHaveLength(2);
    expect(engine.foodItems[0]).toMatchObject({ x: 0, y: 0 });
    expect(engine.foodItems[1].x).toBe(800);
    expect(engine.foodItems[0].vy).toBeGreaterThan(0);
  });

  it('nearestFood returns the closest pellet, or null when there is none', () => {
    const engine = makeEngine();
    expect(call(engine, 'nearestFood', 0, 0)).toBeNull();
    engine.foodItems = [
      { id: 'a', x: 100, y: 100, vy: 10 },
      { id: 'b', x: 10, y: 10, vy: 10 },
    ];
    expect(call<{ id: string }>(engine, 'nearestFood', 0, 0).id).toBe('b');
  });

  it('a fish within FOOD_EAT_RADIUS eats the pellet on the next update: food gone, hunger up', () => {
    // fish centre is at x+32, y+32 for a 64px sprite; put a pellet right on it.
    const f = fish({ x: 100, y: 100, hunger: 0.2 });
    const engine = makeEngine([f]);
    engine.foodItems = [{ id: 'p', x: 132, y: 132, vy: 10 }];
    call(engine, 'update', 0.016);
    expect(engine.foodItems).toHaveLength(0);
    expect(f.hunger).toBeCloseTo(0.2 + FOOD_HUNGER_GAIN, 5);
    expect(f.starvingSince).toBe(0);
  });

  it('eating never pushes hunger above 1', () => {
    const f = fish({ x: 100, y: 100, hunger: 0.9 });
    const engine = makeEngine([f]);
    engine.foodItems = [{ id: 'p', x: 132, y: 132, vy: 10 }];
    call(engine, 'update', 0.016);
    expect(f.hunger).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 - hit-test & selection
// ─────────────────────────────────────────────────────────────────────────────
describe('hitTest & selection', () => {
  it('hitTest returns the topmost (last in the array) instance under the point', () => {
    const engine = makeEngine([
      fish({ id: 'back', x: 100, y: 100 }),
      fish({ id: 'front', x: 100, y: 100 }),
    ]);
    expect(call<Instance | null>(engine, 'hitTest', 120, 120)!.id).toBe('front');
    expect(call<Instance | null>(engine, 'hitTest', 5, 5)).toBeNull();
  });

  it('toggleMarqueeSelect adds all when not fully selected, removes all when already selected', () => {
    const engine = makeEngine(['a', 'b'].map((id) => fish({ id })));
    engine.toggleMarqueeSelect(['a', 'b']);
    expect(engine.marqueeIds!.sort()).toEqual(['a', 'b']);
    engine.toggleMarqueeSelect(['a', 'b']);
    expect(engine.marqueeIds).toBeNull();
  });

  it('selectInstance(id) clears any marquee; selectInstance(null) leaves it', () => {
    const engine = makeEngine([fish({ id: 'a' }), fish({ id: 'b' })]);
    engine.toggleMarqueeSelect(['a', 'b']);
    engine.selectInstance('a');
    expect(engine.marqueeIds).toBeNull();
    engine.toggleMarqueeSelect(['a', 'b']);
    engine.selectInstance(null);
    expect(engine.marqueeIds).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setInstanceSpeed
// ─────────────────────────────────────────────────────────────────────────────
describe('setInstanceSpeed', () => {
  it('updates the preset and re-rolls a velocity within that preset range', () => {
    const f = fish({ swimSpeed: 'slow', vx: 10, vy: 4 });
    const engine = makeEngine([f]);
    engine.setInstanceSpeed(f.id, 'veryFast');
    expect(f.swimSpeed).toBe('veryFast');
    expect(f.vx).toBeGreaterThanOrEqual(55);
    expect(f.vx).toBeLessThanOrEqual(80);
  });

  it('ignores non-fish instances', () => {
    const d = fish({ kind: 'object', swimSpeed: 'slow' });
    const engine = makeEngine([d]);
    engine.setInstanceSpeed(d.id, 'fast');
    expect(d.swimSpeed).toBe('slow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P6-3 - a tank somebody else shared
// ─────────────────────────────────────────────────────────────────────────────
describe('read-only engine (a shared tank)', () => {
  function sharedState(instances: Instance[]) {
    return {
      instances,
      groups: [],
      roomInstances: [],
      width: 400,
      height: 300,
      shape: 'rectangle' as const,
      cornerRadiusFrac: 0.22,
      ovalTopCutFrac: 0.28,
      backgroundSpriteId: null,
      roomBackgroundSpriteId: null,
      backgroundTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
      waterLevel: 1,
      algae: 0,
      lastTickAt: null,
    };
  }

  it('loads its contents from the source it was given, not from local storage', async () => {
    const theirFish = fish();
    const engine = new TankEngine({
      readOnly: true,
      source: { load: async () => ({ tankId: 'tank_theirs', sprites: [FISH_SPRITE], state: sharedState([theirFish]) }) },
    });
    // The load path is the same one the local engine uses; only where it reads from differs.
    await engine.hydrate();

    expect(engine.tankId).toBe('tank_theirs');
    expect(engine.instances.map((i) => i.id)).toEqual([theirFish.id]);
    expect(engine.tankWidth).toBe(400);
  });

  it('refuses to save, so a view of someone else\'s work cannot become a write', async () => {
    const engine = new TankEngine({
      readOnly: true,
      source: { load: async () => ({ tankId: 'tank_theirs', sprites: [], state: sharedState([]) }) },
    });
    await engine.hydrate();

    const result = await engine.save();
    expect(result.ok).toBe(false);
  });

  it('never swaps in this browser\'s sprite library for theirs', async () => {
    const engine = new TankEngine({
      readOnly: true,
      source: { load: async () => ({ tankId: 'tank_theirs', sprites: [FISH_SPRITE], state: sharedState([]) }) },
    });
    await engine.hydrate();

    engine.refreshPalette();

    expect(engine.sprites).toEqual([FISH_SPRITE]);
  });
});
