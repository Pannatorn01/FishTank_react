import type React from 'react';
import { BG_ROTATE_HANDLE_GAP, type BgHandle, type TankEngine } from '@/hooks/useTank';

const CORNERS: { handle: BgHandle; className: string }[] = [
  { handle: 'nw', className: 'tank-bg-handle-nw' },
  { handle: 'ne', className: 'tank-bg-handle-ne' },
  { handle: 'sw', className: 'tank-bg-handle-sw' },
  { handle: 'se', className: 'tank-bg-handle-se' },
];

/** The selected background's move/resize/rotate box, rendered as a DOM layer in .tank-viewport
 *  (sibling to .tank-frame, same trick RoomLayer uses for room decorations) instead of drawn into
 *  TankEngine's own <canvas>. A <canvas> can never show anything outside its own raster bounds, so
 *  dragging/resizing the background past the tank frame's edge used to make the box silently vanish
 *  right at that edge; living in the viewport instead means it now stays visible/grabbable out to
 *  the viewport's own edge (still clipped there, by .tank-viewport's overflow:hidden - it just isn't
 *  clipped by the *frame* any more). Position math converts the engine's canvas-logical coordinates
 *  (same space as Instance.x/y) to on-screen px via frameOffset (the frame's own centered position
 *  within the viewport - see TankCanvas) and effectiveScale (the frame's current zoom). */
export function TankBackgroundOverlay({
  engine,
  frameOffset,
  effectiveScale,
}: {
  engine: TankEngine;
  frameOffset: { left: number; top: number };
  effectiveScale: number;
}) {
  if (!engine.backgroundEditing || !engine.backgroundSpriteId) return null;
  const half = engine.backgroundBoxHalfSize();
  if (!half) return null;

  const { x, y, rotation } = engine.backgroundTransform;
  const left = frameOffset.left + x * effectiveScale;
  const top = frameOffset.top + y * effectiveScale;
  const width = half.halfW * 2 * effectiveScale;
  const height = half.halfH * 2 * effectiveScale;
  const gap = BG_ROTATE_HANDLE_GAP * effectiveScale;
  const boxStyle: React.CSSProperties = {
    left,
    top,
    width,
    height,
    transform: `translate(-50%, -50%) rotate(${(rotation * 180) / Math.PI}deg)`,
  };

  // Handles were hidden by a Save (see backgroundHandlesVisible) - only an invisible hit-region
  // remains, so clicking the placed background brings them back (Photoshop-layer-click convention)
  // without that same click also nudging the placement it just committed.
  if (!engine.backgroundHandlesVisible) {
    return (
      <div
        className="tank-bg-reveal"
        style={boxStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          engine.revealBackgroundHandles();
        }}
      />
    );
  }

  const grab = (handle: BgHandle) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    engine.startBgDrag(handle, e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  return (
    <div
      className="tank-bg-box"
      style={boxStyle}
      onPointerDown={grab('move')}
      onPointerMove={(e) => engine.onBgPointerMove(e)}
      onPointerUp={() => engine.onBgPointerUp()}
      onPointerCancel={() => engine.onBgPointerUp()}
    >
      <div className="tank-bg-stalk" style={{ top: -gap, height: gap }} />
      <div className="tank-bg-handle tank-bg-handle-rotate" style={{ top: -gap }} onPointerDown={grab('rotate')} />
      {CORNERS.map(({ handle, className }) => (
        <div key={handle} className={`tank-bg-handle ${className}`} onPointerDown={grab(handle)} />
      ))}
    </div>
  );
}
