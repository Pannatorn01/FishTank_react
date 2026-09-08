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

### 3. Undo stack กินหน่วยความจำแบบ O(ขนาด canvas × 50) (แก้บางส่วนแล้ว)
**ไฟล์เดิม:** `src/hooks/usePixelEditor.ts:91` (`UNDO_LIMIT = 50` คงที่), `snapshot()` ใช้
`structuredClone(this.current.frames)` — clone ทุก layer ของทุก frame ต่อ 1 undo step
**ตัวเลขจริงตอนนั้น:** background sprite 1400×900 × 3 layers = ~3.8 ล้าน cell ต่อ 1 snapshot
× 50 steps ≈ 190 ล้าน entry ค้างใน memory
**สถานะ:** แก้บางส่วนแล้ว — เพิ่ม `undoLimitFor(width, height)` (`usePixelEditor.ts:105-108`, ใช้จริง
ที่บรรทัด 4030) คำนวณ limit แบบ dynamic จาก `UNDO_CELL_BUDGET` คงที่ (`UNDO_LIMIT × 16×16`) หารด้วย
จำนวน cell จริงของ canvas — sprite เล็กยังได้ 50 steps เต็ม, background sprite ใหญ่ได้แค่ไม่กี่ step
(ขั้นต่ำ 8) แทนที่จะเก็บ 50 steps เท่ากันหมดไม่ว่าขนาดจะใหญ่แค่ไหน
**ยังไม่ได้แก้:** ยังเป็น full-snapshot ต่อ step อยู่ (ไม่ใช่ diff-based) — แค่ "เก็บน้อย step ลงเมื่อ
canvas ใหญ่" ไม่ใช่ "แต่ละ step กินน้อยลง" ถ้าจะแก้ให้สุดต้องเปลี่ยนเป็น diff-based undo จริง ๆ
> หมายเหตุ: ไม่ใช่สาเหตุของ OOM ที่เจอไปแล้ว (อันนั้นคือ NaN loop ซึ่งแก้แล้ว) แต่เป็นความเสี่ยงจริงคนละตัว

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
2. ส่วน tail ของ pen/eraser ที่เหลือใน `onPointerMove` (บล็อก `if (this.tool === 'pen' || this.tool
   === 'eraser')` ที่ยังเรียก `paintCell`/`cellFromEventUnclamped` เดิม) **น่าจะตายสนิทแล้วตั้งแต่ตอน
   migrate pen** (pen เข้า TOOL_REGISTRY แล้ว, `activeGesture` check ด้านบนน่าจะ return ก่อนถึงบล็อกนี้
   เสมอ) — แต่ยังไม่ได้ grep caller ยืนยันแบบเดียวกับที่ทำกับ tool อื่น ๆ **ห้ามลบจนกว่าจะตรวจซ้ำแบบ
   เดียวกัน**

### 6. ยังไม่มีเทสต์ในส่วนที่เสี่ยงที่สุด
มีเทสต์แล้ว: `src/lib/tools/` (127 tests รวมครบทุก tool ที่ migrate แล้ว) + `pixelMath` (4 tests) +
`storage.ts` (12 tests — เพิ่มมาจากอีก session หนึ่งระหว่างนี้ ไม่ใช่ของ backlog นี้)
**ยังไม่มีเลย:** `useTank.ts` (2,083 บรรทัด)
**แนวทาง:** เขียนเทสต์ให้ `useTank.ts` ต่อ — ยังไม่มีการ audit ว่าจุดเสี่ยงที่สุดในนั้นคือจุดไหน

### 7. `docs/PIXI_MIGRATION_PLAN.md` ขัดกับงานที่ทำไปแล้ว (มีหมายเหตุอัปเดตแล้ว บางส่วน)
ไฟล์นั้นเขียนว่า *"ห้ามแตะ src/hooks/usePixelEditor.ts และเครื่องมือวาดใน editor"*
แต่ตอนนี้ refactor เครื่องมือวาดไปแล้วครบทุกตัว (14/14)
**สถานะ:** §0 ของไฟล์นั้นมีหมายเหตุอัปเดต (2026-09-08) บอกจำนวนที่ migrate ไปแล้ว + เตือนว่า §5.D
"ทำงานถูกแล้วไม่ต้องแก้" ไม่ตรงความจริงทั้งหมดแล้ว — **ยังไม่ได้แก้ §5.D เองแบบเต็ม ๆ** แค่แปะหมายเหตุ
ไว้ให้เช็ค ARCHITECTURE.md ก่อนอ้างอิงจุดไหนว่า "เดิมและนิ่งแล้ว"

---

## P2 — UX / ความสามารถที่ขาด

### 8. Gradient tool มีแค่แบบเส้นตรง
แถบ options ของ gradient มีแค่ checkbox "Dither" อย่างเดียว (`ToolOptionsBar.tsx`)
**ขาด:** เลือกชนิด linear / radial, กลับทิศสี (มีปุ่ม swap อยู่ใน COLORS panel แต่ไม่อยู่ในแถบ tool)
> เคยคุยกันแล้วว่าจะเอา linear ก่อน — radial ยังเป็นของที่ขาดอยู่

### 9. ~~คีย์ลัดไม่มีที่ไหนบอกผู้ใช้~~ — ตรวจซ้ำแล้ว: มีอยู่แล้ว ไม่ต้องแก้
`ToolRail.tsx:53`'s `title={t('tool.${entry.tool}.desc')}` มีคีย์ลัดต่อท้ายอยู่แล้วทุกตัว
เช่น `"Pen — draw pixels one at a time (B) • ..."` (ดู `i18n.ts:7-34`) — รายการนี้ตัดทิ้ง

### 10. ปุ่ม Undo/Redo ยังไม่มี `aria-label` (แก้แล้วเฉพาะจุดนี้)
เครื่องมือวาดทุกตัวใน `ToolRail.tsx:54-55` มี `aria-label`+`aria-pressed` ครบอยู่แล้ว
มีแค่ปุ่ม Undo/Redo (`ToolRail.tsx:65,68`) ที่มี `title=` อย่างเดียว ไม่มี `aria-label`
**สถานะ:** แก้แล้ว — เพิ่ม `aria-label` ให้สองปุ่มนี้

### 11. พื้นที่ว่างในแผงฝั่งขวาเยอะผิดสัดส่วน
PREVIEW / ONION SKIN / TRANSFORM มีช่องว่างด้านล่างเยอะมากขณะที่ MY LIBRARY ด้านล่างถูกบีบจนต้องเลื่อน
**แนวทาง:** ให้แผงย่อขนาดตามเนื้อหา (`height: fit-content`) แล้วปล่อยพื้นที่ที่เหลือให้ LIBRARY

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
