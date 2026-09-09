"""Turn the shipped PixelLab PNGs into a TypeScript module of run-length encoded
frames, in exactly the shape pixelCodec.decodeFrame already reads, so the app
seeds them with no image decoding at runtime and no new storage format."""
import os, sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]

# name, type, [source files - more than one means an animation], optional ms per frame.
# Leave the fourth item off for the app's default pace (DEFAULT_FRAME_MS, 350ms); give it for
# anything whose motion has its own tempo - a drifting sky wants a much slower hold than a fish tail.
PACK = [
    ("Cat sitting",    "room",   ["chibi-cat-B-32.png"]),
    ("Cat reaching up","room",   ["chibi-cat-reach-32x40-v3.png"]),
    ("Cat standing",   "room",   ["chibi-cat-swipe-32-v2.png"]),
    ("Cat asleep",     "room",   ["chibi-cat-sleep-32-v2.png"]),
    ("Bird perched",   "room",   ["bird-perch-32.png"]),
    ("Bird pecking",   "room",   ["bird-peck-32.png"]),
    ("Bird flapping",  "room",   ["bird-flap-32.png", "bird-fly-32.png"]),
    ("Bird looking down","room", ["bird-lookdown-32.png"]),
    ("Bird asleep",    "room",   ["bird-sleep-32.png"]),
    ("Tank brush",     "room",   ["brush-40x32.png"]),
    ("Food pellets",   "object", ["food-pellet-32.png"]),
    ("Fish poop",      "object", ["fishpoop-32-v2.png"]),
    ("Fish poop sinking", "object", ["fishpoop-sinking-32-a35.png",
                                     "fishpoop-sinking-32-a60.png",
                                     "fishpoop-sinking-32-a80.png"]),
    ("Algae patch",    "object", ["algae-32-v2.png"]),
    ("Underwater scene", "background", ["background-320x200.png"]),
    ("Room by the window", "background", ["room-window-348x224.png"]),
]

# The shared palette every shipped sprite is snapped to, so the cat, the bird, the props and the
# scenes read as one set. Remapped here, while generating, rather than in a folder of pre-remapped
# copies: that folder kept vanishing off disk between runs, and a derived file that can disappear is
# worse than no derived file at all.
PALETTE = [
    "#14141f", "#2b2b3d", "#4a4a5e", "#7a7a8c", "#b4b4c2", "#e8e8f0", "#ffffff",
    "#2f6fb8", "#4f9ad8", "#8fcbee",
    "#c8862a", "#e8a83c", "#f7d472",
    "#3d7d4e", "#5aa86a",
    "#6b4a2f", "#c9ad7a", "#e3cd9c",
]
PAL = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in PALETTE]


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


_snap_cache = {}


def snap(c):
    """Nearest palette colour, weighted towards green and with a luma term so a highlight stays a
    highlight - plain RGB distance happily swaps one for a mid tone and flattens the form."""
    if c not in _snap_cache:
        best, bd = PAL[0], None
        for p in PAL:
            dr, dg, db = c[0] - p[0], c[1] - p[1], c[2] - p[2]
            d = 2 * dr * dr + 4 * dg * dg + 3 * db * db + 2 * (luma(c) - luma(p)) ** 2
            if bd is None or d < bd:
                best, bd = p, d
        _snap_cache[c] = best
    return _snap_cache[c]


def rle(path):
    """Same encoding as encodeFrame: a flat [count, paletteIndex, ...] list with
    index 0 reserved for transparent, so palette entries are 1-based."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    palette, index_of, runs = [], {}, []
    run_index, run_len = -1, 0
    for r, g, b, a in im.get_flattened_data():
        if a < 128:
            idx = 0
        else:
            key = "#%02x%02x%02x" % snap((r, g, b))
            if key not in index_of:
                palette.append(key)
                index_of[key] = len(palette)
            idx = index_of[key]
        if idx == run_index:
            run_len += 1
        else:
            if run_len:
                runs += [run_len, run_index]
            run_index, run_len = idx, 1
    if run_len:
        runs += [run_len, run_index]
    return w, h, palette, runs

lines = [
    "// GENERATED FILE - do not edit by hand.",
    "// Rebuilt by: python pixellab-assets/genpack.py pixellab-assets src/lib/data/pixellabPack.ts",
    "//",
    "// The art pack generated with PixelLab (see pixellab-assets/): the cat and bird poses, the",
    "// tank props and the two scenes, snapped to one shared 18-colour palette by the generator.",
    "//",
    "// Stored run-length encoded in pixelCodec's own RleFrame shape so seeding costs no image decoding",
    "// and adds no second storage format - storage.buildDefaultSprites turns these into real Sprites.",
    "import type { RleFrame } from '../pixelCodec';",
    "import type { SpriteType } from '../types';",
    "",
    "export interface PackEntry {",
    "  name: string;",
    "  type: SpriteType;",
    "  width: number;",
    "  height: number;",
    "  /** Milliseconds per frame, for an entry whose motion has its own tempo. Absent means the",
    "   *  app's own default pace (storage.DEFAULT_FRAME_MS). */",
    "  frameMs?: number;",
    "  /** One RleFrame per animation frame; a single entry means a still sprite. */",
    "  frames: RleFrame[];",
    "}",
    "",
    "export const PIXELLAB_PACK: PackEntry[] = [",
]

total = 0
for entry in PACK:
    name, kind, files = entry[0], entry[1], entry[2]
    frame_ms = entry[3] if len(entry) > 3 else None
    frames = []
    w = h = None
    for f in files:
        fw, fh, pal, runs = rle(os.path.join(SRC, f))
        if w is None:
            w, h = fw, fh
        elif (fw, fh) != (w, h):
            raise SystemExit("frame size mismatch in %s: %dx%d vs %dx%d" % (name, fw, fh, w, h))
        frames.append((pal, runs))
    lines.append("  {")
    lines.append("    name: %r," % name)
    lines.append("    type: '%s'," % kind)
    lines.append("    width: %d," % w)
    lines.append("    height: %d," % h)
    if frame_ms is not None:
        lines.append("    frameMs: %d," % frame_ms)
    lines.append("    frames: [")
    for pal, runs in frames:
        lines.append("      {")
        lines.append("        enc: 'rle1',")
        lines.append("        palette: [%s]," % ", ".join("'%s'" % c for c in pal))
        lines.append("        runs: [%s]," % ", ".join(str(n) for n in runs))
        lines.append("      },")
        total += len(runs)
    lines.append("    ],")
    lines.append("  },")
lines.append("];")
lines.append("")
lines.append("/** The pack entries other code addresses by name - Life mode's cast (roomScene.ts) needs to find")
lines.append(" *  the sleeping and the awake pose of each animal, and a name is the only stable handle: sprite ids")
lines.append(" *  are minted fresh on every device that seeds the pack. Renaming one of these in the editor")
lines.append(" *  detaches it from the scene, which is why the scene falls back to its own drawn shapes. */")
lines.append("export const PACK_SPRITE_NAMES = {")
lines.append("  catAsleep: 'Cat asleep',")
lines.append("  catAwake: 'Cat reaching up',")
lines.append("  birdAsleep: 'Bird asleep',")
lines.append("  birdAwake: 'Bird flapping',")
lines.append("  roomScene: 'Room by the window',")
lines.append("} as const;")
lines.append("")

open(OUT, "w", encoding="utf-8").write("\n".join(lines).replace("'", "'"))
print("wrote", OUT, "entries:", len(PACK), "run numbers:", total)
