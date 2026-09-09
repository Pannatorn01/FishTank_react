"""Hand-author the two poses PixelLab would not change, by editing the approved
chibi cat sprite directly. Keeps the exact character (same pixels for head and
body) and only redraws the limbs, which no re-generation can promise."""
from PIL import Image

SRC = "chibi-cat-B-32.png"
OUT = "."

OUTLINE = (0x14, 0x14, 0x1f)
DARK    = (0x2b, 0x2b, 0x3d)
MID     = (0x4a, 0x4a, 0x5e)
WHITE   = (0xff, 0xff, 0xff)
OFFWHITE= (0xe8, 0xe8, 0xf0)

def load(p):
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    px = list(im.get_flattened_data())
    return [[px[y*w+x] for x in range(w)] for y in range(h)], w, h

def save(g, name):
    h = len(g); w = len(g[0])
    im = Image.new("RGBA", (w, h))
    im.putdata([g[y][x] for y in range(h) for x in range(w)])
    im.save("%s/%s" % (OUT, name))
    print(name, "%dx%d" % (w, h))

def blank(w, h):
    return [[(0, 0, 0, 0)] * w for _ in range(h)]

def put(g, x, y, c):
    if 0 <= y < len(g) and 0 <= x < len(g[0]):
        g[y][x] = (c[0], c[1], c[2], 255)

def opaque(g, x, y):
    return 0 <= y < len(g) and 0 <= x < len(g[0]) and g[y][x][3] >= 128

def paste(dst, src, dx, dy):
    for y, row in enumerate(src):
        for x, c in enumerate(row):
            if c[3] >= 128:
                put(dst, x + dx, y + dy, c)

def limb(g, x0, y0, x1, y1, width, fill, edge):
    """Thick straight limb: fill first, then trace an outline around it so the
    arm reads against both the head behind it and the empty background."""
    n = max(abs(x1 - x0), abs(y1 - y0))
    cells = set()
    for i in range(n + 1):
        t = i / n
        cx = round(x0 + (x1 - x0) * t)
        cy = round(y0 + (y1 - y0) * t)
        for o in range(width):
            cells.add((cx + o - width // 2, cy))
    for (x, y) in cells:
        put(g, x, y, fill)
    for (x, y) in cells:
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            if (x+dx, y+dy) not in cells:
                put(g, x+dx, y+dy, edge)
    return cells

def paw(g, cx, cy, flip):
    """A little mitten curling over the rim: three pixels wide, one row of
    knuckles, outlined."""
    d = 1 if flip > 0 else -1
    cells = [(cx, cy), (cx+d, cy), (cx+2*d, cy),
             (cx, cy+1), (cx+d, cy+1), (cx+2*d, cy+1)]
    for (x, y) in cells:
        put(g, x, y, WHITE)
    put(g, cx+d, cy+1, OFFWHITE)
    for (x, y) in cells:
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            if (x+dx, y+dy) not in cells:
                put(g, x+dx, y+dy, OUTLINE)

base, W, H = load(SRC)

# ---- pose: hanging / reaching up -------------------------------------------
# The cat keeps its own head and body; only the forelegs are new. The canvas
# grows upward so the raised paws have somewhere to go.
g = blank(32, 40)
DY = 9
paste(g, base, 0, DY)
# erase the sitting forelegs (they sat in front of the chest) so the new arms
# are not competing with them
for y in range(22 + DY, 31 + DY):
    for x in range(10, 22):
        if opaque(g, x, y):
            g[y][x] = (0, 0, 0, 0)
# rebuild a simple hanging lower body in their place
limb(g, 15, 22 + DY, 15, 29 + DY, 7, WHITE, OUTLINE)
limb(g, 12, 30 + DY, 19, 30 + DY, 2, DARK, OUTLINE)
# arms from the shoulders up past the ears
limb(g, 9, 24 + DY, 6, 5, 3, DARK, OUTLINE)
limb(g, 22, 24 + DY, 25, 5, 3, DARK, OUTLINE)
paw(g, 5, 4, +1)
paw(g, 26, 4, -1)
save(g, "chibi-cat-hang-32x40.png")

# ---- pose: swipe -----------------------------------------------------------
g2 = blank(40, 32)
paste(g2, base, 0, 0)
# one foreleg swings out to the right at chest height
for y in range(22, 31):
    for x in range(16, 22):
        if opaque(g2, x, y):
            g2[y][x] = (0, 0, 0, 0)
limb(g2, 20, 24, 32, 21, 3, DARK, OUTLINE)
paw(g2, 33, 20, +1)
save(g2, "chibi-cat-swipe-40x32.png")
