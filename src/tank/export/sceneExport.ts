import { downloadBlob } from '@/lib/download';

/** Renders the scene as it looks `timeMs` into its animation, onto a fresh canvas. The exporter's only
 *  window onto the tank: it asks for frames and never learns what is in them. */
export type SceneFrame = (timeMs: number) => HTMLCanvasElement;

/** Used when the tank has no usable name of its own - a tank created before names existed, or one named
 *  with nothing but spaces or punctuation. */
const FALLBACK_NAME = 'fish-tank';

/** Longest filename stem taken from a tank's name. Long enough that a real name survives whole, short
 *  enough that a pasted paragraph does not become the filename. */
const MAX_NAME_LENGTH = 40;

/**
 * Turns a tank's name into a filename stem.
 *
 * Every export used to be `fish-tank.png` regardless of which tank it came from, so someone with three
 * tanks got three files with the same name and had to open each to tell them apart. The tank has had a
 * name all along.
 *
 * Anything that is awkward in a filename - path separators, the characters Windows reserves, control
 * characters, whitespace runs - collapses to a single dash, and leading/trailing dashes and dots are
 * trimmed (a name beginning with a dot would make a hidden file on Unix; one ending in a dot is
 * rejected outright by Windows). A name that is nothing but those characters leaves an empty stem,
 * which falls back rather than producing a file called `.png`.
 */
export function exportBaseName(tankName: string): string {
  const cleaned = tankName
    // Control characters, plus the set Windows reserves in a filename. Written as escapes rather than
    // as the characters themselves: as literals the class holds raw NUL..US and DEL bytes, which no
    // editor renders and no reviewer can check. Stripping them is the whole point of this line, so the
    // rule that flags control characters in a regex has nothing useful to say about it.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    // Slicing can leave a trailing dash mid-word; trim again rather than shipping "my-tank-".
    .replace(/[-.]+$/g, '');
  return cleaned || FALLBACK_NAME;
}

/** How often the video recorder redraws, and the frame rate it captures at. Real time, on its own
 *  timer, independent of the tank's simulation loop - the point is to record what is actually
 *  happening rather than to drive it. */
const VIDEO_REDRAW_MS = 50;
const VIDEO_FPS = 20;

/** GIF sampling interval. Also the delay written into each frame, so playback runs at the speed it was
 *  sampled at. */
const GIF_FRAME_DELAY_MS = 100;

/**
 * Saving the tank as a picture, a GIF or a video.
 *
 * All three are the same idea at different sample rates - ask for a frame at time t, do something with
 * it - which is why they share one `SceneFrame` callback and nothing else. Nothing here knows about
 * fish, sprites or room decorations.
 */
export class SceneExport {
  /** True while a GIF is being encoded. Read by the toolbar, which disables the other two exports and
   *  shows a spinner: encoding runs on the main thread (see `gif`) so a second one would fight it. */
  encodingGif = false;

  private recording: { recorder: MediaRecorder; timer: number } | null = null;

  private readonly frame: SceneFrame;
  /** The tank's current name, read per export rather than stored: it can be renamed between one
   *  export and the next. */
  private readonly tankName: () => string;
  private readonly notify: () => void;

  constructor(frame: SceneFrame, tankName: () => string, notify: () => void) {
    this.frame = frame;
    this.tankName = tankName;
    this.notify = notify;
  }

  private baseName(): string {
    return exportBaseName(this.tankName());
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  /** A still photo of the tank exactly as it looks right now (one frame at t=0, so every animated item
   *  draws its first frame) - the simplest of the three formats. */
  png(): void {
    this.frame(0).toBlob((blob) => downloadBlob(blob, `${this.baseName()}.png`));
  }

  /**
   * Records the live, already-animating scene as a WebM video via MediaRecorder - the browser-native
   * way to turn a canvas into a video with no encoding library of its own, at the cost of only ever
   * producing WebM (no MP4 without a much heavier ffmpeg-in-the-browser dependency this app does not
   * carry). Stop it with `stopVideo` to finalize and download.
   */
  startVideo(): void {
    if (this.recording) return;
    const canvas = this.frame(0);
    const stream = canvas.captureStream(VIDEO_FPS);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m)
    );
    if (!mimeType) return;
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      downloadBlob(new Blob(chunks, { type: mimeType }), `${this.baseName()}.webm`);
    };
    const startedAt = performance.now();
    // The stream is bound to this one canvas, so each redraw has to land *in* it rather than replacing
    // it with the fresh canvas the scene hands back.
    const redraw = () => {
      const ctx = canvas.getContext('2d')!;
      const next = this.frame(performance.now() - startedAt);
      if (canvas.width !== next.width || canvas.height !== next.height) {
        canvas.width = next.width;
        canvas.height = next.height;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(next, 0, 0);
    };
    const timer = window.setInterval(redraw, VIDEO_REDRAW_MS);
    this.recording = { recorder, timer };
    recorder.start();
    this.notify();
  }

  stopVideo(): void {
    if (!this.recording) return;
    window.clearInterval(this.recording.timer);
    this.recording.recorder.stop();
    this.recording = null;
    this.notify();
  }

  /**
   * Samples the scene at a fixed interval over `durationMs` and encodes the frames as an animated GIF
   * (gifenc - a small, dependency-free, main-thread encoder; no web worker asset to wire up the way the
   * more common gif.js needs). Each frame gets its own 256-color palette rather than one shared across
   * the whole clip - simpler, and this app's flat pixel-art color fills rarely come close to the
   * 256-color ceiling anyway, so the trade-off is invisible in practice for a several-second loop.
   */
  async gif(durationMs = 3000): Promise<void> {
    if (this.encodingGif) return;
    this.encodingGif = true;
    this.notify();
    try {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
      const frameCount = Math.max(1, Math.round(durationMs / GIF_FRAME_DELAY_MS));
      const gif = GIFEncoder();
      const start = performance.now();
      for (let i = 0; i < frameCount; i++) {
        const canvas = this.frame(i * GIF_FRAME_DELAY_MS);
        const ctx = canvas.getContext('2d')!;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, 256);
        const indexed = applyPalette(data, palette);
        gif.writeFrame(indexed, canvas.width, canvas.height, { palette, delay: GIF_FRAME_DELAY_MS });
        // Wait out the real interval between samples, so this records the scene's own already-running
        // animation rather than freezing it or racing ahead of it - the same "record what is actually
        // happening" approach the video export takes.
        const target = start + i * GIF_FRAME_DELAY_MS;
        const wait = target - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      gif.finish();
      downloadBlob(new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }), `${this.baseName()}.gif`);
    } finally {
      this.encodingGif = false;
      this.notify();
    }
  }

  /** Stops a recording in progress without downloading it - for teardown, where finalizing a file the
   *  user is no longer waiting for would be worse than dropping it. */
  destroy(): void {
    if (!this.recording) return;
    window.clearInterval(this.recording.timer);
    this.recording.recorder.ondataavailable = null;
    this.recording.recorder.onstop = null;
    this.recording.recorder.stop();
    this.recording = null;
  }
}
