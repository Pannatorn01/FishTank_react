import { Application } from 'pixi.js';

/**
 * Creates and initializes a Pixi Application sized to fill `container`, with every setting a
 * pixel-art app needs turned on up front so nothing downstream has to remember to set it per-sprite:
 *
 * - `antialias: false` - Pixi's own line/shape antialiasing (Graphics strokes, etc.) off by default;
 *   individual sprite crispness is still controlled per-texture (see textureCache.ts's `scaleMode`).
 * - `resolution: window.devicePixelRatio` + `autoDensity: true` - renders at the display's real pixel
 *   density (crisp on a Retina/HiDPI screen) while `autoDensity` keeps the *CSS* size matching the
 *   logical size Pixi is told to use, rather than the backing-store size.
 * - `backgroundAlpha: 0` - the canvas itself stays transparent; TankScene (P1) paints its own water/
 *   background so this app's own clear color is never visible through anything.
 *
 * Pixi v8's `Application.init()` is async (unlike v7's synchronous constructor) - callers must await
 * this before touching `app.stage` or appending `app.canvas`.
 */
export async function createPixiApp(container: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: container,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    backgroundAlpha: 0,
  });
  container.appendChild(app.canvas);
  return app;
}

export function destroyPixiApp(app: Application): void {
  app.destroy(true, { children: true, texture: true });
}
