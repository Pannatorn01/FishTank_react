/**
 * A single algae patch's shape (P5 §6 item 5, docs/PIXI_MIGRATION_PLAN.md) - a short random squiggle
 * of connected line segments scattered somewhere on the tank's glass, matching how real algae actually
 * grows (scattered fuzzy patches, not a uniform tint or tidy edge-band). Pure - no pixi/DOM imports, so
 * both renderers can share exactly the same generated layout for a given tank size (see
 * docs/PIXI_MIGRATION_PLAN.md P3's geometry.ts for why that matters: independently re-deriving the same
 * "random" shape per renderer would show two different-looking algae layouts depending on which mode
 * you're in - useTank.ts computes this once per tank size and both renderers just read the result off
 * the engine, rather than each calling generateAlgaePatches() itself).
 */
export interface AlgaePatch {
  /** Patch anchor, in tank-logical px - `points` are relative offsets from this. */
  x: number;
  y: number;
  points: { x: number; y: number }[];
}

/** Total patches once algae is fully grown (algae=1) - how many are actually drawn scales linearly
 *  with the current algae amount (see the reveal-count math at each renderer's own call site), so a
 *  partially-grown tank shows a fraction of this set rather than every patch at reduced opacity. */
export const ALGAE_PATCH_COUNT = 14;

export function generateAlgaePatches(tankWidth: number, tankHeight: number): AlgaePatch[] {
  const patches: AlgaePatch[] = [];
  for (let i = 0; i < ALGAE_PATCH_COUNT; i++) {
    const x = 16 + Math.random() * Math.max(1, tankWidth - 32);
    const y = 16 + Math.random() * Math.max(1, tankHeight - 32);
    const segments = 3 + Math.floor(Math.random() * 2);
    const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    let angle = Math.random() * Math.PI * 2;
    for (let s = 0; s < segments; s++) {
      angle += (Math.random() - 0.5) * 2.6;
      const len = 9 + Math.random() * 13;
      const prev = points[points.length - 1];
      points.push({ x: prev.x + Math.cos(angle) * len, y: prev.y + Math.sin(angle) * len });
    }
    patches.push({ x, y, points });
  }
  return patches;
}
