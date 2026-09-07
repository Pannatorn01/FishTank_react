# Draw Fish/Decor — รายการสิ่งที่ควรปรับปรุง (Backlog)

> รายการนี้มาจากการ audit โค้ดจริง (ไม่ใช่การเดา) — แต่ละข้อระบุไฟล์/บรรทัดไว้ให้กระโดดไปแก้ได้เลย
> Created: 2026-09-07 · Status: **ยังไม่เริ่มแก้ — เป็น backlog ล้วน**
>
> เกี่ยวข้องกับ: [`src/lib/tools/ARCHITECTURE.md`](../src/lib/tools/ARCHITECTURE.md) (แผน migrate เครื่องมือวาด)
> และ [`PIXI_MIGRATION_PLAN.md`](./PIXI_MIGRATION_PLAN.md) (ดู §0 — ข้อขัดแย้งที่ต้องเคลียร์)

---

## P0 — ความเสี่ยงข้อมูลหาย / แอปพัง

### 1. ไม่มี Error Boundary เลยทั้งแอป
**อาการ:** ถ้า component ไหน throw ตอน render → หน้าขาวทั้งหน้า ผู้ใช้เสียงานที่ยังไม่ได้เซฟทันที
ไม่มีข้อความบอก ไม่มีปุ่มกู้คืน (ตรงกับอาการหน้าขาวที่เคยเจอ)
**หลักฐาน:** `grep -rn "ErrorBoundary\|componentDidCatch" src/` → ไม่เจอเลย
**แนวทาง:** ครอบ `PixelEditorPanel` + `TankPanel` ด้วย ErrorBoundary ที่แสดงปุ่ม
"ดาวน์โหลด sprite เป็นไฟล์" + "รีเซ็ตหน้า" เพื่อให้กู้งานออกมาได้ก่อน reload

### 2. โหลดข้อมูลจาก localStorage โดยไม่ตรวจ schema
**ไฟล์:** `src/lib/storage.ts:108-253` (ทุก `load*()` มี try/catch แต่เช็คแค่ JSON parse ผ่านหรือไม่)
**อาการ:** ข้อมูลที่ parse ได้แต่รูปร่างผิด (เช่น `frames` เป็น null, `width` เป็น string) จะไหลเข้า
engine ตรง ๆ แล้วไปพังตอน render — ทางออกเดียวของผู้ใช้คือเปิด DevTools ล้าง localStorage เอง
**แนวทาง:** ใส่ validator ตอน load (เช็ค width/height เป็น finite number, frames เป็น array,
cells.length === width*height) ถ้าไม่ผ่านให้ fallback เป็นค่า default แทนที่จะปล่อยพัง
+ เพิ่มปุ่ม "รีเซ็ตข้อมูลทั้งหมด" ใน UI จะได้ไม่ต้องพึ่ง DevTools

### 3. Undo stack กินหน่วยความจำแบบ O(ขนาด canvas × 50)
**ไฟล์:** `src/hooks/usePixelEditor.ts:91` (`UNDO_LIMIT = 50`), `snapshot()` ใช้
`structuredClone(this.current.frames)` — clone ทุก layer ของทุก frame ต่อ 1 undo step
**ตัวเลขจริง:** background sprite 1400×900 × 3 layers = ~3.8 ล้าน cell ต่อ 1 snapshot
× 50 steps ≈ 190 ล้าน entry ค้างใน memory
**แนวทาง:** เปลี่ยนเป็น diff-based undo (เก็บเฉพาะ cell ที่เปลี่ยน + bounding box) หรืออย่างน้อย
ลด `UNDO_LIMIT` แบบ dynamic ตามขนาด canvas
> หมายเหตุ: ไม่ใช่สาเหตุของ OOM ที่เจอไปแล้ว (อันนั้นคือ NaN loop ซึ่งแก้แล้ว) แต่เป็นความเสี่ยงจริงคนละตัว

---

## P1 — หนี้ทางสถาปัตยกรรม

### 4. `usePixelEditor.ts` ยังใหญ่ (กำลังเล็กลงเรื่อยๆ)
migrate เครื่องมือไปสถาปัตยกรรมใหม่แล้ว 8 ตัว (pen, eraser, rect, ellipse, magicWand, move, select,
lasso) เหลืออีก 6 ตัวที่ยังเป็น if-chain เดิม: **line, spray, fill, curve, gradient, eyedropper**
การ migrate select/lasso รอบนี้ยังลบโค้ดที่ตายจริง (`startMoveGesture`, `moveStartCell`, legacy
`moveBuffer` branch, `draftSelectionMode`) ออกไปด้วย หลังยืนยัน caller ครบทุกจุดแล้ว
**แผนละเอียด + ลำดับที่แนะนำ + จุดเสี่ยง:** อยู่ใน `src/lib/tools/ARCHITECTURE.md` §Migration plan แล้ว
(ไม่ต้องเขียนซ้ำที่นี่)

### 5. โค้ดเดิมที่ตายแล้ว — ล่าสุด: ลบไปแล้วจริง (หลังพลาดไปหนึ่งรอบ)
รอบก่อน: เข้าใจผิดว่า branch `if (this.moveBuffer)` ใน `onPointerMove` เข้าไม่ถึงแล้ว ลองลบดูจริงแล้วพบว่า
**ตอนนั้นยังใช้งานอยู่** เพราะ `select`/`lasso` คลิกด้านในกรอบ selection ยังเรียก `startMoveGesture()`
แบบเดิมโดยตรง ไม่ผ่าน `activeGesture` — ได้คืนโค้ดกลับตอนนั้น
**อัปเดตตอนนี้ (migrate select/lasso แล้ว):** พอ select/lasso เปลี่ยนไปเรียก `TOOL_REGISTRY.move` แทน
`startMoveGesture()` โดยตรง ทำให้ branch นั้น + `startMoveGesture()` + `moveStartCell` +
`draftSelectionMode` **กลายเป็น dead code จริง** แล้ว — ลบออกไปแล้วรอบนี้ หลังจาก grep หา caller
ทุกจุดยืนยันซ้ำก่อนลบทุกครั้ง (ไม่ใช่แค่เชื่อว่า "น่าจะ" unreachable เหมือนรอบก่อน)
**บทเรียนที่ยังใช้ได้เสมอ:** ก่อนสรุปว่าอะไร "unreachable" ต้องไล่ caller ทุกจุดจริง ๆ ไม่ใช่แค่ grep
ชื่อ tool ส่วน tail ของ pen/shape ที่เหลือใน `onPointerMove`/`onPointerUp` (สำหรับ tool ที่ยังไม่ migrate)
**ยังไม่ได้ตรวจซ้ำ** — ห้ามสมมติว่าลบได้จนกว่าจะไล่ทุก caller แบบเดียวกัน

### 6. ยังไม่มีเทสต์ในส่วนที่เสี่ยงที่สุด
มีเทสต์แล้ว: `src/lib/tools/` (39 tests) + `pixelMath` (4 tests)
**ยังไม่มีเลย:** `storage.ts` (520 บรรทัด — พังแล้วข้อมูลผู้ใช้หาย), `useTank.ts` (2,083 บรรทัด)
**แนวทาง:** เริ่มจาก `storage.ts` ก่อน — เทสต์ round-trip save→load + ข้อมูลเสีย/ขาดฟิลด์

### 7. `docs/PIXI_MIGRATION_PLAN.md` ขัดกับงานที่ทำไปแล้ว
ไฟล์นั้นเขียนว่า *"ห้ามแตะ src/hooks/usePixelEditor.ts และเครื่องมือวาดใน editor"*
แต่ตอนนี้ refactor เครื่องมือวาดไปแล้ว 6 ตัว
**แนวทาง:** อัปเดต §5 ของไฟล์นั้นให้ตรงกับความจริง ก่อนเริ่ม Pixi migration จะได้ไม่สับสน

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

---

## P3 — คุณภาพโค้ด / ประสิทธิภาพ (ไม่เร่ง)

### 12. Bundle เป็นก้อนเดียว 546 kB
`npm run build` เตือน chunk > 500 kB — ยังไม่มี code splitting ระหว่างแท็บ editor กับ tank
**แนวทาง:** `React.lazy` แยก TankPanel ออกจาก bundle แรก

### 13. จุดเล็ก ๆ ที่สะอาดดีอยู่แล้ว (บันทึกไว้ว่าไม่ต้องแก้)
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
  > **ที่ต้องเช็คต่อ:** tool ที่ยังไม่ migrate (line, curve, fill, spray, gradient) ยังใช้
  > `eraseOverride` ของเดิมอยู่ — ตอน migrate แต่ละตัวต้องไม่ลืม modifier นี้เหมือนกัน

## บทเรียนจากบั๊กที่เพิ่งแก้ (กันพลาดซ้ำ)

1. **ห้าม spread native DOM event** — `{ ...pointerEvent }` ทำให้ `clientX/clientY` หาย
   (เป็น getter บน prototype) → ได้พิกัด `NaN` → ลูปวาดเส้นค้าง → OOM
   บันทึกไว้แล้วใน `src/lib/tools/ARCHITECTURE.md` §Highest-risk points
2. **Playwright จับบั๊กกลุ่มนี้ไม่ได้** — input สังเคราะห์ไม่สร้าง coalesced events เหมือนเมาส์จริง
   ถ้าจะเทสต์ path นี้ต้อง stub `getCoalescedEvents` ในเบราว์เซอร์
3. **ลูป `while(true)` ที่ออกด้วยการเทียบค่าเท่านั้น** อันตรายเสมอเมื่อ input อาจเป็น NaN
   — ใส่ guard ไว้แล้วที่ `pixelMath.ts:bresenhamLine` พร้อมเทสต์
