import { useEffect, useRef, useState } from 'react';
import type { Application } from 'pixi.js';
import { Button } from '@/components/ui/button';
import type { TankEngine } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import { createPixiApp, destroyPixiApp } from '@/tank/render/pixiApp';
import { createRoomScene, type ArmedTool, type RoomSceneHandle } from '@/tank/render/roomScene';
import { invalidateAll, invalidateSprite } from '@/tank/render/textureCache';

/**
 * Life mode (P4, docs/PIXI_MIGRATION_PLAN.md §6/§14) - the tank placed in a room. Started as a
 * view-only preview (per §9 Q10) with the care mechanics (P5) layered in afterward.
 *
 * Feeding and scrubbing are both "select a tool, then use it on the tank" - not a plain tap/drag
 * anywhere on the tank, which is what the first version of this did and which the user reported two
 * problems with: a plain tap could feed wherever it landed, including just outside the tank in its
 * room-decor margin (a pellet stuck "beside" the tank no fish could ever reach); and there was no way
 * to tell dragging-to-scrub apart from just moving the mouse across the tank. Clicking "Feed" or
 * "Scrub" below the tank arms that tool (see armedTool state); with Feed armed, a tap on the tank drops
 * a pellet there (gated to the tank's real bounds - see roomScene.ts's tapHitArea); with Scrub armed,
 * dragging back and forth across the tank wipes algae along the way. A plain tap directly on a piece of
 * waste still collects it regardless of which tool (if any) is armed - that's not a placement action,
 * so it doesn't need the same gating.
 *
 * Owns its own Pixi Application, separate from Build mode's TankPixiLayer - the two are different
 * scenes (a full room vs. just the tank+margin) shown one at a time, not two views of one canvas.
 * Uses `autoDensity: true` (unlike TankPixiLayer) since this canvas fills its own container directly
 * rather than being stretched by external CSS math tied to the tank's logical pixel size.
 *
 * The scene is redrawn from the app's own ticker (see the ticker note in TankPixiLayer.tsx for why
 * that beats a separate requestAnimationFrame loop), and that ticker is stopped whenever this panel
 * isn't the visible mode - this is the more expensive of the two scenes (a whole room: backdrop,
 * cats, predator, status bars, *plus* an entire nested tank scene) and Build mode is a click away, so
 * leaving it drawing 60 rooms a second behind a hidden panel is pure waste. Only drawing pauses:
 * every care mechanic (hunger, evaporation, algae, predators) is simulated by TankEngine itself and
 * keeps running regardless - render() here only reads that state.
 */
export function LifePanel({ engine, active }: { engine: TankEngine; active: boolean }) {
  const { t } = useLanguage();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<RoomSceneHandle | null>(null);
  const [armedTool, setArmedTool] = useState<ArmedTool>(null);
  /** Kept up to date by the `active` effect below, and read inside the (async) app-creation callback,
   *  which can resolve long after the effect that started it captured `active` - the ref always has
   *  the current value there. */
  const activeRef = useRef(active);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;
    let scene: RoomSceneHandle | null = null;

    const onSpritesUpdated = () => invalidateAll();
    const onSpriteDeleted = (e: Event) => invalidateSprite((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('ft:sprites-updated', onSpritesUpdated);
    window.addEventListener('ft:sprite-deleted', onSpriteDeleted);

    createPixiApp(host).then((createdApp) => {
      if (cancelled) {
        destroyPixiApp(createdApp);
        return;
      }
      app = createdApp;
      appRef.current = createdApp;
      app.canvas.classList.add('life-pixi-canvas');
      // Pixi's own `resizeTo` (see pixiApp.ts) measures `host` once at init and again via a
      // ResizeObserver on every size change after that - almost always correct, but a mount that
      // happens while this panel's `.tank-mode-panel` ancestor is still `hidden` (host at 0×0, e.g.
      // visiting Build Tank before ever opening Life) can leave the very first measurement stale in a
      // way the observer doesn't always seem to correct once the tab actually becomes visible (root
      // cause not fully pinned down - this is a defensive re-measurement, not a fix to `resizeTo`
      // itself). One resize now, using whatever size `host` actually has right now, costs nothing when
      // it was already correct.
      app.renderer.resize(host.clientWidth, host.clientHeight);
      scene = createRoomScene(app.stage);
      sceneRef.current = scene;

      app.ticker.add(() => {
        if (cancelled || !app || !scene) return;
        scene.render(engine, app.renderer.width, app.renderer.height);
      });
      if (!activeRef.current) app.ticker.stop();
    });

    return () => {
      cancelled = true;
      window.removeEventListener('ft:sprites-updated', onSpritesUpdated);
      window.removeEventListener('ft:sprite-deleted', onSpriteDeleted);
      // No explicit ticker.remove(): destroyPixiApp tears the whole app (its ticker included) down a
      // line later, and `cancelled` already makes any callback that slips in between a no-op.
      scene?.destroy();
      if (app) destroyPixiApp(app);
      appRef.current = null;
      sceneRef.current = null;
    };
  }, [engine]);

  // Drawing runs only while this panel is the visible mode (see this component's doc comment), and
  // the switch back into it carries the same defensive re-measurement done right after app creation
  // above - see that comment for the full explanation of why `resizeTo` alone isn't enough here.
  // Order matters: resize before restarting the ticker, so the first frame drawn after the switch is
  // already at the right size rather than one frame of the stale one.
  useEffect(() => {
    activeRef.current = active;
    const app = appRef.current;
    // Nothing more to do when the app hasn't finished initializing yet - the creation callback above
    // reads activeRef itself and starts out stopped if this panel isn't the visible mode.
    if (!app) return;
    if (!active) {
      app.ticker.stop();
      return;
    }
    const host = hostRef.current;
    if (host) app.renderer.resize(host.clientWidth, host.clientHeight);
    app.ticker.start();
  }, [active]);

  /** Toggles a tool on/off (clicking the already-armed one disarms it) rather than only ever arming -
   *  the same "click again to deselect" a selected editor tool doesn't offer, but a room decor/palette
   *  selection does, and this is closer in spirit to the latter (a temporary mode, not a persistent
   *  drawing tool). */
  function toggleTool(tool: NonNullable<ArmedTool>): void {
    const next = armedTool === tool ? null : tool;
    setArmedTool(next);
    sceneRef.current?.setArmedTool(next);
  }

  // Any 'background'-type sprite can be the room, exactly as any of them can be the water backdrop -
  // there is no separate "room art" sprite kind to teach the editor about, and the two pictures are
  // picked independently (see TankEngine.roomBackgroundSpriteId). There is no "no room" choice: the
  // scene always stands the tank in a room, falling back to the art pack's own when nothing is set
  // (see roomScene.ts's effectiveRoomSprite), so the select mirrors that with no empty option.
  const roomChoices = engine.sprites.filter((s) => s.type === 'background' && s.deletedAt === 0);
  const activeRoomId =
    roomChoices.find((s) => s.id === engine.roomBackgroundSpriteId)?.id ?? roomChoices[0]?.id ?? '';

  return (
    <div className="life-layout">
      <div ref={hostRef} className="life-pixi-host" />
      <label className="life-room-picker" title={t('life.roomSceneTitle')}>
        <span>{t('life.roomScene')}</span>
        <select value={activeRoomId} onChange={(e) => engine.setRoomBackgroundSprite(e.target.value || null)}>
          {roomChoices.map((sprite) => (
            <option key={sprite.id} value={sprite.id}>
              {sprite.name}
            </option>
          ))}
        </select>
      </label>
      {/* Water level (P5 §6 item 4) - a plain DOM button rather than a Pixi-drawn one, matching every
       *  other action button in this app (Save, zoom, etc.) - simpler than hand-rolling hit-testing
       *  and a hover/pressed state inside the Pixi scene for something that isn't part of the tank
       *  itself. */}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="life-refill-button"
        title={t('life.refillWaterTitle')}
        onClick={() => engine.refillWater()}
      >
        <i className="fa-solid fa-faucet-drip" /> {t('life.refillWater')}
      </Button>
      {/* Feed/Scrub tools (P5 §6 items 2/5) - click to arm, then use directly on the tank (tap to feed,
       *  drag to scrub - see this file's own doc comment for why). */}
      <div className="life-tools">
        <button
          type="button"
          className={`life-tool-item${armedTool === 'feed' ? ' life-tool-item-active' : ''}`}
          title={t('life.feedToolTitle')}
          onClick={() => toggleTool('feed')}
        >
          <i className="fa-solid fa-bowl-food" />
          <span>{t('life.feedTool')}</span>
        </button>
        <button
          type="button"
          className={`life-tool-item${armedTool === 'scrub' ? ' life-tool-item-active' : ''}`}
          title={t('life.scrubToolTitle')}
          onClick={() => toggleTool('scrub')}
        >
          <i className="fa-solid fa-broom" />
          <span>{t('life.scrubTool')}</span>
        </button>
      </div>
      <p className="life-hint">
        {t('life.hint')}
        <br />
        {t('life.petHint')}
      </p>
    </div>
  );
}
