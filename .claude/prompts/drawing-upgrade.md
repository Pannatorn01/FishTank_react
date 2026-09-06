# Prompt: ยกระดับโหมด Drawing ของ Pixel Fish Tank

> วางทั้งก้อนนี้ให้ Claude Code ได้เลย หรือหยิบทีละ Phase ก็ได้ (แนะนำทีละ Phase)

---

## Context

โปรเจกต์นี้คือ pixel-art editor (Vite + React + TS) ที่มี engine เป็น class เดียวใน
`src/hooks/usePixelEditor.ts` (~3.8k บรรทัด) และ UI แยกเป็น component ใน `src/components/editor/`.
ทุกการเปลี่ยนแปลงต้องเดินตาม pattern เดิมของ repo: engine ถือ state + วาดลง canvas แบบ imperative,
React component เป็นแค่ผิวบาง ๆ ที่เรียก engine แล้วอาศัย `refresh()/reactNotify()` เพื่อ re-render.
ห้าม rewrite สถาปัตยกรรม ห้ามใส่ library ใหม่ถ้าไม่จำเป็น ทุกข้อความ UI ต้องเพิ่มทั้ง EN/TH ใน
`src/lib/i18n.ts` และถ้าแตะรูปร่างข้อมูลที่ persist ต้องอัปเดต migration ใน `src/lib/storage.ts`.

เป้าหมายรวม: **ให้ฟีลลิ่งตอนวาดใกล้เคียง Photoshop/Aseprite มากขึ้น** และแก้บั๊กที่ทำให้ทำงานสะดุด

---

## Phase 1 — บั๊กที่ต้องแก้ก่อน (ทำให้จบก่อนค่อยไป Phase อื่น)

### 1.1 Preview ไม่อัปเดตตอนวาด
`restartPreviewTimer()` (`usePixelEditor.ts:3488`) ตั้ง `setInterval` เฉพาะเมื่อ `frames.length > 1`
และ `tickPreview()` ถูกเรียกจาก timer เป็นหลัก ⇒ สไปรต์เฟรมเดียววาดเสร็จแล้ว preview ค้างภาพเก่า
- แยก "repaint preview ของเฟรมปัจจุบัน" ออกจาก "advance ไปเฟรมถัดไป" (ตอนนี้ `tickPreview()`
  ทำสองอย่างพร้อมกัน — มันบวก `previewFrame` ก่อนวาดเสมอ)
- ให้ทุกครั้งที่ bitmap เปลี่ยน (จบ stroke, undo/redo, เปลี่ยน layer/opacity/visibility, transform)
  preview ถูก repaint ด้วย — แต่ **ต้องไม่ทำให้ช้า**: อ่าน comment ที่ `usePixelEditor.ts:3480`
  ให้ครบก่อน (พื้นหลังขนาด 1400x900 เคยทำให้แต่ละ tick กิน ~1750ms) ⇒ ใช้ throttle ด้วย rAF
  หรือ mark dirty แล้วค่อยวาด ห้ามเรียก `compositeToBitmap` ทุก pointermove

### 1.2 Scrollbar ใน `.pixel-canvas-wrap` ทำให้ canvas ขยับ
`src/index.css:654` — `overflow:auto` + `place-items:center` + ความสูงตายตัว ⇒ พอ scrollbar โผล่/หาย
พื้นที่ที่เหลือเปลี่ยน canvas เลยกระตุกกลางคัน ระหว่างวาด
**สิ่งที่ต้องการ:** ไม่ให้มี scrollbar แบบกินพื้นที่ (layout-affecting) อีกต่อไป — ให้ pan/zoom
อยู่ในตัว canvas เอง:
- `overflow: hidden` ที่ wrap แล้วจัดการ pan ด้วย transform/offset ที่ engine ถือเอง
- pan ด้วย Space+drag และ middle-mouse drag (แบบ Photoshop), wheel = pan แนวตั้ง,
  shift+wheel = pan แนวนอน, ctrl/cmd+wheel = zoom (ของเดิมที่ `PixelCanvas.tsx:25-55` ต้องยังทำงาน)
- ปุ่ม "fit" ที่มีอยู่ต้องรีเซ็ต pan ด้วย
- ถ้าจำเป็นต้องมีตัวบอกตำแหน่ง ให้เป็น overlay scrollbar (`position:absolute`, `pointer-events`
  เฉพาะตัวมัน) ที่ **ไม่กินพื้นที่ layout** ห้ามกลับไปใช้ native `overflow:auto`
- ตรวจว่าการแปลง pointer → cell (`clientToCell` หรือชื่อใกล้เคียงใน engine) ยังถูกต้องหลังเปลี่ยน
  รวมถึง `PixelSelectionOverlay` ที่อิง origin เดียวกับ canvas

---

## Phase 2 — Onion skin ที่ใช้งานได้จริง

ของเดิม (`usePixelEditor.ts:3394`) วาดทั้งก่อน(แดง)/หลัง(น้ำเงิน) อยู่แล้ว แต่ alpha ตายตัว `0.3/d`,
depth สูงสุด 2, ปรับอะไรไม่ได้ และเมื่อมี 2 เฟรม prev กับ next คือเฟรมเดียวกันจึงทับกันจนดูเหมือน
มีแค่ข้างเดียว
ต้องการ:
- แยกคุม **frames ก่อน** และ **frames หลัง** เป็นคนละค่า (0-3 ต่อข้าง) พร้อม toggle เปิด/ปิดแยกข้าง
- สไลเดอร์ opacity ของ onion (ค่าเริ่มต้นควรชัดกว่าเดิม เช่น 0.45 สำหรับชั้นแรก)
- โหมดสี: `tint` (แดง/น้ำเงินแบบเดิม) กับ `original` (สีจริง ลด alpha) ให้เลือก
- กันเคส frame ซ้ำ: ถ้า index ก่อน/หลังชนกัน ให้วาดครั้งเดียว
- ถ้าเปิด onion ต้องไม่ทำให้ `redrawRegions` (`usePixelEditor.ts:2955`) ช้าลงจนสะดุด
- ย้าย control พวกนี้ออกจาก `PreviewPanel` ที่แน่นแล้ว ไปเป็น popover/section ของตัวเอง

---

## Phase 3 — ฟีลลิ่งการวาด + modifier แบบ Photoshop

ตอนนี้ modifier มีแค่ Alt=eyedropper (`usePixelEditor.ts:2090`) และ Shift=constrain
(`2163/2288/2295`) เท่านั้น ต้องการให้ครบและ "คาดเดาได้" เหมือน Photoshop:
- **Shift หลังจุดแรก** = ลากเส้นตรงจากจุดที่วาดล่าสุด (pen/eraser) — ตอนนี้ไม่มี
- **Alt ค้าง** = สลับเป็น eyedropper ชั่วคราวทุก paint tool แล้ว **คืนเครื่องมือเดิมเมื่อปล่อย**
  (ต้องแน่ใจว่า cursor เปลี่ยนตามด้วย, ดู `[data-tool=...]` cursor ใน `src/index.css:795+`)
- **Space ค้าง** = pan ชั่วคราว (ผูกกับ Phase 1.2)
- **ปุ่มเมาส์ขวา** = วาดด้วยสีรอง / ลบ (ตั้งค่าได้) และต้อง `preventDefault` context menu บน canvas
- **Ctrl/Cmd+ลาก** ระหว่าง select = duplicate selection แบบ float
- **Shift ตอนคลิก fill/magic wand** = เพิ่มเข้า selection เดิม (ของ magic wand มีแล้วที่ `2125` —
  ให้ tool อื่นสอดคล้องกัน)
- **[ / ]** = ลด/เพิ่ม brush size, ตัวเลข 1-9 = สลับ tool, X = สลับสีหน้า/หลัง
- แก้อาการ "เส้นขาด" ตอนลากเร็ว: ต้องมีการ interpolate ระหว่างสอง pointer event ทุก paint tool
  (ตรวจว่า pen/eraser/spray ทำครบ) และรองรับ `pointerrawupdate`/coalesced events ถ้าคุ้ม
- ทุกอย่างข้างบนต้องเป็น **หนึ่ง undo entry ต่อหนึ่ง stroke** ไม่ใช่ต่อ pixel

เขียนสรุป shortcut ทั้งหมดลง `LEARNING.md` หรือ tooltip ให้ผู้ใช้เห็นด้วย

---

## Phase 4 — Layout

ปัญหา: control กระจัดกระจาย (`CanvasStatusBar.tsx` 404 บรรทัดยัดทุกอย่างไว้แถวเดียว),
onion/transform/layers เบียดกันในคอลัมน์ขวา, ไม่รู้ว่าอะไรเป็น setting ของ tool ที่เลือกอยู่
ต้องการ:
- **แถบ tool options ใต้ toolbar บนสุด** ที่เปลี่ยนตาม tool ที่เลือก (แบบ Photoshop) — size, dither,
  symmetry, shape fill mode ควรอยู่ตรงนี้ ไม่ใช่ปนกับ zoom/grid ใน status bar
- **status bar ล่างสุด** เหลือแค่ zoom, ขนาด canvas, พิกัด cursor, ขนาด selection
- คอลัมน์ขวาแบ่งเป็น section ที่ collapse ได้: Preview / Onion / Transform / Layers
- ต้องยังใช้ได้บนจอแคบ (ดู breakpoint ที่มีอยู่ใน `src/index.css`)

---

## ข้อกำหนดตอนส่งงาน

1. ทำทีละ Phase, `npm run build` ผ่านทุกครั้ง, ไม่มี TS error
2. อธิบายว่าแต่ละบั๊กเกิดจากอะไร (ชื่อไฟล์:บรรทัด) ก่อนแก้
3. อย่าแตะ `src/components/tank/` ถ้าไม่เกี่ยว
4. ถ้าเปลี่ยนรูปร่าง state ที่เซฟลง localStorage ต้องเพิ่ม migration ใน `src/lib/storage.ts`
   ให้ sprite เดิมของผู้ใช้ไม่หาย
5. เทสด้วย tank-ui-tester agent หลังจบแต่ละ Phase และแนบ screenshot
