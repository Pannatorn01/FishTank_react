import { useEffect, useRef, type DependencyList } from 'react';
import { paintLayers, spriteDims } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';

/**
 * A square canvas showing a pixel grid scaled to fit and centered inside it - the one implementation
 * behind every thumbnail in the app (the sprite library, the public gallery, the tank's sprite palette
 * and layer list, the frame strip, the editor's layer list), which were five hand-written copies of the
 * same clear/scale/center/paint sequence at five different sizes.
 *
 * `paint` is a callback rather than a `sprite` prop because the callers genuinely paint different
 * things: a whole sprite's first frame, one animation frame's layer stack, or a single layer's cells
 * *ignoring* its visibility (a hidden layer still has to show its contents in the layer list, which is
 * why that one can't go through `paintLayers`). The canvas is already cleared, scaled and translated
 * when `paint` runs - it only has to draw at `cellPx` per cell from the origin.
 */
export function PixelThumb({
  size,
  width,
  height,
  paint,
  deps,
  className,
}: {
  size: number;
  /** The grid's own dimensions in cells - what `size` has to fit. */
  width: number;
  height: number;
  paint: (ctx: CanvasRenderingContext2D, cellPx: number) => void;
  /**
   * When to repaint. Omit it - the default - to repaint on every render, which is what the frame strip
   * and the layer list need: their pixels are mutated in place by the editor engine, so there is no
   * value React could compare to notice the change. Pass `[sprite]` (or similar) where the source is
   * replaced rather than mutated and repainting is worth avoiding: a gallery page paints dozens of
   * these at once, and a large sprite is a fillRect per cell.
   */
  deps?: DependencyList;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // One scale for both axes (the larger dimension is what has to fit), so a non-square sprite keeps
    // its aspect ratio and is centered in the leftover space rather than stretched to the box.
    const cellPx = size / Math.max(width, height);
    ctx.save();
    ctx.translate((size - width * cellPx) / 2, (size - height * cellPx) / 2);
    paint(ctx, cellPx);
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} width={size} height={size} className={className ? `pixelated ${className}` : 'pixelated'} />;
}

/** The common case: a sprite's first frame. Repaints when the sprite object changes. */
export function SpriteThumb({ sprite, size, className }: { sprite: Sprite; size: number; className?: string }) {
  const { width, height } = spriteDims(sprite);
  return (
    <PixelThumb
      size={size}
      width={width}
      height={height}
      deps={[sprite, size]}
      className={className}
      paint={(ctx, cellPx) => paintLayers(ctx, sprite.frames[0], width, height, cellPx)}
    />
  );
}
