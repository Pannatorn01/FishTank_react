"""Turn the shipped PixelLab PNGs into a TypeScript module of run-length encoded
frames, in exactly the shape pixelCodec.decodeFrame already reads, so the app
seeds them with no image decoding at runtime and no new storage format."""
import os, sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]

# name, type, [source files - more than one means an animation]
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
            key = "#%02x%02x%02x" % (r, g, b)
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
    "// Rebuilt by pixellab-assets/genpack.py from the PNGs in pixellab-assets/unified/.",
    "//",
    "// The art pack generated with PixelLab (see pixellab-assets/): the cat and bird poses, the",
    "// tank props and the two scenes, all on one shared 18-colour palette. Stored run-length",
    "// encoded in pixelCodec's own RleFrame shape so seeding costs no image decoding and adds no",
    "// second storage format - storage.buildDefaultSprites turns these into real Sprites.",
    "import type { RleFrame } from '../pixelCodec';",
    "import type { SpriteType } from '../types';",
    "",
    "export interface PackEntry {",
    "  name: string;",
    "  type: SpriteType;",
    "  width: number;",
    "  height: number;",
    "  /** One RleFrame per animation frame; a single entry means a still sprite. */",
    "  frames: RleFrame[];",
    "}",
    "",
    "export const PIXELLAB_PACK: PackEntry[] = [",
]

total = 0
for name, kind, files in PACK:
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
lines.append("} as const;")
lines.append("")

open(OUT, "w", encoding="utf-8").write("\n".join(lines).replace("'", "'"))
print("wrote", OUT, "entries:", len(PACK), "run numbers:", total)
