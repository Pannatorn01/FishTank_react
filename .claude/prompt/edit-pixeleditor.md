# Prompt: Redesign the Pixel Editor's Drawing-Tool Engine from Scratch

## บริบท

โปรเจกต์นี้เป็น pixel-art sprite editor (React + Canvas 2D) มีไฟล์หลักคือ
`usePixelEditor.ts` ซึ่งรวมทุกอย่างไว้ในคลาสเดียว (`PixelEditorEngine`, ~2,000
บรรทัด): pointer/gesture handling ของทุกเครื่องมือ, undo/redo, selection
(marquee/lasso/magic wand), layers, frames, symmetry, onion skin, zoom/pan,
export ฯลฯ ทุก tool ถูก handle รวมกันอยู่ใน `onPointerDown` / `onPointerMove`
/ `onPointerUp` เดียว ด้วย `if (this.tool === 'xxx') { ... }` ยาวเรียงกัน
และ state ของแต่ละ gesture (shapeStart, moveBuffer, resizeHandle,
rotateOrigin, curvePhase, gradientStart, lassoDraftPoints ฯลฯ) เป็น field
แยกกันหมดบนคลาสเดียว ทำให้:

- gesture ของ tool หนึ่งค้าง/รั่วไปกระทบ state ของอีก tool ได้ง่าย
- การยกเลิก/สลับ tool กลางสโตรกต้อง reset field เป็นสิบตัวด้วยมือ
  (`resetGestureState`)
- เพิ่ม/แก้ tool ใหม่ต้องแก้หลายจุดที่กระจัดกระจาย (pointer handlers, key
  handlers, cursor logic, dirty-rect repaint, undo bookkeeping)
- ยาก unit test เพราะทุกอย่างผูกกับ DOM canvas + instance เดียว

**เป้าหมาย:** ออกแบบสถาปัตยกรรมของ "ระบบเครื่องมือวาด" ใหม่ทั้งหมด
(ไม่ต้องอิง logic/โครงสร้างเดิม) โดยที่ยังคง **feature parity** และ
**performance characteristics** เดิมไว้ (ดูรายการด้านล่าง) แต่ให้เสถียรกว่า,
อ่าน/แก้ง่ายกว่า, และ test ได้

---

## ทำอะไรได้บ้างในปัจจุบัน (feature parity ที่ต้องคงไว้)

**เครื่องมือ:** pen, eraser, line, rect, ellipse, curve (quadratic bezier
2-step drag), fill (flood fill + tolerance + global replace), eyedropper,
spray (density-based, ticking timer), gradient (2 สี, dither mode ได้),
select (marquee), lasso (freeform), magic wand (contiguous/global,
tolerance), move.

**พฤติกรรมร่วมของหลาย tool:**
- brush size ใช้ร่วมกันระหว่าง pen/eraser/spray/line/rect/ellipse/curve
- Alt = eyedropper ชั่วคราว, ขวาคลิก = erase ชั่วคราว (สำหรับ tool ที่วาดสี)
- Shift = constrain (เส้นตรง 0/45/90°, สี่เหลี่ยม/วงกลมสมมาตร) หรือ
  chain-from-last-stroke-end (pen/eraser), หรือ selection add-mode
- Alt ระหว่างลาก selection = subtract mode
- Ctrl/Cmd ระหว่างลาก selection ที่มีอยู่ = copy แทน move
- Symmetry (vertical/horizontal/both/diagonal/radial) รอบแกนที่ลากได้ –
  ทุก paint operation ต้อง mirror ตาม transform ที่ถูกต้อง
- Pixel-Perfect corner trimming (เฉพาะ brush size 1, เฉพาะ paint ไม่ใช่ erase)
- Selection มี 3 รูปแบบ: rectangular (ไม่มี mask), lasso/wand
  (sparse mask + traced polygon outline สำหรับวาด marching ants)
- Selection ป้องกันการวาดนอกพื้นที่ (`paintAllowed`) สำหรับทุก paint tool
- Move/Resize/Rotate selection แบบ floating buffer, unclamped
  (ลากออกนอกขอบ canvas ได้), commit ตอนปล่อยเมาส์
- Esc ยกเลิก gesture กลางคัน แล้ว rollback undo entry ที่ push ไปแล้วทิ้ง
- กด 2 ปุ่มเมาส์พร้อมกันกลางสโตรก = ยกเลิก gesture (Paint/Aseprite
  convention)
- Middle-click หรือ Space+ลากซ้าย = pan (ไม่ขึ้นกับ tool ที่เลือกอยู่)
- Coalesced pointer events สำหรับ pen/eraser (ไม่ให้เส้นหักมุมตอนลากเร็ว)
- Undo/redo แบบ snapshot ทั้งเฟรม แต่ repaint แบบ dirty-rect เมื่อ diff
  ได้ (`layersDiffRegion`)
- Dirty-rect repaint สำหรับทุก gesture (ห้าม full-canvas repaint ทุก
  pointermove บน canvas ใหญ่ – นี่คือเหตุผลที่โค้ดเดิมซับซ้อนมาก)

**Performance constraint ที่ต้องรักษา:**
- Canvas ใหญ่สุดที่รองรับ (background sprite) ถึง ~1400×900 พร้อมหลาย
  layer ต้อง**ไม่**มีการ full repaint ทุก pointer move ระหว่างวาด/ลาก –
  ต้อง repaint เฉพาะ bounding box ที่เปลี่ยนจริงเท่านั้น
- ต้องไม่ trigger React re-render มากกว่า 1 ครั้งต่อ animation frame
  ระหว่างวาด (coalesce การแจ้งเตือน)

---

## สิ่งที่อยากให้ AI ออกแบบใหม่

1. **แยกแต่ละ tool เป็นหน่วยอิสระ** (เช่น แต่ละ tool เป็น class/object ที่
   implement interface เดียวกัน: `onPointerDown/Move/Up`, `onCancel`,
   `getPreview()`, `getCursor()` เป็นต้น) แทนที่จะรวมทุก tool ไว้ในเมธอด
   เดียวของ engine ก้อนเดียว
2. **แยก "gesture state" ออกจาก "engine state ถาวร"** ให้ชัดเจน –
   gesture ที่กำลังทำอยู่ควรเป็น object เดียวที่สร้าง/ทำลายเป็นก้อน
   ไม่ใช่ field กระจัดกระจายหลายสิบตัวที่ต้อง reset เองทีละตัว
3. **ทำให้ cancel/interrupt เป็น first-class operation** ที่ทุก tool
   ต้อง implement แทนที่จะพึ่ง `resetGestureState()` กลางที่ต้องรู้จัก
   internal state ของทุก tool
4. **แยก paint model ออกจาก rendering** – มี pure function/layer สำหรับ
   "คำนวณว่าจะ paint เซลล์ไหนด้วยสีอะไร" แยกจาก "จะ repaint ส่วนไหนของ
   canvas จริง" เพื่อให้ unit test logic ของแต่ละ tool ได้โดยไม่ต้องพึ่ง
   DOM canvas
5. **ทำ dirty-rect tracking เป็นกลไกกลาง** ที่ทุก tool ใช้ร่วมกันแบบ
   uniform (ไม่ใช่ต่างคนต่างคำนวณ bounding box เอง)
6. **Symmetry/selection-mask เป็น "paint pipeline" ที่ประกอบ (compose)
   ได้** เช่น `withSymmetry(withSelectionClip(rawStroke))` แทนที่จะเรียก
   `mirrorCells`/`paintAllowed` แทรกอยู่ในทุก tool
7. เสนอ error-handling/guard rail ที่ป้องกันปัญหาที่โค้ดเดิมมีคอมเมนต์
   ระบุว่าเคยเจอบั๊ก เช่น pointer capture หลุดกลางทาง, blur ระหว่างลาก,
   สอง gesture ทับซ้อนกัน, สลับ sprite/frame กลาง gesture

---

## สิ่งที่ต้องส่งมอบ

1. เอกสารสถาปัตยกรรมสั้นๆ (diagram/description) ของโครงสร้างใหม่
2. Interface/type definitions ของ "Tool" และ "Gesture" กลาง
3. Reference implementation อย่างน้อย 4 tool ที่ครอบคลุมความซับซ้อนต่างกัน:
   - pen/eraser (freehand, coalesced events, pixel-perfect)
   - rect/ellipse (shape preview, shift-constrain, brush thickness)
   - lasso หรือ magic wand (selection mask, add/subtract combine mode)
   - move (floating buffer, unclamped drag, commit-on-release)
4. แผนการ migrate จากโค้ดเดิมแบบ incremental (ทำทีละ tool ได้ไหม หรือ
   ต้อง big-bang) พร้อมระบุความเสี่ยงจุดไหนที่มีโอกาสเสีย feature parity
   มากที่สุด
5. รายการ edge case ที่ควรมี test coverage (อิงจาก "สิ่งที่ต้องคงไว้"
   ด้านบน)

## ข้อจำกัด

- Stack เดิม: React + TypeScript, วาดบน `<canvas>` 2D context จริง (ไม่ใช่
  library วาด), overlay UI (selection border, handles) เป็น DOM แยก
  (`PixelSelectionOverlay.tsx`) ไม่ใช่วาดบน canvas
- ห้ามลดทอน performance บน canvas ใหญ่ (ดู constraint ด้านบน)
- เก็บ public API ของ `usePixelEditor()` hook ให้เข้ากันได้กับ component
  ที่เรียกใช้อยู่เดิมเท่าที่เป็นไปได้ (หรือถ้าจะเปลี่ยน ให้ระบุ diff
  ของ API ชัดเจน)

