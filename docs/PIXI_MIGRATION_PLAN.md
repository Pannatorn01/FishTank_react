# Pixel Fish Tank — PixiJS Migration + Fish-Care Simulation

> **RESUME PROMPT** — อ่านไฟล์นี้ก่อนเริ่มงานต่อทุกครั้งที่ context หาย / เปิด session ใหม่
> อัปเดต §10 Progress Log ทุกครั้งที่ทำอะไรเสร็จ **ก่อน** ไปขั้นถัดไป
>
> Created: 2026-09-07 · Branch: `main` · Status: **PLANNING — ยังไม่เริ่มเขียนโค้ด**

---

## 0. คำสั่งเริ่มงานใหม่ (paste ได้เลยถ้า session ใหม่)

```
อ่าน docs/PIXI_MIGRATION_PLAN.md แล้วทำ Phase ต่อไปที่ยังไม่เสร็จตาม §10 Progress Log
ห้ามข้าม checkpoint — แต่ละ Phase ต้องผ่าน "Done when" ครบก่อนไป Phase ถัดไป
ห้ามแตะ src/hooks/usePixelEditor.ts และเครื่องมือวาดใน editor เพื่องานนี้ (เหตุผลใน §5)
> **อัปเดต 2026-09-08:** มีงานแยกต่างหาก (คนละ scope กับ Pixi migration นี้) ที่รื้อ editor engine ไปแล้ว
> เยอะ — สรุปเพื่อไม่ให้เอกสารนี้ทำให้เข้าใจผิด:
> - เครื่องมือวาด migrate ไป `src/lib/tools/` **ครบ 14/14** (pen, eraser, rect, ellipse, line, magicWand,
>   move, select, lasso, eyedropper, fill, gradient, spray, curve) — ไม่มี if-chain เดิมใน `usePixelEditor.ts`
> - undo/redo เปลี่ยนเป็น **diff-based** (`src/lib/undoHistory.ts`) — ไม่ใช่ full-snapshot ต่อ step แล้ว
> - ลบ dead code จาก engine ไปหลายรอบ (`shapePreviewCells`/`redrawShapePreview`, legacy pen/eraser
>   painting path + `applyBrushAt`/`mirrorCells`/`strokeStep`/... ~340 บรรทัด)
> - `usePixelEditor.ts` เหลือ ~3,900 บรรทัด (จาก ~4,500 ในตาราง §3)
>
> กฎ "ห้ามแตะ editor" **ยังใช้ได้กับงาน Pixi migration นี้เหมือนเดิม** (Pixi bridge เชื่อมผ่าน `Sprite`
> data + `paintLayers()` เท่านั้น ไม่ต้องรู้ engine ภายในเลย) แต่ตาราง §5.D / §3 / §7.D ที่พูดถึง editor
> internals ล้าสมัยแล้ว — **ยึด `src/lib/tools/ARCHITECTURE.md` + `docs/EDITOR_IMPROVEMENTS.md` เป็นความจริง**
> ก่อนอ้างว่า editor ส่วนไหน "เดิมและนิ่งแล้ว"
```

---

## 1. เป้าหมาย — แยกเป็นสองโหมด

ตอนนี้แท็บ "Fish Tank" ทำสองอย่างปนกัน (จัดวาง + จำลองปลาว่าย) ต่อไปจะแยกให้ชัด

### Mode A — **Build / Layout** (คือแท็บ Fish Tank ปัจจุบัน แต่ลดบทบาทลง)
เอาไว้ "จัดวาง" อย่างเดียว หลังวาดสไปรท์เสร็จจาก editor
- วางปลา / ของตกแต่งลงในตู้
- วาง room decor รอบตู้
- ตั้งขนาด / รูปทรงตู้ (rectangle / rounded / oval) / พื้นหลัง
- จัด layer, group, zone
- export PNG / GIF / WebM
- **ไม่มี** กลไกเลี้ยงดู ไม่มีความหิว ไม่มีตาย — ปลาว่ายไปมาสวย ๆ เหมือนเดิม

> คิดว่าเป็น "โหมดออกแบบตู้" — sandbox / แต่งร้าน

### Mode B — **Life / Simulation** (Phase 1 — ของใหม่ทั้งหมด)
เอาตู้ที่ออกแบบไว้จาก Mode A ไป "วางในห้องเรา" แล้วเลี้ยงจริง
- ให้อาหารปลา
- เติมน้ำ (น้ำระเหย / ลดลง)
- ขัดตะไคร่ (algae เกาะกระจก)
- เก็บขี้ปลา (ของเสียสะสม → น้ำเสีย)
- ป้องกันแมว / นก มากินปลา
- ปลามากกว่า 2 ตัว → ผสมพันธุ์ออกลูกได้
- ปลามีอายุขัย → ตายได้

**ภาพเป้าหมาย:** ตู้ปลาวางอยู่ในห้องพิกเซลอาร์ต (หน้าต่างเมืองกลางคืน โปสเตอร์ ต้นไม้ โคมไฟ กองหนังสือ)
ตู้เป็นแค่ *วัตถุหนึ่งชิ้น* ในฉากห้อง ไม่ใช่เต็มหน้าจอแบบตอนนี้

> สำคัญ (คำผู้ใช้): *"เส้นที่เราเห็นในตู้ปลาก็แค่เส้นกำหนดที่ปลาสามารถว่ายได้เท่านั้น"*
> → เส้นขอบตู้ = **swim boundary** ไม่ใช่ขอบเขตของฉาก ทุกอย่างนอกเส้นนั้นคือ "ห้อง"

---

## 2. ทำไมถึงใช้ Pixi ตอนนี้ (ก่อนหน้านี้เคยแนะนำว่า "อย่า")

เดิมประเมินว่า **ไม่คุ้ม** เพราะโจทย์ตอนนั้นคือแค่ตู้ปลา ปลาหลักสิบตัว รูปแบน ๆ Canvas2D เหลือเฟือ
ไม่มีคอขวด performance ให้แก้เลย

**โจทย์ใหม่เปลี่ยนคำตอบ** — Mode B คือเกมจริง ๆ ที่ต้องมี
- ฉากห้องเต็มจอ + parallax + วัตถุโต้ตอบได้หลายสิบชิ้น
- particle: เม็ดอาหารร่วง, ขี้ปลาตกพื้น, ฟองอากาศ, คราบตะไคร่ค่อย ๆ ขึ้น
- ตัวละครเคลื่อนไหว (แมว / นก) เข้าออกฉาก มี state machine
- hit-testing รายวัตถุจำนวนมาก (คลิกเก็บขี้, คลิกไล่แมว, ลากขัดกระจก)
- layer / depth sorting ซับซ้อนกว่าเดิมมาก (หน้า–หลังตู้, ในน้ำ–นอกน้ำ)
- อาจมี filter (น้ำขุ่นเมื่อสกปรก, แสงกลางคืน)

ทำ 6 ข้อนี้ด้วย Canvas2D + DOM layer ที่ sync มือแบบตอนนี้ = ทรมานและบั๊กเยอะ
Pixi ให้ scene graph + event system + batching มาให้ ซึ่งเป็นของที่ยังไงก็ต้องเขียนเองอยู่ดี

**ของแถมที่ได้ทันทีแม้ยังไม่ทำ Mode B:** ทุกวันนี้ room decor กับ background overlay เป็น **DOM layer แยก**
ที่ต้อง sync พิกัดกับ canvas ด้วยมือ (`frameOffset`, `effectiveScale`, `roomFracToScreen`) — บั๊ก zoom
ที่เพิ่งไล่แก้ไป 2 รอบมาจากตรงนี้ล้วน ๆ พอย้ายเข้า scene graph เดียวกัน **บั๊กคลาสนี้หายไปทั้งคลาส**

---

## 3. สถาปัตยกรรมปัจจุบัน (verify แล้ว 2026-09-07)

### ไฟล์
```
src/hooks/useTank.ts          ~2200 บรรทัด  TankEngine class (Canvas2D) — state+sim+hit-test+draw+export ปนกันหมด
src/hooks/usePixelEditor.ts   ~3900 บรรทัด  editor engine — ไม่ต้องแตะเพื่องาน Pixi (แต่งานอื่นรื้อไปเยอะ ดู §0)
src/lib/tools/                เครื่องมือวาดทั้ง 14 ตัว (Tool/Gesture) + paintPipeline + undoHistory — ดู ARCHITECTURE.md
src/lib/pixelMath.ts          paintLayers() ← จุดเชื่อมเดียวระหว่าง editor กับ tank
src/lib/storage.ts            localStorage keys  fishtank.*.v1
src/lib/types.ts              Sprite / Layer / Instance / RoomInstance / TankGroup / SelectionBox / TankShape
src/components/tank/
  TankPanel.tsx               แท็บ + sidebar (Layers / Sprites / Background)
  TankCanvas.tsx      ~600บ.  viewport, fitScale/effectiveScale, zoom, action bar, ปุ่ม export
  RoomLayer.tsx               room decor = DOM layer แยก  (จะถูกกลืนเข้า Pixi ที่ P2)
  TankBackgroundOverlay.tsx   กล่อง move/resize/rotate ของ background = DOM layer แยก
  TankLayers.tsx              รายการ layer รวม (ไม่มีแท็บแยกประเภทแล้ว)
  TankPalette.tsx             ลากสไปรท์ลงตู้
```

### ระบบพิกัด (สำคัญมาก — ที่มาของบั๊กเกือบทั้งหมด)

| ระบบ | ใช้กับ | หน่วย |
|---|---|---|
| **tank-logical px** | `Instance.x/y`, `SelectionBox`, `BackgroundTransform.x/y` | พิกเซลของ raster `tankCanvas` (`tankWidth × tankHeight`) |
| **viewport fraction** | `RoomInstance.xFrac/yFrac` | 0..1 ของขนาด `.tank-viewport` **ที่ zoom 100%** |
| **screen px** | pointer events | ต้องหารด้วย `displayScale` เสมอ |

- `fitScale = min(1, vpW/tankW, vpH/tankH)` — ย่อให้ตู้พอดี viewport
- `effectiveScale = fitScale × TANK_ZOOM_STEPS[zoomIndex]` โดย `TANK_ZOOM_STEPS = [0.5, 0.75, 1]`
- `engine.displayScale` = `effectiveScale` (ป้อนกลับเข้า engine ผ่าน `setDisplayScale`)
- `roomFracToScreen()` / `roomScreenToFrac()` = คู่แปลงกลับกันเป๊ะ ใช้ทั้งตอน render และตอน drag

### สิ่งที่ TankEngine ทำอยู่ (ต้องหาบ้านใหม่ให้ทุกอัน)
- **state** — `sprites / instances / groups / roomInstances / tankWidth / tankHeight / tankShape / background*`
- **sim** — `update(dt)`: ว่าย, schooling, bounce ขอบ, frame animation
- **geometry** — `shapePath()` (Path2D), `clampCenterToShape()`, `clampTopLeftToShape()`, `swimBoundsFor()`
- **input** — `onCanvasPointerDown/Move/Up`, `hitTest()`, marquee, zone tool, `startPaletteDrag`
- **draw** — `draw()`, `drawInstance()`, `drawBackground()` + `bgCache*`
- **undo** — `snapshotState / commitUndo / undo / redo` (UNDO_LIMIT 50)
- **export** — `compositeScene()` → `exportPng` / `exportGif` (gifenc) / `startVideoExport` (MediaRecorder)
- **persist** — `persist()` → `storage.save*`

### สัญญาระหว่าง editor ↔ tank (มีอยู่แล้ว ใช้ต่อได้เลย)
```js
window.dispatchEvent(new CustomEvent('ft:sprites-updated'))               // usePixelEditor.ts:4444
window.dispatchEvent(new CustomEvent('ft:sprite-deleted', {detail:{id}})) // usePixelEditor.ts:4499
// รับที่ TankPanel.tsx:23-24
```
→ **นี่คือจุด invalidate texture cache ของ Pixi** (ดู §5)

---

## 4. สถาปัตยกรรมเป้าหมาย

หัวใจไม่ใช่ "เปลี่ยนไป Pixi" แต่คือ **แยก state / sim / render ออกจากกัน** — Pixi แค่มาแทนชั้น render

```
src/tank/
  model/
    tankState.ts       ข้อมูลล้วน + persistence (ไม่มี DOM ไม่มี canvas — unit-testable)
    types.ts           ขยายจาก src/lib/types.ts
  sim/
    swim.ts            ว่าย / schooling / bounce   ← ยกมาจาก update() เดิม
    geometry.ts        shape math ← ยกมาจาก clampCenterToShape / swimBoundsFor (pure, ห้ามพึ่ง Path2D)
    care.ts            [P5] hunger / water / algae / waste / age
    events.ts          [P5] predator spawn, breeding
  render/
    pixiApp.ts         สร้าง Application, ตั้ง NEAREST, resize
    textureCache.ts    paintLayers → canvas → Texture   (§5)
    tankScene.ts       scene graph ของตู้ (mask = swim boundary)
    roomScene.ts       [P4] ฉากห้อง
    layers.ts          depth / z ordering
  input/
    dragController.ts  Pixi events → model mutations
  export/
    capture.ts         renderer.extract → PNG / GIF / WebM
useTank.ts             เหลือแค่ React glue: สร้าง engine, subscribe, expose ให้ component
```

**กฎเหล็ก:** `sim/` และ `model/` ต้อง **ไม่ import pixi.js เลย** — ต้องทดสอบได้โดยไม่ต้องมี GPU/DOM

### mapping Canvas2D → Pixi v8

| เดิม | ใหม่ |
|---|---|
| `ctx.clip(shapePath(w,h))` | `Graphics` เป็น `container.mask` |
| `paintLayers(ctx, ...)` ทุกเฟรม | วาดครั้งเดียวลง offscreen canvas → `Texture` → `Sprite` (§5) |
| `hitTest()` วนลูปเอง | `sprite.eventMode = 'static'` + `sprite.on('pointerdown')` |
| `drawInstance()` ต่อเฟรม | อัปเดต `sprite.x/y/scale.x` — Pixi วาดเอง |
| `RoomLayer.tsx` (DOM) | `Container` ใน scene เดียวกัน — **ลบ `roomFracToScreen` ทิ้งได้** |
| `TankBackgroundOverlay` (DOM) | `Container` + handle เป็น Pixi `Graphics` |
| `compositeScene()` อ่าน `this.canvas` | `app.renderer.extract.canvas(rootContainer)` |
| `instances` array order = z | `container.sortableChildren` + `zIndex` |

### Pixi v8 API ที่ต้องรู้ (v8 ต่างจาก v7 พอสมควร)
```ts
import { Application, Container, Sprite, Texture, Graphics } from 'pixi.js';

const app = new Application();
await app.init({ background: '#000', antialias: false, resolution: 1, autoDensity: true }); // v8 = async!
container.appendChild(app.canvas);              // v8 ใช้ app.canvas  (v7 = app.view)

const tex = Texture.from(offscreenCanvas);
tex.source.scaleMode = 'nearest';               // v8 ตรงนี้ ไม่ใช่ SCALE_MODES แล้ว

const png = await app.renderer.extract.canvas(rootContainer);
```
เวอร์ชันล่าสุดตอนวางแผน: **pixi.js 8.20.1**

---

## 5. Texture Bridge — เครื่องมือวาดใน editor **ไม่ต้องแก้เลย**

editor กับ tank เชื่อมกันแค่ **ข้อมูลสไปรท์** (`Sprite` / `Layer` / `Frame`) กับ **ฟังก์ชันเดียว** คือ
`paintLayers(ctx, layers, w, h, cellPx, alphaMul?, region?)` ใน `src/lib/pixelMath.ts`

Pixi เรียก `CanvasRenderingContext2D` ตรง ๆ ไม่ได้ (มันคือ WebGL) แต่ **รับ `HTMLCanvasElement` เป็น texture ได้**
เลยใช้แพตเทิร์นที่โค้ดนี้ทำอยู่แล้ว (ดู `RoomLayer.tsx` และ `getBackgroundCache()`)

```ts
// src/tank/render/textureCache.ts
const cache = new Map<string, Texture>();          // key = `${spriteId}:${frameIndex}`

function textureFor(sprite: Sprite, frameIndex: number): Texture {
  const key = `${sprite.id}:${frameIndex}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  const { width, height } = spriteDims(sprite);
  c.width  = width  * DISPLAY_SCALE;                // DISPLAY_SCALE = 4 (คงเดิม)
  c.height = height * DISPLAY_SCALE;
  paintLayers(c.getContext('2d')!, sprite.frames[frameIndex], width, height, DISPLAY_SCALE);

  const tex = Texture.from(c);
  tex.source.scaleMode = 'nearest';                 // ** ห้ามลืม ไม่งั้นพิกเซลเบลอ **
  cache.set(key, tex);
  return tex;
}

// invalidate ผ่าน event ที่มีอยู่แล้ว (§3)
window.addEventListener('ft:sprites-updated', () => destroyAll(cache));
window.addEventListener('ft:sprite-deleted', (e) => destroyFor(e.detail.id));
```

### สรุปสิ่งที่ต้องแก้ / ไม่ต้องแก้

> **หมายเหตุ:** ตารางนี้ = "งาน Pixi migration นี้ไม่ต้องแก้ไฟล์พวกนี้" ยังจริงอยู่ (bridge เชื่อมผ่าน
> `Sprite` data + `paintLayers()` เท่านั้น) — ไม่ได้แปลว่าไฟล์พวกนี้ห้ามแก้โดยงานอื่น (เครื่องมือวาด +
> undo ถูกรื้อไปแล้วโดยงานแยก ดู §0)

| ไฟล์ | งาน Pixi migration นี้ต้องแก้? |
|---|---|
| `src/hooks/usePixelEditor.ts` | ❌ ไม่ต้อง |
| เครื่องมือวาดทั้งหมด (ตอนนี้อยู่ที่ `src/lib/tools/` — pen / eraser / fill / line / curve / rect / ellipse / spray / gradient / select / lasso / magicWand / move / eyedropper) | ❌ ไม่ต้อง |
| `PixelCanvas.tsx`, `ToolRail.tsx`, ColorPalette, LayerPanel, FramePanel | ❌ ไม่ต้อง |
| `src/lib/pixelMath.ts` | ❌ ไม่แตะ (ใช้ต่อ ห้ามแก้ signature) |
| `src/lib/types.ts` | ⚠️ เพิ่มฟิลด์ใหม่ตอน P5 เท่านั้น + ต้องมี migration |
| `src/lib/storage.ts` | ⚠️ เพิ่ม key ใหม่ตอน P2 / P5 |
| `src/hooks/useTank.ts` + `src/components/tank/*` | ✅ รื้อ |

---

## 6. แผนเป็นเฟส

> แต่ละเฟสต้องผ่าน "Done when" ครบทุกข้อก่อนไปต่อ · commit แยกทุกเฟส
> ทุกเฟส: `npx tsc -b` + `npm run build` + `npx oxlint src` ต้องสะอาด (warning เดิม 4 ตัวไม่นับ)

---

### P0 — Spike: Pixi ขึ้นจอได้ (ยังไม่แทนอะไร)
เป้า: พิสูจน์ว่า pixel art คมและ texture bridge ใช้ได้ **ก่อน** ลงทุนรื้อจริง

1. `npm i pixi.js`
2. สร้าง `src/tank/render/pixiApp.ts` + `textureCache.ts` ตาม §5
3. หน้า dev ชั่วคราว (หรือ flag `?pixi=1`) วาดสไปรท์ 1 ตัวจาก library ด้วย Pixi ข้าง ๆ ของเดิม
4. เทียบภาพกับ Canvas2D — ต้องคมเท่ากัน ไม่มี bilinear blur

**Done when:** สไปรท์ Pixi คมเป๊ะเท่า Canvas2D · bundle เพิ่มไม่เกิน ~400KB gzip · build ผ่าน

---

### P1 — แทนชั้น render ของตู้ด้วย Pixi (parity, หลัง feature flag)
เป้า: ภาพเหมือนเดิม 100% แต่วาดด้วย Pixi — ยังไม่รื้อ logic

- flag `VITE_TANK_RENDERER=pixi|canvas2d` (default `canvas2d`) เพื่อ rollback ได้ทันที
- ย้ายเข้า Pixi: น้ำ/gradient, instances, background, shape mask, zone/marquee overlay
- **ยังคง** `TankEngine` เดิมเป็นเจ้าของ state/sim — Pixi แค่อ่านค่าไปวาดใน ticker
- **ยังคง** RoomLayer / BackgroundOverlay เป็น DOM ไปก่อน (ค่อยกลืนที่ P2)

**Done when:**
- สลับ flag แล้วภาพเหมือนกันทั้ง 3 tankShape (rectangle / rounded / oval)
- zoom 100→75→50→100 กลับมาขนาดเดิมเป๊ะ (§7-A)
- ลากปลา / marquee / group / zone ทำงานเหมือนเดิม
- export PNG / GIF / WebM ยังออกไฟล์ถูกต้อง
- Playwright regression เดิมผ่านหมด

---

### P2 — กลืน room decor + background overlay เข้า scene graph
เป้า: **ฆ่าคลาสบั๊ก zoom ทิ้งถาวร** — ของแถมชิ้นใหญ่สุดของการย้ายมา Pixi

- ลบ `RoomLayer.tsx` (DOM) → `Container` ใน Pixi
- ลบ `TankBackgroundOverlay.tsx` (DOM) → `Container` + Graphics handles
- **ลบ `roomFracToScreen` / `roomScreenToFrac` / `roomLogicalRect` ทิ้ง** — ไม่จำเป็นอีก
  เพราะ room decor เป็นลูกของ container เดียวกับตู้ → zoom ไปด้วยกันอัตโนมัติ
- แปลง `RoomInstance.xFrac/yFrac` (viewport fraction) → พิกัดสัมพัทธ์กับตู้ · **ต้องมี migration ใน storage.ts**
- ปิด flag P1 ทิ้ง ลบ path Canvas2D

**Done when:**
- room decor ติดขอบตู้แล้วซูมออก/เข้า ระยะห่างสเกลตามเป๊ะ (§7-B)
- ข้อมูลเก่าใน localStorage ยังโหลดขึ้นถูกตำแหน่ง (migration ทำงาน)
- `useTank.ts` สั้นลงอย่างมีนัยสำคัญ

---

### P3 — รื้อ TankEngine เป็น model / sim / render
เป้า: เตรียมโครงให้ Phase 1 เขียนได้โดยไม่พังของเดิม

- แตกไฟล์ตาม §4
- `sim/` + `model/` ห้าม import pixi
- ย้าย `shapePath` → `geometry.ts` แบบ pure (คืน primitive ไม่ใช่ `Path2D`) แล้วให้ render สร้าง Graphics เอง
- `useTank.ts` เหลือแค่ React glue

**Done when:** พฤติกรรมเหมือนเดิมทุกอย่าง · `sim/` ทดสอบได้แบบ headless · ไม่มี import pixi ใน model/sim

---

### P4 — โครง Mode B: ฉากห้อง + สลับโหมด
เป้า: เอาตู้ไปวางในห้อง (ยังไม่มีกลไกเลี้ยง)

- `roomScene.ts` — ฉากห้อง, ตู้เป็น Container ลูกหนึ่ง, มี parallax / depth
- UI สลับ Build ↔ Life (**ต้องถามผู้ใช้ก่อน**: แท็บแยก หรือปุ่ม toggle — §9 Q10)
- Build mode = ของเดิมทั้งหมด · Life mode = ดูอย่างเดียวไปก่อน

**Done when:** สลับโหมดได้ · Build ยังทำงานครบ · ฉากห้อง render ได้

---

### P5 — กลไกการเลี้ยง (Phase 1 จริง)
**⛔ ห้ามเริ่มก่อนได้คำตอบ §9 จากผู้ใช้**

ทำทีละกลไก แต่ละอันมี commit ของตัวเอง ลำดับแนะนำ (ง่าย → ยาก)
1. อายุ + ตาย (`bornAt`, `lifespanMs`)
2. ความหิว + ให้อาหาร (particle เม็ดอาหารร่วง, ปลาว่ายเข้าหา)
3. ขี้ปลา + เก็บ (สะสม → คุณภาพน้ำ)
4. ระดับน้ำ + เติมน้ำ
5. ตะไคร่ + ขัดกระจก (ลากเมาส์ขัด)
6. ผสมพันธุ์ (>2 ตัว + เงื่อนไข → ลูกปลา)
7. แมว / นก (state machine + วิธีป้องกัน)

---

## 7. ⚠️ Invariants — ห้ามพัง (บั๊กที่ไล่แก้มาแล้ว อย่าให้กลับมา)

### A. Zoom feedback loop — `src/index.css`
```css
main       { display: flex; flex-direction: column; flex: 1; overflow: auto; min-height: 0; }
.tab-panel { flex: 1 0 auto; }
```
> เคยเป็น `height: 100%` แล้วโดนคอมเมนต์ทิ้ง → `.tab-panel` สูงตามเนื้อหา →
> zoom out ทำให้กล่องหด → วัด viewport ได้ค่าที่หดแล้ว → หดซ้อนทุกคลิก และ zoom in ไม่กลับ
>
> **เทสต์:** zoom 100→75→50→100 ต้องได้ขนาดเดิมเป๊ะ (900×600 → 900×600)

### B. Room decor ต้องขยับ "เป็นภาพเดียวกัน" กับตู้
วาง decor ชิดมุมตู้ → ระยะ center-to-corner ต้องสเกลตาม zoom
(4px @100% → 3px @75% → 2px @50% → 4px @100%)
> P2 จะลบกลไกนี้ทิ้งเพราะ scene graph จัดการให้ — **แต่ผลลัพธ์ต้องเหมือนเดิม**

### C. Export ต้องคมเสมอ ไม่ว่าจอจะซูมเท่าไร
`compositeScene()` วาดที่ 100%-equivalent เสมอ · GIF 3 วิ = 30 เฟรม @100ms · WebM ต้องมี EBML header `1a45dfa3`

### D. ไม่ต้องแตะ editor เพื่องาน Pixi นี้
pen/eraser + Pixel Perfect gating, selection outline, rotation — **ไม่อยู่ในขอบเขตงาน Pixi migration**
(เครื่องมือวาดทั้ง 14 ตัว + undo/redo ถูก refactor ไป `src/lib/tools/` แล้วโดยงานอื่น คนละ scope —
ดู §0). Pixi bridge เชื่อม editor↔tank ผ่าน `Sprite` data + `paintLayers()` เท่านั้น ไม่แตะ engine
ภายใน ทั้ง code เดิมและ code ใหม่

### E. Dock drag ใช้ pointer events ไม่ใช่ native HTML5 DnD
`src/hooks/useDockDrag.ts` — native DnD เคยทำให้ลากไม่ติด อย่าเอากลับมา

### F. Storage migration
เปลี่ยน shape ใด ๆ ใน `types.ts` ต้องมี migration ใน `storage.ts` — ผู้ใช้มีสไปรท์/ตู้ที่บันทึกไว้แล้ว
> มี subagent `storage-migration-guardian` ไว้ตรวจตรงนี้

---

## 8. Phase 1 — ร่างระบบเลี้ยง (ยังไม่สรุป รอ §9)

### state ต่อปลา (เพิ่มใน `Instance` หรือแยกเป็น `FishStats`)
```ts
bornAt: number        // epoch ms
lifespanMs: number    // สุ่มรอบค่ากลางตอนเกิด
hunger: number        // 0..1  (1 = อิ่ม)
health: number        // 0..1
lastFedAt: number
```

### state ระดับตู้ (ใหม่ทั้งหมด)
```ts
waterLevel: number     // 0..1  ระเหยลง
waterQuality: number   // 0..1  ลดตามขี้ปลาสะสม
algae: number          // 0..1  ขึ้นเรื่อย ๆ → บังกระจก + ลดคุณภาพน้ำ
wasteItems: { x: number; y: number; createdAt: number }[]
foodItems:  { x: number; y: number; vy: number }[]   // particle ร่วงลง ปลาว่ายเข้าหา
lastTickAt: number     // สำหรับ offline progression
```

### loop (อยู่ใน `sim/care.ts` — pure, รับ dt คืน state ใหม่)
```
algae       += rate * dt
waterLevel  -= evapRate * dt
quality     -= f(waste.length, algae) * dt
fish.hunger -= hungerRate * dt
fish.health -= g(hunger, quality) * dt      → health <= 0  ตาย
age > lifespan                              → ตาย
เงื่อนไขครบ (fish >= 2, hunger สูง, quality ดี, cooldown ผ่าน) → ออกลูก
สุ่มตามช่วงเวลา                              → spawn แมว / นก
```

### วัตถุโต้ตอบ (Pixi `eventMode: 'static'`)

| ของ | การกระทำ | ผล |
|---|---|---|
| เม็ดอาหาร | คลิกที่ผิวน้ำเพื่อโรย | hunger ขึ้น |
| ขี้ปลา | คลิกเก็บ | quality ดีขึ้น |
| ตะไคร่ | ลากขัดกระจก | algae ลด |
| ก๊อก / เหยือก | คลิกหรือลาก | waterLevel ขึ้น |
| แมว / นก | คลิกไล่ (หรือมีฝาปิด?) | กันปลาหาย |

---

## 9. ✅ Design Decisions (ตอบแล้ว 2026-09-07)

| # | คำถาม | คำตอบผู้ใช้ |
|---|---|---|
| Q1 | เวลาเดินแบบไหน | เรียลไทม์ — ปิดแอปแล้วปลายังหิว/สกปรก/ตายต่อได้ |
| Q2 | ปิดแอปนาน ๆ ปลาตายไหม | ไม่ได้ให้อาหารเกิน **4 วัน** → ตาย |
| Q3 | โชว์สถานะยังไง | bar แยก 2 ชุด: **สถานะปลารายตัว** + **สถานะความสะอาดตู้** (ด้านข้างจอ) |
| Q4 | ลูกปลา | สุ่มเกิด **10%/วัน** (เงื่อนไข: ปลา ≥2 ตัว) · ใช้สไปรท์แม่ปลาเดิม สเกลลง (16×16 → 8×8) · โตเต็มวัยใน **3 วัน** |
| Q5 | ปลาตาย | ลอยน้ำ กลายเป็นขาวดำ ต้องคลิกเก็บออก มี "เวลาลอย" 7 วันไปก่อน — **ผู้ใช้ให้ผมช่วยตัดสินใจเรื่อง balance (อายุขัย/โอกาสเกิด) เอง** ดู §9.1 |
| Q6 | แมว/นก | สุ่มโผล่ตอนเปิดแอปเข้ามาเล่น มีโอกาส 20% ต้องกดไล่ทัน ไม่ทัน = คาบปลาไปตัวหนึ่ง (หายจากตู้ถาวร) |
| Q7 | เงิน/ร้านค้า | ไม่มี — ดูแลล้วน ๆ ไม่มี currency/shop |
| Q8 | แพ้เกม | ไม่มี — ปลาตายหมดก็เริ่มใหม่ได้เรื่อย ๆ (ไม่ block ผู้ใช้) |
| Q9 | ศิลป์ฉากห้อง | มีฉากสำเร็จรูปให้เลือกเปลี่ยน — **ผู้ใช้จะอัปโหลดภาพเองทีหลัง** ตอนนี้ยังไม่ต้องสร้าง asset จริง (ดู §9.2) |
| Q10 | UI mode switch | **แท็บแยก 3 แท็บ**: Draw Fish/Decor · Build Tank (เดิม) · Life (ใหม่) |
| Q11 | หลายตู้ | มีหลายตู้ + เก็บ preset ได้ แต่ **เลี้ยงดู (Life mode) ทำได้ทีละตู้เดียว** ที่ active อยู่ |

### 9.1 Balance ที่ผู้ใช้ให้ผมตัดสินใจเอง (อายุขัย / อัตราเกิด)

ยึดจากเลขที่ผู้ใช้ให้แล้ว (4 วันไม่ป้อนอาหาร = ตาย, ลอยน้ำ 7 วัน, เกิด 10%/วัน, โต 3 วัน) แล้วคำนวณให้เข้ากัน:

- **อายุขัยธรรมชาติ (ไม่ป่วย ไม่หิวตาย):** สุ่ม **18–30 วันจริง** ต่อปลา (roll ตอนเกิด, เก็บใน `lifespanMs`)
  - เหตุผล: ต้องนานกว่ารอบ "โต 3 วัน" หลายเท่า ไม่งั้นลูกปลาโตไม่ทันตายก่อน แต่ก็สั้นพอให้ผู้ใช้เห็นวงจรเกิด-ตายจริงภายในเดือนเดียว ไม่ใช่รอเป็นปี
  - ป่วยจาก `hunger=0` นานเกิน 4 วัน หรือ `waterQuality` ต่ำนานเกินไป → ตายเร็วกว่านี้เสมอ (ไม่ใช่รอครบอายุขัย)
- **โอกาสเกิดลูก 10%/วัน** จะ**ลดสัดส่วนอัตโนมัติ**เมื่อประชากรเยอะขึ้น (เช่น คูณด้วย `max(0, 1 - fishCount/12)`) กัน exponential growth ล้นตู้ — เพดานแนะนำ **12 ตัว/ตู้** ค่อยจูนอีกทีตอน P5 เห็นของจริง
- ปลาต้องกินอิ่ม (`hunger > 0.5`) มา ≥1 วันติดก่อนถึงจะนับสิทธิ์สุ่มเกิดในวันนั้น — กันเกิดตอนตู้กำลังจะพัง

> ตัวเลขทั้งหมดนี้เป็นค่าเริ่มต้นสำหรับ P5 เท่านั้น ปรับได้ตอนเทสต์จริง ไม่ต้องขอ approve ใหม่ทุกครั้งที่ปรับตัวเลข — แค่ log การเปลี่ยนไว้ใน commit message

### 9.2 ฉากห้องสำเร็จรูป — รอ asset จากผู้ใช้

**ยังไม่ต้องสร้างภาพห้องเอง** — Phase 4 (`roomScene.ts`) จะเตรียม**โครง**ให้รับภาพห้องเป็น background layer
(หนึ่งภาพ = หนึ่งฉาก, ตู้ปลาวางทับเป็น container ลูก) แต่ตัว asset จริงรอผู้ใช้อัปโหลดทีหลัง
→ ระหว่างนี้ใช้สีพื้นหลังทึบ/placeholder เพื่อทดสอบ layout

---

## 10. Progress Log

> **อัปเดตทุกครั้งที่ทำเสร็จ** — นี่คือแหล่งความจริงว่าไปถึงไหนแล้ว

| Phase | Status | Date | Commit | Note |
|---|---|---|---|---|
| Plan | ✅ done | 2026-09-07 | — | เอกสารนี้ |
| Q&A §9 | ✅ done | 2026-09-07 | — | ผู้ใช้ตอบครบ 11 ข้อ — ดู §9/§9.1/§9.2 |
| P0 Spike | ✅ done | 2026-09-07 | (pending) | ดู §11 — คมเท่า Canvas2D, bundle ~145KB gzip (< 400KB), dynamic-import ไม่กระทบ main bundle |
| P1 Pixi render parity | ✅ done | 2026-09-07 | (pending) | ดู §12 — pixel-diff ผ่านทั้ง 3 ทรง, flag `?tankRenderer=pixi`/`VITE_TANK_RENDERER`, main bundle ไม่โต (dynamic import) |
| P2 room decor เข้า scene | 🟡 partial | 2026-09-08 | (pending) | ดู §13 — room decor เสร็จ+verify แล้ว, background overlay handles / Canvas2D retirement เลื่อนไป P2b/P3 โดยตั้งใจ |
| P3 แยก model/sim/render | 🟡 partial | 2026-09-08 | (pending) | ดู §14 — geometry.ts เสร็จ+verify แล้ว (เจอ+แก้บั๊ก mask จริงจาก P2 ระหว่างทำ), swim.ts/model extraction ยังไม่ทำ |
| P4 ฉากห้อง + สลับโหมด | ⬜ not started | | | รอ asset ห้องจากผู้ใช้ (§9.2) — ทำโครงไปก่อนได้ |
| P5 กลไกเลี้ยง | ⬜ not started | | | **ไม่ blocked แล้ว** — ค่า balance เริ่มต้นอยู่ §9.1 |
| Pixi render-loop cleanup | ✅ done | 2026-09-10 | `a1ca4ac` | ดู §24 — ไล่ตาม official pixijs skills (vendor ไว้ที่ `.agents/skills/` แล้ว) |

> ⚠️ แถว P4/P5 ข้างบนค้างอยู่ที่ "not started" แต่ §23 บันทึกว่า P5 ครบทั้ง 7 ข้อแล้ว — **ยึด §11–§24 เป็นความจริง ตารางนี้ไม่ได้อัปเดตตามทุกครั้ง**

### สถานะโค้ดตอนวางแผน (baseline)
- branch `main` สะอาด · commit ล่าสุด `c9c91c2 feat : can move layout column`
- ✅ เพิ่งแก้เสร็จ: zoom feedback loop (§7-A), room decor lockstep (§7-B), Tank Layers รวมลิสต์เดียว, export PNG/GIF/WebM
- deps: react 19.2.8, vite 8, tailwind 4, gifenc 1.0.3 · **ยังไม่มี pixi.js**
- `tsc -b` / `build` / `oxlint` สะอาด (เหลือ warning เดิม 4 ตัวใน `ui/*.tsx` + `TankCanvas` set-state-in-effect)

---

## 11. P0 Spike — ผลลัพธ์ (2026-09-07)

**สรุป: ผ่านทั้งสองเกณฑ์ → ไปต่อ P1 ได้**

### ไฟล์ที่สร้าง (ของชั่วคราว จะถูกลบตอนเริ่ม P1 จริง ยกเว้นสองไฟล์แรก)
```
src/tank/render/pixiApp.ts          ✅ ใช้ต่อใน P1 ได้เลย (createPixiApp/destroyPixiApp)
src/tank/render/textureCache.ts     ✅ ใช้ต่อใน P1 ได้เลย (textureFor/invalidateSprite/invalidateAll)
src/tank/render/dev/PixiSpike.tsx   🗑️ ลบตอนเริ่ม P1 - หน้าที่จบแล้ว
src/main.tsx                        ⚠️ มี branch `?pixi=1` ชั่วคราว - ลบ branch นี้ตอนลบ PixiSpike.tsx
```

### ผลตรวจ

| เกณฑ์ (จาก §6 "Done when") | ผล |
|---|---|
| สไปรท์ Pixi คมเท่า Canvas2D | ✅ ทดสอบ 3 สไปรท์ (Goldfish sample, Seaweed sample, สไปรท์วาดเองทรงเฉียง) — คมเท่ากันทุกตัว ไม่มี bilinear blur เลย (ยืนยันว่า `texture.source.scaleMode = 'nearest'` ใน textureCache.ts ทำงานถูก) |
| bundle เพิ่มไม่เกิน ~400KB gzip | ✅ pixi.js ทั้งหมด (chunk หลัก + sub-chunks ของ WebGL/WebGPU/Canvas backend ที่ pixi split เอง) รวม **~145KB gzip** — ต่ำกว่างบเกือบ 3 เท่า |
| build ผ่าน | ✅ `tsc -b` และ `npm run build` สะอาด |
| **ของแถมที่เจอเพิ่ม (ไม่ใช่เกณฑ์เดิม แต่สำคัญ)** | เพราะ import pixi.js ผ่าน `import()` แบบ dynamic (โหลดเฉพาะตอนเข้า `?pixi=1`) **bundle หลักของแอปไม่โตขึ้นเลยแม้แต่ byte เดียว** (`index-*.js` ยังคง ~164KB gzip เท่าเดิม) → **P1 ควรทำ tank renderer เป็น dynamic import เหมือนกัน** ไม่ใช่ import ตรงที่ TankPanel.tsx เพื่อไม่ให้แท็บ editor (ที่ไม่ได้ใช้ Pixi) โตขึ้นโดยไม่จำเป็น |

### วิธี re-verify ด้วยตัวเอง (ถ้าอยากดูซ้ำ)
```bash
npm run dev -- --port 5199
# เปิด http://localhost:5199/?pixi=1 (ต้องมีสไปรท์อย่างน้อย 1 ตัวในไลบรารีก่อน - วาดจากแท็บ Draw Fish/Decor)
# เทียบภาพซ้าย (Canvas2D) กับขวา (Pixi) ด้วยตา - ทั้งคู่ต้องคมเท่ากันทุก pixel
```

### สิ่งที่ P1 ต้องทำต่อ (ไม่ใช่แค่ไปอ่าน §6 P1 เฉย ๆ - นี่คือ action items จริงจาก P0)
1. ลบ `src/tank/render/dev/` ทั้งโฟลเดอร์ + ลบ branch `?pixi=1` ใน `main.tsx` กลับไปเป็นโค้ดเดิม
2. ใช้ `pixiApp.ts` + `textureCache.ts` ที่มีอยู่แล้วต่อได้เลย ไม่ต้องเขียนใหม่
3. โหลด Pixi renderer ของตู้ผ่าน dynamic `import()` ใน `TankCanvas.tsx` (ตาม flag `VITE_TANK_RENDERER`) เพื่อรักษาเรื่อง "bundle หลักไม่โต" ที่เพิ่งพิสูจน์ได้ใน P0

---

## 12. P1 Render Parity — ผลลัพธ์ (2026-09-07)

**สรุป: parity ผ่านทุกเกณฑ์ → ไปต่อ P2 ได้**

### ไฟล์ที่เพิ่ม/แก้

```
src/tank/render/rendererMode.ts      ใหม่ - อ่าน flag (?tankRenderer= > VITE_TANK_RENDERER > 'canvas2d')
src/tank/render/tankScene.ts         ใหม่ - Pixi scene builder, mirror ของ useTank.ts's draw() ทีละบรรทัด
src/tank/render/TankPixiLayer.tsx    ใหม่ - React wrapper คุม Application lifecycle + rAF loop ของมันเอง
src/tank/render/pixiApp.ts           แก้ - เพิ่ม CreatePixiAppOptions (autoDensity toggle) ให้ tank ใช้ resolution:1
                                       แทนที่จะบังคับ devicePixelRatio+autoDensity แบบที่ P0 preview เคยใช้
src/hooks/useTank.ts                 แก้ - แตก computeDrawOrder() ออกจาก draw() + เพิ่ม visibleDrawOrder()
                                       (public, read-only) ให้ Pixi renderer เรียกใช้ตรรกะ raised-z-order
                                       เดียวกันโดยไม่ต้อง copy โค้ดส่วนนั้นซ้ำ - draw() เองพฤติกรรมไม่เปลี่ยน
src/components/tank/TankCanvas.tsx   แก้ - อ่าน flag ครั้งเดียวตอน mount, canvas เดิมยังคง mount+draw
                                       เสมอ (ยังเป็น source of truth ของ hit-test/export) แค่ opacity:0
                                       เมื่อ pixi mode + วาง <TankPixiLayer> ทับ (lazy-loaded)
src/index.css                        แก้ - .tank-canvas-hidden, .tank-pixi-host, .tank-pixi-canvas
docs/PIXI_MIGRATION_PLAN.md          แก้ - เอกสารนี้
```

### สถาปัตยกรรมที่เลือก (สำคัญ - ต้องเข้าใจก่อนแตะ P2)

**Canvas2D `<canvas>` ยัง mount และวาดอยู่เสมอ ไม่ว่าโหมดไหน** - ไม่ใช่แค่จอแสดงผล มันคือ source of truth
ของ hit-test/pointer coordinate math/export (`compositeScene()` อ่านจาก `this.canvas` ตรง ๆ) ซึ่ง P1 ตั้งใจไม่แตะ
เลยตามหลักการ "parity ก่อน ไม่รื้อ logic" ในโหมด `pixi`, canvas ตัวนี้แค่โดนทำให้มองไม่เห็น (`opacity:0` -
**ไม่ใช่** `display:none`/`visibility:hidden` ซึ่งจะทำให้หยุดรับ pointer event) แล้ววาง `TankPixiLayer` ทับด้วย
`pointer-events:none` ให้ input ทะลุไปหา canvas ที่มองไม่เห็นแต่ยังทำงานอยู่เหมือนเดิม

ผลคือ **ทุกอย่างที่ P1 ไม่ได้ตั้งใจแตะ (input, undo, export, persist) ทำงานเหมือนเดิม 100% เพราะโค้ดพวกนั้นไม่ถูก
เปลี่ยนแม้แต่บรรทัดเดียว** - ยืนยันด้วย regression suite เดิมทั้งหมดผ่าน (ดูด้านล่าง)

**Pixi coordinate space = tank-logical px ตรง ๆ** - ไม่ใช่ screen/CSS px: `TankPixiLayer` เรียก
`app.renderer.resize(engine.canvas.width, engine.canvas.height)` (ขนาด logical, ไม่คูณ effectiveScale)
แล้วปล่อยให้ CSS (`width:100%;height:100%` - กฎเดียวกับที่ `.tank-canvas` ใช้อยู่แล้ว) เป็นตัว stretch จอแสดงผลไป
เป็นขนาดหน้าจอจริง เหมือนที่ Canvas2D canvas เคยทำมาตลอด - ผลคือ `root` container ไม่ต้อง `.scale()` อะไรเลย,
`Instance.x/y` ใช้ได้ตรง ๆ ไม่ต้องแปลงหน่วย (`resolution:1`, `autoDensity:false` - ปรับ `pixiApp.ts` ให้รับ
options พวกนี้แทนที่จะ hardcode แบบ P0 preview)

### วิธี re-verify ด้วยตัวเอง
```bash
npm run dev -- --port 5199
# canvas2d (ค่า default) - ไม่มีอะไรเปลี่ยน:
open http://localhost:5199/
# pixi - เทียบด้วยตา (วาด/วางสไปรท์ก่อน แล้วลองทั้ง 3 ทรงตู้ rectangle/rounded/oval):
open http://localhost:5199/?tankRenderer=pixi
```

### ผลตรวจ (pixel-diff จริง ไม่ใช่แค่ตาดู - ดูวิธีทำใน §12.1)

| สิ่งที่เทียบ | diffPixels / 1.26M px | หมายเหตุ |
|---|---|---|
| Rectangle (น้ำ+เส้นขอบ+background sprite, ปลาซ่อนไว้) | 2,980 (0.24%) | diff เกาะอยู่ที่เส้นขอบ (AA sub-pixel เท่านั้น - ดู diff map §12.1) น้ำ/gradient/background sprite ตรงเป๊ะ |
| Oval (มีตัดขอบบนแบบ flat-top) | 2,975 (0.24%) | polygon-approximation 64 จุดของเส้นโค้งวงรีเรียบพอ ไม่เห็นรอยหยัก |
| Rounded corners | 2,731 (0.22%) | `roundRect()` ของ Pixi ตรงกับ radius เดียวกันทุกมุมพอดี |
| Selection outline (กรอบเหลือง) | ตรวจด้วยตา | กรอบไม่บิดเบี้ยวตอนปลาว่ายกลับทิศ (พิสูจน์ container/outline แยกจาก sprite flip ถูกต้อง) |
| Flip (ปลาว่ายซ้าย) | ตรวจด้วยตา | สไปรท์ mirror ถูกทิศ, selection box ไม่ถูก mirror ตาม (ตรงกับ Canvas2D ที่วาดกรอบ "หลัง restore()") |
| Bundle size | main +0 byte, `pixi` chunk 71KB gzip | โหลดเฉพาะตอนเลือก pixi mode จริง ๆ |
| Tab switch × 6 รอบ | canvas count คงที่ (14 ทั้งก่อน/หลัง) | ไม่มี leak, `TankPixiLayer`'s cleanup effect ทำลาย app/scene ครบ |
| Regression suite เดิม | ผ่านหมด | zoom lockstep, room decor lockstep+drag, tank layers รวมลิสต์, pen/eraser, dock drag/scroll |

### 12.1 วิธี pixel-diff (เผื่อ session ใหม่อยากตรวจซ้ำ)
ไม่มี pixel-diff library ในโปรเจกต์ - ใช้ Playwright's headless browser เอง draw ภาพ 2 รูปลง canvas
แล้ว `getImageData` เทียบ per-pixel (threshold รวม RGB diff > 10 = นับว่าต่าง) วิธีนี้ไม่ต้องเพิ่ม dependency
สคริปต์ตัวอย่างอยู่ใน git history ของ commit นี้ (ไม่ commit เข้า repo เพราะเป็นเครื่องมือ debug ชั่วคราว)
- ผลลัพธ์ diff map (visualize เป็นภาพแดง=ต่าง/เทา=เหมือน) ยืนยันว่า diff ทั้งหมดอยู่ที่เส้นขอบ stroke บาง ๆ
  1-2px เท่านั้น (ปกติมากสำหรับเทียบ Canvas2D software rasterizer กับ Pixi/WebGL rasterizer คนละตัว - ไม่ใช่
  บั๊ก) ไม่มี diff ในพื้นน้ำ, background sprite, หรือตำแหน่ง/ขนาดของอะไรเลย

### ข้อจำกัดที่รู้ตัว (ไม่ใช่บั๊ก แค่ P1 ยังไม่ครอบคลุม - รอ P3/P4)
- Marquee/zone-draft dashed-rectangle ไม่ได้ pixel-diff ทดสอบจริง (สร้าง manual dash-segment helper ไว้ใน
  `tankScene.ts`'s `dashedRectPath()` แล้ว แต่ยังไม่ได้ตั้ง scenario ทดสอบ marquee-drag ใน Pixi mode -
  ทำได้ตอน P3 ที่ input เริ่มย้ายมาเป็น Pixi-native)
- ยังไม่ได้ทดสอบ tank ที่มี room decor + background พร้อมกันตอน pixi mode (ทดสอบแยกกันคนละ scenario)
- Group/schooling fish (หลายตัวว่ายเป็นฝูง) ยังไม่ได้ทดสอบใน pixi mode โดยเฉพาะ - z-order ของ raised-while-
  dragging ทดสอบผ่าน `visibleDrawOrder()` ที่ Canvas2D ใช้เอง (regression suite เดิมยืนยัน draw() พฤติกรรม
  ไม่เปลี่ยน) แต่ยังไม่ได้ยืนยัน "มองด้วยตา" ว่า Pixi วาด raised order ถูกจริงตอนลากปลาที่อยู่ในกลุ่ม

---

## 13. P2 Room Decor — ผลลัพธ์ (2026-09-08) — **partial, ตั้งใจ scope ลง**

**สรุป: ส่วน room decor (เป้าหมายหลักของ P2 - ฆ่าบั๊ก zoom class) เสร็จและ verify แล้ว
แต่ "ปิด flag ลบ Canvas2D ทั้งหมด" ตามที่ระบุไว้ใน §6 P2 เดิม ยังไม่ได้ทำ - ดูเหตุผลด้านล่าง**

### สิ่งที่ตั้งใจตัดสินใจต่างจาก §6 เดิม (และทำไม)

ตอนเริ่มงานจริง พบว่า "ปิด flag P1 ทิ้ง ลบ path Canvas2D" (ตามที่ §6 P2 เขียนไว้ตอนวางแผน) เปิดปัญหาที่ไม่มี
ทางเลี่ยงได้: room decor ใน Pixi ถ้าให้รับ pointer event ของตัวเอง (`eventMode:'static'`) จะชนกับ
`.tank-pixi-host` ที่ตั้ง `pointer-events:none` ไว้ตั้งแต่ P1 (จงใจ เพื่อให้ event ทะลุไปหา Canvas2D canvas
สำหรับปลา/น้ำ) — จะเปิดให้ Pixi รับ event ของตัวเองได้ ต้องเปลี่ยน host เป็น `pointer-events:auto` ซึ่งจะไป
บัง Canvas2D canvas จากการรับ event ของปลา/marquee/zone ทันที (สอง element ซ้อนกันรับ click จุดเดียวกัน
พร้อมกันไม่ได้) นี่คือการ "รวม input ให้เป็นระบบเดียว" ตัวจริง ซึ่ง §6 เองก็แยกไว้เป็นงานของ **P3
(`input/dragController.ts`)** อยู่แล้ว — ทำใน P2 จะเป็นการทำ P3 บางส่วนแบบเร่งรีบ เสี่ยงเกินความจำเป็นสำหรับ
phase ที่เป้าหมายจริงคือ "ภาพต้อง zoom ไปด้วยกัน" ไม่ใช่ "ย้าย input ทั้งระบบ"

**ทางแก้ที่เลือก:** ให้ input ของ room decor ยังอยู่ที่ DOM layer เดิม (`RoomLayer.tsx`) ในทั้งสองโหมด - แค่
`opacity:0` (ไม่ใช่ `display:none`) เวลาอยู่โหมด pixi เพื่อให้ยังรับ pointer event ได้เหมือนเดิมทุกอย่าง แต่
มองไม่เห็น ส่วน Pixi วาดสำเนา "ภาพอย่างเดียว" (visual-only) ทับไว้ด้านบน - **แพตเทิร์นเดียวกับที่ P1 ใช้กับ
Canvas2D `<canvas>` เป๊ะ** (มองไม่เห็นแต่ยังทำงาน + อีกระบบวาดทับให้เห็น) เพราะงั้น**บั๊ก zoom ของ room decor
หายจริง** (ตำแหน่ง/ขนาดคำนวณจาก scene graph เดียวกับตู้ ไม่ต้องทำ manual reprojection เลย) แต่ **ยังไม่ได้ลบ
Canvas2D หรือรวม input** — เก็บไว้เป็นงานของ P3 ตามที่ §6 วางไว้ตั้งแต่ต้นจริง ๆ

ในทางเดียวกัน **TankBackgroundOverlay.tsx (กล่อง move/resize/rotate ของ background) ไม่ได้ย้ายเข้า Pixi ในรอบ
นี้** — มันไม่มีบั๊กแบบ room decor เลย (`backgroundTransform.x/y` เป็นพิกัด tank-logical มาตั้งแต่แรก ไม่เคย
เป็น viewport-fraction) ใช้ frameOffset/effectiveScale เหมือน RoomLayer.tsx และทำงานถูกอยู่แล้วทั้งสองโหมด
โดยไม่ต้องแก้อะไร - ย้ายเข้า Pixi ตอนนี้จะเป็นแค่ "ความสวยงามของสถาปัตยกรรม" ไม่ใช่การแก้บั๊ก จึงเลื่อนไปพร้อม
กับตอน P3 รวม input ทีเดียว (ตอนนั้น handle เองก็ควรเป็น Pixi Graphics ที่รับ event ของตัวเองได้เลย)

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `RoomInstance.xFrac/yFrac` → `x/y` (พิกัด tank-logical เดียวกับ `Instance.x/y`) |
| `src/lib/storage.ts` | เพิ่ม `ROOM_MARGIN_FRAC`, `roomSceneMargin()` (source of truth เดียวของ margin ทั้งฝั่ง engine/renderer), `normalizeRoomInstances()` (migration รองรับทั้ง legacy `xFrac/yFrac` และ current `x/y` ในอาเรย์เดียวกัน) |
| `src/hooks/useTank.ts` | ลบ `roomFracToScreen`/`roomScreenToFrac`/`roomLogicalRect`/`clampRoomFrac`/`ROOM_MARGIN_PX` ทิ้งหมด แทนที่ด้วย `clampRoomPosition()`/`roomRect()` (สั้นกว่าเดิมมาก เพราะไม่ต้องแปลงหน่วย) - `addRoomInstance`/`onRoomPointerDown`/`onRoomPointerMove` ใช้ `canvasPoint()` ตรง ๆ (คู่เดียวกับที่ปลาใช้อยู่แล้ว) - `compositeScene`/`exportPng`/`startVideoExport`/`exportGif` ตัดพารามิเตอร์ `fitScale`/`viewportSize` ทิ้ง (ไม่จำเป็นอีกแล้ว) |
| `src/components/tank/RoomLayer.tsx` | ใช้ `frameOffset`+`effectiveScale` แทน `roomFracToScreen` (สูตรเดียวกับ `TankBackgroundOverlay.tsx` อยู่แล้ว) - `onRoomPointerDown/Move` รับ `clientX/clientY` ตรง ๆ ไม่ใช่ React event object ทั้งก้อน (ให้ทั้ง DOM และ Pixi (อนาคต) เรียกแบบเดียวกันได้) |
| `src/tank/render/tankScene.ts` | เพิ่ม `sceneRoot` container offset ด้วย margin, `roomLayer` (visual-only Pixi sprites อ่านจาก `engine.roomInstances` ตรง ๆ ทุกเฟรม) |
| `src/tank/render/TankPixiLayer.tsx` | resize เป็น `sceneWidth × sceneHeight` (รวม margin) แทนแค่ขนาดตู้ |
| `src/components/tank/TankCanvas.tsx` | ย้าย `<TankPixiLayer>` ออกจาก `.tank-wrap` (ซึ่ง `overflow:hidden` จะตัด margin ทิ้ง) มาเป็น sibling ระดับ `.tank-viewport` พร้อมคำนวณ style เอง; ห่อ `<RoomLayer>` ด้วย wrapper `opacity:0` เวลาโหมด pixi |
| `src/index.css` | `.tank-pixi-host` เอา `inset:0` ออก (ใช้ inline style แทน), เพิ่ม `.tank-room-layer-hidden` |

### ผลตรวจ

| เกณฑ์ | ผล |
|---|---|
| room decor ติดขอบตู้แล้ว zoom ระยะห่างสเกลตามเป๊ะ ทั้งสองโหมด | ✅ canvas2d: gap 7→5→4→7 px (ตรงสัดส่วน 100/75/50/100%) · pixi: ตรวจด้วยภาพจริงทั้ง 3 ระดับซูม (screenshot in §13 ไม่ได้ commit เข้า repo) เห็นชัดว่าเล็กลง/ใหญ่ขึ้นพร้อมกับตู้ ไม่มี manual reprojection code เหลืออยู่เลย |
| ข้อมูลเก่า (legacy `xFrac/yFrac`) โหลดขึ้นถูกตำแหน่ง | ✅ ทดสอบ seed legacy record จริงผ่าน migration - ได้ตำแหน่งจำกัดขอบเขตแน่นอน (finite, ไม่ NaN, ไม่ crash) |
| ลากย้าย room decor ยังทำงาน (ทั้งสองโหมด) | ✅ canvas2d: เหมือนเดิม · pixi: ลากที่ DOM (invisible) แล้ว Pixi visual ตามถูกต้อง (ทดสอบจริงด้วยภาพก่อน/หลัง) |
| export PNG/GIF/WebM ยังถูกต้อง | ✅ ทั้ง 3 ฟอร์แมต ยังออกไฟล์ถูกต้อง หลังตัด `fitScale`/`viewportSize` ออกจาก signature |
| `useTank.ts` สั้นลง | 🟡 สั้นลงจริง (-39 บรรทัดสุทธิ) แต่ไม่ "มาก" ตามที่ §6 คาดไว้ เพราะโค้ดส่วนใหญ่ที่ลบไปเป็น complexity ที่**ย้ายไปอยู่ที่ `tankScene.ts` แทน** (ไฟล์ใหม่) ไม่ใช่ลบทิ้งเฉย ๆ - สมเหตุสมผลเพราะ engine ยังต้องมี `clampRoomPosition`/`roomRect` สำหรับ canvas2d mode +export อยู่ดี |
| Regression suite เดิม | ✅ ผ่านหมด (zoom lockstep, room decor lockstep+drag, tank layers, pen/eraser, dock, tab-switch × 6 รอบไม่มี leak) |
| `tsc -b` / `build` / `oxlint` | ✅ สะอาด (warning เดิม 4 ตัวเท่านั้น) |

### สิ่งที่เหลือสำหรับ P2b/P3 (ระบุไว้ชัดเพื่อไม่ให้หลงลืม)
1. **รวม input เป็นระบบเดียว** - ตอนนี้มี 2 ระบบพร้อมกัน (Canvas2D `<canvas>` สำหรับปลา/น้ำ, DOM `RoomLayer.tsx` สำหรับ room decor) ทั้งคู่ "มองไม่เห็นแต่ทำงาน" ในโหมด pixi ซึ่งใช้งานได้จริงแต่ไม่ใช่สถาปัตยกรรมสุดท้าย - P3 ควรตัดสินใจว่าจะรวมเป็น Pixi-native event ทั้งหมด (`eventMode:'static'`) หรือยังคง DOM ไว้เป็นชั้น input แยกต่างหากถาวร (ทั้งสองแบบมีข้อดีข้อเสีย ยังไม่ได้ตัดสินใจ)
2. **TankBackgroundOverlay.tsx → Pixi Graphics handles** - ไม่มีบั๊กให้แก้ แต่ทำพร้อม input consolidation ใน P3 จะสมเหตุสมผลกว่า
3. **ปิด flag / ลบ Canvas2D draw() ทั้งหมด** - รอจนกว่า input จะรวมเป็นระบบเดียวก่อน (Canvas2D ยังจำเป็นสำหรับ hit-test ตราบใดที่ยังไม่มี Pixi-native input) - export ก็ยังอ่าน `this.canvas` (Canvas2D raster) อยู่ ต้องสลับเป็น `app.renderer.extract.canvas()` พร้อมกัน
4. Marquee/zone-draft dashed rectangle และ multi-fish schooling ใน pixi mode ยังไม่ pixel-diff ทดสอบ (เหมือนที่ระบุไว้ใน §12 P1 - ยังไม่ได้แก้เพิ่มใน P2)

---

## 14. P3 Geometry Extraction — ผลลัพธ์ (2026-09-08) — **partial**

**สรุป: ส่วน geometry (shape math) เสร็จและ verify แล้ว - เจอ+แก้บั๊กจริงจาก P2 ระหว่างทำด้วย
ส่วน `swim.ts`/`model/tankState.ts` (§6 เดิม) ยังไม่ได้ทำ - scope ลงเหตุผลเดียวกับ P2: ความเสี่ยงสูงเทียบกับ
ประโยชน์ที่ได้ในรอบนี้**

### ทำไม scope ลงเหลือแค่ geometry

§6 P3 เดิมตั้งใจแตกทั้ง `model/` (state+persistence) และ `sim/` (swim update loop + geometry) ออกจาก
`useTank.ts` ทั้งก้อน แต่ `update()` (swim/schooling logic) พันกับ method อื่นของ engine แน่นมาก
(`spriteFor`, `zoneFor`, `coMoversFor`, `reactNotify` ฯลฯ) การแยกให้เป็น pure function จริงจะต้องออกแบบ
"snapshot ของ engine state" ใหม่ทั้งหมดที่ swim logic อ่าน ไม่ใช่แค่ copy-paste - เสี่ยงสูงกว่า geometry มาก
(ซึ่งเป็น pure math ล้วน แยกออกมาตรงไปตรงมา) จึงเลือกทำเฉพาะ geometry ส่วนที่ **มีคุณค่าเป็นรูปธรรมชัดเจนและ
ความเสี่ยงต่ำ** ในรอบนี้ก่อน แล้วปล่อย `swim.ts`/`model/` เป็นงานต่อ (บันทึกไว้ด้านล่าง)

### ของแถมที่ไม่คาดคิด: เจอบั๊ก mask จริงจาก P2

ระหว่างเทียบผล pixel-diff ของทรง oval/rounded หลัง refactor (คาดว่าจะเหมือนเดิมเป๊ะ) เจอว่า **น้ำในตู้ทรง
oval/rounded เพี้ยนไปคนละรูปกับเส้นขอบ** (เส้นขอบถูก แต่พื้นน้ำถูกตัดผิดตำแหน่ง/ผิดขนาด) - ไล่จนพบว่าเป็นบั๊ก
จริงที่มีอยู่แล้วตั้งแต่ P2 commit (`89fe4d0`) ไม่เกี่ยวกับ geometry refactor เลย:

**ต้นเหตุ:** `mask` (Pixi Graphics ที่ใช้เป็น `root.mask`) ไม่เคยถูกเพิ่มเข้า scene graph เลย (ลอยอยู่นอก
`sceneRoot`) พอ P2 เพิ่ม `sceneRoot.position.set(marginX, marginY)` มา `root` (มีน้ำ/ปลาข้างใน) ขยับตาม
offset ถูกต้อง แต่ `mask` (ไม่มี parent) ยังคง transform เดิม (world 0,0) - clip ผิดตำแหน่งไปเลย **ทรง
rectangle รอดมาได้เพราะ Pixi ใช้ scissor-rect fast path สำหรับ mask สี่เหลี่ยมตรง (คำนวณจาก transform ของ
container ที่ถูก mask ไม่ใช่ตัว mask เอง) แต่ oval/rounded เป็น polygon ต้องใช้ stencil-buffer path ซึ่งพึ่ง
transform ของ mask เองจริง ๆ** - บั๊กเลยซ่อนอยู่และไม่มีใครเห็นจนกว่าจะมาทดสอบทรงอื่นที่ไม่ใช่ rectangle

**วิธีแก้:** เพิ่ม `root.addChild(mask)` (ให้ mask เป็นลูกของ `root` เอง จึงรับ transform เดียวกัน) - ยืนยัน
ว่า Pixi ไม่เอา mask object ไปวาดซ้ำเป็นรูปสีขาวทับหน้าจอด้วย (ลองแล้ว ไม่มีปัญหานั้น)

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/tank/sim/geometry.ts` | ใหม่ - `ROUNDED_RADIUS_MIN/MAX`, `OVAL_TOP_CUT_MIN/MAX` (ย้ายมาจาก useTank.ts), `roundedCornerRadius()`, `ovalFlatTopGeometry()`, `clampCenterToShape()`, `clampTopLeftToShape()` - pure functions ล้วน ไม่ import pixi/DOM เลย |
| `src/tank/sim/__tests__/geometry.test.ts` | ใหม่ - unit test 13 เคส (vitest, headless) ครอบคลุมทั้ง 3 ทรง + edge case (คลิปเป็น 0, cut fraction เกินขอบ, ฯลฯ) |
| `src/hooks/useTank.ts` | `shapePath()`/`clampCenterToShape()`/`clampTopLeftToShape()`/`shapeCornerRadius()` เดิม แทนที่ด้วยการเรียก geometry.ts (`clampCenterToShape` wrapper method กลายเป็น dead code เพราะไม่มีคนเรียกอีกแล้ว - ลบทิ้งไปด้วย - TS compiler เป็นคนจับได้เอง!) - re-export ค่าคงที่ 4 ตัวจาก geometry.ts ให้ import site เดิม (`TankCanvas.tsx`) ไม่ต้องแก้ |
| `src/tank/render/tankScene.ts` | `traceShape()` ใช้ `ovalFlatTopGeometry`/`roundedCornerRadius` ร่วมกับ useTank.ts แทนที่จะคำนวณ trig เองอีกชุด (ลบความเสี่ยง "sync กันแค่ด้วยตา" ที่เคยเขียนเตือนไว้ในคอมเมนต์ตัวเองจริง ๆ) + **แก้บั๊ก mask ตามด้านบน** |

### ผลตรวจ

| เกณฑ์ (§6 P3 Done-when, เฉพาะส่วน geometry) | ผล |
|---|---|
| พฤติกรรมเหมือนเดิมทุกอย่าง | ✅ pixel-diff ยืนยันหลังแก้บั๊ก mask: oval diff 4,407px (0.35%), rounded diff 7,442px (0.59%) - ระดับเดียวกับ AA-noise ที่เจอใน P1 (ไม่ใช่บั๊ก) - regression suite เดิมทั้งหมดผ่าน (room decor lockstep/drag ทั้งสองโหมด, zoom cycle, tank layers, export PNG/GIF/WebM, editor pen/eraser/dock, tab-switch × 6 ไม่ leak) |
| `sim/` ทดสอบได้แบบ headless | ✅ `npm test` รัน geometry.test.ts ผ่านหมด 13/13 ไม่ต้องมี browser/DOM |
| ไม่มี import pixi ใน model/sim | ✅ ยืนยันด้วย `grep -rn "pixi" src/tank/sim/` ไม่เจอเลย |
| `useTank.ts` เหลือแค่ React glue | ❌ ยังไม่ทำ (ตัดสินใจ scope ออกตามเหตุผลด้านบน) - ยังเป็นงานเปิดของ P3 ต่อ |

### สิ่งที่เหลือสำหรับ P3 ต่อ (รวมกับ P2's §13 list เดิม)
1. **`sim/swim.ts`** - แยก `update()` (schooling/bounce/frame-animation) ออกจาก engine เป็น pure function - งานเปิดใหญ่สุดที่เหลือของ P3 เดิม ต้องออกแบบ "engine state snapshot" ที่ swim logic อ่านก่อน ไม่ใช่ mechanical extraction ตรงไปตรงมาแบบ geometry
2. **`model/tankState.ts`** - แยก state fields + persistence ออกจาก engine class
3. รวม input เป็นระบบเดียว (จาก P2 §13) - ยังไม่ทำ
4. `TankBackgroundOverlay.tsx` → Pixi Graphics handles (จาก P2 §13) - ยังไม่ทำ
5. ปิด flag / ลบ Canvas2D ทั้งหมด (จาก P2 §13) - ยังไม่ทำ - รอข้อ 3 ก่อน

---

## 15. P4 โครง Mode B — ผลลัพธ์ (2026-09-08)

**สรุป: 3-tab switch (Draw / Build Tank / Life) เสร็จและ verify แล้ว Life เป็น view-only preview ตาม
§9 Q10/Q9 - แสดงห้อง placeholder (ยังไม่มี asset จริง ตาม §9.2) + ตู้ปลาเดิมฝังอยู่ข้างใน ยังไม่มีกลไกเลี้ยง
(P5)**

### บั๊กสถาปัตยกรรมที่พบและแก้ระหว่างทำ (ก่อนเขียน UI จริงด้วยซ้ำ)

`useTank()` เดิมถูกเรียกอยู่**ข้างใน** `TankPanel.tsx` เอง - เป็น local React state (`useRef`/`useState`)
ไม่ใช่ singleton ข้ามคอมโพเนนต์ ถ้าเพิ่ม `LifePanel` แล้วให้มันเรียก `useTank()` เองอีกรอบ จะได้ engine คนละ
ตัวกับ Build mode ทันที (เห็นข้อมูลตรงกันแค่ตอน save() แล้ว reload หน้าใหม่เท่านั้น) - แก้โดยย้าย `useTank()`
ขึ้นไปที่ component ใหม่ `TankSection.tsx` (เจ้าของ engine ตัวเดียว) ให้ `TankPanel`/`LifePanel` รับ `engine`
เป็น prop แทนที่จะเรียก hook เอง - `TankPanel.tsx` เปลี่ยนจาก `{ active }` (เรียก `useTank()` ข้างใน) เป็น
`{ engine }` (รับมาจากพ่อ) ผลข้างเคียง: การ lazy-load `TankSection` (ไม่ใช่ `TankPanel` ตรง ๆ) ยังคง
code-split bundle ของ tank engine ออกจาก editor เหมือนเดิม (69.92kB gzip 19.86kB ตาม `npm run build`
- ไม่ได้ถูกดึงเข้า main bundle)

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/components/tank/TankSection.tsx` | ใหม่ - เรียก `useTank()` ครั้งเดียว, ย้าย 2 effect (sprite listeners + `engine.setActive`) มาจาก TankPanel เดิม, mount ทั้ง `TankPanel`/`LifePanel` พร้อมกันสลับด้วย `hidden` (ไม่ conditional-render) ให้ engine loop/Pixi app ไม่ต้อง teardown ทุกครั้งที่สลับโหมด |
| `src/components/tank/TankPanel.tsx` | รับ `{ engine }` prop แทนการเรียก `useTank()`/listeners/active-effect เอง (ย้ายไป TankSection) |
| `src/components/tank/LifePanel.tsx` | ใหม่ - Pixi Application แยกของตัวเอง (`autoDensity:true`, คนละตัวกับ TankPixiLayer ของ Build mode) วาด `roomScene.ts` ทุกเฟรม |
| `src/tank/render/roomScene.ts` | ใหม่ - ห้อง placeholder (ผนัง gradient + พื้นแถบสีเข้ม ตาม §9.2) + ฝัง `createTankScene()` เดิมจาก P1-P3 ไว้ใน sub-container ที่ scale/position ให้พอดีวางบนพื้นห้อง (`TANK_FIT_FRAC = 0.62` ของพื้นที่ห้อง) |
| `src/App.tsx` | `Tab = 'editor' \| 'tank' \| 'life'`, ปุ่มแท็บที่ 3 "Life", lazy-load `TankSection` แทน `TankPanel` ตรง ๆ, `hasVisitedTank` trigger ทั้ง `tank`/`life` |
| `src/lib/i18n.ts` | `tab.tank`: "Fish Tank" → "Build Tank" (แยกความหมายจาก Life), เพิ่ม `tab.life`: "Life" |
| `src/index.css` | `.tank-mode-panel[hidden]`, `.life-layout`/`.life-pixi-host`/`.life-pixi-canvas` |

### ผลตรวจ

| เกณฑ์ (§6 P4 Done-when) | ผล |
|---|---|
| สลับโหมดได้ | ✅ Playwright: 4 รอบ Life↔Build ไม่มี console error, canvas count คงที่ (ไม่ leak Pixi app) |
| Build ยังทำงานครบ | ✅ ลากปลาจาก palette วางได้, สลับไป Life แล้วกลับมา state (ปลาที่วาง) ยังอยู่ครบ ไม่ reset/ไม่ซ้ำ |
| ฉากห้อง render ได้ | ✅ screenshot ยืนยัน: ผนัง gradient ม่วงเข้ม + พื้นแถบเข้มกว่า + ตู้ปลา (น้ำ/ปลา) ย่อขนาดวางบนพื้นห้องชัดเจน ไม่ใช่จอเปล่า/ดำ |
| editor ไม่มี regression | ✅ pen tool ยังวาดพิกเซลได้ปกติ (App.tsx เปลี่ยนแต่ editor tab ไม่ถูกแตะ) |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, `npm run build` ผ่าน, `oxlint` warning เดิม 4 ตัวเท่านั้น, `npm test` 89/89 |

### ข้อจำกัดที่ตั้งใจ (ตาม §6 P4 เอง ไม่ใช่บั๊ก)

- Life mode **ดูอย่างเดียว** - ไม่มี drag/click ใด ๆ ในตู้ (ตาม §9 Q10) - ของจริงมาใน P5
- ห้องเป็น placeholder สีล้วน ไม่ใช่ภาพจริง (ตาม §9.2 - รอผู้ใช้อัปโหลด asset)
- ตู้ใน Life mode สเกลลงตายตัวตามสัดส่วนห้อง (`TANK_FIT_FRAC`) - ยังไม่มี parallax/depth ตาม §6 เดิม (ของแต่งเสริม ไม่ block P5)

---

## 16. P5 กลไกการเลี้ยง — ข้อ 1: อายุ + ตาย (2026-09-08)

**สรุป: กลไกแรกของ P5 (ตามลำดับ "ง่าย → ยาก" ใน §6) เสร็จและ verify แล้วด้วย Playwright จริง (จำลองอายุ
ปลาผ่าน localStorage เพราะอายุขัยจริง 18-30 วัน รอไม่ได้ในเทสต์)**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `Instance` เพิ่ม `bornAt`/`lifespanMs`/`dead`/`diedAt` |
| `src/lib/storage.ts` | `randomFishLifespanMs()` (สุ่ม 18-30 วันจริงตาม §9.1) + `normalizeInstance()` migration (backfill ให้ปลาที่บันทึกไว้ก่อนมีฟีเจอร์นี้ - ตอนโหลด ไม่ใช่ตอนเซฟ ตามธรรมเนียม `normalizeRoomInstances` เดิม) |
| `src/hooks/useTank.ts` | `addInstance()` สุ่ม lifespan ตอนเกิด (เฉพาะ kind fish) · `update()` เช็ค `Date.now() - bornAt >= lifespanMs` แบบ wall-clock ตรง ๆ ทุกเฟรม (ไม่ต้องมี offline catch-up - อายุคำนวณจากนาฬิกาจริงเสมอ ตรง Q1 ที่ต้องนับต่อแม้ปิดแอป) ปลาตายแล้วลอยขึ้นผิวน้ำ (`swimBoundsFor().yMin`) หยุดว่าย/หยุด animate · `drawInstance()` desaturate ด้วย `ctx.filter = 'grayscale(1)'` · `onCanvasPointerDown()` คลิกปลาตาย = `removeInstance()` แทนการเลือก |
| `src/tank/render/tankScene.ts` | `ColorMatrixFilter` (grayscale) instance เดียวใช้ร่วมกันทุกปลาตาย ให้ตรงกับ Canvas2D |

### ผลตรวจ (Playwright จำลองด้วย localStorage: ตั้ง `bornAt` ย้อนไปไกลมาก + `lifespanMs` สั้น แล้ว reload)

| เกณฑ์ | ผล |
|---|---|
| ปลาตายตรงเวลา (wall-clock, ไม่ใช่ tick) | ✅ เจอ dead ทันทีหลัง reload |
| render desaturate | ✅ pixel scan ยืนยัน R≈G≈B บนตัวปลาที่ตาย (ทั้ง canvas2d - ยังไม่ทดสอบ pixi renderer ด้วย pixel-diff จริง แค่โค้ดรีวิว) |
| ลอยขึ้นผิวน้ำ หยุดว่าย | ✅ centroid ปลาไล่จาก y≈517 → y≈35 (จาก 600) ภายใน ~45s ด้วยอัตรา 20px/s ตามโค้ด แล้วหยุดนิ่งที่ผิวน้ำ |
| คลิกเก็บออก | ✅ Layers 2→1 แถว, pixel scan ยืนยันปลาตายหายจาก canvas |
| ปลาปกติไม่ถูกกระทบ | ✅ ยังว่ายเคลื่อนที่ปกติ, ไม่ desaturate, คลิกแล้ว **เลือก** (ไม่ลบ) เหมือนเดิม |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน (bundle Life+Build ยังแยก lazy chunk, +3.75kB gzip จาก ColorMatrixFilter), `oxlint` warning เดิม 4 ตัว, `npm test` 89/89 |

### ข้อจำกัด/ของค้างที่ตั้งใจ (ยังไม่ทำ เก็บไว้ข้อถัดไปของ P5)

- ยังไม่ verify pixel-diff จริงของ Pixi renderer's grayscale (แค่ตรวจ Canvas2D ด้วย pixel scan) - ความเสี่ยงต่ำเพราะ `ColorMatrixFilter.grayscale()` เป็น API มาตรฐานของ Pixi
- ปลาที่ตายจากความหิว/น้ำเสีย (ข้อ 2-3 ของ §6 P5) ยังไม่ทำ - ตอนนี้ตายจากอายุขัยอย่างเดียว
- "ลอย 7 วัน" ตาม §9 Q5 ยังไม่มีความหมายเชิงกลไก (ไม่ auto-ลบหลัง 7 วัน) - ตีความว่าเป็น flavor ไม่ใช่กติกาที่ต้อง enforce เว้นแต่ผู้ใช้อยากได้ auto-cleanup จริง ๆ ทีหลัง
- ลูกปลาที่คลอดใหม่ (ข้อ 6) ยังไม่มี - เมื่อทำแล้วต้องเรียก `randomFishLifespanMs()` เดียวกันนี้ตอนสร้างลูกปลาด้วย

---

## 17. P5 กลไกการเลี้ยง — ข้อ 2: ความหิว + ให้อาหาร (2026-09-08)

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง (เจอ+แก้บั๊ก 3 อันระหว่างตรวจ ก่อนจะ commit)**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `Instance` เพิ่ม `hunger`/`starvingSince` · `FoodItem` type ใหม่ |
| `src/lib/storage.ts` | `normalizeInstance()` backfill `hunger`/`starvingSince` · `KEY_TANK_LAST_TICK` + `loadTankLastTick`/`saveTankLastTick` (checkpoint สำหรับ catch-up ตอนเปิดแอปใหม่) |
| `src/hooks/useTank.ts` | `foodItems`/`lastTickAt` field ใหม่ (foodItems **ไม่ persist** - ของชั่วคราวเหมือนตำแหน่งว่ายปลาระหว่าง session) · `feedAt(x,y)` วางเม็ดอาหาร · `tickHunger(elapsedMs)` ใช้ร่วมกันทั้งต่อเฟรม (dt) และตอน catch-up (init()) - หา "จุดที่หิวตกถึง 0" แม่นยำแม้ elapsed ก้อนใหญ่ ไม่ใช่แค่ clamp เป็น 0 ตอนโหลด (สำคัญเพราะกระทบนับ 4 วันอดตาย) · food-seeking override ใน swim loop (หิว > schooling) · `drawFoodItems()` + hunger bar ใน `drawInstance()` |
| `src/tank/render/tankScene.ts` | `foodLayer` Graphics + hunger bar (ผูกกับ `v.outline` เดิม) ให้ตรงกับ Canvas2D |
| `src/tank/render/roomScene.ts` | `feedHitArea` (Graphics โปร่งใสขนาดเท่าฉากตู้ทั้งก้อนรวม margin) รับคลิกใน Life mode แปลงเป็นพิกัด tank-logical ผ่าน `onFeed` callback |
| `src/components/tank/LifePanel.tsx` | ส่ง `engine.feedAt` เป็น `onFeed` เข้า `createRoomScene` |

### บั๊ก 3 อันที่เจอตอน verify (แก้ก่อน commit)

1. **Life mode ว่างเปล่าถ้า reload แล้วเข้า Life ตรง ๆ โดยไม่เคยเปิด Build Tank ก่อนในเซสชันนั้น** - ต้นเหตุ: `engine.canvas.width/height` ไม่เคยถูกตั้งค่าเลย เพราะ `resizeCanvas()` วัดขนาดจาก DOM ของ Build mode ซึ่งถูกซ่อนด้วย `hidden` (`display:none` - ไม่มี layout เลย) ทำให้ `getBoundingClientRect()` คืน 0×0 เสมอจนกว่า Build mode จะถูกโชว์จริง แก้ใน `resizeCanvas()`: ถ้าไม่มี rect จริงให้ fallback ไปใช้ `tankWidth`/`tankHeight` (ขนาด config เชิงตรรกะ) ไปก่อน แล้วให้การวัด DOM จริงทับอีกทีเมื่อ Build mode ถูกแสดง (บั๊กนี้เป็นผลข้างเคียงจาก P4 ที่ Life/Build แชร์ engine เดียวกันแต่ Build's DOM อาจไม่เคยถูกเห็นเลย ไม่ใช่บั๊กที่เกิดจากโค้ด hunger เอง)
2. **อาหารจมลึกกว่าที่ปลาว่ายไปถึง** - อาหารเดิมพักที่ `canvas.height - 12` แต่ปลามี "แถบทราย" กันไม่ให้ว่ายชนพื้นจริง (`sandH = max(18, h*0.08)`) ทำให้ตำแหน่งพักของอาหารอยู่นอกระยะที่ศูนย์กลางปลาเข้าถึงได้เกิน `FOOD_EAT_RADIUS` เสมอ - ปลาว่ายเข้าใกล้ได้แต่ไม่มีวันกินสำเร็จ แก้โดยให้อาหารพักที่ `h - sandH - 16` (สูงกว่าเดิม อยู่ในระยะเอื้อมของปลา) และขยาย `FOOD_EAT_RADIUS` 22→28
3. **แถบความหิวโชว์แค่ Pixi (Life mode) ไม่โชว์ Canvas2D (Build mode ที่เป็น default renderer)** - ลืมใส่ตอนแรก เพิ่ม logic เดียวกันใน `drawInstance()`

### ผลตรวจ (Playwright, 2 รอบ - รอบแรกเจอบั๊กข้างบน รอบสองยืนยันหลังแก้)

| เกณฑ์ | ผล |
|---|---|
| Life mode render ได้แม้ reload ตรงเข้า Life โดยไม่ผ่าน Build ก่อน | ✅ (หลังแก้บั๊ก 1) น้ำ/เส้นขอบขึ้นทันที ไม่มี console error · กลับไป Build ทีหลังขนาดยังถูกต้อง (900×600 ไม่เพี้ยน) |
| ให้อาหารแล้วปลาหิวว่ายไปกินสำเร็จจริง | ✅ (หลังแก้บั๊ก 2) เห็นลูกอาหารหายไปพร้อมแถบหิวขยายขึ้น/เปลี่ยนสีแดง→เหลือง ที่ ~t35s หลังคลิกวาง (สังเกตซ้ำได้ 2 รอบ) |
| แถบหิวโชว์ทั้ง 2 renderer | ✅ (หลังแก้บั๊ก 3) Build mode (Canvas2D) โชว์แถบแดงตรงกับ Life mode (Pixi) |
| catch-up ตอนเปิดแอปใหม่ (Q1) | ยัง verify แค่โค้ดรีวิว + unit-level reasoning ไม่ได้จำลองผ่าน Playwright จริง (ต้องปลอม `fishtank.tankLastTick.v1` คู่กับ `bornAt` ย้อนหลัง - ทำได้แต่ยังไม่ได้ทำรอบนี้) |
| ปลาปกติ (หิวเต็ม) ไม่โชว์แถบ | ✅ เกือบทั้งหมด - เห็นแถบเขียวบางมากได้เพราะเวลาผ่านไปเสี้ยววินาทีตั้งแต่สร้างปลาหิวก็ลดจาก 1.0 ไปนิดหน่อยแล้ว (พฤติกรรมถูกต้องตามดีไซน์ ไม่ใช่บั๊ก) |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 140/140 (จำนวนเพิ่มจาก 89 เพราะมีเทสต์ใหม่จากงาน refactor เครื่องมือ editor ของผู้ใช้เอง ไม่เกี่ยวกับ P5) |

### ข้อจำกัด/ของค้าง

- ไม่ได้ verify offline catch-up (`tickHunger` เรียกจาก `init()`) ด้วย Playwright จริง - ความเสี่ยงปานกลาง เพราะ logic ซับซ้อนกว่าอายุขัย (ต้องหาจุดตัดศูนย์ให้แม่นด้วย) แนะนำ verify ก่อนใช้งานจริงจัง
- ~~Food-seeking บางครั้งอาจสั่นเล็กน้อยก่อนล็อกเป้าอาหารสำเร็จ~~ **แก้แล้ว 2026-09-08** - ผู้ใช้รายงานว่าเห็นปลาสลับซ้าย-ขวาเร็วมากตอนว่ายลงหาอาหาร (ดูเหมือนดิ่งลงแนวตั้งแทนที่จะว่ายเฉียง) ต้นเหตุคือ `inst.dir` ถูกคำนวณใหม่จากตำแหน่ง x เทียบกับอาหารทุกเฟรม พอเข้าใกล้จุดอาหารมาก ๆ ความต่างเล็กน้อยระหว่างเฟรมทำให้ `dir` สลับเครื่องหมายแทบทุกเฟรม แก้ด้วย hysteresis (`FOOD_SEEK_DEADZONE = 36`) - ไม่เปลี่ยน `dir` จนกว่าจะเลยอาหารไปเกินระยะนี้ในแนวนอน ปล่อยให้ทิศเดิมพาไปแบบเฉียงจนเลยแล้วค่อยเลี้ยวกลับ (ตรงกับที่ผู้ใช้อยากได้ - "เฉียงลง แล้วค่อยว่ายกลับมา") พร้อมแก้อีกจุด: เดิม `dy<2` (ถึงระดับความลึกอาหารแล้ว) จะไปโดน logic ของปลาว่ายเล่นทั่วไปสุ่ม targetY ใหม่ทับ ทำให้หลุดเป้าหมายตอนใกล้จะถึง - เพิ่มเงื่อนไข `!seekingFood` กันไว้ ยืนยันด้วย Playwright: 0 การสลับทิศจริงจาก 21 จุดข้อมูลตลอด 16 วินาทีที่ว่ายเข้าหาอาหาร (มีจุดเดียวที่ Δx=+0.10px ซึ่งเป็นระดับ noise ไม่ใช่การสลับทิศจริง) และปลายังกินอาหารสำเร็จตามปกติ
- ยังไม่มี UI ให้ผู้ใช้กด "ให้อาหารทั้งตู้" ทีเดียว - ตอนนี้ต้องคลิกทีละจุดใน Life mode เท่านั้น
- ข้อ 4-7 ของ §6 P5 (น้ำ, ตะไคร่, ผสมพันธุ์, แมว/นก) ยังไม่ทำ

---

## 18. P5 กลไกการเลี้ยง — ข้อ 3: ขี้ปลา + เก็บ (2026-09-08)

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง ผ่านทุกข้อ - ตัวเลขวัดได้ตรงสูตรเป๊ะ (แถบความสะอาด 79/90px ≈ 1-1/8 = 0.875 ตามสูตร, ขี้ปลาโผล่ที่ t=41s หลังกิน ตรงขอบล่างของช่วง 5-15s พอดี)**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `WasteItem` type ใหม่ (id, x, y, createdAt) |
| `src/hooks/useTank.ts` | `wasteItems` (transient เหมือน `foodItems`) · `poopDueAt: Map<fishId, dueAtMs>` (transient, ไม่ persist) · `eatFood()` ตั้งเวลาขี้แบบสุ่ม 5-15s หลังกิน · `update()` เช็ค `poopDueAt` ทุกเฟรม, spawn waste ที่ตำแหน่งปลาตอนนั้น (ปลาตาย/หายไปก่อนถึงเวลา = ไม่ขี้) · waste ตกไปพักที่พื้นตู้จริง (ไม่ต้องอยู่ในระยะที่ปลาว่ายถึงแบบอาหาร เพราะไม่มีใครต้องไปถึงมัน) · `tankCleanliness` getter (คำนวณสดจาก `wasteItems.length`, ไม่ persist ไม่มี catch-up เพราะไม่ใช่ค่าที่ decay ตามเวลา) · `collectWasteAt()` + `handleTankTap()` รวม logic แตะเป็นจุดเดียว (เจอขี้ = เก็บ, ไม่เจอ = ให้อาหาร) · `drawWasteItems()` วาดสีน้ำตาลใน Canvas2D |
| `src/tank/render/tankScene.ts` | `wasteLayer` Graphics วาดขี้ปลาสีน้ำตาล ให้ตรงกับ Canvas2D |
| `src/tank/render/roomScene.ts` | เปลี่ยนชื่อ callback `onFeed`→`onTap` (ทำ 2 หน้าที่แล้ว) · เพิ่ม `cleanlinessBar` มุมซ้ายบนของฉาก Life mode (เขียว/เหลือง/แดง ตาม `engine.tankCleanliness`) |
| `src/components/tank/LifePanel.tsx` | ส่ง `engine.handleTankTap` แทน `engine.feedAt` ตรง ๆ |

### ผลตรวจ (Playwright, วัดตัวเลขจริงไม่ใช่แค่ดูภาพ)

| เกณฑ์ | ผล |
|---|---|
| แถบความสะอาดเต็ม/เขียวตอนไม่มีขี้ปลา | ✅ 90px (baseline) |
| ขี้ปลาโผล่ 5-15s หลังกิน ที่ตำแหน่งปลาตอนนั้น | ✅ โผล่ที่ t=41s (36s ที่กินเสร็จ + 5s) - ขอบล่างพอดีของช่วงที่กำหนด ตกลงมาเรื่อย ๆ จนพักที่ก้นตู้ |
| แถบความสะอาดลดลงตามสูตรตอนมีขี้ 1 ชิ้น | ✅ 79/90 = 0.878 ≈ `1 - 1/8 = 0.875` ตามสูตรเป๊ะ สียังเขียวถูกต้อง (เกณฑ์ >0.5) |
| แตะขี้ปลา = เก็บออก, แตะที่อื่น = ให้อาหาร (จุดเดียวกัน) | ✅ ยืนยันทั้ง 2 ทาง (ครั้งแรกพลาดตำแหน่งขี้ปลา ดันไปโรยอาหารแทนโดยไม่ตั้งใจ - เป็นการยืนยัน fallback behavior โดยบังเอิญ) เก็บสำเร็จแล้วแถบความสะอาดกลับมา 90px เป๊ะ |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน (bundle ยังแยก chunk เดิม), `oxlint` warning เดิม 4 ตัว, `npm test` 197/197 |
| console/page error | ✅ ไม่มีเลยตลอด 2 รอบทดสอบเต็ม (~90s ต่อรอบ) |

### ข้อจำกัด/ของค้าง

- ยังไม่รวม `tankCleanliness` เข้ากับ waterLevel/algae (ข้อ 4-5) ตามที่ร่างไว้ใน §8 - ตอนนี้เป็นแค่ฟังก์ชันของ `wasteItems.length` อย่างเดียว จะขยายสูตรเมื่อสองข้อนั้นมาถึง
- แถบความสะอาดอยู่ใน Life mode (Pixi) เท่านั้น ไม่มีใน Build mode (Canvas2D) - ต่างจากแถบหิวที่ทำ parity ไว้ทั้ง 2 renderer เพราะแถบนี้เป็นสถานะระดับตู้ ไม่ใช่ per-fish จึงผูกกับมุมมอง "ห้อง/ดูแล" ของ Life mode โดยเฉพาะ ไม่ใช่กับตัวตู้เอง
- `poopDueAt` ไม่ persist - reload ระหว่างรอขี้ = ยกเลิกไปเฉย ๆ (ยอมรับได้ เป็นแค่จังหวะเวลา ไม่ใช่ state ที่ต้องแม่นยำแบบ 4 วันอดตาย)

---

## 19. P5 กลไกการเลี้ยง — ข้อ 4: ระดับน้ำ + เติมน้ำ (2026-09-08)

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง - ตำแหน่งเส้นแบ่งน้ำ/อากาศตรงตามสูตรเป๊ะ (40% เต็ม → เส้นแบ่งอยู่ที่ 55-60% จากบน ตรงกับที่คำนวณไว้)**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/storage.ts` | `KEY_TANK_WATER_LEVEL` + `loadTankWaterLevel`/`saveTankWaterLevel` |
| `src/hooks/useTank.ts` | `waterLevel` field (1..0, persist ผ่าน `save()`) · `tickWaterLevel(elapsedMs)` ง่ายกว่า `tickHunger` มาก (ไม่มีผลลัพธ์ "ตาย" ให้ต้องหาจุดตัดศูนย์แม่นยำ แค่ decay เชิงเส้น clamp 0) เรียกทั้งต่อเฟรมและตอน catch-up ใน `init()` ใช้ checkpoint `lastTickAt` ร่วมกับ hunger · `refillWater()` เติมเต็มทันที · `waterTopY()` ใหม่ - จุดเริ่มผิวน้ำปัจจุบัน ใช้ทั้งใน `swimBoundsFor`/`maxSwimY`/`randomTargetY` (ปลาว่ายขึ้นเหนือน้ำที่ระเหยไปแล้วไม่ได้ - มีผลจริงต่อ gameplay ไม่ใช่แค่ภาพ) · `drawBackground()` วาดโซน "อากาศว่าง" สีเข้ม (`#0d1a24`) เหนือผิวน้ำปัจจุบัน แทนน้ำเต็มตู้เหมือนเดิม |
| `src/tank/render/tankScene.ts` | เพิ่ม `air` Graphics ให้ตรงกับ Canvas2D · water/waterline ขยับตาม `waterTop` (ปัดเศษเป็นพิกเซลเต็มกัน cache key เปลี่ยนทุกเฟรมจาก sub-pixel drift ของการระเหยที่ต่อเนื่อง) |
| `src/lib/i18n.ts` | `life.refillWater`/`life.refillWaterTitle` |
| `src/components/tank/LifePanel.tsx` | ปุ่ม "Refill water" มุมขวาบน (DOM ธรรมดา ไม่ใช่ Pixi - ตามแนวทางปุ่ม action อื่นในแอปนี้) เรียก `engine.refillWater()` |
| `src/index.css` | `.life-refill-button` (ขวาบน ไม่ชนกับแถบความสะอาดที่ซ้ายบน) |

### ผลตรวจ (Playwright, จำลอง waterLevel=0.4 ผ่าน localStorage)

| เกณฑ์ | ผล |
|---|---|
| เส้นแบ่งน้ำ/อากาศอยู่ตำแหน่งถูกต้อง (40% เต็ม = เส้นแบ่งที่ 60% จากบน) | ✅ วัดสี pixel จริง: `#0d1a24` เป๊ะตั้งแต่ 5%-55% จากบน, gradient น้ำตั้งแต่ 60%-90% - เส้นแบ่งอยู่ระหว่าง 55-60% ตรงตามคาด |
| ปลาว่ายอยู่แค่ในโซนน้ำ ไม่ลอยในโซนอากาศ | ✅ ยืนยันจากภาพ |
| ตรงกันทั้ง Canvas2D (Build) และ Pixi (Life) | ✅ ทั้งสอง renderer แสดงเส้นแบ่งที่ตำแหน่งเดียวกัน |
| ปุ่ม Refill ไม่ชนแถบความสะอาด | ✅ ปุ่มขวาบน (x:1266) แถบซ้ายบน (x:8) ไม่ทับกัน |
| กด Refill แล้วน้ำเต็มทันที ไม่มี animation | ✅ ยืนยันภาพก่อน/หลังภายใน ~400ms |
| สลับกลับ Build mode หลัง refill ยังเห็นน้ำเต็มตรงกัน | ✅ engine เดียวกัน ทั้ง 2 renderer sync กันอัตโนมัติ |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 197/197 |
| console/page error | ✅ ไม่มีเลยตลอดการทดสอบ |

### ข้อจำกัด/ของค้าง

- `waterLevel` ยังไม่ผูกกับผลลัพธ์อื่นนอกจากพื้นที่ว่ายและภาพ - ยังไม่มี "ปลาป่วย/ตายเพราะน้ำแห้ง" (ตาม §9.1 ที่พูดถึง waterQuality ต่ำนานเกินไป → ตายเร็ว) เพราะ waterQuality ยังไม่ถูกสร้างเป็นค่ารวม (รอข้อ 5 ตะไคร่ มาผสมกันตามที่ร่างไว้ใน §8/§17)
- ไม่มี UI แสดงตัวเลข % น้ำ - ใช้ระดับน้ำที่เห็นในภาพเป็นตัวบอกแทน (ตรงตามธรรมชาติของตู้ปลาจริงที่ดูจากระดับน้ำ ไม่ใช่ตัวเลข)

---

## 20. P5 กลไกการเลี้ยง — ข้อ 5: ตะไคร่ + ขัดกระจก (2026-09-08)

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง 2 รอบ - รอบแรกเจอบั๊ก persistence จริง (ขัด/เติมน้ำใน Life mode หายหลัง reload) แก้แล้ว รอบสองยืนยันผ่านหมด ตามที่ผู้ใช้ระบุเอง: "จะเกิดไวขึ้นถ้าไม่เก็บขี้ปลา"**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/storage.ts` | `KEY_TANK_ALGAE` + `loadTankAlgae`/`saveTankAlgae` |
| `src/hooks/useTank.ts` | `algae` field (0..1, persist) · `tickAlgae(elapsedMs, wasteCount)` เติบโตเร็วขึ้นตาม `wasteItems.length` (ต่างจาก `tickWaterLevel` ที่ไม่มีตัวแปรภายนอกมาเร่ง) - รับ `wasteCount` เป็น parameter แทนอ่านจาก `this.wasteItems.length` ตรง ๆ เพราะตอน catch-up ใน `init()` ไม่รู้ว่ามีขี้ปลาค้างอยู่เท่าไหร่ตอนปิดแอป (waste ไม่ persist) เลยส่ง 0 (ใช้แค่ base rate) ส่วนตอนเรียกต่อเฟรมส่งค่าจริง · `scrubAlgae(dragDistancePx)` ลดตะไคร่ตามระยะทางลากสะสม · `drawAlgae()` วาดแถบเขียวโปร่งใส 4 ขอบ (ไม่ใช่ทั่วทั้งตู้ - ประมาณการง่าย ๆ แทนการ track ตะไคร่แบบ per-region จริง) |
| `src/tank/render/tankScene.ts` | `algaeLayer` Graphics ให้ตรงกับ Canvas2D |
| `src/tank/render/roomScene.ts` | เปลี่ยนจาก `pointertap` handler เดี่ยว ๆ เป็น pointerdown/globalpointermove/pointerup state machine แยกแยะ "แตะ" (ระยะขยับ ≤6px → `onTap`) กับ "ลาก" (เกิน 6px → `onScrub` ต่อเนื่อง) - ใช้ threshold เดียวกับ `TAP_MOVE_THRESHOLD` ที่ useTank.ts ใช้อยู่แล้ว |
| `src/components/tank/LifePanel.tsx` | ส่ง `onScrub` callback เพิ่มเข้า `createRoomScene` |

### บั๊ก persistence ที่เจอตอน verify รอบแรก (แก้ก่อน commit)

**อาการ:** ขัดตะไคร่/เติมน้ำใน Life mode ได้ผลจริงในเซสชันสด แต่ reload แล้วหายกลับไปค่าเดิม

**ต้นเหตุ:** `scrubAlgae()`/`refillWater()`/`feedAt()`/`collectWasteAt()` (ซึ่งมีมาตั้งแต่ข้อ 2-3) ไม่เคยเรียก `this.persist()` เลย - เดิมถือว่าเป็น simulation state ที่รอ Save เหมือนตำแหน่งว่ายปลา แต่ต่างจากปลาตรงที่ **Life mode ไม่มีปุ่ม Save ของตัวเอง** (มีแค่ที่ Build Tank) ทำให้ผู้ใช้ไม่มีทางกด Save ปุ่มที่ Build Tank ได้เลยถ้ายังไม่เคยแก้อะไรที่นั่นมาก่อน (ปุ่มถูก disable อยู่จนกว่า `dirty` จะเป็น true)

**วิธีแก้:** เพิ่ม `this.persist()` ใน `feedAt()`, `collectWasteAt()` (เฉพาะตอนเก็บสำเร็จจริง), `refillWater()`, `scrubAlgae()` - ทั้งหมดเป็น "การกระทำของผู้ใช้โดยตรง" (ต่างจาก `eatFood()`/tick ต่าง ๆ ที่เป็นผลจาก simulation อัตโนมัติ ไม่ต้อง persist) ตามธรรมเนียมเดียวกับที่ลากปลาทุกเฟรมก็เรียก `persist()` อยู่แล้ว

### ผลตรวจ (Playwright, 2 รอบ)

| เกณฑ์ | ผล |
|---|---|
| แถบตะไคร่เป็นขอบ 4 ด้าน ไม่ใช่สีทึบทั้งตู้ | ✅ กลางตู้ใสกว่าขอบ/มุมชัดเจน ตรงกันทั้ง Canvas2D และ Pixi |
| ตะไคร่โตเร็วขึ้นเมื่อมีขี้ปลาค้าง | ✅ ยืนยันจากสูตร (โค้ดรีวิว) - ยังไม่ได้ทดสอบเปรียบเทียบอัตราจริงด้วย Playwright (ระยะเวลาที่ต้องรอสังเกตการเติบโตจริงยาวเกินจะทดสอบ) |
| แตะสั้น (≤6px) = ให้อาหาร ไม่ขัดตะไคร่ | ✅ |
| ลาก (>6px สะสม) = ขัดตะไคร่ ไม่ให้อาหารซ้อน | ✅ ลาก ~5500px แล้วตะไคร่หายหมดจากภาพ ไม่มีอาหารโผล่เพิ่ม |
| ปุ่ม Save เปิดใช้งานหลังขัด/เติมน้ำใน Life mode | ✅ (หลังแก้บั๊ก) |
| ขัด/เติมน้ำรอด reload หลังกด Save | ✅ ค่าก่อน/หลัง reload ตรงกันเป๊ะ |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 197/197 |
| console/page error | ✅ ไม่มีเลยตลอด 2 รอบทดสอบ |

### ข้อจำกัด/ของค้าง

- ยังไม่ได้ verify อัตราเร่งจริงจาก waste count ด้วย Playwright (แค่ตรวจโค้ด/สูตร) - ความเสี่ยงต่ำเพราะเป็นการคูณเชิงเส้นตรงไปตรงมา
- `tankCleanliness` (§18) ยังไม่รวม algae เข้าไปด้วยตามที่ร่างไว้ใน §8 - ยังเป็นแค่ฟังก์ชันของ waste อย่างเดียว

---

## 21. P5 ข้อ 5 ปรับใหญ่ตาม feedback ผู้ใช้ 2 รอบ (2026-09-08)

**สรุป: หลัง commit ข้อ 5 (§20) ผู้ใช้ทดลองใช้จริงแล้ว feedback 2 รอบ ทำให้ต้องปรับใหญ่ทั้งภาพตะไคร่และโมเดลการโต้ตอบ - เสร็จและ verify ผ่านหมดทั้ง 12 ข้อทดสอบ**

### Feedback รอบแรก: "ให้อาหารแค่ตอนกดในตู้ปลา เพราะมันบัค อาหารอยู่ด้านข้าง...ต้องเลือก item ให้อาหารปลาถึงจะให้ได้"

**บั๊กจริงที่เจอ:** `tapHitArea` (จุดรับสัมผัสของ Life mode) เดิมครอบคลุมพื้นที่ทั้ง scene รวม room-decor margin รอบตู้ด้วย (`sceneWidth/sceneHeight` จาก `roomSceneMargin`) ไม่ใช่แค่ตัวตู้จริง - แตะใกล้ขอบตู้ (แต่จริง ๆ ยังอยู่ใน margin) ยังคง trigger การให้อาหารได้ โดยพิกัดถูก clamp เข้าขอบตู้ ทำให้อาหารไปติดอยู่ "ข้างตู้" ตามที่ผู้ใช้เห็น

**แก้:** 
1. ย่อ `tapHitArea` ให้ครอบคลุมแค่ตัวตู้จริง (`rect(marginX, marginY, w, h)` แทน `rect(0,0,sceneWidth,sceneHeight)`)
2. เพิ่มโมเดล "เลือกเครื่องมือก่อนใช้" - ปุ่ม Feed/Scrub ที่มุมซ้ายล่างของ Life mode (คลิกเพื่อ arm/disarm)

### Feedback รอบสอง: "อยากให้ตะไค้ เป็นขึ้นบนกระจกแบบรูปที่ 1 และเปลี่ยนจากการกดลากไอเท็มเป็นคลิ๊กเพื่อบอกว่าใช้ก็พอ แต่ตอนขัดต้องลาก ไป-มา เพื่อขัด"

ตอบ 2 เรื่อง:
1. **รูปแบบตะไคร่**: จากแถบทึบ 4 ขอบ (§20) → ลายเส้นหยักสีเขียวกระจายบนกระจกแบบตะไคร่จริง (ตามภาพอ้างอิงที่ผู้ใช้ส่ง)
2. **วิธีโต้ตอบ**: รอบแรกทำเป็น "ลากไอเทมจาก toolbar เข้าตู้" (drag-and-drop) แต่ผู้ใช้อยากได้ "คลิกเลือกก่อน แล้วค่อยใช้บนตู้" (Feed=คลิกในตู้ครั้งเดียว, Scrub=ต้องลากไป-มาจริง ๆ)

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/tank/sim/algae.ts` (ใหม่) | `AlgaePatch` type + `generateAlgaePatches(w,h)` - สุ่ม 14 หย่อมเส้นหยัก pure function ไม่มี pixi/DOM import (ตามแนวทาง geometry.ts เดิม) - engine เรียกครั้งเดียว ให้ทั้ง 2 renderer อ่านผลเดียวกัน ไม่สุ่มแยกกันจนภาพไม่ตรงกัน |
| `src/hooks/useTank.ts` | `algaePatches` field + `ensureAlgaePatches()` (regenerate เฉพาะตอนขนาดตู้เปลี่ยน) เรียกจาก `update()` · `drawAlgae()` เขียนใหม่ทั้งหมดเป็นวาดเส้นหยัก reveal ตามสัดส่วน `algae` · `collectWasteAt` เปลี่ยนจาก private→public · ลบ `handleTankTap` ทิ้ง (ย้าย logic ไป roomScene.ts ที่รู้ armed-tool state) |
| `src/tank/render/tankScene.ts` | Pixi algae rendering เขียนใหม่ให้ตรงกับ Canvas2D (อ่าน `engine.algaePatches`) |
| `src/tank/render/roomScene.ts` | กลับไปใช้ pointerdown/move/up state machine ภายใน (ของเดิมก่อนหน้านี้) แต่เพิ่ม `setArmedTool()` ที่ UI เรียกได้ - แตะ = ลองเก็บขี้ปลาก่อน ถ้าไม่เจอและ armed='feed' → ให้อาหาร, ลาก = ขัดเฉพาะตอน armed='scrub' เท่านั้น (ไม่ armed = ลากไม่มีผลอะไรเลย) · `tapHitArea` ย่อขนาดเหลือแค่ตัวตู้จริง |
| `src/components/tank/LifePanel.tsx` | ลบกลไก drag-and-drop จาก DOM ทั้งหมด (ซับซ้อนเกินจำเป็น + ผู้ใช้ไม่อยากได้) เปลี่ยนเป็นปุ่มคลิกธรรมดา 2 ปุ่ม toggle `armedTool` state |
| `src/lib/i18n.ts` | ปรับข้อความปุ่ม/hint ให้ตรงกับโมเดลคลิก-แล้ว-ใช้ |
| `src/index.css` | `.life-tool-item-active` (ไฮไลต์ปุ่มที่กำลัง arm อยู่) |

### ผลตรวจ (Playwright, 12 ข้อ)

| เกณฑ์ | ผล |
|---|---|
| แตะนอกตู้จริง (แต่เคยอยู่ใน margin เดิม) ไม่ทำอะไร | ✅ |
| คลิก Feed = ปุ่มไฮไลต์ (Scrub ไม่ไฮไลต์) | ✅ |
| Feed armed + แตะในตู้ = อาหารตกตรงจุด | ✅ |
| Feed armed + แตะนอกตู้ = ไม่มีอาหารเพิ่ม | ✅ |
| ยกเลิก Feed แล้วแตะในตู้ = ไม่ให้อาหาร | ✅ |
| ตะไคร่แสดงเป็นเส้นหยักกระจาย ไม่ใช่แถบทึบ | ✅ ตรงกับภาพอ้างอิง |
| Scrub armed + แตะสั้น = ไม่ขัด | ✅ |
| Scrub armed + ลากจริง = ฟองน้ำโผล่ตามลาก + ตะไคร่ลดจริง | ✅ |
| ยกเลิก Scrub แล้วลาก = ไม่ขัด | ✅ |
| แตะขี้ปลาเก็บได้เสมอไม่ว่า armed อะไรอยู่ | ✅ |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 226/226 |
| console/page error | ✅ ไม่มีเลยตลอด ~10 รอบทดสอบ |

### ข้อสังเกตที่ยังไม่แก้ (ไม่บล็อก แต่ควรดูภายหลัง)

~~QA เจอ: บางครั้งหลัง navigate จาก Build Tank → Life, canvas ของ Life ล็อกขนาดเล็กกว่าพื้นที่จริง~~ **แก้แล้ว 2026-09-09 (commit `244ca8f`)** - เพิ่ม `app.renderer.resize(host.clientWidth, host.clientHeight)` ทั้งตอนสร้าง Pixi app และทุกครั้งที่ prop `active` ใหม่ของ `LifePanel` เปลี่ยนเป็น true (ส่งมาจาก `TankSection`) - verify ด้วย Playwright: ขนาด canvas ตรงกับ host เป๊ะทั้ง 5 รอบสลับแท็บ + 2 รอบ resize หน้าต่าง ไม่มี console error

---

## 22. P5 ข้อ 6: ผสมพันธุ์ (2026-09-09)

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง (บังคับ `Math.random()=0` เพื่อทดสอบกลไกที่ปกติสุ่มและช้ามาก) - เจอ population cap ทำงานถูกต้องเป๊ะที่ 12 ตัวพอดีตามสูตร**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `Instance` เพิ่ม `matureAt` (เวลาที่โตเต็มวัย - เท่ากับ `bornAt` สำหรับปลาที่ผู้ใช้วางเอง) และ `wellFedSince` (เวลาที่ hunger>0.5 ต่อเนื่องล่าสุด - เคลียร์เป็น 0 ทันทีที่หิวลง) |
| `src/lib/storage.ts` | `normalizeInstance()` backfill ทั้งสองฟิลด์ (ปลาเก่าก่อนมีฟีเจอร์นี้ = ถือว่าโตเต็มวัยแล้ว) |
| `src/hooks/useTank.ts` | `tickHunger()` เพิ่ม logic set/clear `wellFedSince` ตาม hunger ปัจจุบัน (wall-clock timestamp เหมือน `bornAt`/`starvingSince` เดิม เลยไม่ต้องมี catch-up พิเศษตอนเปิดแอปใหม่) · `tickBreeding()` ใหม่ - เช็คทุกเฟรมแบบ per-ms rate (เหมือน tick อื่นๆ) แต่ข้ามตอน catch-up ของ `init()` โดยตั้งใจ (ส่ง elapsed=0 เพราะพลาดโอกาสผสมพันธุ์ตอนปิดแอปไม่กระทบความถูกต้องแบบตายเพราะอดอาหาร) · `spawnBaby()` สร้าง Instance ใหม่ใช้สไปรท์แม่ปลาเดิม `matureAt = now + 3 วัน` · `growthScale()` คำนวณสัดส่วนขนาดวาด (0.5→1.0) - ตั้งใจปรับแค่ขนาดที่ **วาด** เท่านั้น ไม่แตะพื้นที่ว่าย/hit-box (ไม่ต้องแก้ `spritePx()` consumer ทุกจุดที่มีอยู่เยอะมาก) · `drawInstance()` ใช้ growth scale คูณ pw/ph ก่อนวาด |
| `src/tank/render/tankScene.ts` | duplicate `growthScale()` เดียวกัน (อ่าน `inst.bornAt/matureAt` ตรง ๆ ไม่เรียกผ่าน engine method - ตามธรรมเนียม constant ที่ sync กันด้วยคอมเมนต์ เหมือน HUNGER_BAR_HEIGHT ฯลฯ) |
| `src/hooks/__tests__/useTank.test.ts` | เพิ่ม `matureAt`/`wellFedSince` ใน test helper `fish()` (ของผู้ใช้เอง - แก้ให้ compile ผ่านหลัง type เปลี่ยน) |

### ผลตรวจ (Playwright, บังคับ `Math.random()=0` เพื่อ trigger กลไกที่ปกติช้าและสุ่มมาก)

| เกณฑ์ | ผล |
|---|---|
| ผสมพันธุ์ได้เมื่อมี ≥2 ตัว eligible (กินอิ่ม ≥1 วัน) | ✅ จำนวนปลาโตจาก 2 → 12 ทันทีหลัง reload |
| ลูกปลาใช้สไปรท์เดียวกับแม่ | ✅ `spriteId` ตรงกันทุกตัว |
| ลูกปลา `matureAt - bornAt` = 3 วันเป๊ะ | ✅ วัดได้ 259200000ms (=3×24×60×60×1000) เป๊ะทุกตัว ต่างจากพ่อแม่ที่ `matureAt===bornAt` |
| ลูกปลาวาดเล็กกว่าพ่อแม่จริง | ✅ เห็นชัดในภาพ (~50% ตาม `BABY_SCALE_FRAC`) |
| **Population cap ทำงานถูกต้อง** | ✅ หยุดโตพอดีที่ 12 ตัว แม้ `Math.random()` ถูกบังคับเป็น 0 ตลอด (สูตร `dailyChance = 0.1 * max(0, 1-fishCount/12)` แตะ 0 พอดีที่ 12 - ยืนยันว่า cap ทำงานจริง ไม่ใช่แค่ทฤษฎี) |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 249/249 |
| console/page error | ✅ ไม่มีเลย |

### หมายเหตุสภาพแวดล้อม (ไม่เกี่ยวกับ P5 โดยตรง)

ระหว่าง verify รอบนี้พบว่าระบบ persistence ของแอปมีการอัปเกรดขนานกันไปเป็น IndexedDB-based repository pattern (`src/lib/data/` - `TankRepo`/`adapter`/`indexedDbAdapter` เป็นต้น) โดยผู้ใช้เอง (งานแยกจาก P5) - `TankState` type ใน `src/lib/data/adapter.ts` มี `waterLevel`/`algae`/`lastTickAt` เป็น field อยู่แล้วตรงกับชื่อที่ P5 ใช้ ยืนยันด้วย `tsc -b` สะอาดและ QA เห็นข้อมูลปลา (`bornAt`/`matureAt`/`wellFedSince`) ครบถ้วนถูกต้องใน IndexedDB จริงหลัง save - ระบบ P5 ทำงานร่วมกับ persistence layer ใหม่ได้ปกติ ไม่ต้องแก้อะไรเพิ่ม

### ข้อจำกัด/ของค้าง

- ยังไม่ verify การเติบโตของขนาดภาพแบบต่อเนื่อง (แค่เห็น snapshot ตอนอายุไม่กี่วินาที) - สูตรเป็น linear interpolation ตรงไปตรงมา ความเสี่ยงต่ำ
- Growth scale ปรับแค่ภาพที่วาด ไม่ปรับพื้นที่ว่าย/hit-box จริง (ตั้งใจ - ดู comment ใน `growthScale()`) - ลูกปลาเล็กจะมี hit-box เท่าตัวโตเต็มวัยไปก่อน ไม่กระทบการเล่นมากนักแต่เป็นความคลาดเคลื่อนที่รู้ตัว
- ~~เหลือกลไกสุดท้ายของ P5: ข้อ 7 (แมว/นก)~~ **เสร็จแล้ว - ดู §23**

---

## 23. P5 ข้อ 7: แมว/นก (2026-09-09) - **P5 ครบทั้ง 7 ข้อแล้ว**

**สรุป: เสร็จและ verify แล้วด้วย Playwright จริง (บังคับ `Math.random()=0` เพื่อ trigger การสุ่มโผล่ที่ปกติมีแค่ 20%) ผ่านครบทุกกรณี - จบ P5 ทั้ง 7 กลไกตามที่ผู้ใช้ตั้งใจไว้ตั้งแต่แรก**

### สิ่งที่ทำจริง

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `src/lib/types.ts` | `PredatorEvent` type ใหม่ (`kind`, `xFrac`, `spawnedAt`, `expiresAt`) - ไม่ persist เหมือน FoodItem/WasteItem |
| `src/hooks/useTank.ts` | `predator` field · `init()` สุ่มโผล่ 20% ครั้งเดียวตอนโหลดแอป (เฉพาะถ้ามีปลาที่ยังไม่ตาย) - **ไม่ใช่** ambient spawn ที่สุ่มซ้ำระหว่างเล่น ตรงตาม §9 Q6 "โผล่มาตอนเปิดแอปเข้ามาเล่น" · `update()` เช็คหมดเวลาทุกเฟรม → `stealRandomFish()` · `scarePredator()`/`stealRandomFish()` ใหม่ - การถูกคาบไปคือลบ instance ตรง ๆ ไม่ผ่าน flow ตายธรรมชาติ (ไม่ลอย ไม่เทาขาวดำ ไม่ต้องเก็บ) ตาม §9 Q6 "หายจากตู้ถาวร" |
| `src/tank/render/roomScene.ts` | `predatorContainer` (sibling ของ `tankSlot` - อยู่ที่พื้นห้อง ไม่ใช่ในน้ำ) วาดรูปแมว/นกแบบเรขาคณิตง่าย ๆ + แถบนับถอยหลัง (เขียว→เหลือง→แดง) แตะโดน → `engine.scarePredator()` |

### ผลตรวจ (Playwright, บังคับ `Math.random()=0`)

| เกณฑ์ | ผล |
|---|---|
| โผล่มาเป็นแมว (สีน้ำตาล หูสามเหลี่ยม) ที่พื้นห้องข้างตู้ พร้อมแถบนับถอยหลัง | ✅ |
| แตะโดนทันเวลา = หายไป ปลาไม่หาย | ✅ ปลานับได้ 1 ตัวเท่าเดิม |
| ไม่แตะจนหมดเวลา (~6s) = ปลาหายไปจริง | ✅ แถบเปลี่ยนสีเขียว→เหลือง→แดงตามเวลา แล้วปลาหายจาก Layers panel (0 ตัวจาก 1 ตัว) |
| ไม่มี override = ไม่ได้โผล่ทุกครั้ง (สุ่มจริง 20%) | ✅ reload ปกติ 2 รอบไม่เจอแมว/นกเลย สอดคล้องกับความน่าจะเป็น |
| build/lint/test สะอาด | ✅ `tsc -b` เงียบ, build ผ่าน, `oxlint` warning เดิม 4 ตัว, `npm test` 249/249 |
| console/page error | ✅ ไม่มีเลย |

### ข้อจำกัด/ของค้าง

- ทดสอบเฉพาะกรณี "แมว" (บังคับผ่าน `Math.random()=0` ทำให้ทั้ง spawn-roll และ kind-roll ตกที่แมวพร้อมกัน) - ยังไม่ได้ทดสอบกรณี "นก" แยก เพราะบังคับให้สุ่มตกที่นกด้วยค่าเดียวกันทำไม่ได้ตรงไปตรงมา (คนละ `Math.random()` call ในลำดับเดียวกัน) ความเสี่ยงต่ำเพราะ code path ใช้ pattern เดียวกันกับแมว (`drawBirdShape` แค่วาดคนละรูปทรง/สี)
- แมว/นกนับเวลาถอยหลังแม้ผู้ใช้ไม่ได้อยู่ในแท็บ Life (ตาม pattern real-time เดียวกับกลไกอื่นทั้งหมดใน P5) - ถ้าไม่ได้เปิดดู Life ทันเวลาอาจพลาดเห็นและเสียปลาไปโดยไม่รู้ตัว - ตรงตามธีม "ต้องดูแลตู้จริง ๆ" ที่ตั้งใจไว้ตั้งแต่ต้น ไม่ใช่บั๊ก

### สรุปรวม P5 (กลไกการเลี้ยงปลา) - ครบทั้ง 7 ข้อ

1. ✅ อายุ + ตาย (§16)
2. ✅ ความหิว + ให้อาหาร (§17, แก้บั๊กเพิ่มที่ §19 ใน commit แยก)
3. ✅ ขี้ปลา + เก็บ (§18)
4. ✅ ระดับน้ำ + เติมน้ำ (§19)
5. ✅ ตะไคร่ + ขัดกระจก (§20, ปรับใหญ่ตาม feedback ผู้ใช้ที่ §21)
6. ✅ ผสมพันธุ์ (§22)
7. ✅ แมว/นก (§23)

เกมเลี้ยงปลาตาม Phase 1 ที่ผู้ใช้ตั้งใจไว้ตอนเริ่มโปรเจกต์ ("เอาตู้ปลาที่เราสร้างไปวางไว้ในห้องเรา แล้วเราต้องดูแลตู้ปลา") เสร็จสมบูรณ์ตามสเปกเดิมแล้ว งานที่เหลือ (ถ้าต้องการต่อ) คือของค้างจาก P2/P3 เดิม (input consolidation, ลบ Canvas2D fallback) หรือ P4's room artwork จริงเมื่อผู้ใช้เตรียม asset พร้อม

---

## 24. Pixi render-loop cleanup (2026-09-10)

งานบำรุงรักษา ไม่ใช่ Phase ใหม่ — ตรวจโค้ด Pixi ที่มีอยู่เทียบกับ **official pixijs skills**
(`npx skills add https://github.com/pixijs/pixijs-skills` → vendor ไว้ที่ `.agents/skills/` +
`.claude/skills/`, ล็อกเวอร์ชันที่ `skills-lock.json`) ตาม 3 แหล่งที่ผู้ใช้ให้มา:
pixijs.com/8.x, agentskills.io, github.com/pixijs/pixijs-skills

### 24.1 บั๊กจริงที่เจอ — Life mode พังอยู่แล้วบน `main`

Life mode ขึ้นเป็นแผงเปล่า พร้อม `Cannot read properties of null (reading 'clear')` 2 ครั้ง
โยนออกมาจาก render pass ของ Pixi เอง (`DefaultBatcher.break` ใต้ `StencilMaskPipe`)

**สาเหตุ:** `destroyPixiApp()` ส่ง `texture: true` แต่ texture พวกนั้นเป็นของ cache ระดับ module ใน
`textureCache.ts` ที่ TankPixiLayer กับ LifePanel **ใช้ Texture object เดียวกัน** พอ React StrictMode
mount effect ซ้ำ → Application ตัวแรกที่ถูก cancel ถูก destroy ขณะที่ตัวที่สองยังวาดอยู่ → ลาก texture
ของ cache ลงไปด้วย

ยืนยันด้วยการสลับ flag ตัวนี้ตัวเดียวไป-กลับ (รีโปรได้/หายได้ตามต้องการ) บน dev server สะอาด ไม่ใช่ HMR
artifact · อายุ texture เป็นของ `invalidateSprite()`/`invalidateAll()` เท่านั้น

### 24.2 render loop ซ้อนกันสองชั้น

ทั้ง `TankPixiLayer.tsx` และ `LifePanel.tsx` เปิด `requestAnimationFrame` ของตัวเอง ขณะที่ ticker ของ
Application (autoStart, ไม่เคยปิด) ก็ render ทุกเฟรมอยู่แล้ว — สอง loop ไม่มีลำดับต่อกัน เฟรมไหนที่
ticker ชนะ ภาพที่ออกจะเป็นตำแหน่งของเฟรมก่อนหน้า

แก้เป็น `app.ticker.add()` ที่ priority NORMAL ซึ่ง Pixi รับประกันว่าทำงานก่อน `app.render()` ที่
TickerPlugin ลงทะเบียนไว้ที่ LOW (ดู `.agents/skills/pixijs-ticker/SKILL.md`)

ผลพลอยได้: Life mode มีสวิตช์ปิด — ฉากห้อง (backdrop + แมว + นักล่า + status bar + **tank scene ซ้อน
ข้างใน**) เคยวาด 60 ครั้ง/วินาทีหลังแผงที่ซ่อนอยู่ตลอดเวลาที่อยู่โหมด Build ตอนนี้หยุดพร้อมแผง
**หยุดแค่การวาด** — hunger/evaporation/algae/predator เป็นของ TankEngine เดินต่อเหมือนเดิม

### 24.3 ของเล็กที่แก้ไปด้วย

| แก้ | ที่ | เหตุผล |
|---|---|---|
| `roundPixels: true` | `pixiApp.ts` (renderer-wide) | `Instance.x/y` เป็น float — sprite nearest-neighbour ที่ sample หลุด grid จะสั่นเป็นแถว ๆ ตอนปลาว่าย |
| `TextureSource.defaultOptions.scaleMode = 'nearest'` | `textureCache.ts` (module scope) | ตั้งครั้งเดียวแทนต่อ texture — texture ที่สร้างที่อื่นในอนาคตพลาดไม่ได้ |
| `stage.eventMode = 'none'` | `TankPixiLayer.tsx` | host div เป็น `pointer-events:none` อยู่แล้ว — ตัด hit-test walk ทั้ง scene graph ต่อ pointer move |
| `image-rendering: pixelated` | `.tank-canvas` (index.css) | ทั้งสอง renderer วาดที่ logical size แล้วให้ CSS ยืด — เบราว์เซอร์ resample แบบ bilinear ทำให้ภาพที่อุตส่าห์ทำให้คมเบลอทิ้ง |
| `scale.set()` ครั้งเดียว | `tankScene.ts` updateInstanceView | แทน width/height setter แล้วอ่าน sign ของ scale ที่เพิ่งเขียนกลับมา flip |

### 24.4 ผลวัด (Playwright, `?tankRenderer=pixi`)

| | `main` ก่อนแก้ | หลังแก้ |
|---|---|---|
| rAF/วินาที (Build) | 242 | 72 |
| rAF/วินาที (Life) | 242 | 18 |
| console errors | 2 | 0 |
| Life mode | เปล่า | ห้อง+แมว+ตู้ ครบ |

242 คงที่ทุกโหมด = 4 loop วิ่งพร้อมกันไม่ว่าจะเปิดแท็บไหน (รวม Life ที่ crash ไปแล้วก็ยังวิ่ง)
เลข Life 18 คือต้นทุนวาดห้องจริงบน software GL ของ headless ไม่ใช่การ throttle

verify เพิ่ม: วาดสไปรท์ → save → ลากลงตู้ → ปลาแสดงผลคม พร้อม hunger bar · สลับโหมดไปกลับหลายรอบ
console สะอาด · `tsc -b` / `oxlint` / `vitest` (343 tests) / `build` ผ่านหมด

### 24.5 ยังไม่ได้ทำ (คิดแล้วว่ายังไม่คุ้ม)

- `ParticleContainer` สำหรับ food pellets / waste — จำนวนยังน้อยเกินกว่าจะคุ้ม (ดู
  `.agents/skills/pixijs-scene-particle-container/`)
- `cacheAsTexture` บนฉากห้องส่วนที่นิ่ง
- input consolidation ไป Pixi event system (ของค้างจาก P2/P3 เดิม — ดู doc comment ของ `tankScene.ts`)
