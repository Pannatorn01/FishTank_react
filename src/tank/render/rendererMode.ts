export type TankRendererMode = 'canvas2d' | 'pixi';

/**
 * Which renderer draws the tank's water/instances/glass-outline on screen (see
 * docs/PIXI_MIGRATION_PLAN.md §6 P1) - TankEngine's own simulation, input handling, undo, and export
 * are identical either way; this only controls the visible display layer in TankCanvas.tsx.
 *
 * Resolution order:
 * 1. `?tankRenderer=pixi` / `?tankRenderer=canvas2d` in the URL - a runtime override with no rebuild
 *    needed, for quickly comparing the two side by side while testing. Never meant for end users.
 * 2. `VITE_TANK_RENDERER` at build time (set in `.env` or the environment) - the real rollout switch.
 * 3. `'canvas2d'` - the default while Pixi is still being verified for parity.
 */
export function getTankRendererMode(): TankRendererMode {
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('tankRenderer');
    if (param === 'pixi' || param === 'canvas2d') return param;
  }
  const envValue = import.meta.env.VITE_TANK_RENDERER;
  return envValue === 'pixi' ? 'pixi' : 'canvas2d';
}
