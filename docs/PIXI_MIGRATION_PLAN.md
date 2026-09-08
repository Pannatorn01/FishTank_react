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
> **อัปเดต 2026-09-08:** ระหว่างนี้มีงานแยกต่างหาก refactor เครื่องมือวาดไปสถาปัตยกรรมใหม่ที่
> `src/lib/tools/` **ครบทุกตัวแล้ว (14/14)**: pen, eraser, rect, ellipse, line, magicWand, move, select,
> lasso, eyedropper, fill, gradient, spray, curve — ไม่มี tool ไหนเหลือ if-chain เดิมใน
> `usePixelEditor.ts` อีกต่อไป ดู `src/lib/tools/ARCHITECTURE.md` และ `docs/EDITOR_IMPROVEMENTS.md`
> กฎ "ห้ามแตะ" ข้อนี้ยังใช้ได้สำหรับงาน Pixi migration นี้เหมือนเดิม (แยก scope กัน) แต่
> **"ทำงานถูกแล้วไม่ต้องแก้" ใน §5.D ไม่ตรงกับความจริงอีกต่อไปทั้งหมด** — ก่อนอ้างว่า editor ส่วนไหน
> "เดิมและนิ่งแล้ว" ให้เช็ค ARCHITECTURE.md ก่อน
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
src/hooks/useTank.ts          ~2100 บรรทัด  TankEngine class (Canvas2D) — state+sim+hit-test+draw+export ปนกันหมด
src/hooks/usePixelEditor.ts   ~4500 บรรทัด  editor engine — ห้ามแตะ
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

| ไฟล์ | ต้องแก้? |
|---|---|
| `src/hooks/usePixelEditor.ts` | ❌ ไม่แตะ |
| เครื่องมือวาดทั้งหมด (pen / eraser / fill / line / curve / rect / ellipse / spray / gradient / select / lasso / magicWand / move) | ❌ ไม่แตะ |
| `PixelCanvas.tsx`, `ToolRail.tsx`, ColorPalette, LayerPanel, FramePanel | ❌ ไม่แตะ |
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

### D. ห้ามแตะ editor (เพื่องานนี้)
pen/eraser + Pixel Perfect gating, selection outline, rotation — **ไม่อยู่ในขอบเขตงานนี้**
(pen/eraser/rect/ellipse/magicWand/move ถูก refactor ไป `src/lib/tools/` แล้วโดยงานอื่น แยก scope
กันคนละงาน — ดูหมายเหตุอัปเดตที่ §0 ด้านบน)

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
| P3 แยก model/sim/render | ⬜ not started | | | |
| P4 ฉากห้อง + สลับโหมด | ⬜ not started | | | รอ asset ห้องจากผู้ใช้ (§9.2) — ทำโครงไปก่อนได้ |
| P5 กลไกเลี้ยง | ⬜ not started | | | **ไม่ blocked แล้ว** — ค่า balance เริ่มต้นอยู่ §9.1 |

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
