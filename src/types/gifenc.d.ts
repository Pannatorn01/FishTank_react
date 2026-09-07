/**
 * gifenc ships no types of its own and there's no @types/gifenc package - this covers exactly the
 * slice of its API TankEngine.exportGif (useTank.ts) actually calls. See
 * https://github.com/mattdesl/gifenc for the full surface if more of it is ever needed.
 */
declare module 'gifenc' {
  export type GifColor = [number, number, number] | [number, number, number, number];

  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): GifColor[];

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifColor[], format?: string): Uint8Array;

  export interface WriteFrameOptions {
    palette?: GifColor[];
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
    readonly buffer: ArrayBuffer;
    readonly stream: { bytesView(): Uint8Array };
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;
}
