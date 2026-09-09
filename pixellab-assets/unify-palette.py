"""Remap every PixelLab sprite onto one shared palette so the cat, the bird and the
scenery read as a single art set. Also hardens alpha to 0/255 at the app's own
128 cutoff (see imageImport.ts ALPHA_CUTOFF) so no soft edge survives import."""
import glob, os, sys
from PIL import Image

# One ramp, shared outline. Neutrals carry the cat, the two accents carry the bird,
# and the scenery colors sit on the same value steps.
PALETTE = [
    "#14141f",  # outline / darkest, used by every sprite
    "#2b2b3d",
    "#4a4a5e",
    "#7a7a8c",
    "#b4b4c2",
    "#e8e8f0",
    "#ffffff",
    "#2f6fb8",  # bird body dark
    "#4f9ad8",  # bird body
    "#8fcbee",  # bird body light
    "#c8862a",  # beak / food dark
    "#e8a83c",  # beak / food
    "#f7d472",  # beak / food light
    "#3d7d4e",  # plants dark
    "#5aa86a",  # plants
    "#6b4a2f",  # poop / driftwood
    "#c9ad7a",  # sand dark
    "#e3cd9c",  # sand
]

def hex2rgb(h):
    return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

PAL = [hex2rgb(h) for h in PALETTE]

def luma(c):
    return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]

def nearest(c):
    """Weighted RGB distance plus a luma term, so a remap keeps light pixels light -
    plain RGB distance happily swaps a highlight for a mid tone and flattens the form."""
    best, bd = PAL[0], None
    for p in PAL:
        dr, dg, db = c[0]-p[0], c[1]-p[1], c[2]-p[2]
        d = 2*dr*dr + 4*dg*dg + 3*db*db + 2*(luma(c)-luma(p))**2
        if bd is None or d < bd:
            best, bd = p, d
    return best

src = sys.argv[1]
dst = os.path.join(src, "unified")
os.makedirs(dst, exist_ok=True)
cache = {}
for f in sorted(glob.glob(os.path.join(src, "*.png"))):
    im = Image.open(f).convert("RGBA")
    out = []
    for r, g, b, a in im.get_flattened_data():
        if a < 128:
            out.append((0, 0, 0, 0)); continue
        key = (r, g, b)
        if key not in cache:
            cache[key] = nearest(key)
        n = cache[key]
        out.append((n[0], n[1], n[2], 255))
    o = Image.new("RGBA", im.size); o.putdata(out)
    name = os.path.basename(f)
    o.save(os.path.join(dst, name))
    cols = {p[:3] for p in out if p[3]}
    print("%-28s %-9s %d colors" % (name, "%dx%d" % im.size, len(cols)))
