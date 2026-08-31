import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { paintFrameCells } from '@/lib/pixelMath';
import * as storage from '@/lib/storage';
import type { Instance, Sprite } from '@/lib/types';

const DISPLAY_SCALE = 4;
const FRAME_INTERVAL = 0.35;
const TAP_MOVE_THRESHOLD = 6;

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

class TankEngine {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  wrap: HTMLDivElement | null = null;
  trash: HTMLButtonElement | null = null;

  sprites: Sprite[] = [];
  instances: Instance[] = [];
  bubbles: Bubble[] = [];

  draggingInstance: Instance | null = null;
  dragOffset = { x: 0, y: 0 };
  dragStart = { x: 0, y: 0 };
  dragMoved = false;
  selectedId: string | null = null;
  trashArmed = false;

  private paletteGhost: HTMLCanvasElement | null = null;
  private paletteGhostPx = { pw: 64, ph: 64 };
  private paletteDragSpriteId: string | null = null;
  private lastTime = 0;
  private rafId: number | null = null;
  private reactNotify: () => void = () => {};

  init(notify: () => void): void {
    this.reactNotify = notify;
    this.sprites = storage.loadSprites() || [];
    this.instances = storage.loadInstances() || [];

    for (let i = 0; i < 14; i++) {
      this.bubbles.push({
        x: Math.random(),
        y: Math.random(),
        r: 2 + Math.random() * 3,
        speed: 8 + Math.random() * 10,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  attachCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
  }

  attachWrap(el: HTMLDivElement | null): void {
    this.wrap = el;
  }

  attachTrash(el: HTMLButtonElement | null): void {
    this.trash = el;
  }

  spriteDims(sprite?: Sprite): { width: number; height: number } {
    return {
      width: (sprite && sprite.width) || storage.DEFAULT_GRID_SIZE,
      height: (sprite && sprite.height) || storage.DEFAULT_GRID_SIZE,
    };
  }

  spritePx(sprite?: Sprite): { pw: number; ph: number } {
    const { width, height } = this.spriteDims(sprite);
    return { pw: width * DISPLAY_SCALE, ph: height * DISPLAY_SCALE };
  }

  spriteFor(inst: Instance): Sprite | undefined {
    return this.sprites.find((s) => s.id === inst.spriteId);
  }

  private randomTargetY(ph: number): number {
    if (!this.canvas) return 0;
    const h = this.canvas.height;
    const sandH = Math.max(18, h * 0.08);
    const maxY = Math.max(0, h - sandH - ph);
    return Math.random() * maxY;
  }

  resizeCanvas(): void {
    if (!this.canvas || !this.wrap) return;
    const rect = this.wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.canvas.width = Math.max(200, Math.floor(rect.width));
    this.canvas.height = Math.max(200, Math.floor(rect.height));
    this.instances.forEach((inst) => {
      const { pw, ph } = this.spritePx(this.spriteFor(inst));
      inst.x = Math.min(inst.x, this.canvas!.width - pw);
      inst.y = Math.min(inst.y, this.canvas!.height - ph);
    });
  }

  refreshPalette(): void {
    this.sprites = storage.loadSprites() || [];
    this.reactNotify();
  }

  removeInstancesBySprite(spriteId: string): void {
    this.instances = this.instances.filter((inst) => inst.spriteId !== spriteId);
    this.persist();
  }

  private persist(): void {
    try {
      storage.saveInstances(this.instances);
    } catch (err) {
      console.warn('saveInstances failed', err);
    }
    this.reactNotify();
  }

  clearTank(confirmClear: () => boolean): void {
    if (!this.instances.length) return;
    if (!confirmClear()) return;
    this.instances = [];
    this.selectInstance(null);
    this.persist();
  }

  addInstance(spriteId: string, x: number, y: number): void {
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite || !this.canvas) return;
    const { pw, ph } = this.spritePx(sprite);
    const inst: Instance = {
      id: storage.uid('inst'),
      spriteId,
      kind: sprite.type,
      x: Math.min(Math.max(0, x - pw / 2), this.canvas.width - pw),
      y: Math.min(Math.max(0, y - ph / 2), this.canvas.height - ph),
      dir: Math.random() < 0.5 ? -1 : 1,
      vx: sprite.type === 'fish' ? 18 + Math.random() * 22 : 0,
      vy: sprite.type === 'fish' ? 6 + Math.random() * 12 : 0,
      targetY: sprite.type === 'fish' ? this.randomTargetY(ph) : 0,
      frameIndex: 0,
      frameTimer: 0,
      bobPhase: Math.random() * Math.PI * 2,
      isDragging: false,
    };
    this.instances.push(inst);
    this.persist();
  }

  removeInstance(id: string): void {
    this.instances = this.instances.filter((inst) => inst.id !== id);
    this.persist();
  }

  selectInstance(id: string | null): void {
    this.selectedId = id;
    this.reactNotify();
  }

  removeSelected(): void {
    if (this.selectedId) this.removeInstance(this.selectedId);
    this.selectInstance(null);
  }

  bringToFront(id: string): void {
    const idx = this.instances.findIndex((inst) => inst.id === id);
    if (idx === -1 || idx === this.instances.length - 1) return;
    const [inst] = this.instances.splice(idx, 1);
    this.instances.push(inst);
    this.persist();
  }

  sendToBack(id: string): void {
    const idx = this.instances.findIndex((inst) => inst.id === id);
    if (idx <= 0) return;
    const [inst] = this.instances.splice(idx, 1);
    this.instances.unshift(inst);
    this.persist();
  }

  private hitTest(x: number, y: number): Instance | null {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      const sprite = this.spriteFor(inst);
      if (!sprite) continue;
      const { pw, ph } = this.spritePx(sprite);
      if (x >= inst.x && x <= inst.x + pw && y >= inst.y && y <= inst.y + ph) return inst;
    }
    return null;
  }

  onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inst = this.hitTest(x, y);
    if (!inst) {
      this.selectInstance(null);
      return;
    }
    this.instances.splice(this.instances.indexOf(inst), 1);
    this.instances.push(inst);
    inst.isDragging = true;
    this.draggingInstance = inst;
    this.dragOffset = { x: x - inst.x, y: y - inst.y };
    this.dragStart = { x, y };
    this.dragMoved = false;
    canvas.setPointerCapture(e.pointerId);
    this.reactNotify();
  }

  onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!this.draggingInstance || !this.canvas || !this.trash) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (Math.hypot(x - this.dragStart.x, y - this.dragStart.y) > TAP_MOVE_THRESHOLD) this.dragMoved = true;
    const inst = this.draggingInstance;
    const { pw, ph } = this.spritePx(this.spriteFor(inst));
    inst.x = Math.min(Math.max(0, x - this.dragOffset.x), this.canvas.width - pw);
    inst.y = Math.min(Math.max(0, y - this.dragOffset.y), this.canvas.height - ph);

    const trashRect = this.trash.getBoundingClientRect();
    const over =
      e.clientX >= trashRect.left && e.clientX <= trashRect.right && e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;
    if (this.trashArmed !== over) {
      this.trashArmed = over;
      this.reactNotify();
    }
  }

  onCanvasPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!this.draggingInstance || !this.trash) return;
    const inst = this.draggingInstance;
    const trashRect = this.trash.getBoundingClientRect();
    const over =
      e.clientX >= trashRect.left && e.clientX <= trashRect.right && e.clientY >= trashRect.top && e.clientY <= trashRect.bottom;

    inst.isDragging = false;
    this.trashArmed = false;

    if (over) {
      this.removeInstance(inst.id);
      this.selectInstance(null);
    } else if (!this.dragMoved) {
      this.selectInstance(inst.id);
    } else {
      this.selectInstance(null);
    }
    this.draggingInstance = null;
    this.persist();
  }

  get trashVisible(): boolean {
    return !!this.draggingInstance;
  }

  startPaletteDrag(e: React.PointerEvent<HTMLDivElement>, spriteId: string): void {
    e.preventDefault();
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite) return;

    const { pw, ph } = this.spritePx(sprite);
    const ghost = document.createElement('canvas');
    ghost.width = pw;
    ghost.height = ph;
    ghost.className = 'palette-ghost';
    const gctx = ghost.getContext('2d')!;
    const { width, height } = this.spriteDims(sprite);
    paintFrameCells(gctx, sprite.frames[0], width, height, DISPLAY_SCALE);
    document.body.appendChild(ghost);
    this.paletteGhost = ghost;
    this.paletteGhostPx = { pw, ph };
    this.paletteDragSpriteId = spriteId;
    this.movePaletteGhost(e.clientX, e.clientY);

    const move = (ev: PointerEvent) => this.movePaletteGhost(ev.clientX, ev.clientY);
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.finishPaletteDrag(ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  private movePaletteGhost(clientX: number, clientY: number): void {
    if (!this.paletteGhost) return;
    const { pw, ph } = this.paletteGhostPx;
    this.paletteGhost.style.left = `${clientX - pw / 2}px`;
    this.paletteGhost.style.top = `${clientY - ph / 2}px`;
  }

  private finishPaletteDrag(clientX: number, clientY: number): void {
    if (this.paletteGhost) {
      this.paletteGhost.remove();
      this.paletteGhost = null;
    }
    if (this.canvas && this.paletteDragSpriteId) {
      const rect = this.canvas.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        this.addInstance(this.paletteDragSpriteId, clientX - rect.left, clientY - rect.top);
      }
    }
    this.paletteDragSpriteId = null;
  }

  private update(dt: number): void {
    if (!this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.bubbles.forEach((b) => {
      b.y -= (b.speed * dt) / h;
      if (b.y < -0.05) b.y = 1.05;
    });

    this.instances.forEach((inst) => {
      const sprite = this.spriteFor(inst);
      if (!sprite) return;
      inst.frameTimer += dt;
      if (inst.frameTimer >= FRAME_INTERVAL) {
        inst.frameTimer = 0;
        inst.frameIndex = (inst.frameIndex + 1) % sprite.frames.length;
      }
      if (inst.isDragging) return;
      inst.bobPhase += dt * 2;
      if (inst.kind === 'fish') {
        const { pw, ph } = this.spritePx(sprite);
        if (inst.vy === undefined) inst.vy = 6 + Math.random() * 12;
        if (inst.targetY === undefined) inst.targetY = this.randomTargetY(ph);

        inst.x += inst.vx * inst.dir * dt;
        if (inst.x <= 0) {
          inst.x = 0;
          inst.dir = 1;
          inst.targetY = this.randomTargetY(ph);
        }
        if (inst.x >= w - pw) {
          inst.x = w - pw;
          inst.dir = -1;
          inst.targetY = this.randomTargetY(ph);
        }

        const dy = inst.targetY - inst.y;
        if (Math.abs(dy) < 2) {
          inst.targetY = this.randomTargetY(ph);
        } else {
          inst.y += Math.sign(dy) * Math.min(Math.abs(dy), inst.vy * dt);
        }
      }
    });
  }

  private drawBackground(): void {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#7fd7e8');
    grad.addColorStop(1, '#0f6f97');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    this.bubbles.forEach((b) => {
      const bx = b.x * w + Math.sin(b.phase + b.y * 10) * 6;
      const by = b.y * h;
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const sandH = Math.max(18, h * 0.08);
    ctx.fillStyle = '#e4c48a';
    ctx.fillRect(0, h - sandH, w, sandH);
  }

  private draw(): void {
    if (!this.ctx) return;
    this.drawBackground();
    this.instances.forEach((inst) => {
      const sprite = this.spriteFor(inst);
      if (!sprite || !this.ctx) return;
      const { width, height } = this.spriteDims(sprite);
      const { pw, ph } = this.spritePx(sprite);
      const frame = sprite.frames[inst.frameIndex % sprite.frames.length];
      const renderY = inst.y + (inst.kind === 'fish' && !inst.isDragging ? Math.sin(inst.bobPhase) * 3 : 0);

      this.ctx.save();
      this.ctx.translate(inst.x + pw / 2, renderY + ph / 2);
      if (inst.kind === 'fish' && inst.dir < 0) this.ctx.scale(-1, 1);
      this.ctx.translate(-pw / 2, -ph / 2);
      paintFrameCells(this.ctx, frame, width, height, DISPLAY_SCALE);
      this.ctx.restore();

      if (inst.id === this.selectedId) {
        this.ctx.strokeStyle = '#ffeb3b';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(inst.x - 2, renderY - 2, pw + 4, ph + 4);
      }
    });
  }

  private loop(t: number): void {
    const dt = this.lastTime ? Math.min(0.05, (t - this.lastTime) / 1000) : 0;
    this.lastTime = t;
    this.update(dt);
    this.draw();
    this.rafId = requestAnimationFrame((nt) => this.loop(nt));
  }
}

export function useTank() {
  const engineRef = useRef<TankEngine | null>(null);
  const [, setTick] = useState(0);
  if (!engineRef.current) {
    engineRef.current = new TankEngine();
  }
  const engine = engineRef.current;

  useEffect(() => {
    engine.init(() => setTick((t) => t + 1));
    engine.resizeCanvas();
    engine.refreshPalette();
    const onResize = () => engine.resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}

export type { TankEngine };
