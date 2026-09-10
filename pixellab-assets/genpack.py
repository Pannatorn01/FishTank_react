"""Turn the shipped PixelLab PNGs into a TypeScript module of run-length encoded
frames, in exactly the shape pixelCodec.decodeFrame already reads, so the app
seeds them with no image decoding at runtime and no new storage format."""
import os, sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]

# name, type, [source files - more than one means an animation], ms per frame or None,
# and whether to snap the colours to the shared palette (default True).
#
# Every entry here is art the *renderer* uses - the room's cats, their emote bubbles, and the room
# itself. None of it is seeded into the user's sprite library any more. It used to be, and the
# result was a library the user had to scroll past two dozen cat poses and a row of props to reach
# their own drawings. A library holds what someone drew; this holds what the game draws.
# Leave the fourth item off for the app's default pace (DEFAULT_FRAME_MS, 350ms); give it for
# anything whose motion has its own tempo - a drifting sky wants a much slower hold than a fish tail.
CAST = [
    # The Life-mode cast: three cats in every pose the room's activities draw them in. One pose per
    # activity (see CAT_ACTIVITIES in useTank.ts), plus the walk that carries them between zones.
    # Poses generated but still unused - angry, yawning, idle, standing - stay in
    # pixellab-assets/cat-orange/ rather than padding the bundle out.
    ("Cat orange asleep", "room", ["cats/orange/asleep-%d.png" % i for i in range(5)], 420),
    ("Cat orange walking", "room", ["cats/orange/walk-%d.png" % i for i in range(8)], 130),
    ("Cat orange sitting", "room", ["cats/orange/sit-%d.png" % i for i in range(5)], 380),
    ("Cat orange pouncing", "room", ["cats/orange/pounce-%d.png" % i for i in range(8)], 110),
    ("Cat orange eating", "room", ["cats/orange/eat-%d.png" % i for i in range(7)], 200),
    ("Cat orange drinking", "room", ["cats/orange/drink-%d.png" % i for i in range(6)], 220),
    ("Cat orange grooming", "room", ["cats/orange/groom-%d.png" % i for i in range(12)], 180),
    ("Cat orange running", "room", ["cats/orange/run-%d.png" % i for i in range(8)], 90),
    ("Cat orange playing", "room", ["cats/orange/play-%d.png" % i for i in range(5)], 200),
    ("Cat orange watching", "room", ["cats/orange/watch-%d.png" % i for i in range(5)], 400),
    ("Cat orange stretching", "room", ["cats/orange/stretch-%d.png" % i for i in range(5)], 240),
    ("Cat grey asleep", "room", ["cats/grey/asleep-%d.png" % i for i in range(5)], 420),
    ("Cat grey walking", "room", ["cats/grey/walk-%d.png" % i for i in range(8)], 130),
    ("Cat grey sitting", "room", ["cats/grey/sit-%d.png" % i for i in range(5)], 380),
    ("Cat grey pouncing", "room", ["cats/grey/pounce-%d.png" % i for i in range(8)], 110),
    ("Cat grey eating", "room", ["cats/grey/eat-%d.png" % i for i in range(7)], 200),
    ("Cat grey drinking", "room", ["cats/grey/drink-%d.png" % i for i in range(6)], 220),
    ("Cat grey grooming", "room", ["cats/grey/groom-%d.png" % i for i in range(12)], 180),
    ("Cat grey running", "room", ["cats/grey/run-%d.png" % i for i in range(8)], 90),
    ("Cat grey playing", "room", ["cats/grey/play-%d.png" % i for i in range(5)], 200),
    ("Cat grey watching", "room", ["cats/grey/watch-%d.png" % i for i in range(5)], 400),
    ("Cat grey stretching", "room", ["cats/grey/stretch-%d.png" % i for i in range(5)], 240),
    ("Cat cream asleep", "room", ["cats/cream/asleep-%d.png" % i for i in range(5)], 420),
    ("Cat cream walking", "room", ["cats/cream/walk-%d.png" % i for i in range(8)], 130),
    ("Cat cream sitting", "room", ["cats/cream/sit-%d.png" % i for i in range(5)], 380),
    ("Cat cream pouncing", "room", ["cats/cream/pounce-%d.png" % i for i in range(8)], 110),
    ("Cat cream eating", "room", ["cats/cream/eat-%d.png" % i for i in range(7)], 200),
    ("Cat cream drinking", "room", ["cats/cream/drink-%d.png" % i for i in range(6)], 220),
    ("Cat cream grooming", "room", ["cats/cream/groom-%d.png" % i for i in range(12)], 180),
    ("Cat cream running", "room", ["cats/cream/run-%d.png" % i for i in range(8)], 90),
    ("Cat cream playing", "room", ["cats/cream/play-%d.png" % i for i in range(5)], 200),
    ("Cat cream watching", "room", ["cats/cream/watch-%d.png" % i for i in range(5)], 400),
    ("Cat cream stretching", "room", ["cats/cream/stretch-%d.png" % i for i in range(5)], 240),
    # Emote bubbles shown above a cat (roomScene.ts). Single frames: the bubble pops in and out
    # rather than animating, so its whole motion belongs to the scene, not to the sprite.
    ("Emote happy",    "room",   ["emotes/happy.png"]),
    ("Emote angry",    "room",   ["emotes/angry.png"]),
    ("Emote sleepy",   "room",   ["emotes/sleepy.png"]),
    ("Emote hungry",   "room",   ["emotes/hungry.png"]),
    # Tank grime and litter. The algae comes in two densities: a thin tuft for a glass that is only
    # starting to go, and a thick mat once it has been left. Waste is drawn as two different things -
    # a strand drifting down, then a pile once it lands - because a falling pile looks like a bug.
    # Algae keeps its own greens. The shared palette has exactly two of them, so snapping the
    # generated art to it collapsed the base into near-black and the fronds into one flat tone -
    # the tuft came out looking like a clump of dirt rather than something growing.
    ("Algae thin",     "object", ["algae-sway/%d.png" % i for i in range(7)], 190, False),
    ("Algae thick",    "object", ["algae-thick-32.png"], None, False),
    ("Waste sinking",  "object", ["fishpoop-sinking-32-a35.png",
                                  "fishpoop-sinking-32-a60.png",
                                  "fishpoop-sinking-32-a80.png"], 260),
    ("Waste settled",  "object", ["fishpoop-32.png"]),
    # The two tools the player actually uses on the tank: the sponge that follows a scrub drag, and
    # the pellets that fall through the water after a feed. Both were drawn as flat Pixi shapes (a
    # yellow rounded rectangle, a plain circle) next to pixel-art fish, which looked exactly like
    # what it was.
    ("Tank brush",     "room",   ["brush-40x32.png"]),
    ("Food pellets",   "object", ["food-sink/%d.png" % i for i in range(7)], 150),
    # The room itself. Also render-only: the backdrop is the room Life mode draws, not a picture the
    # user has to keep filed in their library to stop the room going blank.
    # The room the cats live in. Its landmarks are measured in ROOM_ART (roomScene.ts) - a different
    # backdrop needs its own numbers, so replacing this file means re-measuring, not just swapping.
    ("Room by the window", "background", ["room-cats-512x220.png"], None, False),
]


# The shared palette every shipped sprite is snapped to, so the cats, the props and the
# scenes read as one set. Remapped here, while generating, rather than in a folder of pre-remapped
# copies: that folder kept vanishing off disk between runs, and a derived file that can disappear is
# worse than no derived file at all.
PALETTE = [
    "#14141f", "#2b2b3d", "#4a4a5e", "#7a7a8c", "#b4b4c2", "#e8e8f0", "#ffffff",
    "#2f6fb8", "#4f9ad8", "#8fcbee",
    "#c8862a", "#e8a83c", "#f7d472",
    # Added for the emote bubbles: an anger red and a heart pink. Nothing else in the pack is
    # either colour, so the snap keeps sending the cats' warm browns to the brown ramp - checked
    # against the rendered sprites after adding these, not assumed.
    "#c0392b", "#e08aa0",
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


def rle(path, snap_colors=True):
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
            key = "#%02x%02x%02x" % (snap((r, g, b)) if snap_colors else (r, g, b))
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

# Entries whose PNGs are no longer on disk are carried over verbatim from the module this script
# last wrote. The source art for a few of the older sprites was deleted once it had been packed, and
# regenerating without this would silently drop them out of the starter library - a content
# regression with no error to notice it by. Reading the previous output back is not elegant, but the
# alternative is a generator that quietly ships less than it did last run.
def carried_entries(path):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return {}
    nl = chr(10)
    out = {}
    for b in text.split(nl + "  {" + nl)[1:]:
        body = b.split(nl + "  }," )[0]
        for line in body.split(nl):
            if line.startswith("    name: "):
                name = line[len("    name: "):].rstrip(",").strip("'")
                out[name] = "  {" + nl + body + nl + "  },"
                break
    return out


CARRIED = carried_entries(OUT)


def sources_present(files):
    return all(os.path.exists(os.path.join(SRC, f)) for f in files)


lines = [
    "// GENERATED FILE - do not edit by hand.",
    "// Rebuilt by: python pixellab-assets/genpack.py pixellab-assets src/lib/data/pixellabPack.ts",
    "//",
    "// The art generated with PixelLab (see pixellab-assets/): the three cats' poses, the emote",
    "// bubbles and the room, snapped to one shared 20-colour palette by the generator.",
    "//",
    "// Stored run-length encoded in pixelCodec's own RleFrame shape so seeding costs no image decoding",
    "// and adds no second storage format - storage.buildCastSprites turns these into real Sprites.",
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
    "/** Life mode's art - the cats, the emote bubbles above them, and the room backdrop.",
    " *",
    " *  None of this is seeded into the user's sprite library. It is the renderer's own art, decoded",
    " *  on first use and never written to storage (see storage.buildCastSprites). A library holds what",
    " *  the user drew; this holds what the game draws. */",
    "export const ROOM_CAST_PACK: PackEntry[] = [",
]

total = 0
carried_over = []


def emit(entries):
    """Appends one TypeScript array body's worth of entries to `lines`."""
    global total
    for entry in entries:
        name, kind, files = entry[0], entry[1], entry[2]
        frame_ms = entry[3] if len(entry) > 3 else None
        # A room photographed rather than drawn to the shared ramp keeps its own colours: the
        # 20-colour palette was built around the cats and a blue-and-brown room, and forcing a warm
        # pastel interior through it turned the beige walls grey and speckled the table pink. Such a
        # file is expected to arrive already reduced to a sane number of colours.
        snap_colors = entry[4] if len(entry) > 4 else True
        if not sources_present(files):
            if name not in CARRIED:
                raise SystemExit("no art and no previous entry for %r" % name)
            lines.append(CARRIED[name])
            carried_over.append(name)
            continue
        frames = []
        w = h = None
        for f in files:
            fw, fh, pal, runs = rle(os.path.join(SRC, f), snap_colors=snap_colors)
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


emit(CAST)
lines.append("];")
lines.append("")
lines.append("/** The pack entries other code addresses by name - Life mode's cast (roomScene.ts) looks up each")
lines.append(" *  cat's poses, and a name is the only stable handle: sprite ids are minted fresh on every device")
lines.append(" *  that seeds the pack. Renaming one of these in the editor detaches it from the scene, which is")
lines.append(" *  why the scene falls back to its own drawn shapes. */")
lines.append("export const PACK_SPRITE_NAMES = {")
lines.append("  roomScene: 'Room by the window',")
lines.append("  scrubBrush: 'Tank brush',")
lines.append("  foodPellet: 'Food pellets',")
lines.append("  algaeThin: 'Algae thin',")
lines.append("  algaeThick: 'Algae thick',")
lines.append("  wasteSinking: 'Waste sinking',")
lines.append("  wasteSettled: 'Waste settled',")
lines.append("} as const;")
lines.append("")
lines.append("/** The emote bubble shown above a cat (roomScene.ts drawEmote). Names match the pack entries. */")
lines.append("export const EMOTE_SPRITE_NAMES = {")
lines.append("  happy: 'Emote happy',")
lines.append("  angry: 'Emote angry',")
lines.append("  sleepy: 'Emote sleepy',")
lines.append("  hungry: 'Emote hungry',")
lines.append("} as const;")
lines.append("export type EmoteKind = keyof typeof EMOTE_SPRITE_NAMES;")
lines.append("")
lines.append("/** The three cats that live in the room. Same drawing in three coats - see")
lines.append(" *  pixellab-assets/cats/, built by recolouring the one generated cat rather than generating three. */")
lines.append("export const CAT_VARIANTS = ['orange', 'grey', 'cream'] as const;")
lines.append("export type CatVariant = (typeof CAT_VARIANTS)[number];")
lines.append("export type CatPose =")
lines.append("  | 'asleep'")
lines.append("  | 'walking'")
lines.append("  | 'sitting'")
lines.append("  | 'pouncing'")
lines.append("  | 'eating'")
lines.append("  | 'drinking'")
lines.append("  | 'grooming'")
lines.append("  | 'running'")
lines.append("  | 'playing'")
lines.append("  | 'watching'")
lines.append("  | 'stretching';")
lines.append("")
lines.append("/** The pack entry name for one cat in one pose. Kept as a function rather than a table so a new")
lines.append(" *  coat only has to be added to CAT_VARIANTS and to genpack.py's PACK. */")
lines.append("export function catSpriteName(variant: CatVariant, pose: CatPose): string {")
lines.append("  return `Cat ${variant} ${pose}`;")
lines.append("}")
lines.append("")

open(OUT, "w", encoding="utf-8").write("\n".join(lines).replace("'", "'"))
print("wrote", OUT, "cast entries:", len(CAST), "run numbers:", total)
if carried_over:
    print("carried over (source art missing):", ", ".join(carried_over))
