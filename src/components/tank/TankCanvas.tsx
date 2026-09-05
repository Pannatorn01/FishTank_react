import { useEffect, useRef, useState } from 'react';
import {
  OVAL_TOP_CUT_MAX,
  OVAL_TOP_CUT_MIN,
  ROUNDED_RADIUS_MAX,
  ROUNDED_RADIUS_MIN,
  SWIM_SPEEDS,
  TANK_SIZE_MAX,
  TANK_SIZE_MIN,
  TANK_ZOOM_STEPS,
  type TankEngine,
} from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import { TANK_SHAPES } from '@/lib/storage';
import type { TankShape } from '@/lib/types';
import { RoomLayer } from './RoomLayer';
import { TankBackgroundOverlay } from './TankBackgroundOverlay';

const SPEED_ICON: Record<(typeof SWIM_SPEEDS)[number], string> = {
  slow: 'fa-solid fa-turtle',
  medium: 'fa-solid fa-fish',
  fast: 'fa-solid fa-bolt',
  veryFast: 'fa-solid fa-bolt-lightning',
};

const SHAPE_ICON: Record<TankShape, string> = {
  rectangle: 'fa-solid fa-square',
  rounded: 'fa-solid fa-square-full',
  oval: 'fa-regular fa-circle',
};

/** Same cooldown/rationale as the sprite editor's PixelCanvas: a trackpad pinch or a fast scroll
 *  wheel fires many small wheel events per gesture, so a time gate (not a delta-magnitude
 *  threshold, since deltaY's scale varies by device/deltaMode) keeps one gesture from blowing
 *  through several zoom steps at once. */
const WHEEL_ZOOM_COOLDOWN_MS = 80;

export function TankCanvas({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const selected = engine.selectedInstance;
  const drawingZone = !!engine.zoneDraftTarget;
  const [justSaved, setJustSaved] = useState(false);
  const frameElRef = useRef<HTMLDivElement | null>(null);
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const lastWheelZoom = useRef(0);

  const handleSave = () => {
    engine.save();
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1500);
  };

  const handleRefresh = () => {
    engine.refresh(() => confirm(t('tank.refreshConfirm')));
  };

  const [widthInput, setWidthInput] = useState(String(engine.tankWidth ?? ''));
  const [heightInput, setHeightInput] = useState(String(engine.tankHeight ?? ''));
  useEffect(() => {
    setWidthInput(String(engine.tankWidth ?? ''));
    setHeightInput(String(engine.tankHeight ?? ''));
  }, [engine.tankWidth, engine.tankHeight]);

  const applySize = () => {
    const w = parseInt(widthInput, 10);
    const h = parseInt(heightInput, 10);
    if (Number.isFinite(w) && Number.isFinite(h)) engine.setTankSize(w, h);
  };

  useEffect(() => {
    if (!drawingZone) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') engine.cancelZoneTool();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawingZone, engine]);

  // Tracks the viewport's own (fixed-ish, but window-resize-sensitive) content size, so the
  // auto-fit scale below can be recomputed whenever it changes.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl+scroll while the mouse is over the tank zooms it, same shortcut/behavior as the sprite
  // editor's canvas. A native (non-passive) listener is required: React 17+ registers wheel
  // listeners as passive at the root, so a synthetic onWheel prop can't preventDefault() the
  // browser's own ctrl+wheel page zoom.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelZoom.current < WHEEL_ZOOM_COOLDOWN_MS) return;
      lastWheelZoom.current = now;
      if (e.deltaY < 0) engine.zoomIn();
      else if (e.deltaY > 0) engine.zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [engine]);

  // Keeps the canvas resolution and everyone's positions rescaled live while .tank-frame's size is
  // changing (native drag) - resizeCanvas() only touches the engine's own data (canvas pixel
  // buffer, instance x/y), never anything CSS/layout-related, so calling it here is safe. It must
  // NOT also write the observed size back into engine.tankWidth/Height here, though: that's exactly
  // what (via displayScale below) controls this element's own inline width/height, so feeding the
  // observed size back into it would race the two against each other - each write nudges the box a
  // little, which retriggers the observer, forever (a classic ResizeObserver feedback loop, and the
  // reason an earlier version of this drifted the tank smaller every frame while "resizing" it).
  // Committing the size is handled once, on pointerup, below instead.
  useEffect(() => {
    const el = frameElRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => engine.resizeCanvas());
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine]);

  // Commits the frame's current size once a resize gesture actually ends, instead of continuously -
  // firing on any window pointerup is harmless (setTankSize() no-ops if the size didn't change), and
  // sidesteps needing to precisely detect "was that pointerdown on the resize grip". The measured
  // rect is in on-screen pixels, which includes the current zoom - dividing it back out is what
  // keeps the *logical* tank size (what gets saved) independent of how zoomed-out the view happened
  // to be while dragging.
  useEffect(() => {
    const onPointerUp = () => {
      const el = frameElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        engine.setTankSize(Math.round(rect.width / engine.displayScale), Math.round(rect.height / engine.displayScale));
      }
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, [engine]);

  const tankWidth = engine.tankWidth ?? TANK_SIZE_MIN.width;
  const tankHeight = engine.tankHeight ?? TANK_SIZE_MIN.height;
  // "Fit" = as large as the tank can be drawn while still fitting entirely inside the viewport - the
  // zoom steps are a fraction *of this*, so 100% zoom can never spill outside the viewport the tank
  // is centered in, and shrinking the browser window (or growing the tank past what fits) both just
  // shrink this the same way. Never scales past 1 (a small tank isn't blown up to fill the space).
  const fitScale =
    viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(1, viewportSize.width / tankWidth, viewportSize.height / tankHeight)
      : 1;
  const effectiveScale = fitScale * TANK_ZOOM_STEPS[engine.zoomIndex];

  useEffect(() => {
    engine.setDisplayScale(effectiveScale);
    engine.resizeCanvas();
  }, [engine, effectiveScale, tankWidth, tankHeight]);

  // min/max are expressed in on-screen px too (scaled the same as width/height), so the native
  // resize handle itself can't be dragged past TANK_SIZE_MIN/MAX in real time - without this, only
  // the pointerup commit (setTankSize's own clamp) enforced the limit, which meant the box would
  // visibly overshoot while dragging and then snap back the moment you let go.
  const frameStyle = {
    width: tankWidth * effectiveScale,
    height: tankHeight * effectiveScale,
    minWidth: TANK_SIZE_MIN.width * effectiveScale,
    minHeight: TANK_SIZE_MIN.height * effectiveScale,
    maxWidth: TANK_SIZE_MAX.width * effectiveScale,
    maxHeight: TANK_SIZE_MAX.height * effectiveScale,
  };

  // Matches the water shape to whatever TankEngine.draw() actually clips its canvas drawing to
  // (see shapePath/clampCenterToShape in useTank.ts) - 'oval' is a plain 50% radius (an ellipse
  // inscribed in any rectangle), 'rounded' mirrors the same corner-radius formula the engine uses
  // for its clip path/physics so the visible glass edge and the invisible collision edge agree.
  const wrapShapeStyle =
    engine.tankShape === 'oval'
      ? { borderRadius: '50%' }
      : engine.tankShape === 'rounded'
        ? { borderRadius: Math.min(tankWidth, tankHeight) * engine.tankCornerRadiusFrac * effectiveScale }
        : undefined;

  // .tank-frame is centered in .tank-viewport via flexbox (see index.css) - this is that same
  // centering done in JS, so TankBackgroundOverlay can convert the engine's canvas-logical
  // coordinates into on-screen positions within the viewport, independent of the frame's own DOM
  // position.
  const frameOffset = {
    left: Math.max(0, (viewportSize.width - frameStyle.width) / 2),
    top: Math.max(0, (viewportSize.height - frameStyle.height) / 2),
  };

  return (
    <div className="tank-canvas-col">
      <div
        className="tank-viewport"
        ref={(el) => {
          viewportElRef.current = el;
          engine.attachViewport(el);
        }}
        onPointerDown={() => engine.selectRoomInstance(null)}
      >
        <div className="tank-frame" style={frameStyle} ref={frameElRef}>
          <div className="tank-wrap" style={wrapShapeStyle} ref={(el) => engine.attachWrap(el)}>
            <canvas
              ref={(el) => {
                engine.attachCanvas(el);
                if (el) engine.resizeCanvas();
              }}
              className={`tank-canvas${drawingZone ? ' drawing-zone' : ''}`}
              onPointerDown={(e) => engine.onCanvasPointerDown(e)}
              onPointerMove={(e) => engine.onCanvasPointerMove(e)}
              onPointerUp={() => engine.onCanvasPointerUp()}
              onPointerCancel={() => engine.onCanvasPointerUp()}
            />
          </div>
        </div>
        {/* Room decorations render as their own DOM layer, after (i.e. visually above) .tank-frame,
         * so they can overlap the tank chrome - unlike in-tank instances they aren't drawn into the
         * simulation <canvas> at all, since they live outside that coordinate space entirely. */}
        <RoomLayer engine={engine} viewportSize={viewportSize} />
        <TankBackgroundOverlay engine={engine} frameOffset={frameOffset} effectiveScale={effectiveScale} />
      </div>

      <div className="tank-action-bar">
        <div className="tank-action-group">
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('action.undo')}
            disabled={!engine.canUndo}
            onClick={() => engine.undo()}
          >
            <i className="fa-solid fa-arrow-rotate-left" />
          </button>
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('action.redo')}
            disabled={!engine.canRedo}
            onClick={() => engine.redo()}
          >
            <i className="fa-solid fa-arrow-rotate-right" />
          </button>
          <span className="tank-action-divider" aria-hidden="true" />
          <button
            type="button"
            className={`selection-toolbar-btn${justSaved ? ' active' : ''}`}
            title={justSaved ? t('tank.saved') : t('tank.save')}
            disabled={!engine.dirty}
            onClick={handleSave}
          >
            <i className={`fa-solid ${justSaved ? 'fa-check' : 'fa-floppy-disk'}`} />
          </button>
          <button type="button" className="selection-toolbar-btn" title={t('tank.refresh')} onClick={handleRefresh}>
            <i className="fa-solid fa-arrows-rotate" />
          </button>
          <span className="tank-action-divider" aria-hidden="true" />
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('status.zoomOut')}
            disabled={engine.zoomIndex === 0}
            onClick={() => engine.zoomOut()}
          >
            <i className="fa-solid fa-magnifying-glass-minus" />
          </button>
          <span className="tank-zoom-label">{engine.zoomLabel()}</span>
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('status.zoomIn')}
            disabled={engine.zoomIndex === TANK_ZOOM_STEPS.length - 1}
            onClick={() => engine.zoomIn()}
          >
            <i className="fa-solid fa-magnifying-glass-plus" />
          </button>
        </div>

        <div className="swim-toolbar" hidden={!selected || selected.kind !== 'fish'} title={t('tank.speedTitle')}>
          {SWIM_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={`swim-toolbar-btn${selected?.swimSpeed === speed ? ' active' : ''}`}
              title={t(`tank.speed.${speed}`)}
              onClick={() => selected && engine.setInstanceSpeed(selected.id, speed)}
            >
              <i className={SPEED_ICON[speed]} />
            </button>
          ))}
        </div>

        <div className="marquee-toolbar" hidden={!drawingZone}>
          <span className="marquee-toolbar-count">{t('tank.zoneHint')}</span>
          <button type="button" className="delete-selected-btn" onClick={() => engine.cancelZoneTool()}>
            {t('tank.zoneCancel')}
          </button>
        </div>

        <div className="marquee-toolbar" hidden={!engine.marqueeIds || engine.marqueeIds.length === 0}>
          <span className="marquee-toolbar-count">{t('tank.marqueeCount', { n: engine.marqueeIds?.length ?? 0 })}</span>
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('tank.groupSelected')}
            disabled={(engine.marqueeIds?.length ?? 0) < 2}
            onClick={() => engine.groupMarquee()}
          >
            <i className="fa-solid fa-object-group" />
          </button>
          <button type="button" className="delete-selected-btn" onClick={() => engine.deleteMarquee()}>
            <i className="fa-solid fa-trash" /> {t('tank.deleteSelectedMarquee')}
          </button>
        </div>

        <div className="selection-toolbar" hidden={!engine.selectedId}>
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('tank.sendToBack')}
            onClick={() => engine.selectedId && engine.sendToBack(engine.selectedId)}
          >
            <i className="fa-solid fa-angles-down" />
          </button>
          <button
            type="button"
            className="selection-toolbar-btn"
            title={t('tank.bringToFront')}
            onClick={() => engine.selectedId && engine.bringToFront(engine.selectedId)}
          >
            <i className="fa-solid fa-angles-up" />
          </button>
          {selected?.kind === 'fish' && (
            <button
              type="button"
              className="selection-toolbar-btn"
              title={t('tank.setZone')}
              onClick={() => engine.armZoneTool()}
            >
              <i className="fa-solid fa-vector-square" />
            </button>
          )}
          {selected?.kind === 'fish' && engine.selectedZone && (
            <button
              type="button"
              className="selection-toolbar-btn"
              title={t('tank.clearZone')}
              onClick={() => engine.clearZone()}
            >
              <i className="fa-solid fa-eraser" />
            </button>
          )}
          <button type="button" className="delete-selected-btn" onClick={() => engine.removeSelected()}>
            <i className="fa-solid fa-trash" /> {t('tank.deleteSelected')}
          </button>
        </div>

        <div className="selection-toolbar" hidden={!engine.selectedRoomId}>
          <button
            type="button"
            className="delete-selected-btn"
            onClick={() => engine.selectedRoomId && engine.removeRoomInstance(engine.selectedRoomId)}
          >
            <i className="fa-solid fa-trash" /> {t('tank.deleteSelected')}
          </button>
        </div>

        <div className="tank-size-group" title={t('tank.sizeTitle')}>
          <i className="fa-solid fa-expand" />
          <input
            type="number"
            min={TANK_SIZE_MIN.width}
            max={TANK_SIZE_MAX.width}
            value={widthInput}
            onChange={(e) => setWidthInput(e.target.value)}
            onBlur={applySize}
            onKeyDown={(e) => e.key === 'Enter' && applySize()}
          />
          <span>&times;</span>
          <input
            type="number"
            min={TANK_SIZE_MIN.height}
            max={TANK_SIZE_MAX.height}
            value={heightInput}
            onChange={(e) => setHeightInput(e.target.value)}
            onBlur={applySize}
            onKeyDown={(e) => e.key === 'Enter' && applySize()}
          />
          <button type="button" className="selection-toolbar-btn" title={t('tank.resetSize')} onClick={() => engine.resetTankSize()}>
            <i className="fa-solid fa-compress" />
          </button>
        </div>

        <div className="tank-shape-group" title={t('tank.shapeTitle')}>
          {TANK_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className={`selection-toolbar-btn${engine.tankShape === shape ? ' active' : ''}`}
              title={t(`tank.shape.${shape}`)}
              onClick={() => engine.setTankShape(shape)}
            >
              <i className={SHAPE_ICON[shape]} />
            </button>
          ))}
          {engine.tankShape === 'rounded' && (
            <input
              type="range"
              className="tank-shape-slider"
              title={t('tank.shapeRoundedAmount')}
              min={ROUNDED_RADIUS_MIN}
              max={ROUNDED_RADIUS_MAX}
              step={0.01}
              value={engine.tankCornerRadiusFrac}
              onChange={(e) => engine.setTankCornerRadius(parseFloat(e.target.value))}
            />
          )}
          {engine.tankShape === 'oval' && (
            <input
              type="range"
              className="tank-shape-slider"
              title={t('tank.shapeOvalTopCut')}
              min={OVAL_TOP_CUT_MIN}
              max={OVAL_TOP_CUT_MAX}
              step={0.01}
              value={engine.tankOvalTopCutFrac}
              onChange={(e) => engine.setTankOvalTopCut(parseFloat(e.target.value))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
