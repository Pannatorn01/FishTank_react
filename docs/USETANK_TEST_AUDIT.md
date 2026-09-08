# useTank.ts — audit จุดเสี่ยงก่อนเขียนเทสต์

`src/hooks/useTank.ts` (2,201 บรรทัด) — ทั้งไฟล์คือ `class TankEngine` ก้อนเดียว + hook wrapper
`useTank()` บาง ๆ ท้ายไฟล์ ยังไม่มีเทสต์เลยแม้แต่ตัวเดียว

**ข่าวดี:** เลขคณิตรูปทรงตู้ (`clampTopLeftToShape` / `ovalFlatTopGeometry` / `roundedCornerRadius`
/ `clampCenterToShape`) ถูกแยกไป `src/tank/sim/geometry.ts` แล้วและมีเทสต์ครบ — TankEngine แค่ห่อ
เรียกต่อ ไม่ต้องเทสต์ซ้ำ เช่นเดียวกับ `storage.ts` (12 tests, รวม `normalizeInstance` backfill
P5 fields)

**สิ่งที่ยังไม่มีใครเทส คือ "พฤติกรรม engine"** — simulation, hunger, undo/redo, grouping, z-order

---

## โครงสร้างสำหรับเซ็ตอัป test

- `TankEngine` เป็น plain class → `new TankEngine()` ได้ตรง ๆ **ไม่ต้องเรียก `init()`**
  (`init()` แตะ `requestAnimationFrame` / `document` / `storage` / rAF loop — เลี่ยงในเทส)
- vitest รันบน node env ไม่มี DOM → ต้อง:
  - stub `engine.canvas = { width, height, getBoundingClientRect: () => ({left:0,top:0,...}) } as any`
  - ตั้ง `(engine as any).hasSized = true` ก่อนเทส `update()`
  - stub `globalThis.localStorage = new MemoryStorage()` (คัดลอก pattern จาก `storage.test.ts`)
    เพราะหลาย method จบด้วย `persist()` → จริง ๆ `persist()` แค่ set `dirty=true` + notify
    (**ไม่ได้เขียน localStorage** — เขียนเฉพาะ `save()`) แต่ `undo()/redo()/refresh()` เรียก
    `storage.load*()` จริง
- seed state ผ่าน field ตรง ๆ: `engine.instances = [...]`, `engine.groups = [...]`,
  `engine.sprites = [...]` (ทุกตัว public)
- private method เรียกผ่าน `(engine as any).methodName(...)` — `tickHunger`, `update`,
  `swimBoundsFor`, `hitTest`, `computeDrawOrder`, `pruneEmptyGroups` ฯลฯ
- fake time: `vi.useFakeTimers()` + `vi.setSystemTime()` — โค้ด hunger/lifespan ใช้ `Date.now()` ตรง ๆ

---

## จุดเสี่ยง เรียงตามความสำคัญ

### P0 — hunger / starvation catch-up (`tickHunger`, บรรทัด ~1740)
โค้ดใหม่สุด (P5), เกี่ยวกับ balance + เวลา wall-clock + การตายถาวรของปลา ถ้าพลาด = ปลาตายเร็ว/ช้าผิด
หรือ catch-up ตอนเปิดแอปหลังปิดไปหลายวันคำนวณผิด

เทสต์ที่ควรมี:
- decay เชิงเส้น: 1 → หลัง `HUNGER_FULL_TO_EMPTY_MS/2` → hunger ≈ 0.5
- ข้ามศูนย์ใน step เดียว: `starvingSince` ถูกตั้งเป็น**ช่วงเวลาจริงที่ hunger แตะ 0** ไม่ใช่ `now`
  (นี่คือหัวใจของ catch-up — comment ในโค้ดอธิบายไว้ยาว) ตรวจ `fracToZero` ด้วย step ใหญ่ ๆ
- catch-up ก้อนเดียว = ตายจริง: fish hunger 0.1, เรียก `tickHunger(5 วัน)` → `dead === true`,
  `diedAt` set, `groupId` ถูกล้าง
- `elapsedMs <= 0` → no-op (กัน dt ติดลบตอน tab กลับมา focus)
- ปลาที่ `dead` อยู่แล้ว / ไม่ใช่ `kind:'fish'` → ไม่แตะ
- fish ที่ persist มาแบบ hunger 0 + starvingSince ก่อนหน้า → reload แล้ว `tickHunger` ตรวจตายได้เลย
  (death check อยู่นอก `if (inst.hunger > 0)`)

### P0 — undo / redo (`snapshotState` / `pushUndo` / `undo` / `redo`, บรรทัด ~330-382)
snapshot ผ่าน `JSON.parse(JSON.stringify(...))` — ต้องเป็น deep copy จริง (แก้ instance หลัง snapshot
ต้องไม่กระทบ snapshot) `UNDO_LIMIT = 50` — push ตัวที่ 51 ต้อง shift ตัวเก่าสุดออก
redo ถูกล้างเมื่อมี action ใหม่ (`commitUndo` set `redoStack = []`)

เทสต์:
- `removeInstance` → `undo()` คืน instance กลับครบ (รวม `groupId`) → `redo()` ลบอีกครั้ง
- undo ล้าง `selectedId`/`marqueeIds`/`selectedRoomId`
- push เกิน 50 → `undoStack.length === 50`, ตัวเก่าสุดหาย
- action ใหม่หลัง undo → `canRedo === false`
- **ช่องว่างที่ตั้งใจ** (ไม่ใช่บั๊ก — ระบุใน comment): `groupMarquee` / `ungroup` / `renameGroup` /
  `moveRow` / `bringToFront` / `sendToBack` **ไม่** `pushUndo()` มีแต่ delete + drag ที่ undo ได้
  → เทสต์ควร lock behavior นี้ไว้ (assert ว่า group แล้ว undo ไม่คืน)

### P1 — grouping / schooling (`groupMarquee` ~1290, `pruneEmptyGroups` ~1274, `moveRow` ~1365)
list manipulation ซับซ้อน + z-order block reinsertion + การล้าง group ที่เหลือ < 2 ตัว

เทสต์:
- `groupMarquee`: สมาชิกที่เลือกกลายเป็น block ต่อเนื่องใน `instances`, ทุกตัวได้ `groupId` เดียวกัน,
  `marqueeIds` ถูกล้าง, ลำดับ non-member อื่นไม่สลับ
- `groupMarquee` ต้องมี ≥ 2 ตัว (< 2 → no-op)
- `pruneEmptyGroups`: ลบสมาชิกจนกลุ่มเหลือ 1 → กลุ่มถูก dissolve, ตัวที่เหลือ `groupId === null`,
  `groups` ไม่มี entry นั้น
- `deleteGroup` ลบทั้งสมาชิกและ group entry + ล้าง `selectedId` ถ้าโดน
- `ungroup` เก็บ instance ไว้ ล้างแค่ `groupId` + ลบ group entry
- `moveRow`:
  - drag instance ลงบน instance ในกลุ่มอื่น → รับ `groupId` ของเป้าหมาย + prune กลุ่มเก่า + reflow
  - drag group header ลงบน group → no-op (บรรทัด 1367)
  - drop ลง instance ตัวเอง → no-op
  - `targetKind:'group'` → แทรกท้าย block ของสมาชิกกลุ่มนั้น
- `reflowSchoolOffsets`: N สมาชิก → offset กระจายรอบ 0 (จุดกึ่งกลางของชุด `(i - (n-1)/2) * 55` + jitter)
  — mock `Math.random` ให้คงที่แล้วเช็คระยะห่าง
- `coMoversFor`: มี `groupId` → สมาชิกอื่นในกลุ่ม; ไม่มีแต่อยู่ใน marquee > 1 → ที่เหลือใน marquee;
  นอกนั้น → `[]`

### P1 — z-order (`moveBlockToFront/Back` ~1440, `bringToFront`/`sendToBack`, `computeDrawOrder` ~2114)
`instances` = ลำดับ z (index 0 = หลังสุด) `bringToFront` ของ instance ในกลุ่ม = ยกทั้งบล็อกกลุ่ม

เทสต์:
- `bringToFront(id)` ย้ายไปท้าย array, `sendToBack` ไปหัว
- instance ในกลุ่ม → ทั้งกลุ่มขยับเป็นบล็อก คงลำดับภายใน
- `computeDrawOrder`: ไม่มี drag → คืน `instances` ตรง ๆ; มี `draggingInstance` → ตัวที่ลาก +
  co-movers ย้ายไปท้าย (draw ทับ) ที่เหลือคงลำดับเดิม

### P1 — swim physics (`update` ~1786, `swimBoundsFor` ~432)
ยาว 150 บรรทัด, สาขาเยอะ (schooling / hunger-seek / bounce / shape-refine / dead-float) mutate
`this.instances` โดยตรง เทสต์แบบ deterministic ได้ด้วยการ mock `Math.random`

เทสต์:
- `swimBoundsFor` ไม่มี zone → `{0, w-pw, 0, h-sandH-ph}`
- มี zone → clamp ตามกรอบ zone; **zone ที่หลุดขอบ canvas ไปแล้วต้องไม่ขังปลานอกพื้นที่ว่ายได้**
  (comment เตือนไว้ — `xMax = min(xMaxFull, max(xMin, zone.x1 - pw))`)
- `zoneFor`: instance มี `groupId` → ใช้ zone ของกลุ่ม, ไม่งั้น `inst.zone`
- `update`: ปลาชนขอบซ้าย → `dir` เป็น 1, ชนขวา → -1, `x` ถูก clamp
- ปลากิน food: วาง `foodItems` ใกล้ปลาในรัศมี `FOOD_EAT_RADIUS` แล้ว `update(dt)` → food หาย,
  `hunger` เพิ่ม `FOOD_HUNGER_GAIN` (cap 1), `starvingSince = 0`
- ปลาหิว + มี food ไกล → `dir` หันเข้าหา food, `targetY` เล็งไป food (แซง schooling)
- dead fish ลอยขึ้น `bounds.yMin` ไม่ว่ายต่อ
- old-age: `bornAt` เก่ากว่า `lifespanMs` → `update` set `dead`
- **guard**: `!hasSized` → `update` return ทันที (กันปลายุบมุมตอน canvas ยังเป็น 300×150 default)
- schooling: 2+ ตัวในกลุ่มเดียว ไม่ drag → `dir`/`centerY` ร่วม; 1 ตัว → ไม่ school

### P2 — food (`feedAt` ~1719, `nearestFood`, `eatFood`)
- `feedAt` clamp x ใน `[0, canvas.width]`, y `>= 0`, ตั้ง `vy = FOOD_FALL_SPEED`
- ไม่มี canvas → no-op
- `nearestFood` คืนตัวใกล้สุดตามระยะยูคลิด, ไม่มี food → null
- `update`: food จมหยุดที่ `floorY = height - sandH - 16` (ไม่ทะลุพื้นทราย)

### P2 — hit-test & selection (`hitTest` ~1470, `toggleMarqueeSelect` ~1424, `selectInstance`)
- `hitTest` วนจากบนลงล่าง (index สูง = อยู่หน้า) คืนตัวแรกที่โดน bounding box
- `toggleMarqueeSelect`: ทุก id เลือกอยู่แล้ว → เอาออกหมด; ไม่งั้น → เพิ่มหมด; ว่างแล้ว set `null`
- `selectInstance(id)` ล้าง `marqueeIds` + `selectedRoomId`; `selectInstance(null)` ไม่ล้าง marquee

### P3 — background transform (`startBgDrag` ~684, `onBgPointerMove` ~697)
scale clamp `[BG_MIN_SCALE, BG_MAX_SCALE]`, rotate/​move delta math — เทสต์ได้แต่ค่าคุ้มต่ำกว่า P0-P1
(interaction ล้วน, พังแล้วเห็นทันทีตอนใช้)

---

## ข้อเสนอ: ลำดับการเขียน

1. `tickHunger` + undo/redo (P0, เซ็ตอัปเบา — แทบไม่ต้อง canvas)
2. grouping + z-order (P1, ไม่ต้อง canvas เลย ยกเว้น `applyZone` ที่เรียก `swimBoundsFor`)
3. `swimBoundsFor` + `update` (P1, ต้อง stub canvas + mock `Math.random`)
4. food + hit-test (P2)

คาดว่า ~40-55 เทสต์ ครอบคลุมตรรกะที่ regression พังเงียบได้ทั้งหมด เหลือส่วน DOM/rendering
(`draw`, `resizeCanvas`, `compositeScene`, video/png export) ให้ tank-ui-tester (Playwright) ดูแลตามเดิม

## บั๊ก / ข้อสังเกตที่เจอระหว่าง audit (ยังไม่แก้)
- ไม่มีบั๊กชัด ๆ — โค้ด hunger/undo/grouping ดู sound
- **ช่องว่าง undo** (ตั้งใจ ระบุใน comment): group/ungroup/rename/moveRow/bring-send ไม่ undoable
  ต่างจาก delete/drag — ถ้าจะทำให้ครบเป็นงานแยก ไม่ใช่บั๊ก
- `update` บรรทัด 1860: fallback `inst.vy` legacy ใช้ค่า hardcode `6 + rnd*12` (ช่วง medium)
  ไม่ตรงกับ `SWIM_SPEED_PRESETS` เป๊ะ — กระทบเฉพาะ instance เก่าจริง ๆ ที่ `vy` undefined
  (`normalizeInstance` ไม่ backfill `vy`) ผลกระทบเล็กมาก
