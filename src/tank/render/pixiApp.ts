import { Application } from 'pixi.js';

export interface CreatePixiAppOptions {
  /** Default `true` (crisp on a Retina/HiDPI screen, at `window.devicePixelRatio` resolution) with
   *  the canvas element's CSS size auto-managed to match the logical size Pixi is given.
   *
   *  Pass `false` for a canvas whose CSS size is meant to be driven externally instead - e.g.
   *  TankPixiLayer.tsx, which stretches its canvas via the same `width:100%;height:100%` CSS rule
   *  the Canvas2D tank canvas already uses (see index.css's `.tank-canvas`), so the backing store
   *  must stay at exactly the tank's *logical* pixel size (matching `Instance.x/y`'s own coordinate
   *  space 1:1) with no DPR multiplier or Pixi-managed CSS size fighting that external stretch. */
  autoDensity?: boolean;
  /** Only meaningful when `resizeTo` is used (i.e. `autoDensity: true`, the default) - ignored (left
   *  at Pixi's own default resolution handling) otherwise, since a manually-resized app (see
   *  `app.renderer.resize()`) should get resolution 1 so its logical and backing-store pixel sizes
   *  are identical, the same one-to-one relationship the Canvas2D tank canvas has always had. */
  resolution?: number;
}

/**
 * Creates and initializes a Pixi Application, with every setting a pixel-art app needs turned on up
 * front so nothing downstream has to remember to set it per-sprite:
 *
 * - `antialias: false` - Pixi's own line/shape antialiasing (Graphics strokes, etc.) off by default;
 *   individual sprite crispness is still controlled per-texture (see textureCache.ts's `scaleMode`).
 * - `backgroundAlpha: 0` - the canvas itself stays transparent; the tank scene (see tankScene.ts)
 *   paints its own water/background so this app's own clear color is never visible through anything.
 *
 * With the default `autoDensity: true`, the app is sized to fill `container` at the display's real
 * pixel density and its own CSS size is kept in sync automatically - the right choice for a
 * self-contained preview. Pass `autoDensity: false` for a canvas whose size is meant to be driven
 * externally instead (see CreatePixiAppOptions.autoDensity) - the caller is then responsible for
 * calling `app.renderer.resize(width, height)` itself.
 *
 * Pixi v8's `Application.init()` is async (unlike v7's synchronous constructor) - callers must await
 * this before touching `app.stage` or appending `app.canvas`.
 */
export async function createPixiApp(container: HTMLElement, options: CreatePixiAppOptions = {}): Promise<Application> {
  const { autoDensity = true, resolution } = options;
  const app = new Application();
  if (autoDensity) {
    await app.init({
      resizeTo: container,
      antialias: false,
      resolution: resolution ?? window.devicePixelRatio ?? 1,
      autoDensity: true,
      backgroundAlpha: 0,
    });
  } else {
    // No resizeTo/autoDensity: the caller drives sizing entirely via app.renderer.resize() and its
    // own CSS on app.canvas (see TankPixiLayer.tsx) - start at a harmless placeholder size rather
    // than 0x0, which some Pixi internals (texture allocation) don't like.
    await app.init({
      width: 1,
      height: 1,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      backgroundAlpha: 0,
    });
  }
  container.appendChild(app.canvas);
  return app;
}

export function destroyPixiApp(app: Application): void {
  app.destroy(true, { children: true, texture: true });
}
