# คู่มือเรียนรู้เพื่อพัฒนา Pixel Fish Tank ต่อ

เอกสารนี้มีไว้สำหรับ**คน** ไม่ใช่ Claude — สรุปว่าถ้าอยากแก้/เพิ่มฟีเจอร์ในโปรเจกต์นี้เอง
ต้องรู้อะไรบ้าง และไฟล์ต่างๆ ทำหน้าที่อะไร

---

## 1. สิ่งที่ควรเรียนรู้ (เรียงตามลำดับที่ควรเรียน)

### 1.1 JavaScript/TypeScript พื้นฐาน
ถ้าแม่น JS อยู่แล้ว TypeScript ไม่ยาก — มันคือ JS ที่เพิ่ม "ชนิดข้อมูล" (type) เข้าไป
ช่วยจับบั๊กตอนเขียนโค้ดก่อนรันจริง สิ่งที่ต้องรู้ในโปรเจกต์นี้:
- `interface`/`type` — ดูตัวอย่างจริงได้ที่ [src/lib/types.ts](src/lib/types.ts)
- `?` (optional), `| null`, generic เบื้องต้น (`Array<T>`, `Record<K, V>`)
- ไม่ต้องรู้ลึกมาก แค่พอ "อ่าน error ของ TypeScript แล้วเข้าใจ" ก็เพียงพอ

อ่านเพิ่ม: [typescriptlang.org/docs](https://www.typescriptlang.org/docs/)

### 1.2 React พื้นฐาน (สำคัญที่สุด)
โปรเจกต์นี้เขียนด้วย React ทั้งหมด สิ่งที่ต้องเข้าใจ:
- **Component + JSX** — เขียน UI เป็นฟังก์ชันที่ return HTML-like syntax
- **Props** — การส่งข้อมูลจาก component แม่ไปลูก (เช่น `<ToolRail engine={engine} />`)
- **`useState`** — เก็บค่าที่เปลี่ยนแล้วต้อง render ใหม่
- **`useEffect`** — รันโค้ดตอน component mount/unmount หรือเมื่อค่าบางอย่างเปลี่ยน
- **`useRef`** — เก็บค่าที่ "อยู่ข้ามการ render" โดยไม่ทำให้ re-render (ใช้เยอะมากในโปรเจกต์นี้)
- **Custom hook** — ฟังก์ชันที่ขึ้นต้นด้วย `use...` รวม logic ไว้ใช้ซ้ำ (เช่น `usePixelEditor`, `useTank`)

อ่านเพิ่ม: [react.dev/learn](https://react.dev/learn) (official, มีตัวอย่างเล่นได้ในหน้าเว็บเลย)

### 1.3 รูปแบบเฉพาะของโปรเจกต์นี้: "Engine ใน useRef"
**นี่คือจุดที่ต่างจาก React ทั่วไปที่สุด และเป็นสิ่งที่ต้องเข้าใจก่อนแก้โค้ดส่วน editor/tank**

ปกติ React อยากให้ทุกอย่างเป็น "state" แต่การวาดภาพบน `<canvas>` ต้องอัปเดตเร็วมาก
(ทุกครั้งที่ขยับเมาส์ 60+ ครั้ง/วินาที) ถ้าใช้ `useState` ล้วนๆ จะทำให้ React
re-render ถี่เกินไปจนหน่วง

วิธีแก้ในโปรเจกต์นี้: สร้าง **class ธรรมดา** (`PixelEditorEngine` ใน
[src/hooks/usePixelEditor.ts](src/hooks/usePixelEditor.ts), `TankEngine` ใน
[src/hooks/useTank.ts](src/hooks/useTank.ts)) ที่เก็บ state และ logic ทั้งหมดไว้ในตัวเอง
แล้ว "แปะ" มันไว้ใน `useRef` — วาดภาพบน canvas ทำตรงๆ แบบเดิม (ไม่ผ่าน React)
ส่วน React จะแค่คอย "บอกให้ re-render" (`reactNotify()`) เฉพาะตอนที่มีอะไรต้องอัปเดตบน UI จริงๆ
(เช่น สลับเครื่องมือ, ปุ่ม undo enable/disable)

**สรุปกฎง่ายๆ:** ถ้าจะเพิ่ม field/method ใหม่ที่เกี่ยวกับการวาด → ใส่ใน engine class
ถ้าจะเพิ่ม UI ธรรมดาที่ไม่เกี่ยวกับ canvas → ใช้ `useState` ปกติได้เลย (ดูตัวอย่างใน
[src/components/editor/SpriteMetaForm.tsx](src/components/editor/SpriteMetaForm.tsx) ที่ใช้ `useState` ธรรมดาสำหรับช่องกรอกชื่อ)

### 1.4 Canvas 2D API
ทั้งหน้าวาดภาพและตู้ปลาวาดทุกอย่างด้วย `<canvas>` ไม่ใช่ HTML elements สิ่งที่ใช้บ่อย:
- `canvas.getContext('2d')` — เอา "ปากกา" มาวาด
- `ctx.fillStyle`, `ctx.fillRect(x, y, w, h)` — วาดสี่เหลี่ยมสี (ทุก pixel ในภาพวาดคือสี่เหลี่ยมเล็กๆ)
- `ctx.clearRect(...)` — ล้างพื้นที่
- `ctx.save()` / `ctx.translate()` / `ctx.scale(-1, 1)` / `ctx.restore()` — ใช้ตอนพลิกภาพปลาซ้าย-ขวา
- `requestAnimationFrame(callback)` — วนลูปวาดภาพใหม่ทุกเฟรม (ใช้ในตู้ปลาให้ปลาว่ายได้)

อ่านเพิ่ม: [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

### 1.5 Tailwind CSS
แทนที่จะเขียน CSS แยกไฟล์ ใช้ class สำเร็จรูปใส่ตรง `className` เช่น
`className="flex items-center gap-2"` (flex + จัดกึ่งกลางแนวตั้ง + ระยะห่าง 8px)
โปรเจกต์นี้ใช้ทั้ง Tailwind class (ใน component จาก shadcn) และ CSS ธรรมดา
(ใน [src/index.css](src/index.css) สำหรับ layout เฉพาะของแอป)

อ่านเพิ่ม: [tailwindcss.com/docs](https://tailwindcss.com/docs) (ดูช่อง search แล้วพิมพ์ class ที่เจอในโค้ด จะเจอคำอธิบาย)

### 1.6 shadcn/ui + Radix UI
ปุ่ม, select, checkbox ในโปรเจกต์นี้ไม่ได้เขียนเอง แต่ดึงมาจาก 8bitcn (สร้างบน shadcn/ui
ซึ่งสร้างบน Radix UI อีกที) สิ่งที่ต้องรู้:
- component พวกนี้ถูก "copy" โค้ดมาไว้ในโปรเจกต์จริงๆ (ดูได้ที่ `src/components/ui/`) ไม่ใช่ npm package ที่มองไม่เห็นโค้ด — **แก้ไขได้เลยถ้าต้องการ**
- `Select` ไม่ใช่ `<select>` ปกติของ HTML แต่เป็น component ประกอบ (`Select` + `SelectTrigger` + `SelectContent` + `SelectItem`) — ใช้ `onValueChange` แทน `onChange`
- `Checkbox` ใช้ `checked` + `onCheckedChange` แทน `onChange`

อ่านเพิ่ม: [ui.shadcn.com/docs](https://ui.shadcn.com/docs), [8bitcn.com/docs](https://www.8bitcn.com/docs)

### 1.7 Vite
เครื่องมือ build ที่ทำให้ `npm run dev` ขึ้น dev server เร็วๆ และ `npm run build`
รวมไฟล์ทั้งหมดเป็นเว็บที่ deploy ได้ ไม่ต้องรู้ลึก แค่รู้จักคำสั่งหลักๆ ใน
[package.json](package.json) ก็พอ

### 1.8 Git/GitHub เบื้องต้น
`git add`, `git commit`, `git push`, `git status`, `git log` — โปรเจกต์นี้ push ไว้ที่
`https://github.com/Pannatorn01/FishTank_react.git` แล้ว

### 1.9 localStorage
ที่เก็บข้อมูลปลา/ตู้ปลาไว้ในเบราว์เซอร์ ไม่มี server/database จริง ดูโค้ดอ่าน-เขียนได้ที่
[src/lib/storage.ts](src/lib/storage.ts) — `localStorage.setItem(key, JSON.stringify(data))`
และ `JSON.parse(localStorage.getItem(key))`

### 1.10 Pointer Events API
`onPointerDown` / `onPointerMove` / `onPointerUp` — ใช้แทน `onMouseDown`/`onTouchStart`
แยกกัน เพราะ Pointer Events รองรับทั้งเมาส์และนิ้วสัมผัสด้วย event ชุดเดียว
(สำคัญมากเพราะแอปนี้ต้องเล่นได้ทั้งคอมและมือถือ)

---

## 2. โครงสร้างโฟลเดอร์

```
FishTank-react/
├── .claude/skills/run/SKILL.md   วิธีรันโปรเจกต์ (สำหรับ Claude Code)
├── LEARNING.md                    ไฟล์นี้
├── README.md                      ภาพรวมโปรเจกต์แบบสั้น
├── package.json                   รายชื่อ dependency + คำสั่ง npm run dev/build/preview
├── vite.config.ts                 ตั้งค่า Vite: path alias "@/" -> "src/", ปลั๊กอิน Tailwind
├── tsconfig*.json                 ตั้งค่า TypeScript
├── components.json                บอก shadcn CLI ว่าดึง component จากไหน (รวม registry ของ 8bitcn)
│
├── public/                        ไฟล์ static ที่ copy ตรงๆ ไม่ผ่าน build (เช่น favicon.svg)
│
└── src/
    ├── main.tsx                   จุดเริ่มต้นจริง: เอา <App /> ไปแปะที่ <div id="root">
    ├── App.tsx                    component บนสุด: สลับแท็บ "วาดปลา" / "ตู้ปลา"
    ├── index.css                  Tailwind + ตัวแปรสี (theme) + CSS ของแอปเอง (layout, canvas)
    │
    ├── lib/                       โค้ดล้วนๆ ไม่เกี่ยวกับ UI (ทดสอบง่าย, เอาไปใช้ที่ไหนก็ได้)
    │   ├── types.ts                 นิยาม TypeScript type ทั้งหมด (Sprite, Frame, Instance, ...)
    │   ├── storage.ts                อ่าน/เขียน localStorage + สร้างปลา/สาหร่ายตัวอย่างตอนเปิดครั้งแรก
    │   ├── pixelMath.ts               ฟังก์ชันคำนวณล้วนๆ: วาดเส้นตรง (Bresenham), ทดสอบจุดในวงรี,
    │   │                               พลิกภาพ, หมุนภาพ, ระบายสีเฟรมลง canvas
    │   └── utils.ts                   helper เล็กๆ ของ shadcn (ฟังก์ชัน `cn` รวม className)
    │
    ├── hooks/                     "สมอง" ของแอป — state + logic ทั้งหมด อยู่ตรงนี้
    │   ├── usePixelEditor.ts        ทุกอย่างเกี่ยวกับหน้าวาดภาพ: เครื่องมือ 9 แบบ, undo/redo,
    │   │                             สมมาตร, พลิก/หมุน, ซูม, export PNG, บันทึกลงคลัง
    │   └── useTank.ts                ทุกอย่างเกี่ยวกับตู้ปลา: instance ของปลา/ของตกแต่ง,
    │                                  animation loop, ลาก-วาง, ชนขอบ
    │
    └── components/                UI ล้วนๆ — เรียกใช้ engine จาก hooks/ ข้างบน
        ├── editor/                  ส่วนประกอบของหน้าวาดภาพ (1 ไฟล์ = 1 ชิ้นส่วน UI)
        │   ├── PixelEditorPanel.tsx   ประกอบทุกชิ้นเข้าด้วยกัน + เรียก usePixelEditor()
        │   ├── PixelCanvas.tsx         ตัว <canvas> จริงๆ ที่วาดภาพ
        │   ├── ToolRail.tsx            แถบไอคอนเครื่องมือ 2 คอลัมน์
        │   ├── CanvasStatusBar.tsx     แถบซูม/ขนาดกริด/เส้นกริด/สมมาตร
        │   ├── FrameStrip.tsx          แถวเฟรม (thumbnail 1-3 เฟรม) + ปุ่มเพิ่ม/ลบ/คัดลอก
        │   ├── PreviewPanel.tsx        กรอบพรีวิวแอนิเมชันวนลูป
        │   ├── ColorPalette.tsx        พาเลตสี + สีกำหนดเอง
        │   ├── TransformPanel.tsx      ปุ่มพลิก/หมุน
        │   ├── SpriteMetaForm.tsx      ช่องชื่อ/ประเภท/ปุ่มบันทึก/export
        │   └── SpriteLibrary.tsx       คลังปลาที่บันทึกไว้ทั้งหมด
        │
        ├── tank/                    ส่วนประกอบของตู้ปลา
        │   ├── TankPanel.tsx           ประกอบ canvas + palette เข้าด้วยกัน + เรียก useTank()
        │   ├── TankCanvas.tsx           ตัว <canvas> ของตู้ปลา + ปุ่มถังขยะ/ลบ
        │   └── TankPalette.tsx          รายการปลา/ของตกแต่งให้ลากลงตู้
        │
        └── ui/                       component ที่ดึงมาจาก shadcn/8bitcn (แก้ได้ แต่ปกติไม่ต้องแตะ)
            ├── button.tsx, select.tsx, checkbox.tsx, ...   เวอร์ชันมาตรฐานของ shadcn
            └── 8bit/                                        เวอร์ชัน "retro" ที่แอปนี้ใช้จริง
                ├── button.tsx, select.tsx, ...                 ห่อเวอร์ชันมาตรฐานอีกที + เพิ่มลาย pixel
                └── styles/retro.css                            โหลดฟอนต์ Press Start 2P
```

### หลักการ: อ่านโค้ดจากไหนก่อน?
ถ้าอยากเข้าใจแอปนี้เร็วที่สุด แนะนำอ่านตามลำดับนี้:
1. `src/App.tsx` — เห็นภาพรวมว่ามี 2 แท็บ
2. `src/hooks/usePixelEditor.ts` — ไฟล์ใหญ่สุดแต่สำคัญสุด อ่านช้าๆ ทีละ method
3. `src/components/editor/PixelEditorPanel.tsx` — ดูว่า UI เรียกใช้ engine ยังไง
4. ไล่ดู component ย่อยใน `src/components/editor/` ทีละไฟล์ (ไฟล์เล็ก อ่านง่าย)
5. ทำแบบเดียวกันกับฝั่ง `useTank.ts` + `src/components/tank/`

---

## 3. อยากลองแก้/เพิ่มฟีเจอร์ — เริ่มตรงไหน?

**เพิ่มเครื่องมือวาดใหม่ (เช่น "spray brush"):**
1. เพิ่มชื่อเครื่องมือใน `ToolName` ที่ [src/lib/types.ts](src/lib/types.ts)
2. เพิ่ม logic ตอนกดวาดใน `onPointerDown`/`onPointerMove` ของ `usePixelEditor.ts`
3. เพิ่มปุ่มไอคอนใน [src/components/editor/ToolRail.tsx](src/components/editor/ToolRail.tsx)

**เพิ่มสีในพาเลต:** แก้ array `COLORS` บนสุดของ `usePixelEditor.ts` ไฟล์เดียวจบ

**เพิ่มพฤติกรรมใหม่ให้ปลาในตู้ (เช่น ปลาไล่กันเล่น):** แก้ method `update()` (private)
ใน `useTank.ts` — ตรงนี้คำนวณตำแหน่งปลาทุกเฟรม

**เปลี่ยนสไตล์หน้าตา:** ปุ่ม/select ส่วนใหญ่มาจาก `src/components/ui/8bit/` แก้ตรงนั้นได้เลย
(เป็นโค้ดจริงในโปรเจกต์ ไม่ใช่ library ภายนอก) ส่วน layout/สีพื้นหลัง แก้ที่ `src/index.css`

---

## 4. ลำดับการเรียนที่แนะนำถ้าเริ่มจากศูนย์

1. HTML/CSS/JS พื้นฐาน (ถ้ายังไม่แม่น) — [freeCodeCamp](https://www.freecodecamp.org/) หรือ MDN
2. React official tutorial — [react.dev/learn](https://react.dev/learn) ทำตามจนจบ "Tic-Tac-Toe" ในหน้านั้น
3. TypeScript เบื้องต้น — [typescriptlang.org/docs/handbook/2/basic-types.html](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)
4. กลับมาอ่านโค้ดโปรเจกต์นี้ตามลำดับในหัวข้อ 2 ด้านบน
5. ลองแก้อะไรเล็กๆ ตามหัวข้อ 3 แล้วรัน `npm run dev` ดูผลจริง
