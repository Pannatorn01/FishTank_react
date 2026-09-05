import { useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex, type Hsv } from '@/lib/pixelMath';

/** Canvas bitmap resolution - the actual on-screen size is controlled by CSS (.sv-square/.hue-bar stretch to the card width), so this just needs to stay high enough to look crisp once stretched. */
const SV_SIZE = 200;
const HUE_HEIGHT = 12;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  const svDragging = useRef(false);
  const hueDragging = useRef(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const hsvRef = useRef(hsv);
  const [hexInput, setHexInput] = useState(value);
  const lastEmitted = useRef(value);

  useEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setHsv(hexToHsv(value));
    setHexInput(value);
  }, [value]);

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
    onChange(hex);
  };

  const commitHexInput = () => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hexInput.trim());
    if (!match) {
      setHexInput(value);
      return;
    }
    const hex = `#${match[1].toLowerCase()}`;
    lastEmitted.current = hex;
    setHsv(hexToHsv(hex));
    setHexInput(hex);
    onChange(hex);
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
      <div className="sv-square">
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

      <div className="hue-bar">
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
        <span className="color-picker-swatch" style={{ background: value }} />
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
