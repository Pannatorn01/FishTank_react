# Pixel art pipeline

How art gets from PixelLab into Pixel Fish Tank, what that costs, and what has already been tried
and failed. Written 2026-09-10, after the room's cast was rebuilt from one bird and one cat into
three cats with a five-stage raid.

Read this before generating anything. Several of the notes below are worth more than a generation
budget, because they are failures that only showed up after the art was paid for.

## The short version

1. Generate with PixelLab (MCP tools, or `curl` against the API — see *Access*).
2. Save the raw frames under `pixellab-assets/<subject>/`.
3. Turn them into game-ready frames with a small Python script (`makecats.py` is the worked example).
4. Add rows to `CAST` in `pixellab-assets/genpack.py`.
5. Run `python pixellab-assets/genpack.py pixellab-assets src/lib/data/pixellabPack.ts`.
6. Use the new name from `src/tank/render/roomScene.ts`.

Nothing new should ever be added to the user's sprite library. See *The library rule*.

## Access

The token lives in `.claude/settings.local.json` as `PIXELLAB_API_TOKEN`, which git ignores. The MCP
server reads it **once, at session start** — changing the token does not take effect until the
session restarts.

To use a new token immediately, call the API directly instead:

```sh
curl -s -X POST https://api.pixellab.ai/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_balance","arguments":{}}}'
```

Every MCP tool is reachable this way; `name` is the tool and `arguments` its parameters. Responses
come back as server-sent events, so strip the `data: ` prefix before parsing.

## What things actually cost

Measured on a trial account, not read off a price list.

| Call | Cost |
| --- | --- |
| `create_character`, standard mode | 1 generation |
| `animate_character`, template mode | 1 generation per direction |
| `animate_character`, v3 mode | ~1 per direction at ≤96px, more for bigger canvases |
| `create_image_pixflux` | 1 generation |
| `create_character`, pro mode | 20–40 generations |
| `inpaint_image` | 20–40 generations |
| `create_ui_asset` | 20–40 generations, and its minimum output is 192px |

An earlier note in this project claimed the character tools cost 20–40 and should be avoided. That
was wrong: it is true only of `mode="pro"`. Standard mode is 1.

Two consequences worth planning around:

- **The game is side-on, so generate one direction and mirror it in code.** Every animation costs
  per direction. `roomScene.ts` flips `predatorSprite.scale.x`; the eight-direction default would
  have cost eight times as much for seven views nothing draws.
- **Recolour instead of regenerating.** The grey and cream cats are the orange cat with its fur hue
  remapped (`makecats.py`). Free, and it guarantees the three move identically — three separate
  generations would not have matched frame for frame.

Concurrency is capped at 8 queued jobs; a ninth returns `rate limit exceeded` rather than queueing.

## What PixelLab gets wrong

**A template animation is not guaranteed to produce the pose its name promises.** This is the single
most expensive lesson here. Of the cat template's animations:

| Template | Result |
| --- | --- |
| `walk-8-frames`, `running-8-frames`, `jump`, `eating` | correct |
| `sitting` | the cat stayed standing for all 8 frames |
| `sitting-on-belly`, `seated-on-belly-idle` | a standing cat crouching slightly, never lying down |
| `angry` | a standing cat flicking its tail; unreadable at game size |

The pattern: animations with obvious travel come out right, and poses that require the body to
change shape while staying still do not. For those, delete the animation and re-run with
`mode="v3"` and an `action_description` that names the body mechanics rather than the pose:

> "cat lowering its haunches to the ground and settling into an upright sitting pose, front legs
> straight, tail curled"

> "cat lying down flat on its side asleep, body low against the ground, legs folded under, head
> resting down, eyes closed, tail curled around it"

Both worked first try, at 1 generation each. A v3 animation starts from the character's standing
rotation, so its first few frames are the transition into the pose — take the tail of the animation
as the loop, not the whole thing.

**Do not judge a pose by the sprite's bounding-box height.** A cat sitting up keeps almost the same
height, because the head rises as the haunches drop. Two poses were signed off on that measurement
in this project and both were wrong. Render the frames and look at them. `makecats.py`'s contact
sheets exist for this.

**Never mention the fish tank or a ledge in a prompt.** It draws the tank or a table edge into the
sprite. Describe the pose alone and let the scene compose it.

**Emote bubbles come out at wildly different sizes.** Four bubbles generated from near-identical
prompts ranged from 17px to 26px wide. Do not try to fix this by regenerating: `placeCastMember`
sizes everything by the width of its *drawn* pixels, so passing them all the same `widthFrac` makes
them uniform on screen whatever the source canvas is.

**No bird template exists.** Quadruped templates are bear, cat, dog, horse, lion.

## Getting art into the game

### The palette

`genpack.py` snaps every colour to one shared 20-colour palette so the whole set reads as one style.
Sprite cells are plain `#rrggbb` with **no per-pixel alpha**, so hard edges matter more than
shading — generate with flat shading, low detail, and a selective outline.

Adding a colour to the palette changes how *every* sprite snaps, not just the new one. Two were
added for the emote bubbles (a red and a pink, which nothing else in the set uses). After any
palette change, decode the packed sprites and look at them — `pixellab-assets/cats/_packcheck.png`
was rendered straight out of the generated module for exactly this reason.

### Missing source art

Several source PNGs have been deleted from `pixellab-assets/` over time. `genpack.py` carries such
entries over from the module it last wrote rather than dropping them silently, and prints what it
carried. A regeneration that quietly ships less than the last one is the failure this guards
against.

### The library rule

**Generated art is never seeded into the user's sprite library.** It was, for several versions, and
the result was a library the user had to scroll past two dozen cat poses and a row of props to reach
their own drawings.

- `ROOM_CAST_PACK` (generated) holds everything the renderer draws.
- `storage.buildCastSprites()` decodes it once into `Sprite` objects, in memory, never persisted.
- `storage.buildDefaultSprites()` returns only the two hand-drawn samples.
- `storage.strayCastSprites()` lists library sprites that are really pack art, and
  `usePixelEditor` deletes them on load. **Add any new pack name to `RETIRED_CAST_NAMES` when it
  stops being used**, or old libraries keep it forever.

A test asserts the starter library is exactly the two samples. Keep it passing.

## Adding a new room backdrop

The room is `pixellab-assets/room-window-348x224.png`, packed as `Room by the window`.

The catch is `ROOM_ART` in `roomScene.ts`: a set of fractions measured off that one picture — where
the table top edge is, how wide the table is, where the floorboards start, where each cat sleeps.
**A different backdrop needs its own numbers.** There is no way to find a painted table
automatically, and the tank stands on the painted table rather than at a fixed screen position.

To add one:

1. Generate at 348×224, or update `fitRoomBackground`'s assumptions if the aspect changes.
2. Measure the table top edge, table span, and floor line in source pixels.
3. Either replace `ROOM_ART`'s numbers, or make `ROOM_ART` a per-backdrop record keyed by sprite
   name — the second is the real fix once there is more than one room.

Note the size limits: image generation caps at 320×320 on Tier 1 and 512×512 on Tier 2. The current
room is 348 wide, which is already past Tier 1.

For a room that moves, `animate_image` costs `ceil(width × height × frames / 65536)`. A full 348×224
backdrop at 8 frames is ~10 generations. A 128×64 strip — a curtain, a patch of sky — is 1, and
composites over the still room for the same effect.

## Adding a new cat action

The raid is a five-phase state machine. The pieces:

| Where | What |
| --- | --- |
| `types.ts` | `PredatorPhase` — the phase names |
| `useTank.ts` | `stepPredator` — phase transitions and timings |
| `roomScene.ts` | `PHASE_POSE`, `PHASE_EMOTE`, `FLOOR_PHASES` — how each phase is drawn |
| `genpack.py` | one `CAST` row per coat per pose |

To add a phase: add it to `PredatorPhase`, handle it in `stepPredator`, and give it a pose and an
emote. To add only a pose, add the rows and point an existing phase at it.

Two rules the current design leans on:

- **Only the phase with a real deadline draws the countdown bar.** A bar during the approach would
  claim the fish was already in danger. The two phases before the pounce are warnings, not timers.
- **The container needs an explicit `hitArea`.** Pixi hit-tests a container against its children,
  and the pose sprite is `eventMode: 'none'` while the fallback shape is hidden — so without a
  rectangle there is nothing to tap. This has broken once already.

Poses already generated but not yet used by any phase live in `pixellab-assets/cat-orange/`:
`angry`, `run`, `lick`, `yawn`, `idle`, `sit` (whole), `eat`. Adding one costs 0 generations —
recolour it in `makecats.py` and add three `CAST` rows.

## Open items

- The sleepy emote bubble sits further above the sleeping cat on screen than the placement maths
  predicts (14px at the measured viewport). Unresolved; needs a browser to diagnose.
- `ROOM_ART` hardcodes one backdrop's geometry. See *Adding a new room backdrop*.
- The project has no browser automation installed, so nothing here has been verified by actually
  looking at the running app. Placement has been checked by replaying `roomScene`'s own maths in
  Python against the packed sprites (`pixellab-assets/cats/_in-room.png`), which is not the same
  thing.
- `pose-v1.py`, `pose-v2.py`, `sink-angle.py` and `unify-palette.py` are one-off scripts from
  earlier art work. They reference PNGs that no longer exist and nothing calls them.
