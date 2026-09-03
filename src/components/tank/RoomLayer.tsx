import { useEffect, useRef } from 'react';
import type { TankEngine } from '@/hooks/useTank';
import { paintLayers } from '@/lib/pixelMath';
import type { RoomInstance } from '@/lib/types';

const DISPLAY_SCALE = 4;

/** A single room decoration, drawn at its native sprite size (same DISPLAY_SCALE as in-tank
 *  instances, so it reads as the "same size" whether it's inside the tank or outside it) and
 *  positioned by its center at (xFrac, yFrac) of the viewport. */
function RoomItem({ engine, inst, viewportSize }: { engine: TankEngine; inst: RoomInstance; viewportSize: { width: number; height: number } }) {
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
    ctx.clearRect(0, 0, pw, ph);
    paintLayers(ctx, sprite.frames[0], width, height, DISPLAY_SCALE);
  }, [engine, sprite]);

  if (!sprite || !inst.visible) return null;
  const selected = engine.selectedRoomId === inst.id;

  return (
    <div
      className={`tank-room-item${selected ? ' selected' : ''}`}
      style={{ left: inst.xFrac * viewportSize.width, top: inst.yFrac * viewportSize.height }}
      onPointerDown={(e) => engine.onRoomPointerDown(e, inst.id)}
      onPointerMove={(e) => engine.onRoomPointerMove(e)}
      onPointerUp={() => engine.onRoomPointerUp()}
      onPointerCancel={() => engine.onRoomPointerUp()}
    >
      <canvas ref={canvasRef} className="pixelated" />
    </div>
  );
}

export function RoomLayer({ engine, viewportSize }: { engine: TankEngine; viewportSize: { width: number; height: number } }) {
  if (!engine.roomInstances.length) return null;
  return (
    <div className="tank-room-layer">
      {engine.roomInstances.map((inst) => (
        <RoomItem key={inst.id} engine={engine} inst={inst} viewportSize={viewportSize} />
      ))}
    </div>
  );
}
