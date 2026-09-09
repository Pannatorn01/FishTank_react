"""Build the room's three cats from the one cat PixelLab generated.

Only one cat was ever generated (pixellab-assets/cat-orange/, side view, east); the grey and the
cream cat are that same drawing recoloured here. Three generated cats would have cost three times
the generations and still not have matched each other frame for frame - a recolour is free and
guarantees the three move identically, which is what makes them read as one household of cats
rather than three unrelated sprites.
"""
import colorsys, os
from PIL import Image

SRC = 'cat-orange'
OUT = 'cats'
# pose name -> (source folder, frame range). Two of these are tails rather than whole animations:
# both the lie-down and the sit-down start with the cat still on its feet moving into the pose, and
# those lead-in frames are a transition, not the pose. Taking frames 4..8 gives the settled pose,
# which then loops as slow breathing. The rest are used whole.
POSES = {
    'asleep': ('sleep', range(4, 9)),
    'walk': ('walk', range(0, 8)),
    'sit': ('sit', range(4, 9)),
    'pounce': ('jump', range(0, 8)),
    'eat': ('eat', range(0, 7)),
}
# Hue window covering every warm fur tone in the source (350..70 deg, wrapping through 0). The
# green eyes fall outside it and so keep their colour in every coat.
def in_fur(h):
    return h >= 350 or h <= 70

# Dark tones are recoloured by their own rule. The source cat's contour is a dark brown that sits
# inside the same hue window as its fur, so treating it like body colour lifted it to a mid grey
# and the silhouette dissolved at the ~20px the room draws these at.
DARK_V = 0.60
VARIANTS = {
    'orange': None,
    'grey': lambda h, s, v: (250 / 360, s * 0.12, v * 0.45 if v < DARK_V else v),
    'cream': lambda h, s, v: (38 / 360, s * (0.55 if v < DARK_V else 0.30),
                              v * 0.50 if v < DARK_V else v * 0.82 + 0.18),
}


def recolour(im, fn):
    if fn is None:
        return im
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < 0.12 or not in_fur(h * 360):
                continue
            nh, ns, nv = fn(h * 360, s, v)
            nr, ng, nb = colorsys.hsv_to_rgb(nh, min(1, ns), min(1, nv))
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


for pose, (folder, rng) in POSES.items():
    frames = [Image.open(os.path.join(SRC, folder, '%d.png' % i)).convert('RGBA') for i in rng]
    # One bounding box for the whole animation, so the cat moves inside its frame instead of every
    # frame being re-centred on its own pixels - which reads as a jitter, not as walking.
    boxes = [f.getbbox() for f in frames]
    L = min(b[0] for b in boxes); T = min(b[1] for b in boxes)
    R = max(b[2] for b in boxes); B = max(b[3] for b in boxes)
    for var, fn in VARIANTS.items():
        d = os.path.join(OUT, var)
        os.makedirs(d, exist_ok=True)
        for i, f in enumerate(frames):
            recolour(f.crop((L, T, R, B)), fn).save(os.path.join(d, '%s-%d.png' % (pose, i)))
    print(pose, '<-', folder, len(frames), 'frames', (R - L, B - T))
