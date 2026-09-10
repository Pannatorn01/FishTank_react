import { ColorMatrixFilter, Container, FillGradient, Graphics, Sprite } from 'pixi.js';
import { spriteDims } from '@/lib/pixelMath';
import type { TankEngine } from '@/hooks/useTank';
import { PACK_SPRITE_NAMES } from '@/lib/data/pixellabPack';
import { buildCastSprites, roomSceneMargin } from '@/lib/storage';
import type { Instance, RoomInstance, SelectionBox, Sprite as SpriteData, TankShape } from '@/lib/types';
import { ovalFlatTopGeometry, roundedCornerRadius } from '@/tank/sim/geometry';
import { textureFor } from './textureCache';

/** Kept identical to the constants of the same name in useTank.ts's Canvas2D draw() - this file is
 *  a second, independent renderer of the exact same scene (see docs/PIXI_MIGRATION_PLAN.md P1), so
 *  every color/size here is copied on purpose, not re-derived, to make an eyeballed diff against the
 *  original trivial if either one is ever changed. */
const WATER_TOP = 0x7fd7e8;
const WATER_BOTTOM = 0x0f6f97;
const OUTLINE_COLOR = 0x1c2436;
const OUTLINE_WIDTH = 5;
const SELECTION_COLOR = 0xffeb3b;
const ZONE_SELECTED_COLOR = 0x78ffa0;
const ZONE_SELECTED_ALPHA = 0.9;
const MARQUEE_COLOR = 0xffeb3b;
const MARQUEE_FILL_ALPHA = 0.15;
const ZONE_DRAFT_COLOR = 0x4ade80;
const ZONE_DRAFT_FILL_ALPHA = 0.15;
const DISPLAY_SCALE = 4;
const OVAL_ARC_SEGMENTS = 64;
/** Shared, stateless - Pixi filters can be assigned to any number of sprites' `.filters` at once, so
 *  one instance covers every dead fish rather than allocating a fresh one per instance view. Mirrors
 *  the Canvas2D renderer's `ctx.filter = 'grayscale(1)'` (see the `dead` doc comment in types.ts). */
const DEAD_FISH_FILTER = new ColorMatrixFilter();
DEAD_FISH_FILTER.grayscale(1, false);
const HUNGER_BAR_HEIGHT = 4;
const HUNGER_BAR_GAP = 4;
const FOOD_COLOR = 0xf5a623;
const FOOD_RADIUS = 4;
/** How wide a falling pellet is drawn, in tank-logical px. The pixel-art pellet is scaled to this
 *  rather than drawn at its own cell size, so a pellet stays the size the feeding behaviour was
 *  tuned around (fish steer toward FOOD_RADIUS-sized targets) whatever the artwork's canvas is. */
const FOOD_SPRITE_WIDTH = FOOD_RADIUS * 4;
const WASTE_COLOR = 0x6b4a2f;
const WASTE_RADIUS_X = 3;
const WASTE_RADIUS_Y = 5;
/** Waste sizes in tank-logical px. The settled pile is sized by width - it has landed and spread,
 *  so width is what says how much of it there is.
 *
 *  The falling strand is sized by HEIGHT instead, because it is far taller than it is wide: giving
 *  it a width made it come out three times a fish's height, a dark totem hanging in the water. */
const WASTE_SINKING_HEIGHT = 13;
const WASTE_SETTLED_WIDTH = 22;
/** Matches useTank.ts's Canvas2D drawAlgae() stroke color exactly. */
const ALGAE_COLOR = 0x4ade80;
/** Algae tuft width in tank-logical px, and the growth level at which the thin tuft gives way to
 *  the thick mat. Two sprites rather than one scaled up: algae that has been left does not just get
 *  bigger, it closes over, and a scaled-up tuft cannot show that. */
const ALGAE_SPRITE_WIDTH = 26;
const ALGAE_THICK_FROM = 0.55;
/** Matches useTank.ts's Canvas2D BABY_SCALE_FRAC exactly - see growthScale() below. */
const BABY_SCALE_FRAC = 0.5;

/** Mirrors useTank.ts's private TankEngine.growthScale() (P5 §6 item 6) - duplicated rather than
 *  called on the engine since it's pure math over fields already on `inst` (bornAt/matureAt), the same
 *  "small pure formula kept in sync by comment, not by sharing a function" pattern already used here
 *  for the hunger bar / dead-fish grayscale constants. */
function growthScale(inst: Instance): number {
  if (inst.matureAt <= inst.bornAt) return 1;
  const frac = (Date.now() - inst.bornAt) / (inst.matureAt - inst.bornAt);
  const clamped = Math.max(0, Math.min(1, frac));
  return BABY_SCALE_FRAC + (1 - BABY_SCALE_FRAC) * clamped;
}

/**
 * Traces the tank's swim-area silhouette onto a Pixi Graphics context instead of a Path2D - used
 * both as the water/instance layer's mask (replacing ctx.clip()) and, traced a second time, as the
 * visible glass outline (replacing ctx.stroke()). Built from geometry.ts's pure
 * ovalFlatTopGeometry/roundedCornerRadius (see docs/PIXI_MIGRATION_PLAN.md P3) - the same functions
 * useTank.ts's own Canvas2D shapePath() and clamp logic use, so this can no longer drift out of sync
 * with them the way it could back when each independently re-derived the same trigonometry (see this
 * function's own git history for what that looked like). An oval's flat-top cut is reproduced by
 * polygon-sampling the arc geometry.ts already solved analytically, since Pixi's Graphics has no
 * partial-ellipse-arc primitive to call directly (only a full ellipse) - OVAL_ARC_SEGMENTS points
 * reads as a smooth curve at every tank size this app supports.
 */
function traceShape(g: Graphics, shape: TankShape, w: number, h: number, cornerRadiusFrac: number, ovalTopCutFrac: number): void {
  if (shape === 'oval') {
    const geo = ovalFlatTopGeometry(w, h, ovalTopCutFrac);
    if (!geo.hasCut) {
      g.ellipse(geo.cx, geo.cy, geo.rx, geo.ry);
      return;
    }
    const points: number[] = [geo.xLeft, geo.topCutY, geo.xRight, geo.topCutY];
    for (let i = 1; i <= OVAL_ARC_SEGMENTS; i++) {
      const theta = geo.thetaRight + ((geo.thetaLeft - geo.thetaRight) * i) / OVAL_ARC_SEGMENTS;
      points.push(geo.cx + geo.rx * Math.cos(theta), geo.cy + geo.ry * Math.sin(theta));
    }
    g.poly(points, true);
  } else if (shape === 'rounded') {
    const r = Math.max(0, Math.min(roundedCornerRadius(w, h, cornerRadiusFrac), w / 2, h / 2));
    g.roundRect(0, 0, w, h, r);
  } else {
    g.rect(0, 0, w, h);
  }
}

/** Manual dashed rectangle - Pixi's Graphics stroke has no dash-pattern option (unlike Canvas2D's
 *  setLineDash), so the marquee/zone-draft rectangles' dashed border is reproduced edge-by-edge as
 *  short line segments. Dash/gap lengths match the Canvas2D call site's setLineDash([6, 4]). */
function dashedRectPath(g: Graphics, x0: number, y0: number, x1: number, y1: number, dash = 6, gap = 4): void {
  const edges: [number, number, number, number][] = [
    [x0, y0, x1, y0],
    [x1, y0, x1, y1],
    [x1, y1, x0, y1],
    [x0, y1, x0, y0],
  ];
  for (const [ex0, ey0, ex1, ey1] of edges) {
    const dx = ex1 - ex0;
    const dy = ey1 - ey0;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    let pos = 0;
    while (pos < len) {
      const segLen = Math.min(dash, len - pos);
      const sx = ex0 + ux * pos;
      const sy = ey0 + uy * pos;
      const ex = ex0 + ux * (pos + segLen);
      const ey = ey0 + uy * (pos + segLen);
      g.moveTo(sx, sy).lineTo(ex, ey);
      pos += dash + gap;
    }
  }
}

interface InstanceView {
  container: Container;
  sprite: Sprite;
  outline: Graphics;
}

interface RoomView {
  sprite: Sprite;
}

/** Everything one call to createTankScene() owns - all torn down together by destroy(). Mirrors
 *  TankEngine's own draw() one-to-one (see the mapping table in docs/PIXI_MIGRATION_PLAN.md §4) but
 *  reads the engine's live, already-simulated state each frame rather than owning any simulation
 *  itself - a display-layer swap only, not a rewrite of state/physics/input (all of which stay
 *  exactly where they are in useTank.ts).
 *
 * Room decor (P2, docs/PIXI_MIGRATION_PLAN.md §13) is drawn here for VISUAL parity only - dragging/
 * selecting a room item is still handled entirely by the existing DOM layer (RoomLayer.tsx), which
 * stays mounted (just made invisible via opacity in pixi mode - see TankCanvas.tsx) rather than being
 * ported to Pixi's own event system. The two rendering surfaces can't both be pointer-interactive at
 * the same point on screen (only one DOM element receives a given click), and in-tank instances'
 * pointer handling already lives on the Canvas2D <canvas> (also kept mounted-but-invisible, per P1) -
 * consolidating every input path onto one system is real work with its own risk, and is deliberately
 * left to a later phase (see the plan doc's P3, "input/dragController.ts") rather than folded into
 * this one at extra risk for a purely visual milestone. */
export interface TankSceneHandle {
  /** Repaints everything from the engine's current state - call once per animation frame. */
  render(engine: TankEngine): void;
  destroy(): void;
}

export function createTankScene(stage: Container): TankSceneHandle {
  // sceneRoot is offset by (marginX, marginY) each frame (see the margin block in render() below) -
  // so everything inside it (the tank itself AND room decor) shares one coordinate space with the
  // tank's own top-left corner at local (0,0), matching Instance.x/y and RoomInstance.x/y directly
  // with no per-item reprojection. Room decor (`roomLayer`) is a *sibling* of `root`, not a child of
  // it - `root.mask` clips everything inside `root` to the tank's own water shape, and room decor
  // must NOT be clipped by that (it lives *around* the tank, meant to stay visible past that
  // boundary) - `outline` is a sibling of `root` for the exact same reason.
  const sceneRoot = new Container();
  const root = new Container();
  const mask = new Graphics();
  const air = new Graphics();
  const water = new Graphics();
  const backgroundSprite = new Sprite();
  const waterline = new Graphics();
  const algaeLayer = new Graphics();
  /** Pooled sprites for the grime: one per algae patch and one per waste item on screen, hidden
   *  rather than destroyed when there are fewer. Both used to be drawn with Graphics - a green
   *  squiggle and a brown ellipse - which read as debug shapes next to pixel-art fish. */
  const algaeSpriteLayer = new Container();
  const algaeSprites: Sprite[] = [];
  const wasteSpriteLayer = new Container();
  const wasteSprites: Sprite[] = [];
  const cast = buildCastSprites();
  const algaeArt = {
    thin: cast.get(PACK_SPRITE_NAMES.algaeThin),
    thick: cast.get(PACK_SPRITE_NAMES.algaeThick),
  };
  const wasteArt = {
    sinking: cast.get(PACK_SPRITE_NAMES.wasteSinking),
    settled: cast.get(PACK_SPRITE_NAMES.wasteSettled),
  };
  const zoneBelowLayer = new Container();
  const wasteLayer = new Graphics();
  const foodLayer = new Graphics();
  /** The pixel-art pellets, one pooled Sprite per food item on screen. Kept beside foodLayer rather
   *  than replacing it: the plain circle stays as the fallback for a build with no art. */
  const foodSpriteLayer = new Container();
  const foodSprites: Sprite[] = [];
  const foodArt = cast.get(PACK_SPRITE_NAMES.foodPellet);
  const instanceLayer = new Container();
  const overlayLayer = new Container();
  const outline = new Graphics();
  const roomLayer = new Container();

  backgroundSprite.visible = false;
  backgroundSprite.anchor.set(0.5);

  root.addChild(air, water, backgroundSprite, waterline, algaeLayer, algaeSpriteLayer, zoneBelowLayer, wasteLayer, wasteSpriteLayer, foodLayer, foodSpriteLayer, instanceLayer, overlayLayer);
  // `mask` is added as root's own child (not left floating outside the scene graph) specifically so
  // it inherits root's transform - a mask that's never actually parented anywhere keeps Pixi's
  // default identity transform regardless of where the container using it as a mask ends up moving.
  // This bit for real: once P2 added sceneRoot's own margin offset (see its declaration comment)
  // shifting `root` away from world (0,0), an unparented mask kept clipping at the *old*, unshifted
  // position instead of following along - for a plain rectangle tank this went unnoticed (Pixi
  // appears to fast-path an axis-aligned rectangle mask via scissor testing, deriving the clip bounds
  // from the *masked container's* own transform rather than the mask object's), but 'oval' and
  // 'rounded' (arbitrary polygon shapes, needing the slower stencil-buffer path, which does depend on
  // the mask's own transform) rendered the water clipped to entirely the wrong region. Adding it as a
  // normal child here doesn't make it paint as an ordinary visible white shape on top of everything
  // else - Pixi already excludes a container's own assigned mask object from its own normal render
  // pass.
  root.addChild(mask);
  root.mask = mask;
  // Draw order: tank (water/instances/mask), its outline, then room decor last - "always renders
  // above the tank frame, can overlap it" (see RoomInstance's doc comment in types.ts).
  sceneRoot.addChild(root, outline, roomLayer);
  stage.addChild(sceneRoot);

  const waterGradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: WATER_TOP },
      { offset: 1, color: WATER_BOTTOM },
    ],
  });

  const instanceViews = new Map<string, InstanceView>();
  const roomViews = new Map<string, RoomView>();
  let lastShapeKey = '';
  let lastWaterSizeKey = '';
  let lastMarginKey = '';

  function ensureInstanceView(id: string): InstanceView {
    let v = instanceViews.get(id);
    if (!v) {
      const container = new Container();
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      const outlineG = new Graphics();
      container.addChild(sprite, outlineG);
      instanceLayer.addChild(container);
      v = { container, sprite, outline: outlineG };
      instanceViews.set(id, v);
    }
    return v;
  }

  function pruneInstanceViews(liveIds: Set<string>): void {
    for (const [id, v] of instanceViews) {
      if (!liveIds.has(id)) {
        v.container.destroy({ children: true });
        instanceViews.delete(id);
      }
    }
  }

  function ensureRoomView(id: string): RoomView {
    let v = roomViews.get(id);
    if (!v) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      roomLayer.addChild(sprite);
      v = { sprite };
      roomViews.set(id, v);
    }
    return v;
  }

  function pruneRoomViews(liveIds: Set<string>): void {
    for (const [id, v] of roomViews) {
      if (!liveIds.has(id)) {
        v.sprite.destroy();
        roomViews.delete(id);
      }
    }
  }

  /** timeMs drives each room item's own frame animation deterministically from the same clock used
   *  for everything else this frame - simpler than the DOM RoomLayer.tsx's own per-item rAF loop
   *  (not needed here since this whole scene already redraws every animation frame). */
  function updateRoomView(v: RoomView, inst: RoomInstance, sprite: SpriteData, timeMs: number): void {
    const { width, height } = spriteDims(sprite);
    const pw = width * DISPLAY_SCALE;
    const ph = height * DISPLAY_SCALE;
    v.sprite.visible = inst.visible;
    if (!inst.visible) return;
    const frameIndex = sprite.frames.length > 1 ? Math.floor(timeMs / (sprite.frameMs || 400)) % sprite.frames.length : 0;
    v.sprite.texture = textureFor(sprite, frameIndex);
    v.sprite.width = pw;
    v.sprite.height = ph;
    v.sprite.position.set(inst.x, inst.y);
  }

  function drawZoneRect(
    parent: Container,
    zone: SelectionBox,
    strokeColor: number,
    strokeAlpha: number,
    fillAlpha?: number,
    dashed = false,
  ): void {
    const g = new Graphics();
    const { x0, y0, x1, y1 } = zone;
    const w = x1 - x0;
    const h = y1 - y0;
    if (fillAlpha !== undefined) {
      g.rect(x0, y0, w, h).fill({ color: strokeColor, alpha: fillAlpha });
    }
    if (dashed) {
      dashedRectPath(g, x0, y0, x1, y1);
    } else {
      g.rect(x0, y0, w, h);
    }
    g.stroke({ width: 1.5, color: strokeColor, alpha: strokeAlpha, join: 'round' });
    parent.addChild(g);
  }

  function updateInstanceView(v: InstanceView, inst: Instance, sprite: SpriteData, selected: boolean): void {
    const { width, height } = spriteDims(sprite);
    // Growing (P5 §6 item 6) shrinks only what's drawn here, same as Canvas2D's drawInstance() - see
    // growthScale()'s own doc comment for why the swim-bounds footprint stays full adult size.
    const growth = inst.kind === 'fish' ? growthScale(inst) : 1;
    const pw = width * DISPLAY_SCALE * growth;
    const ph = height * DISPLAY_SCALE * growth;
    const renderY = inst.y + (inst.kind === 'fish' && !inst.isDragging ? Math.sin(inst.bobPhase) * 3 : 0);
    const frameIndex = inst.frameIndex % sprite.frames.length;

    v.container.visible = inst.visible;
    if (!inst.visible) return;

    v.container.position.set(inst.x + pw / 2, renderY + ph / 2);
    const texture = textureFor(sprite, frameIndex);
    v.sprite.texture = texture;
    const flipSign = inst.kind === 'fish' && inst.dir < 0 ? -1 : 1;
    // One scale.set() rather than assigning `width`/`height` and then re-signing `scale.x` for the
    // flip: those setters derive a scale from the texture's size internally, which means reading the
    // just-written scale back out and re-deriving the flip from its sign every frame. Since the
    // texture here is rasterized at exactly DISPLAY_SCALE (see textureCache.ts), the scale wanted is
    // just the growth factor - computed directly, with the flip folded into the same call.
    v.sprite.scale.set((pw / (texture.width || 1)) * flipSign, ph / (texture.height || 1));
    v.sprite.filters = inst.dead ? [DEAD_FISH_FILTER] : null;

    v.outline.clear();
    if (selected) {
      v.outline.rect(-pw / 2 - 2, -ph / 2 - 2, pw + 4, ph + 4).stroke({ width: 2, color: SELECTION_COLOR });
    }
    // Hunger status bar (P5 §6 item 2, §9 Q3 - per-fish status) - small enough to read as a status
    // light rather than competing with the fish itself, hidden once full so a well-fed tank isn't
    // covered in bars.
    if (inst.kind === 'fish' && !inst.dead && inst.hunger < 1) {
      const barW = pw;
      const barY = -ph / 2 - HUNGER_BAR_GAP - HUNGER_BAR_HEIGHT;
      v.outline.rect(-barW / 2, barY, barW, HUNGER_BAR_HEIGHT).fill({ color: 0x000000, alpha: 0.4 });
      const fillColor = inst.hunger > 0.5 ? 0x4ade80 : inst.hunger > 0.2 ? 0xfacc15 : 0xef4444;
      v.outline.rect(-barW / 2, barY, barW * Math.max(0, inst.hunger), HUNGER_BAR_HEIGHT).fill(fillColor);
    }
  }

  function render(engine: TankEngine): void {
    const w = engine.canvas?.width ?? 0;
    const h = engine.canvas?.height ?? 0;
    if (w <= 0 || h <= 0) {
      sceneRoot.visible = false;
      return;
    }
    sceneRoot.visible = true;

    // sceneRoot's own offset - see its declaration comment above. Recomputed only when the tank's
    // size actually changes (matching sceneWidthFor/sceneHeightFor's own use in TankPixiLayer.tsx,
    // which is what actually sizes the backing store this offset needs to line up inside of).
    const marginKey = `${w}:${h}`;
    if (marginKey !== lastMarginKey) {
      lastMarginKey = marginKey;
      const { marginX, marginY } = roomSceneMargin(w, h);
      sceneRoot.position.set(marginX, marginY);
    }

    const shapeKey = `${engine.tankShape}:${w}:${h}:${engine.tankCornerRadiusFrac}:${engine.tankOvalTopCutFrac}`;
    if (shapeKey !== lastShapeKey) {
      lastShapeKey = shapeKey;
      mask.clear();
      traceShape(mask, engine.tankShape, w, h, engine.tankCornerRadiusFrac, engine.tankOvalTopCutFrac);
      mask.fill(0xffffff);
      outline.clear();
      traceShape(outline, engine.tankShape, w, h, engine.tankCornerRadiusFrac, engine.tankOvalTopCutFrac);
      outline.stroke({ width: OUTLINE_WIDTH, color: OUTLINE_COLOR, join: 'round' });
    }

    // Water level (P5 §6 item 4) - included in the cache key (unlike most other size-keyed blocks
    // here) since it changes continuously, not just on a resize/shape edit. Rounded to whole pixels so
    // evaporation's continuous sub-pixel drift doesn't invalidate (and thus redraw) this every single
    // frame for a change nobody could actually see.
    const waterTop = Math.round((1 - engine.waterLevel) * h);
    const waterSizeKey = `${w}:${h}:${waterTop}`;
    if (waterSizeKey !== lastWaterSizeKey) {
      lastWaterSizeKey = waterSizeKey;
      air.clear();
      if (waterTop > 0) air.rect(0, 0, w, waterTop).fill(0x0d1a24);
      water.clear().rect(0, waterTop, w, h - waterTop).fill(waterGradient);
      const waterlineH = Math.max(3, h * 0.02);
      waterline.clear().rect(0, waterTop, w, waterlineH).fill({ color: 0xffffff, alpha: 0.35 });
    }

    // Algae (P5 §6 item 5) - scattered squiggle patches (see generateAlgaePatches's doc comment),
    // reading `engine.algaePatches` rather than generating its own so this always matches whatever
    // Canvas2D's drawAlgae() would show for the same tank (both read the one engine-owned layout).
    algaeLayer.clear();
    const visibleAlgaeCount = Math.round(engine.algae * engine.algaePatches.length);
    if (algaeArt.thin && algaeArt.thick) {
      // Which sprite: the whole glass turns over at once rather than patch by patch, so crossing
      // ALGAE_THICK_FROM reads as the tank having got away from you rather than as a slow blur.
      const art = engine.algae >= ALGAE_THICK_FROM ? algaeArt.thick : algaeArt.thin;
      const texture = textureFor(art);
      for (let i = 0; i < visibleAlgaeCount; i++) {
        const patch = engine.algaePatches[i];
        let view = algaeSprites[i];
        if (!view) {
          view = new Sprite();
          // Bottom-centre: algae grows up off whatever it is stuck to, so its base is what should
          // land on the patch's anchor point.
          view.anchor.set(0.5, 1);
          view.eventMode = 'none';
          algaeSprites.push(view);
          algaeSpriteLayer.addChild(view);
        }
        view.texture = texture;
        view.scale.set(ALGAE_SPRITE_WIDTH / (texture.width || 1));
        // Mirroring alternate patches stops fourteen copies of one tuft reading as wallpaper.
        view.scale.x *= i % 2 === 0 ? 1 : -1;
        view.position.set(patch.x, patch.y);
        view.visible = true;
      }
      for (let i = visibleAlgaeCount; i < algaeSprites.length; i++) algaeSprites[i].visible = false;
    } else {
      for (let i = 0; i < visibleAlgaeCount; i++) {
        const patch = engine.algaePatches[i];
        algaeLayer.moveTo(patch.x + patch.points[0].x, patch.y + patch.points[0].y);
        for (let p = 1; p < patch.points.length; p++) {
          algaeLayer.lineTo(patch.x + patch.points[p].x, patch.y + patch.points[p].y);
        }
      }
      if (visibleAlgaeCount > 0) algaeLayer.stroke({ width: 4, color: ALGAE_COLOR, cap: 'round', join: 'round' });
    }

    const bgSprite = engine.backgroundSpriteId
      ? engine.sprites.find((s) => s.id === engine.backgroundSpriteId && s.type === 'background')
      : null;
    if (bgSprite) {
      const { width: sw, height: sh } = spriteDims(bgSprite);
      backgroundSprite.texture = textureFor(bgSprite, 0);
      backgroundSprite.width = sw * DISPLAY_SCALE * engine.backgroundTransform.scale;
      backgroundSprite.height = sh * DISPLAY_SCALE * engine.backgroundTransform.scale;
      backgroundSprite.position.set(engine.backgroundTransform.x, engine.backgroundTransform.y);
      backgroundSprite.rotation = engine.backgroundTransform.rotation;
      backgroundSprite.visible = true;
    } else {
      backgroundSprite.visible = false;
    }

    zoneBelowLayer.removeChildren();
    if (engine.selectedZone) {
      drawZoneRect(zoneBelowLayer, engine.selectedZone, ZONE_SELECTED_COLOR, ZONE_SELECTED_ALPHA);
    }

    wasteLayer.clear();
    // Hoisted out of the callback: narrowing a property does not survive into a closure, and
    // these two are fixed for the whole pass anyway.
    const sinkingArt = wasteArt.sinking;
    const settledArt = wasteArt.settled;
    if (sinkingArt && settledArt) {
      engine.wasteItems.forEach((w, i) => {
        const art = w.settled ? settledArt : sinkingArt;
        // The sinking strand is a three-frame loop; the settled pile is a still. Offsetting each
        // item's frame by its index keeps a cloud of falling waste from tumbling in lockstep.
        const frames = Math.max(1, art.frames.length);
        const frame = frames > 1 ? (Math.floor(Date.now() / (art.frameMs || 260)) + i) % frames : 0;
        const texture = textureFor(art, frame);
        let view = wasteSprites[i];
        if (!view) {
          view = new Sprite();
          view.anchor.set(0.5, w.settled ? 1 : 0.5);
          view.eventMode = 'none';
          wasteSprites.push(view);
          wasteSpriteLayer.addChild(view);
        }
        // Re-set every frame: an item that lands changes both its art and where its origin is.
        view.anchor.set(0.5, w.settled ? 1 : 0.5);
        view.texture = texture;
        view.scale.set(
          w.settled
            ? WASTE_SETTLED_WIDTH / (texture.width || 1)
            : WASTE_SINKING_HEIGHT / (texture.height || 1),
        );
        view.position.set(w.x, w.y);
        view.visible = true;
      });
      for (let i = engine.wasteItems.length; i < wasteSprites.length; i++) wasteSprites[i].visible = false;
    } else {
      engine.wasteItems.forEach((w) => {
        wasteLayer.ellipse(w.x, w.y, WASTE_RADIUS_X, WASTE_RADIUS_Y).fill(WASTE_COLOR);
      });
    }

    foodLayer.clear();
    if (foodArt) {
      // Grow the pool as needed and hide the tail of it, rather than making and destroying Sprites
      // every frame - feeding drops a handful of pellets at once and this runs per frame.
      // The pellets tumble as they sink. Each item is offset by its index so a handful dropped at
      // once does not turn in perfect unison, which reads as one object rather than several.
      const foodFrames = Math.max(1, foodArt.frames.length);
      engine.foodItems.forEach((food, i) => {
        const frame =
          foodFrames > 1
            ? (Math.floor(Date.now() / (foodArt.frameMs || 150)) + i) % foodFrames
            : 0;
        const texture = textureFor(foodArt, frame);
        let view = foodSprites[i];
        if (!view) {
          view = new Sprite();
          view.anchor.set(0.5);
          view.eventMode = 'none';
          foodSprites.push(view);
          foodSpriteLayer.addChild(view);
        }
        view.texture = texture;
        view.scale.set(FOOD_SPRITE_WIDTH / (texture.width || 1));
        view.position.set(food.x, food.y);
        view.visible = true;
      });
      for (let i = engine.foodItems.length; i < foodSprites.length; i++) foodSprites[i].visible = false;
    } else {
      engine.foodItems.forEach((food) => {
        foodLayer.circle(food.x, food.y, FOOD_RADIUS).fill(FOOD_COLOR);
      });
    }

    const order = engine.visibleDrawOrder();
    const liveIds = new Set<string>();
    order.forEach((inst) => {
      const sprite = engine.spriteFor(inst);
      if (!sprite) return;
      liveIds.add(inst.id);
      const v = ensureInstanceView(inst.id);
      const selected = inst.id === engine.selectedId || !!engine.marqueeIds?.includes(inst.id);
      updateInstanceView(v, inst, sprite, selected);
    });
    pruneInstanceViews(liveIds);
    // One full reorder pass matching `order` exactly - cheap (setChildIndex on an already-correct
    // slot is a no-op check inside Pixi) and avoids the subtlety of trying to diff old vs new order
    // incrementally.
    order.forEach((inst, i) => {
      const v = instanceViews.get(inst.id);
      if (v) instanceLayer.setChildIndex(v.container, Math.min(i, instanceLayer.children.length - 1));
    });

    overlayLayer.removeChildren();
    if (engine.marqueeRect) {
      drawZoneRect(overlayLayer, engine.marqueeRect, MARQUEE_COLOR, 1, MARQUEE_FILL_ALPHA, true);
    }
    if (engine.zoneDraftRect) {
      drawZoneRect(overlayLayer, engine.zoneDraftRect, ZONE_DRAFT_COLOR, 1, ZONE_DRAFT_FILL_ALPHA, true);
    }

    // Visual-only - see this file's own doc comment above for why input for these stays on the DOM
    // RoomLayer.tsx rather than Pixi's own event system.
    const roomLiveIds = new Set<string>();
    const timeMs = performance.now();
    engine.roomInstances.forEach((inst) => {
      const sprite = engine.spriteFor(inst);
      if (!sprite) return;
      roomLiveIds.add(inst.id);
      updateRoomView(ensureRoomView(inst.id), inst, sprite, timeMs);
    });
    pruneRoomViews(roomLiveIds);
  }

  function destroy(): void {
    // A single recursive destroy from the top - root, outline, and roomLayer (with every instance/
    // room sprite inside them) are all children of sceneRoot, so this tears down everything in one
    // sweep rather than destroying instanceViews/roomViews' sprites individually first and risking a
    // double-destroy when the recursive pass reaches them again.
    instanceViews.clear();
    roomViews.clear();
    foodSprites.length = 0;
    algaeSprites.length = 0;
    wasteSprites.length = 0;
    sceneRoot.destroy({ children: true });
  }

  return { render, destroy };
}
