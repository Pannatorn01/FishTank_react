import { useEffect, useRef, useState } from 'react';
import { Container, Sprite as PixiSprite } from 'pixi.js';
import { paintLayers } from '@/lib/pixelMath';
import * as storage from '@/lib/storage';
import type { Sprite } from '@/lib/types';
import { createPixiApp, destroyPixiApp } from '../pixiApp';
import { textureFor } from '../textureCache';

/**
 * P0 spike (docs/PIXI_MIGRATION_PLAN.md §6) - proves two things before any real migration work
 * starts, using the user's own real saved sprites rather than a synthetic test image:
 *
 * 1. A sprite rasterized through the existing `paintLayers()` and handed to Pixi as a texture reads
 *    exactly as crisp as the same sprite drawn straight onto a plain `<canvas>` - i.e. the texture
 *    bridge (textureCache.ts) doesn't introduce blur.
 * 2. pixi.js's own bundle-size cost is what the plan's "Done when" expects (~400KB gzip or less).
 *
 * Reached only via `?pixi=1` (see main.tsx) - never part of the normal app flow, and deleted once P1
 * starts (this file's only job is to be thrown away after answering the two questions above).
 */
export function PixiSpike() {
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const pixiHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = (storage.loadSprites() ?? []).filter((s) => s.type !== 'background');
    setSprites(loaded);
    if (loaded[0]?.id) setSelectedId(loaded[0].id);
  }, []);

  const sprite = sprites.find((s) => s.id === selectedId) ?? null;

  // Canvas2D reference render - the same paintLayers() call the editor/tank already use everywhere,
  // at a large on-screen size (16x a typical 16px sprite) so any blur is impossible to miss.
  useEffect(() => {
    const canvas = canvas2dRef.current;
    if (!canvas || !sprite) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = sprite.width || 16;
    const height = sprite.height || 16;
    const cellPx = 16;
    canvas.width = width * cellPx;
    canvas.height = height * cellPx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintLayers(ctx, sprite.frames[0], width, height, cellPx);
  }, [sprite]);

  // Pixi render - textureFor() is the exact bridge P1 will reuse for every fish/decoration in the
  // tank, so if this looks crisp, the real migration's sprites will too.
  useEffect(() => {
    const host = pixiHostRef.current;
    if (!host || !sprite) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    createPixiApp(host).then((app) => {
      if (cancelled) {
        destroyPixiApp(app);
        return;
      }
      const container = new Container();
      const tex = textureFor(sprite, 0);
      const spriteView = new PixiSprite(tex);
      // Blow the texture's native (DISPLAY_SCALE=4) size up further to match the Canvas2D reference's
      // 16px-per-cell rendering above (4 * 4 = 16), so the two are a fair, same-size comparison.
      spriteView.scale.set(4);
      container.addChild(spriteView);
      app.stage.addChild(container);
      cleanup = () => destroyPixiApp(app);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sprite]);

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#eee', background: '#1a1a1a', minHeight: '100vh' }}>
      <h1>Pixi Spike (P0) - crispness + bundle-size check</h1>
      <p>ตรวจว่า Pixi วาดสไปรท์คมเท่า Canvas2D ไหม ใช้สไปรท์จริงจาก library (เลือกด้านล่าง)</p>
      <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)} style={{ marginBottom: 16, padding: 4 }}>
        {sprites.length === 0 && <option value="">(ไม่มีสไปรท์ในไลบรารี - วาดอย่างน้อย 1 ตัวก่อน)</option>}
        {sprites.map((s) => (
          <option key={s.id} value={s.id ?? ''}>
            {s.name} ({s.type})
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 32 }}>
        <div>
          <div>Canvas2D (reference)</div>
          <canvas ref={canvas2dRef} className="pixelated" style={{ imageRendering: 'pixelated', border: '2px solid #555' }} />
        </div>
        <div>
          <div>Pixi (WebGL)</div>
          <div ref={pixiHostRef} style={{ width: 256, height: 256, border: '2px solid #555' }} />
        </div>
      </div>
    </div>
  );
}
