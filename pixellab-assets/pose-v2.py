"""Re-pose the approved chibi cat by relocating its own limb pixels, so every
pose keeps the character's real shading and lay ends up looking like the same
cat - which is exactly what re-generating could not guarantee."""
from PIL import Image

OUTLINE  = (0x14, 0x14, 0x1f)
DARK     = (0x2b, 0x2b, 0x3d)

def load(p):
    im = Image.open(p).convert("RGBA"); w, h = im.size
    px = list(im.get_flattened_data())
    return [[px[y*w+x] for x in range(w)] for y in range(h)]

def save(g, name):
    h = len(g); w = len(g[0])
    im = Image.new("RGBA", (w, h))
    im.putdata([g[y][x] for y in range(h) for x in range(w)])
    im.save(name); print(name, "%dx%d" % (w, h))

def blank(w, h): return [[(0,0,0,0)]*w for _ in range(h)]
def inb(g, x, y): return 0 <= y < len(g) and 0 <= x < len(g[0])
def put(g, x, y, c):
    if inb(g, x, y): g[y][x] = (c[0], c[1], c[2], 255)
def op(g, x, y): return inb(g, x, y) and g[y][x][3] >= 128

def paste(dst, src, dx, dy):
    for y, row in enumerate(src):
        for x, c in enumerate(row):
            if c[3] >= 128: put(dst, x+dx, y+dy, c)

def grab(g, x0, y0, x1, y1):
    """Lift a rectangle of limb pixels out of the sprite, returning it as its
    own little grid and clearing it from the source."""
    out = []
    for y in range(y0, y1+1):
        row = []
        for x in range(x0, x1+1):
            c = g[y][x] if op(g, x, y) else (0,0,0,0)
            row.append(c)
            if op(g, x, y): g[y][x] = (0,0,0,0)
        out.append(row)
    return out

def flipv(s): return s[::-1]
def fliph(s): return [r[::-1] for r in s]

def connect(g, x0, y0, x1, y1, width=2):
    """Short dark upper arm joining a relocated paw back to the shoulder, drawn
    under an outline so it does not read as a floating bar."""
    n = max(abs(x1-x0), abs(y1-y0), 1)
    cells = set()
    for i in range(n+1):
        t = i/n
        cx = round(x0 + (x1-x0)*t); cy = round(y0 + (y1-y0)*t)
        for o in range(width): cells.add((cx+o, cy))
    for (x, y) in cells: put(g, x, y, DARK)
    for (x, y) in cells:
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            if (x+dx, y+dy) not in cells and not op(g, x+dx, y+dy):
                put(g, x+dx, y+dy, OUTLINE)

# ---------------- swipe: right foreleg swings out and up --------------------
b = load("chibi-cat-B-32.png")
g = blank(40, 32)
paste(g, b, 0, 0)
leg = grab(g, 17, 24, 22, 30)          # the cat's own right foreleg
paste(g, leg, 24, 17)                   # replanted forward and higher
connect(g, 21, 22, 25, 20, 2)           # shoulder to the new paw
save(g, "chibi-cat-swipe-40x32.png")

# ---------------- hang: both forepaws raised beside the head ---------------
b = load("chibi-cat-B-32.png")
g = blank(32, 42)
DY = 10
paste(g, b, 0, DY)
rl = grab(g, 17, 24+DY, 22, 30+DY)      # right foreleg
ll = grab(g, 11, 24+DY, 16, 30+DY)      # left foreleg
paste(g, flipv(rl), 23, 4)              # flipped so the paw points up
paste(g, fliph(flipv(ll)), 3, 4)
connect(g, 22, 11, 24, 24+DY, 2)        # arms running up past the ears
connect(g, 8,  11, 8,  24+DY, 2)
save(g, "chibi-cat-hang-32x42.png")
