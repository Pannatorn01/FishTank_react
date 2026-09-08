# Draw Fish/Decor — รายการสิ่งที่ควรปรับปรุง (Backlog)

> รายการนี้มาจากการ audit โค้ดจริง (ไม่ใช่การเดา) — แต่ละข้อระบุไฟล์/บรรทัดไว้ให้กระโดดไปแก้ได้เลย
> Created: 2026-09-07 · Updated: 2026-09-08 · Status: **แก้ไปหลายข้อแล้ว (ดู "สถานะ" ในแต่ละข้อ) —
> ที่เหลือยังเป็น backlog**
>
> เกี่ยวข้องกับ: [`src/lib/tools/ARCHITECTURE.md`](../src/lib/tools/ARCHITECTURE.md) (แผน migrate เครื่องมือวาด)
> และ [`PIXI_MIGRATION_PLAN.md`](./PIXI_MIGRATION_PLAN.md) (ดู §0 — ข้อขัดแย้งที่ต้องเคลียร์)

---

## P0 — ความเสี่ยงข้อมูลหาย / แอปพัง

### 1. ไม่มี Error Boundary เลยทั้งแอป (แก้แล้ว)
**อาการเดิม:** ถ้า component ไหน throw ตอน render → หน้าขาวทั้งหน้า ผู้ใช้เสียงานที่ยังไม่ได้เซฟทันที
ไม่มีข้อความบอก ไม่มีปุ่มกู้คืน (ตรงกับอาการหน้าขาวที่เคยเจอ)
**สถานะ:** แก้แล้ว — `src/components/ErrorBoundary.tsx` (ใหม่) ครอบทั้ง `<App />` จาก `main.tsx:11-13`
(ครอบกว้างกว่าที่เสนอไว้เดิม คือทั้งแอป ไม่ใช่แค่สองแผง) มีปุ่มดาวน์โหลด backup / reload / รีเซ็ตข้อมูล

### 2. โหลดข้อมูลจาก localStorage โดยไม่ตรวจ schema (แก้แล้ว)
**ไฟล์:** `src/lib/storage.ts:108-253` (ทุก `load*()` มี try/catch แต่เช็คแค่ JSON parse ผ่านหรือไม่)
**อาการเดิม:** ข้อมูลที่ parse ได้แต่รูปร่างผิด (เช่น `frames` เป็น null, `width` เป็น string) จะไหลเข้า
engine ตรง ๆ แล้วไปพังตอน render — ทางออกเดียวของผู้ใช้คือเปิด DevTools ล้าง localStorage เอง
**สถานะ:** แก้แล้ว — เพิ่ม `isValidSprite()` (`storage.ts:113`) เข้าไปกรองใน `loadSprites()` +
`downloadDataBackup()` + `resetAllData()` แล้ว

### 3. ✅ Undo stack กินหน่วยความจำแบบ O(ขนาด canvas × 50) — แก้แล้ว (diff-based undo)
**ไฟล์เดิม:** `snapshot()` ใช้ `structuredClone(this.current.frames)` — clone ทุก layer ของทุก frame
ต่อ 1 undo step (background 1400×900 × 3 layers ≈ 3.8M cell/snapshot × ~50 steps × 2 stacks)
**รอบแรก (mitigation):** เพิ่ม `undoLimitFor(w,h)` cap จำนวน step ตามขนาด canvas (ลงถึง 8) — "เก็บน้อย
step" ไม่ใช่ "step ละน้อย"
**สถานะ: แก้ครบแล้ว (2026-09-08) — diff-based undo:**
- โมดูลใหม่ `src/lib/undoHistory.ts` (pure, มีเทสต์ `undoHistory.test.ts` 14 ตัว): `HistoryEntry` เป็น
  discriminated union — `'cells'` เก็บแค่สี่เหลี่ยมที่เปลี่ยน (bbox จาก `layersDiffRegion`) ของ frame
  ที่แก้ ทั้งสองทิศ (before/after) · `'full'` = snapshot pair สำหรับการเปลี่ยนเชิงโครงสร้าง (resize,
  เพิ่ม/ลบ layer, opacity/visibility, frameMs, สลับ frame)
- `usePixelEditor.ts`: `undoStack`/`redoStack` เป็น `HistoryEntry[]` · `historyPending` = full snapshot
  ตัวเดียวที่ถือไว้ ณ `pushUndo()` ล่าสุด แล้ว compact เป็น entry แบบ lazy ที่ `pushUndo`/`undo`/`redo`
  รอบถัดไป (`finalizeHistoryPending`) · undo/redo ไม่ clone snapshot ใหม่แล้ว (entry สองทิศในตัว)
- no-op edit (วาดทับสีเดิมทั้งหมด) → ไม่ push entry เลย (ตรงกับหลัก "ไม่มี dead Ctrl+Z" ที่ fill ใช้อยู่)
- memory budget: `trimHistory` — count cap 80 + byte budget 32MB (ไม่ต่ำกว่า 8 step)
- ยืนยัน: 154 unit tests, build, lint + Playwright (round-trip 12 stroke exact, fill, resize 'full'
  สองทิศ, gesture cancel, aliasing scenario) + editor test เดิมทั้งหมดผ่าน
> หมายเหตุ: ไม่ใช่สาเหตุของ OOM ที่เจอไปแล้ว (อันนั้นคือ NaN loop) แต่เป็นความเสี่ยงจริงคนละตัว

---

## P1 — หนี้ทางสถาปัตยกรรม

### 4. `usePixelEditor.ts` ยังใหญ่ (migrate เครื่องมือครบทุกตัวแล้ว)
**สถานะ:** เสร็จแล้ว — migrate เครื่องมือไปสถาปัตยกรรมใหม่ครบทั้ง 14 ตัว (pen, eraser, rect, ellipse,
line, magicWand, move, select, lasso, eyedropper, fill, gradient, spray, curve) ไม่มี tool ไหนเหลือ
if-chain เดิมแล้ว curve (ตัวสุดท้าย ใหญ่ที่สุด) ต้องเพิ่ม interface จริง 4 อย่าง
(`keepActive`/`overlay`/`onResumeDown`/`onKeyDown`) เพราะเป็น gesture เดียวที่ข้ามหลาย
pointerdown-cycle (ลาก line เริ่มต้น → ปล่อย → โผล่ preview เบซิเยร์รอ handle → คลิกครั้งที่สองแยก
ต่างหากถึงจะ commit) — รายละเอียดเต็มอยู่ใน `src/lib/tools/ARCHITECTURE.md`
การ migrate select/lasso ลบโค้ดตายจริง (`startMoveGesture`, `moveStartCell`, legacy `moveBuffer`
branch, `draftSelectionMode`) ออกไปด้วย หลังยืนยัน caller ครบทุกจุด — migrate line ลบ
`computeShapeCells()` เต็มตัว + `shapeStart` field — migrate curve ลบมากที่สุดรอบเดียว: `commitCurve`/
`cancelCurve` เต็มตัว, `curveStart`/`curveEnd`/`curveDraggingControl` fields, engine's เอง
`quadraticBezierCells`/`mirroredExpand`/`thickenPath`
**ของแถมที่เจอระหว่าง migrate curve (แก้แล้ว ไม่ใช่แค่ preserve เฉย ๆ):** 2 บั๊กจริง ดูรายละเอียดที่
ARCHITECTURE.md §Deviations — (1) `commitGestureResult`'s "ไม่มีอะไรเปลี่ยน" ไม่เคย repaint dirtyRects
เลย ทำให้ rect/line/curve ที่ลากออกนอก selection ทั้งหมดค้าง overlay ไว้บนจอ (2) Escape ระหว่าง curve
bend-idle ไม่เคย rollback undo entry ที่ push ไว้ตอนเริ่มลาก ทำให้ค้าง entry เปล่าไว้ใน undo stack

### 5. โค้ดเดิมที่ตายแล้ว — ล่าสุด: ลบไปแล้วจริง (หลังพลาดไปหนึ่งรอบ)
รอบก่อน: เข้าใจผิดว่า branch `if (this.moveBuffer)` ใน `onPointerMove` เข้าไม่ถึงแล้ว ลองลบดูจริงแล้วพบว่า
**ตอนนั้นยังใช้งานอยู่** เพราะ `select`/`lasso` คลิกด้านในกรอบ selection ยังเรียก `startMoveGesture()`
แบบเดิมโดยตรง ไม่ผ่าน `activeGesture` — ได้คืนโค้ดกลับตอนนั้น
**อัปเดตตอนนี้ (migrate select/lasso แล้ว):** พอ select/lasso เปลี่ยนไปเรียก `TOOL_REGISTRY.move` แทน
`startMoveGesture()` โดยตรง ทำให้ branch นั้น + `startMoveGesture()` + `moveStartCell` +
`draftSelectionMode` **กลายเป็น dead code จริง** แล้ว — ลบออกไปแล้วรอบนี้ หลังจาก grep หา caller
ทุกจุดยืนยันซ้ำก่อนลบทุกครั้ง (ไม่ใช่แค่เชื่อว่า "น่าจะ" unreachable เหมือนรอบก่อน)
**บทเรียนที่ยังใช้ได้เสมอ:** ก่อนสรุปว่าอะไร "unreachable" ต้องไล่ caller ทุกจุดจริง ๆ ไม่ใช่แค่ grep
ชื่อ

**เจอเพิ่มระหว่าง migrate curve (ตัวสุดท้าย):**
1. ✅ **ลบแล้ว (2026-09-08):** `shapePreviewCells` field + `redrawShapePreview()` + `cellsDirtyRects()`
   (ตายตามไปด้วย เพราะ caller เหลือแค่ `redrawShapePreview`) + `redrawShapePreview(null)` no-op ใน
   `resetGestureState()` `refresh()`/`attachCanvas()` ตอนนี้เรียก `drawGrid()` เปล่า ๆ
   tsc / build / 140 tests / lint ผ่าน — ARCHITECTURE.md อัปเดตแล้ว
2. ✅ **ลบแล้ว (2026-09-08):** ส่วน tail ของ pen/eraser ใน `onPointerMove` + transitive closure ทั้งหมด
   ยืนยันแล้วว่าตายจริง — trace caller ทุกจุด: pen/eraser ที่ `painting===true` มี `activeGesture` เสมอ
   (`beginToolGesture` set ทั้งคู่ หรือ reset `painting=false` ถ้า gesture null; `startResizeDrag`/
   `startRotateDrag` เป็น select-only) → return ที่ `if (this.activeGesture)` ก่อนถึงบล็อกนี้เสมอ
   ลบ ~335 บรรทัด (net −309): บล็อก `onPointerMove` + `paintCell` + `strokeStep` + `strokeDirtyRects`
   + `reflectRectAxis` + `clampRect` + `applyBrushAt` + `brushCellsAt` + `paintAllowed` + `mirrorCells`
   + `symmetryTransforms` + `applyPixelPerfectCorner` + `restoreCellFromSnapshot` + `pixelPerfectActive`
   + `currentPaintColor` + fields `strokeSnapshot`/`strokePoints`/`strokeVisits`/`lastPaintCell`
   (ทั้งหมด reachable แค่จากบล็อกนี้ — logic จริงย้ายไป `src/lib/tools/paintPipeline.ts` + `penTool.ts`
   ตั้งแต่ migrate แล้ว) · tsc / build / 154 tests / lint ผ่าน + Playwright (pixel-perfect corner trim,
   eraser, off-canvas stroke, symmetry mirror, undo/redo) ผ่านหมด

### 6. ✅ ยังไม่มีเทสต์ในส่วนที่เสี่ยงที่สุด — เขียนแล้ว (2026-09-08)
เดิม: `src/lib/tools/` + `pixelMath` + `storage.ts` มีเทสต์ แต่ `useTank.ts` (2,200 บรรทัด) ไม่มีเลย
**แก้:**
- audit จุดเสี่ยงก่อน → `docs/USETANK_TEST_AUDIT.md`
- `export class TankEngine` (เดิม export แค่ type) เพื่อ new ใน test ได้ตรง ๆ ไม่ต้องผ่าน hook/DOM
- export balance constants (`HUNGER_FULL_TO_EMPTY_MS` / `STARVATION_DEATH_MS` / `FOOD_HUNGER_GAIN`)
- `src/hooks/__tests__/useTank.test.ts` — **40 tests**: tickHunger + starvation catch-up (P0),
  undo/redo + deep-copy snapshot + UNDO_LIMIT + "grouping ไม่ undoable" (P0), grouping/pruning/coMovers
  (P1), z-order + drag-to-front (P1), swimBoundsFor + zone หลุดขอบ (P1), update() physics (bounce /
  dead-float / old-age / hasSized guard) (P1), food (feedAt clamp / nearestFood / eat / cap 1) (P2),
  hitTest + marquee toggle + setInstanceSpeed
- setup: fake canvas 800×600, `hasSized=true`, MemoryStorage, `vi.useFakeTimers()`, private ผ่าน `(engine as any)`
รวมทั้งโปรเจกต์: 197 tests ผ่าน · build · lint

### 7. ✅ `docs/PIXI_MIGRATION_PLAN.md` ขัดกับงานที่ทำไปแล้ว — แก้แล้ว (2026-09-08)
ไฟล์นั้นเขียนว่า *"ห้ามแตะ src/hooks/usePixelEditor.ts และเครื่องมือวาดใน editor"* แต่งานแยกได้รื้อ editor
ไปเยอะ (14/14 tools, diff-based undo, ลบ dead code ~340 บรรทัด)
**แก้แล้ว:** ปรับ §0 (สรุปงานที่ทำไปทั้งหมด + ชี้ให้ยึด ARCHITECTURE.md/EDITOR_IMPROVEMENTS.md เป็นความจริง),
§3 (line count 4500→3900 + เพิ่มบรรทัด `src/lib/tools/`), §5.D table (เปลี่ยนหัวเป็น "งาน Pixi migration
นี้ต้องแก้?" + หมายเหตุว่าไฟล์พวกนี้ถูกแก้โดยงานอื่นได้), §7.D (คำอธิบายให้ตรงกับสภาพจริง) — กฎ
"งาน Pixi ไม่ต้องแตะ editor" ยังจริง (bridge เชื่อมผ่าน Sprite data + paintLayers() เท่านั้น)

---

## P2 — UX / ความสามารถที่ขาด

### 8. ✅ Gradient tool มีแค่แบบเส้นตรง — เพิ่ม radial แล้ว (2026-09-08)
**แก้:** เพิ่ม `GradientType = 'linear' | 'radial'` — Select ใน `ToolOptionsBar` (เฉพาะตอนเลือก gradient),
field `engine.gradientType` + `setGradientType()` (sticky ข้าม sprite เหมือน brushSize/symmetry)
- math ร่วม: `gradientT(x,y,start,end,type)` ใน `gradientTool.ts` — linear = projection บนแกนลาก (คงเดิม),
  radial = ระยะจาก start (center, วัดจาก cell center) / ความยาวลาก (radius), clamp [0,1]
- commit path + live preview overlay (`ctx.createRadialGradient` / dither loop) ใช้ helper เดียวกัน
- 15 gradient tests (เพิ่ม 3 radial: distance-based blend, 2D symmetry, zero-length) + build + lint +
  Playwright (วาด radial → เห็น blob กลมจริงบน canvas + preview)
**ยังไม่ทำ:** ปุ่ม swap สี ในแถบ tool (มีอยู่แล้วใน COLORS panel + คีย์ X — ไม่เร่ง)

### 9. ~~คีย์ลัดไม่มีที่ไหนบอกผู้ใช้~~ — ตรวจซ้ำแล้ว: มีอยู่แล้ว ไม่ต้องแก้
`ToolRail.tsx:53`'s `title={t('tool.${entry.tool}.desc')}` มีคีย์ลัดต่อท้ายอยู่แล้วทุกตัว
เช่น `"Pen — draw pixels one at a time (B) • ..."` (ดู `i18n.ts:7-34`) — รายการนี้ตัดทิ้ง

### 10. ปุ่ม Undo/Redo ยังไม่มี `aria-label` (แก้แล้วเฉพาะจุดนี้)
เครื่องมือวาดทุกตัวใน `ToolRail.tsx:54-55` มี `aria-label`+`aria-pressed` ครบอยู่แล้ว
มีแค่ปุ่ม Undo/Redo (`ToolRail.tsx:65,68`) ที่มี `title=` อย่างเดียว ไม่มี `aria-label`
**สถานะ:** แก้แล้ว — เพิ่ม `aria-label` ให้สองปุ่มนี้

### 11. ✅ พื้นที่ว่างในแผงฝั่งขวาเยอะผิดสัดส่วน — แก้แล้ว (2026-09-08)
เดิม `.dock-panel { flex: 1 0 auto }` (index.css) → ทุก panel โตแบ่งพื้นที่เท่ากัน: PREVIEW/ONION/
TRANSFORM ได้ส่วนแบ่งเกินเนื้อหา (ช่องว่าง ~67px ในทุกการ์ด) ส่วน LAYERS/LIBRARY ได้ส่วนแบ่งเท่ากัน
ซึ่งไม่พอ → บีบจน scroll ในตัวเอง (วัดจริงบน main: ทุก panel มี dead zone 67px รวม layers ด้วย)
**แก้:**
- `.dock-panel` → `flex: 0 0 auto` (สูงตามเนื้อหา) — panel เล็กไม่ยืดแล้ว
- เฉพาะ `palette` / `layers` / `library` (list ที่ยาวได้ไม่จำกัด) → `flex: 1 1 auto` + `body`
  `overflow-y: auto` ดูดพื้นที่ที่เหลือของ column แล้ว scroll ในตัวเองเมื่อเต็ม
- `.dock-panel-body` → `flex: 1 1 auto` ให้ body เต็ม panel ที่โต (เดิม body ไม่เต็ม เหลือ dead zone)
- panel ที่ผู้ใช้ลากตั้งความสูงเอง (`[data-fixed-height]` + inline flex) ยังชนะเหมือนเดิม
ยืนยัน: build/lint ผ่าน + Playwright วัด (1400×900 / 1200×560): PREVIEW/ONION/TRANSFORM สูงพอดีเนื้อหา,
LAYERS/LIBRARY เต็ม+scroll ในตัว, ไม่มี horizontal page scroll

### 12. ✅ แก้แล้ว — คลิกที่ข้อความ checkbox 4 ตัวใน ToolOptionsBar ไม่ทำงาน (พบระหว่าง migrate gradient)
**แก้แล้ว (2026-09-08):** เปลี่ยน wrapper จาก `<label>` เป็น `<span>` และให้แต่ละ `Checkbox` มี `id`
(`tool-opt-contiguous` / `tool-opt-shape-filled` / `tool-opt-pixel-perfect` / `tool-opt-dither`)
กับ `<Label htmlFor={id}>` ชี้ไปแทน — ตัด nested-label ออก คลิกที่ข้อความติ๊กได้แล้ว
tsc / build / 140 unit tests / lint ผ่าน

<details><summary>รายละเอียดบั๊กเดิม</summary>

**ไฟล์:** `src/components/editor/ToolOptionsBar.tsx:120-190` — ปุ่ม "Contiguous" (Magic Wand),
"Filled" (Rect/Ellipse), "Pixel Perfect" (Pen), "Dither" (Gradient) ทั้ง 4 ใช้ pattern เดียวกัน:
`<label className="mini-toggle"><Checkbox/><Label>ข้อความ</Label></label>` — คือ native `<label>`
ครอบ native `<label>` อีกที (Radix `Label` render เป็น `<label>` ของมันเอง)
**อาการยืนยันแล้วจริง (ไม่ใช่เดา):** ทดสอบผ่าน Playwright คลิกที่ข้อความ "Dither" โดยตรง แล้วเช็ค
`aria-checked`/`data-state` ก่อน-หลังคลิก — **ไม่เปลี่ยนเลย** ต้องคลิกที่กล่องสี่เหลี่ยม 20px ของ
checkbox เองเท่านั้นถึงจะติ๊กได้ เหตุผล: เบราว์เซอร์ระงับ label-click-forwarding เมื่อ click target
เป็น `<label>` อีกอันซ้อนอยู่ข้างใน (nested label ไม่ forward click ไปยัง control ของ label แม่)
**ผลกระทบ:** ผู้ใช้ทั่วไปมักคลิกที่ข้อความ (เป้าใหญ่กว่า ดูเป็นธรรมชาติกว่า) แล้วจะรู้สึกว่าปุ่มพัง
**แนวทาง:** ให้ Radix `Checkbox` มี `id` แล้วให้ `<Label htmlFor={id}>` ชี้ไปแทน (ตัด nested-label
structure ออก เปลี่ยน wrapping element จาก `<label>` เป็น `<div>` ธรรมดา) — แก้จุดเดียวที่ pattern
แล้วนำไปใช้ซ้ำทั้ง 4 จุด
</details>

---

## P3 — คุณภาพโค้ด / ประสิทธิภาพ (ไม่เร่ง)

### 13. Bundle เป็นก้อนเดียว 546 kB (แก้แล้ว)
**สถานะ:** แก้แล้ว — `src/App.tsx:12` แยก `TankPanel` ด้วย `lazy(() => import(...))` +
`hasVisitedTank` gate แล้ว ยืนยันจาก `npm run build`: `TankPanel-*.js` เป็น chunk แยก (57 kB) ไม่รวม
อยู่ใน bundle แรกอีกต่อไป

### 14. จุดเล็ก ๆ ที่สะอาดดีอยู่แล้ว (บันทึกไว้ว่าไม่ต้องแก้)
- `any` / `@ts-ignore` ทั้งโปรเจกต์มีแค่ 2 จุด
- non-null assertion ใน `usePixelEditor.ts` มีแค่ 3 จุด
- `touch-action: none` ตั้งไว้ครบแล้ว (`index.css:746, 913, 931, 1014`) — touch ใช้งานได้
- localStorage ใช้ key แบบมีเวอร์ชัน (`.v1`/`.v2`) อยู่แล้ว — โครงรองรับ migration ในอนาคตได้

---

## บั๊กที่เจอระหว่าง audit นี้ (แก้ไปแล้ว ไม่ต้องทำซ้ำ)

- **คลิกขวาเพื่อลบด้วยปากกาใช้ไม่ได้** — `PenGesture` ไม่ได้อ่าน `e.button` เลย ทำให้ modifier
  "คลิกขวา = ลบ" (ที่ของเดิมมีผ่าน `eraseOverride`) หายไปตอน refactor
  ยืนยันด้วยการทดสอบจริง: ก่อนแก้ลากขวาทับเส้นแล้วไม่มีอะไรเกิดขึ้น หลังแก้ลบออกหมด
  → แก้ที่ `penTool.ts:createPenTool` + ล็อกด้วย unit test 2 ตัว
  (`rect`/`ellipse` ไม่มีปัญหานี้ — `ShapeGesture` อ่าน `button` อยู่แล้ว)
  > **ปิดจบแล้ว:** ทุก tool migrate ครบแล้ว รวม curve (ตัวสุดท้าย) — เช็คแล้วว่า right-click erase
  > ยังทำงานถูกต้องทุกตัว (line/fill/gradient/spray/curve ทุกตัวเช็คแล้วตอน migrate ของตัวเอง)

## บทเรียนจากบั๊กที่เพิ่งแก้ (กันพลาดซ้ำ)

1. **ห้าม spread native DOM event** — `{ ...pointerEvent }` ทำให้ `clientX/clientY` หาย
   (เป็น getter บน prototype) → ได้พิกัด `NaN` → ลูปวาดเส้นค้าง → OOM
   บันทึกไว้แล้วใน `src/lib/tools/ARCHITECTURE.md` §Highest-risk points
2. **Playwright จับบั๊กกลุ่มนี้ไม่ได้** — input สังเคราะห์ไม่สร้าง coalesced events เหมือนเมาส์จริง
   ถ้าจะเทสต์ path นี้ต้อง stub `getCoalescedEvents` ในเบราว์เซอร์
3. **ลูป `while(true)` ที่ออกด้วยการเทียบค่าเท่านั้น** อันตรายเสมอเมื่อ input อาจเป็น NaN
   — ใส่ guard ไว้แล้วที่ `pixelMath.ts:bresenhamLine` พร้อมเทสต์
