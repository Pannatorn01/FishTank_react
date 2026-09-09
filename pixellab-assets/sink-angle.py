"""Build a sinking-dropping variant out of the approved resting strands, by
lifting one strand and tilting it. Rotating existing pixels keeps the exact
palette and thickness of the sprite that was already accepted, which a fresh
generation kept failing to match."""
from PIL import Image

SRC = "fishpoop-32-v2.png"

def components(im):
    w, h = im.size
    px = list(im.get_flattened_data())
    seen = [[False]*w for _ in range(h)]
    def op(x, y): return 0 <= x < w and 0 <= y < h and px[y*w+x][3] >= 128
    out = []
    for y in range(h):
        for x in range(w):
            if op(x, y) and not seen[y][x]:
                stack = [(x, y)]; seen[y][x] = True; cells = []
                while stack:
                    cx, cy = stack.pop(); cells.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx+dx, cy+dy
                            if op(nx, ny) and not seen[ny][nx]:
                                seen[ny][nx] = True; stack.append((nx, ny))
                out.append(cells)
    out.sort(key=len, reverse=True)
    return out, px, w

def crop_component(im, cells, px, w):
    xs = [p[0] for p in cells]; ys = [p[1] for p in cells]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    sub = Image.new("RGBA", (x1-x0+1, y1-y0+1))
    sub.putdata([px[y*w+x] if (x, y) in set(cells) else (0, 0, 0, 0)
                 for y in range(y0, y1+1) for x in range(x0, x1+1)])
    return sub

def harden(im):
    """Nearest-neighbour rotation still leaves half-alpha edge pixels on some
    builds; force every pixel back to fully on or fully off at the app's cutoff."""
    d = [(r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
         for r, g, b, a in im.get_flattened_data()]
    o = Image.new("RGBA", im.size); o.putdata(d); return o

def place(sub, size=32):
    c = Image.new("RGBA", (size, size))
    c.paste(sub, ((size - sub.width)//2, (size - sub.height)//2))
    return harden(c)

im = Image.open(SRC).convert("RGBA")
comps, px, w = components(im)
strand = crop_component(im, comps[0], px, w)   # the longest of the three

for angle, name in ((35, "fishpoop-sinking-32-a35.png"),
                    (60, "fishpoop-sinking-32-a60.png"),
                    (80, "fishpoop-sinking-32-a80.png")):
    r = strand.rotate(angle, resample=Image.NEAREST, expand=True)
    out = place(r)
    out.save(name)
    n = sum(1 for p in out.get_flattened_data() if p[3])
    print(name, "%dx%d" % out.size, n, "opaque px")
