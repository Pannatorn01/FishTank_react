# The cat room

A design for turning Life mode from "a fish tank with a cat hazard" into a room where three cats
live. Written 2026-09-10 from a reference picture (`pixellab-assets/room.jpeg`) and a wish list:
cats chasing each other, playing, watching each other play, eating, using a litter box, and sitting
at the window — plus being able to do things to them.

This is the plan, not the build. Nothing here is implemented yet.

See [PIXEL_ART_PIPELINE.md](PIXEL_ART_PIPELINE.md) for how art gets into the game, what the tools
cost, and which of them lie about what they produce.

## What blocks what

Read this first, because one item is a hard stop.

| Piece | Status |
| --- | --- |
| New cat poses | Can be generated now. ~1 generation each. |
| Small props (ball, food, litter) | Can be generated now. 1 generation each. |
| **The room backdrop** | **Blocked.** The trial plan caps image generation at 200×200; the room needs ~512×224. |

The account is on the trial: 22 generations left of 40. The character and animation tools are not
subject to the 200×200 image cap (they cap at 128px, and the cats are 48px), so **every cat
animation below can be made today**. The room cannot. It needs either a Tier 2 subscription
(512×512, $24/mo) or for the room to be drawn by hand.

That split is convenient: the cats are the work, and they are unblocked.

## The room

### Size

The reference is 2.33:1. The current room is 1.55:1, which is why it letterboxes with bars down both
sides on a wide window.

**Proposed: 512 × 224** (2.29:1). Close to the reference, close to the browser window it was measured
against, and 512 is the largest a Tier 2 subscription will generate.

### Layout

Reading the reference left to right: a tall window with a padded sill, food and water bowls on the
floor beneath it, a long low table across the middle, a round cat bed under the table, then a
scratching post, a litter box, a rug and a ball on the right, under a second window.

Proposed landmark rows and columns, in source pixels on a 512×224 canvas:

| Landmark | Position |
| --- | --- |
| Table top edge | row 140 |
| Table spans | columns 100–412 |
| Floor line (where things stand) | row 196 |
| Left window sill (a cat can sit on it) | columns 10–80, top edge row 150 |
| Right window sill | columns 440–502, top edge row 150 |
| Food and water bowls | columns 25–70 |
| Cat bed, under the table | columns 150–215 |
| Litter box | columns 430–480 |
| Scratching post | columns 400–425 |
| Toy / rug | columns 280–350 |

These put the tank at up to 268 wide and 87 tall, standing centred on row 140. That is a little
shorter than the current room allows (102), because the table has to sit higher to leave room for a
bed, a litter box and a rug underneath it. If the tank matters more than the floor, lower the table.

**The numbers above are a proposal, not a measurement.** Once the art exists, measure the real rows
and columns off it and hand them over — `ROOM_ART` in `roomScene.ts` is where they go.

### One change the code needs either way

`ROOM_ART` currently hardcodes one room's geometry. A second room means making it a record keyed by
sprite name, so each backdrop carries its own landmarks. Worth doing as part of this rather than
after.

## The cats

### Zones

Everything a cat does happens somewhere. A zone is a column on the floor line, or a sill.

`bed`, `bowls`, `litter`, `toy`, `post`, `windowLeft`, `windowRight`, `tank`

The three cats each pick a zone, walk to it, and do the thing that zone is for. Walking between
zones is the glue that makes the room read as alive rather than as three looping animations.

### What drives the choice

Four needs per cat, each a 0–1 value that drifts over time:

| Need | Rises when | Falls when |
| --- | --- | --- |
| Hunger | always, slowly | eating at the bowls |
| Energy | sleeping in a bed or on a sill | doing anything else |
| Boredom | always, faster when awake | playing, chasing, watching the window |
| Bladder | after eating | using the litter box |

The highest need picks the next activity. A cat with nothing pressing sleeps, grooms, or sits.

This is the part that makes it a cat game rather than a screensaver: the player's actions move these
numbers, so the room responds to being looked after.

**The fish tank is a fifth pull.** A hungry cat with no food in its bowl goes for the tank instead —
which turns the existing raid from a random event into a consequence. Keep an unconditional random
raid as well, at a longer interval, so a well-fed room is not a silent one.

### Activities and the art they need

| Activity | Pose | Have it? |
| --- | --- | --- |
| Sleeping in a bed | `asleep` | yes |
| Walking between zones | `walking` | yes |
| Sitting, watching | `sitting` | yes |
| Watching another cat play | `sitting` + head turn, or just `sitting` | yes |
| Eating from the bowl | `eating` | yes |
| Chasing another cat | `run` | generated, not packed |
| Grooming | `lick` | generated, not packed |
| Yawning on waking | `yawn` | generated, not packed |
| Hissing when a chase gets rough | `angry` | generated, not packed |
| Raiding the tank | `pouncing` | yes |
| **Playing with the ball** | rolling on its back, batting | **new, 1 gen** |
| **Digging in the litter** | front paws scraping | **new, 1 gen** |
| **Looking out the window** | sitting, head up, tail flicking | **new, 1 gen** |
| **Stretching on waking** | front down, back up | **new, 1 gen** |
| Drinking | template `drinking` | **new, 1 gen** |

Five new generations. Four of the five are poses that change the body's shape while standing still,
which is exactly the category the templates get wrong — generate them with `mode="v3"` and an
`action_description` naming the mechanics. See the pipeline doc.

Everything already generated lives in `pixellab-assets/cat-orange/` and costs nothing to add: run it
through `makecats.py` for the three coats and add three `CAST` rows per pose.

### Props that need to be sprites

Anything that changes state cannot be painted into the backdrop.

| Prop | Why | Cost |
| --- | --- | --- |
| Ball | moves when batted | 1 gen |
| Food in the bowl | full / empty | 1 gen |
| Litter box mess | appears, then gets buried | 1 gen, or reuse the old fish-waste sprite |

The bed, bowls themselves, litter box, scratching post and rug are static and belong in the backdrop.

### Two cats at once

Chasing and playing need a pair. The simplest version that reads correctly: one cat is the chaser
and one is the quarry, both in `run`, the chaser one step behind and both bouncing off the room's
edges. A third cat in `sitting` nearby is "watching them play" for free.

Do not try to generate a two-cat animation. Two sprites and a follow rule will read better and cost
nothing.

## What the player can do

The room currently accepts one gesture: tap a raiding cat to scare it. The rest of the toolbar acts
on the tank.

| Gesture | Effect |
| --- | --- |
| Tap a cat | Pet it. Heart bubble, boredom drops. A sleeping cat wakes and is briefly annoyed. |
| Tap the food bowl | Refill it. Cats stop raiding the tank while there is food. |
| Tap the litter box | Clean it. |
| Tap or drag the ball | Throw it; nearby cats chase. |
| Tap a raiding cat | Scare it off. Already built. |

Petting is the one to build first. It is the smallest change that makes the cats feel like they are
being kept rather than watched, and it needs no new art beyond the happy bubble that already exists.

## Suggested order

1. **Cat poses.** Five generations, unblocked today. Recolour and pack them.
2. **Zones and needs.** The per-cat state machine, driven against the current room. The cats will
   walk to the wrong-looking places until the new backdrop exists, but the logic is testable now and
   the raid already proves the pattern.
3. **`ROOM_ART` per backdrop.** Needed before a second room can exist at all.
4. **The room art.** After a subscription or a hand-drawn file.
5. **Player actions.** Petting, then the bowl, then the ball.

Steps 1 and 2 are most of the work and neither is blocked.

## Open questions

- Does a cat that gets fed properly ever raid the tank? The design above says yes, rarely, so the
  room is never silent. Worth checking that it does not feel like a punishment for playing well.
- The sleepy emote bubble already sits further above a sleeping cat than the placement maths
  predicts. That wants fixing before more bubbles are added, or every new one inherits it.
- Three cats each running a state machine, plus the fish, on every frame. Nothing here is expensive
  on its own, but it has not been measured.
