import { useEffect, useRef } from 'react';
import type { TankEngine } from '@/hooks/useTank';
import { paintLayers } from '@/lib/pixelMath';
import type { RoomInstance } from '@/lib/types';

const DISPLAY_SCALE = 4;

/** A single room decoration, rasterized at its native sprite size (same DISPLAY_SCALE useTank.ts uses
 *  for every in-tank sprite, for the same reason: a fixed, crisp logical-pixel buffer regardless of
 *  view zoom) and then scaled *visually* by `effectiveScale` - the same auto-fit-times-zoom factor
 *  the tank canvas itself is drawn at (see TankCanvas.tsx). Room decorations live in their own DOM
 *  layer outside the canvas entirely, so nothing else makes them shrink and grow in step with the
 *  tank the way an in-tank fish or plant automatically does just by being drawn on that same,
 *  CSS-scaled canvas: without this they stayed a fixed absolute size no matter how small the tank
 *  itself was drawn, which is what let one dwarf a tank many times its own on-screen size. The oval/
 *  round/rounded outline the tank draws is only ever the *swim* boundary - room decor was always
 *  meant to read as furniture around that boundary, sized to match it, not objects with a size of
 *  their own independent of the room they're sitting in.
 *
 *  Position converts through frameOffset/effectiveScale - the exact same pair TankBackgroundOverlay
 *  uses for the background sprite's own move handles - now that RoomInstance.x/y live in the same
 *  tank-logical coordinate space as everything else (see its doc comment in types.ts): `frameOffset`
 *  is where the tank frame's own top-left corner sits inside the viewport, so `frameOffset.left +
 *  inst.x * effectiveScale` is just "the frame's corner, plus this item's tank-relative offset from
 *  it, both already in the same current-zoom screen scale" - no separate viewport-fraction
 *  reprojection needed the way the pre-P2 version required (see docs/PIXI_MIGRATION_PLAN.md §7-B). */
function RoomItem({
  engine,
  inst,
  frameOffset,
  effectiveScale,
}: {
  engine: TankEngine;
  inst: RoomInstance;
  frameOffset: { left: number; top: number };
  effectiveScale: number;
}) {
  const sprite = engine.spriteFor(inst);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = engine.spriteDims(sprite);
    const { pw, ph } = engine.spritePx(sprite);
    canvas.width = pw;
    canvas.height = ph;

    const draw = (frameIndex: number) => {
      ctx.clearRect(0, 0, pw, ph);
      paintLayers(ctx, sprite.frames[frameIndex], width, height, DISPLAY_SCALE);
    };
    draw(0);
    if (sprite.frames.length <= 1) return;

    // Room decorations otherwise never animate - cycling through frames here mirrors the frame
    // animation every in-tank instance (fish and objects alike) gets from TankEngine.update(),
    // just driven by its own rAF loop since this canvas lives outside that engine's draw().
    const frameInterval = sprite.frameMs || 400;
    let frameIndex = 0;
    let elapsed = 0;
    let lastTime = 0;
    let rafId: number;
    const tick = (t: number) => {
      elapsed += lastTime ? t - lastTime : 0;
      lastTime = t;
      if (elapsed >= frameInterval) {
        elapsed = 0;
        frameIndex = (frameIndex + 1) % sprite.frames.length;
        draw(frameIndex);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine, sprite]);

  if (!sprite || !inst.visible) return null;
  const selected = engine.selectedRoomId === inst.id;
  const left = frameOffset.left + inst.x * effectiveScale;
  const top = frameOffset.top + inst.y * effectiveScale;

  return (
    <div
      className={`tank-room-item${selected ? ' selected' : ''}`}
      style={{
        left,
        top,
        // Order matters: translate first (in the item's own untransformed box, so -50%/-50% is
        // exactly half of its native, unscaled size) then scale - scaling around the box's default
        // center transform-origin afterward can't un-center it, so the anchor point set by left/top
        // stays exactly where it was regardless of what effectiveScale happens to be.
        transform: `translate(-50%, -50%) scale(${effectiveScale})`,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        engine.onRoomPointerDown(e.clientX, e.clientY, inst.id);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => engine.onRoomPointerMove(e.clientX, e.clientY)}
      onPointerUp={() => engine.onRoomPointerUp()}
      onPointerCancel={() => engine.onRoomPointerUp()}
    >
      <canvas ref={canvasRef} className="pixelated" />
    </div>
  );
}

export function RoomLayer({
  engine,
  frameOffset,
  effectiveScale,
}: {
  engine: TankEngine;
  frameOffset: { left: number; top: number };
  effectiveScale: number;
}) {
  if (!engine.roomInstances.length) return null;
  return (
    <div className="tank-room-layer">
      {engine.roomInstances.map((inst) => (
        <RoomItem key={inst.id} engine={engine} inst={inst} frameOffset={frameOffset} effectiveScale={effectiveScale} />
      ))}
    </div>
  );
}
