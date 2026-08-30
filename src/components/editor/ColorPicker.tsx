import { useEffect, useRef, useState } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

const SV_SIZE = 100;
const HUE_HEIGHT = 10;

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

export function ColorPicker({ engine }: { engine: PixelEditorEngine }) {
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  const svDragging = useRef(false);
  const hueDragging = useRef(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(engine.color));
  const hsvRef = useRef(hsv);
  const [hexInput, setHexInput] = useState(engine.color);
  const lastEmitted = useRef(engine.color);

  useEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);

  useEffect(() => {
    if (engine.color === lastEmitted.current) return;
    setHsv(hexToHsv(engine.color));
    setHexInput(engine.color);
  }, [engine.color]);

  useEffect(() => {
    const canvas = svRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = hsvToHex(hsv.h, 1, 1);
    ctx.fillRect(0, 0, w, h);
    const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
    whiteGrad.addColorStop(0, '#fff');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, w, h);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, '#000');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, w, h);
  }, [hsv.h]);

  useEffect(() => {
    const canvas = hueRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((c, i, arr) => grad.addColorStop(i / (arr.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, []);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    lastEmitted.current = hex;
    setHexInput(hex);
    engine.setColor(hex);
  };

  const commitHexInput = () => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hexInput.trim());
    if (!match) {
      setHexInput(engine.color);
      return;
    }
    const hex = `#${match[1].toLowerCase()}`;
    lastEmitted.current = hex;
    setHsv(hexToHsv(hex));
    setHexInput(hex);
    engine.setColor(hex);
  };

  const updateFromSv = (clientX: number, clientY: number) => {
    const canvas = svRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = clamp01((clientX - rect.left) / rect.width);
    const v = 1 - clamp01((clientY - rect.top) / rect.height);
    emit({ h: hsvRef.current.h, s, v });
  };

  const updateFromHue = (clientX: number) => {
    const canvas = hueRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const h = clamp01((clientX - rect.left) / rect.width) * 360;
    emit({ h, s: hsvRef.current.s, v: hsvRef.current.v });
  };

  return (
    <div className="color-picker">
      <div className="sv-square" style={{ width: SV_SIZE, height: SV_SIZE }}>
        <canvas
          ref={svRef}
          width={SV_SIZE}
          height={SV_SIZE}
          onPointerDown={(e) => {
            svDragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateFromSv(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!svDragging.current) return;
            updateFromSv(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            svDragging.current = false;
          }}
          onPointerCancel={() => {
            svDragging.current = false;
          }}
        />
        <div className="sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>

      <div className="hue-bar" style={{ width: SV_SIZE, height: HUE_HEIGHT }}>
        <canvas
          ref={hueRef}
          width={SV_SIZE}
          height={HUE_HEIGHT}
          onPointerDown={(e) => {
            hueDragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateFromHue(e.clientX);
          }}
          onPointerMove={(e) => {
            if (!hueDragging.current) return;
            updateFromHue(e.clientX);
          }}
          onPointerUp={() => {
            hueDragging.current = false;
          }}
          onPointerCancel={() => {
            hueDragging.current = false;
          }}
        />
        <div className="hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="color-picker-footer">
        <span className="color-picker-swatch" style={{ background: engine.color }} />
        <input
          className="color-picker-hex-input"
          type="text"
          value={hexInput}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={commitHexInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitHexInput();
              e.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}
