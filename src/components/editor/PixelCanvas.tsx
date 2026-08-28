import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

export function PixelCanvas({ engine }: { engine: PixelEditorEngine }) {
  return (
    <div
      className="pixel-canvas-wrap"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) engine.deselect();
      }}
    >
      <canvas
        ref={(el) => engine.attachCanvas(el)}
        className="pixel-canvas pixelated"
        data-tool={engine.tool}
        onPointerDown={(e) => engine.onPointerDown(e)}
        onPointerMove={(e) => engine.onPointerMove(e)}
        onPointerUp={() => engine.onPointerUp()}
        onPointerCancel={() => engine.onPointerUp()}
      />
    </div>
  );
}
