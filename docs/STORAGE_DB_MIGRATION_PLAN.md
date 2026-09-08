# แผนย้ายชั้นเก็บข้อมูล: localStorage → Storage Adapter → Database

> Created: 2026-09-08 · Updated: 2026-09-08 · Status: **P0–P4 เสร็จ · P5 เขียนโค้ดครบแล้วแต่ยังไม่ได้ทดสอบกับ Supabase จริง (P5-5) · P6 (auth) เป็นงานถัดไป** · ข้อตัดสินใจหลักล็อกครบแล้ว (§0)
> ที่มา: audit โค้ดจริง ไม่ใช่การเดา
> ทุกข้ออ้างอิง `ไฟล์:บรรทัด` ณ commit `86efa06` — ถ้าบรรทัดเลื่อน ให้ grep ชื่อฟังก์ชันที่ระบุไว้แทน
>
> เกี่ยวข้องกับ: [`EDITOR_IMPROVEMENTS.md`](./EDITOR_IMPROVEMENTS.md) (ข้อ 2 — validate ตอนโหลด),
> [`PIXI_MIGRATION_PLAN.md`](./PIXI_MIGRATION_PLAN.md) §9 (lifecycle ปลา),
> [`USETANK_TEST_AUDIT.md`](./USETANK_TEST_AUDIT.md) (วิธี stub localStorage ในเทสต์)

---

## 0. TL;DR — อ่าน 1 นาที

ตอนนี้ข้อมูลทั้งหมดอยู่ใน `localStorage` ผ่าน [`src/lib/storage.ts`](../src/lib/storage.ts) ซึ่ง **ยังทำงานได้**
แต่มี 3 กำแพงที่จะชนแน่นอน:

1. **โควตา ~5MB** — pixel เก็บเป็น hex string ต่อ 1 ช่อง งานใหญ่ไม่กี่ชิ้นก็เต็ม และตอนเต็มแอปจะพัง/เซฟเงียบ
2. **API เป็น synchronous ทั้งหมด** — `loadSprites(): Sprite[]` ถูกเรียกใน constructor ของ engine
   ส่วน DB/HTTP เป็น async ทั้งหมด → **นี่คือค่าใช้จ่ายหลักของการย้าย ไม่ใช่ตัว SQL**
3. **record ไม่มี `updatedAt` / `userId` / tombstone** → sync กับ server และแก้ conflict ไม่ได้เลย

**ลำดับงานที่แนะนำ (ทำตามลำดับ ห้ามข้าม):**

| เฟส | ชื่อ | ทำไมต้องมาก่อน | ขนาดงาน |
|-----|------|----------------|---------|
| P0 | อุดรูรั่ว quota / error ที่มีอยู่ | กันข้อมูลผู้ใช้หายระหว่างทาง | S |
| P1 | เพิ่ม metadata (`id`, `updatedAt`, `deletedAt`, `rev`) | ยิ่งเพิ่มช้า ยิ่ง backfill แพง | S |
| P2 | บีบ pixel (RLE) | ซื้อเวลาให้ localStorage อีกหลายเท่า | M |
| P3 | `StorageAdapter` แบบ async + repository | เปลี่ยน call chain ทั้งแอปครั้งเดียว | **L (ใหญ่สุด)** |
| P4 | เปลี่ยน backend เป็น IndexedDB | ทดสอบ async จริง + ปลดล็อกโควตาระดับ GB | M |
| P5 | Supabase + sync (offline-first) | ถึงจะแตะ database จริง | L |
| P6 | auth (guest mode) + แชร์ตู้ + ย้ายข้อมูลผู้ใช้เดิม | ปิดงาน | M |

> P0–P2 ทำได้ทันทีและมีประโยชน์แม้ไม่เคยต่อ DB เลย · P3 คือจุดที่ "ต้องตัดสินใจแล้วทำให้จบ"

### ข้อตัดสินใจที่ล็อกแล้ว (เจ้าของโปรเจกต์ยืนยัน 2026-09-08)

| หัวข้อ | ที่เลือก | ผลต่อแผน |
|--------|---------|----------|
| Backend | **Supabase** (Postgres + Auth + Storage + RLS) | ไม่ต้องเขียน API server เอง · RLS เป็นด่านความปลอดภัยหลัก · §5 เขียนเป็น SQL ของ Supabase ตรง ๆ |
| โหมดทำงาน | **Offline-first + sync** | P4 (IndexedDB) **บังคับทำ ห้ามข้าม** · ต้องมี outbox + delta sync + merge (§4 P5) |
| ขอบเขตผู้ใช้ | **หลายคน แชร์/ดูตู้กันได้** | schema ต้องมี `visibility` + ตาราง `tank_shares` + policy สำหรับผู้ชม (read-only) ตั้งแต่แรก |
| Guest mode | **ต้องเล่นได้โดยไม่ต้องสมัคร** | local เป็นแหล่งความจริงเริ่มต้นเสมอ · ล็อกอินคือการ "อัปเกรด" ไม่ใช่เงื่อนไขเริ่มใช้ (§4 P6) |
| ผู้ใช้จริงตอนนี้ | **ยังไม่มี (มีแค่เจ้าของโปรเจกต์)** | **breaking change ทำได้** — ไม่ต้องแบก backward compat ทุกเฟส · ยังต้องมี migration เพราะข้อมูลของเจ้าของเองมีอยู่จริง แต่ถ้าจำเป็นจริง ๆ "backup แล้ว reset" เป็นทางออกที่ยอมรับได้ |
| จำนวนตู้ต่อผู้ใช้ | **หลายตู้ สลับไปมาได้** | ตาราง `tanks` จำเป็นแน่นอน · `TankEngine` ต้องรับ `tankId` เป็นพารามิเตอร์ · ต้องมี UI เลือก/สร้าง/ลบตู้ (งานเพิ่มใน P4–P5) |
| การแชร์ sprite | **มี gallery ของ sprite แยกจากตู้ + fork ได้** | `sprites` ต้องมี `visibility` / `forked_from` / `hidden_by_admin` ตั้งแต่ schema แรก · ต้องมี moderation จริงจังก่อนเปิด public |

> ผลลัพธ์ที่ตามมาโดยตรง: **ห้ามใช้ Supabase client อ่าน/เขียนตรงจาก component เด็ดขาด**
> ทุกอย่างต้องผ่าน repository (§3) ไม่งั้น offline-first จะพังทันทีที่เน็ตหลุด

**ความคืบหน้า: P0–P4 เสร็จ · P5 เขียนครบแล้ว** (ดู checklist §7) · ทดสอบในเบราว์เซอร์จริงด้วย
[`scripts/storage-smoke.cjs`](../scripts/storage-smoke.cjs) — **25/25 ผ่าน** (รันคู่กับ `npm run dev`)

> ⚠️ **สิ่งที่ยังไม่ได้พิสูจน์:** โค้ด sync ทั้งหมดยังไม่เคยคุยกับ Supabase จริงสักครั้ง (ยังไม่มีโปรเจกต์/credential)
> · logic ที่ทดสอบได้แบบ pure — merge, outbox, การ map record↔row — มี unit test 13 เคสครบ
> · **ขั้นตอนถัดไปฝั่งคุณ:** สร้างโปรเจกต์ Supabase → รัน `supabase/schema.sql` → ใส่ค่าใน `.env` → แล้วค่อยไล่ P5-5 · งานถัดไปคือ **P3 — เฟสที่ใหญ่และเสี่ยงที่สุด**

---

## 1. สภาพปัจจุบัน (แผนที่ข้อมูล)

### 1.1 key ทั้งหมดที่แอปเป็นเจ้าของ

ประกาศไว้ที่ [`storage.ts:17-43`](../src/lib/storage.ts#L17-L43) และ [`storage.ts:374-375`](../src/lib/storage.ts#L374-L375) — 18 key:

| key | ชนิดข้อมูล | ประเภท | ปลายทางใน DB (ดู §5) |
|-----|-----------|--------|----------------------|
| `fishtank.sprites.v1` | `Sprite[]` (ก้อนใหญ่สุด) | เนื้องาน | ตาราง `sprites` |
| `fishtank.instances.v1` | `Instance[]` | เนื้องาน | ตาราง `tank_instances` |
| `fishtank.groups.v1` | `TankGroup[]` | เนื้องาน | ตาราง `tank_groups` |
| `fishtank.roomInstances.v1` | `RoomInstance[]` | เนื้องาน | ตาราง `room_instances` |
| `fishtank.tankSize.v1` | `{width,height}` | ตั้งค่าตู้ | `tank_settings` (jsonb) |
| `fishtank.tankShape.v1` | `TankShape` | ตั้งค่าตู้ | `tank_settings` |
| `fishtank.tankCornerRadiusFrac.v1` | `number` | ตั้งค่าตู้ | `tank_settings` |
| `fishtank.tankOvalTopCutFrac.v1` | `number` | ตั้งค่าตู้ | `tank_settings` |
| `fishtank.tankBackgroundSpriteId.v1` | `string \| null` | ตั้งค่าตู้ | `tank_settings` (อ้าง sprites) |
| `fishtank.tankBackgroundTransform.v2` | `BackgroundTransform` | ตั้งค่าตู้ | `tank_settings` |
| `fishtank.tankLastTick.v1` | `number` (epoch ms) | สถานะ runtime | `tank_settings` |
| `fishtank.savedColors.v1` | `string[]` | preference | `user_prefs` |
| `fishtank.pinnedColors.v1` | `string[]` | preference | `user_prefs` |
| `fishtank.paletteColors.v1` | `string[]` | preference | `user_prefs` |
| `fishtank.brushSizes.v1` | `Record<string,number>` | preference | `user_prefs` |
| `fishtank.canvasBackground.v1` | `CanvasBackground` | preference | **คงไว้ที่เครื่อง** |
| `fishtank.uiTheme.v1` | `UiTheme` | preference | **คงไว้ที่เครื่อง** |
| `fishtank.onionSkin.v1` | `OnionSettings` | preference | `user_prefs` |

**อีก 3 key ที่เขียน localStorage ตรง ๆ ไม่ผ่าน storage.ts** (สำคัญ — ดูปัญหา P0-4):

| key | ที่มา |
|-----|------|
| `fishtank.editorLayout.v1` | [`useEditorLayout.ts:132`](../src/hooks/useEditorLayout.ts#L132) · อ่าน [:243](../src/hooks/useEditorLayout.ts#L243) · เขียน [:253](../src/hooks/useEditorLayout.ts#L253) |
| `fishtank.uiScale.v1` | [`useUiScale.ts:22`](../src/hooks/useUiScale.ts#L22) · อ่าน [:26](../src/hooks/useUiScale.ts#L26) · เขียน [:44](../src/hooks/useUiScale.ts#L44) |
| `fishtank.sidePanel.collapsed.<id>` | [`EditorDock.tsx:13`](../src/components/editor/EditorDock.tsx#L13) · [:17](../src/components/editor/EditorDock.tsx#L17) · [:67](../src/components/editor/EditorDock.tsx#L67) — **หลาย key ตาม id ของ panel** |

### 1.2 ใครอ่าน / ใครเขียน

**อ่าน (ทั้งหมดเป็น sync และอยู่ใน constructor):**
- `PixelEditorEngine` ctor — [`usePixelEditor.ts:452-471`](../src/hooks/usePixelEditor.ts#L452-L471)
- `TankEngine` ctor — [`useTank.ts:286-313`](../src/hooks/useTank.ts#L286-L313)
- `TankEngine.refresh()` — [`useTank.ts:803-821`](../src/hooks/useTank.ts#L803-L821) (โหลดซ้ำทับ state ในหน่วยความจำ)
- `TankEngine` โหลด sprite ซ้ำเมื่อได้ event — [`useTank.ts:629`](../src/hooks/useTank.ts#L629), [:650](../src/hooks/useTank.ts#L650)

**เขียน:**
- editor `saveSprite()` — [`usePixelEditor.ts:3806-3812`](../src/hooks/usePixelEditor.ts#L3806-L3812) และ
  `deleteSprite()` — [:3846-3852](../src/hooks/usePixelEditor.ts#L3846-L3852) → **มี try/catch + rollback + แจ้ง error แล้ว (ของดี รักษาไว้)**
- editor เขียน default sprites ตอน init — [`usePixelEditor.ts:452-455`](../src/hooks/usePixelEditor.ts#L452-L455) → **ไม่มี try/catch**
- tank `save()` — [`useTank.ts:776-790`](../src/hooks/useTank.ts#L776-L790) เขียน 10 key รวด, catch แล้ว `console.warn` เฉย ๆ

**การสื่อสารข้ามแผง:** DOM event `'ft:sprites-updated'` — dispatch ที่
[`usePixelEditor.ts:3816`](../src/hooks/usePixelEditor.ts#L3816) · ฟังที่ `LifePanel.tsx:31`, `TankSection.tsx:30`,
`TankPixiLayer.tsx:42` แล้ว **ไปโหลดใหม่จาก localStorage แบบ sync** — pattern นี้จะพังเมื่อการอ่านกลายเป็น async (ดู §4 P3 ข้อ 3)

### 1.3 โมเดลการเซฟ (คงไว้ ไม่ต้องเปลี่ยน)

- **editor = auto-save** — เซฟทันทีที่กด Save sprite
- **tank = manual save** — `persist()` แค่ mark `dirty` ([`useTank.ts:766-769`](../src/hooks/useTank.ts#L766-L769))
  ไม่แตะ localStorage จนกว่าผู้ใช้จะกดปุ่ม Save เอง
  → **โมเดลนี้เหมาะกับ DB มาก (batch write ที่ขอบเขตชัดเจน) ห้ามเปลี่ยนเป็น auto-save ตอนย้าย**

---

## 2. ปัญหาที่ต้องแก้ (จัดลำดับตามความเสี่ยง)

### P0-1 · `setItem` ทุกจุดไม่มี try/catch ในตัวมันเอง
**ไฟล์:** ทุก `save*()` ใน [`storage.ts`](../src/lib/storage.ts) เช่น [:149-151](../src/lib/storage.ts#L149-L151),
[:196-198](../src/lib/storage.ts#L196-L198) — ตรงข้ามกับฝั่ง `load*()` ที่มี try/catch ครบทุกตัว
**ผล:** `QuotaExceededError` ทะลุขึ้นไปหา caller — รอดอยู่ทุกวันนี้เพราะ call site 2 จุดดักไว้ แต่จุดอื่นไม่ดัก

### P0-2 · เขียน default sprites ตอน init ไม่ถูกดัก → แอปพังตั้งแต่เปิด
**ไฟล์:** [`usePixelEditor.ts:452-455`](../src/hooks/usePixelEditor.ts#L452-L455)
ถ้าโควตาเต็มอยู่แล้ว (หรือ Safari private mode ที่ `setItem` throw เสมอ) constructor จะ throw → ErrorBoundary ขึ้นเต็มจอ
**แก้:** ครอบ try/catch — เขียนไม่ได้ก็ให้ใช้ default sprites ในหน่วยความจำต่อไป + แสดง banner "โหมดอ่านอย่างเดียว"

### P0-3 · `TankEngine.save()` ล้มเหลวแบบเงียบ
**ไฟล์:** [`useTank.ts:776-790`](../src/hooks/useTank.ts#L776-L790) — `catch { console.warn(...) }`
`this.dirty = false` อยู่ใน try จึงยังค้างเป็น `true` (ถูกแล้ว) แต่ **ผู้ใช้ไม่เห็นอะไรเลย** เข้าใจว่าเซฟผ่าน
**แก้:** ให้ `save()` คืน `{ ok: boolean; error?: unknown }` แล้ว caller โชว์ toast (i18n key `error.saveFailed` มีอยู่แล้ว)

### P0-4 · `ALL_STORAGE_KEYS` ตกไป 3 key → backup / reset ไม่ครบ
**ไฟล์:** [`storage.ts:690-709`](../src/lib/storage.ts#L690-L709) ไม่มี `editorLayout` / `uiScale` / `sidePanel.collapsed.*`
**ผล:** `downloadDataBackup()` ([:718](../src/lib/storage.ts#L718)) ได้ไฟล์ไม่ครบ และ `resetAllData()` ([:741](../src/lib/storage.ts#L741))
ล้างไม่หมด — layout ที่พังจะค้างอยู่แม้ผู้ใช้กด "รีเซ็ตข้อมูล" แล้ว
**แก้:** ย้าย 3 key มาประกาศใน storage.ts + ให้ `resetAllData()` กวาด prefix `fishtank.sidePanel.collapsed.` ด้วยการวน `Object.keys(localStorage)`

### P1-1 · record ไม่มี metadata สำหรับ sync
`Sprite.id` เป็น `string | null` ([`types.ts:35`](../src/lib/types.ts#L35)) และไม่มี `updatedAt` / `deletedAt` / `rev` เลย
การลบ sprite = หายออกจาก array ([`usePixelEditor.ts:3844`](../src/hooks/usePixelEditor.ts#L3844))
→ server ไม่มีทางแยกได้ว่า "ถูกลบ" หรือ "เครื่องนี้ยังไม่ sync"

### P1-2 · pixel format กินที่มหาศาล
`Frame = CellColor[]` ([`types.ts:2`](../src/lib/types.ts#L2), ใช้ที่ `Layer.cells` [`types.ts:31`](../src/lib/types.ts#L31))
— 1 ช่อง = `"#aabbcc",` (10 ตัวอักษร) หรือ `null,` (5)
sprite 64×64 · 8 เฟรม · 2 เลเยอร์ = 65,536 ช่อง ≈ **400–600KB ต่อชิ้น** ·
พื้นหลัง 1400×900 (ขนาดที่อ้างถึงใน `EDITOR_IMPROVEMENTS.md` ข้อ 3) = 1.26M ช่อง/เลเยอร์ → **เกิน 5MB ด้วยชิ้นเดียว**

### P1-3 · เขียนทั้ง array ทุกครั้ง
`saveSprites(this.sprites)` stringify sprite ทุกตัวใหม่หมดแม้แก้ตัวเดียว — เป็น sync บน main thread ยิ่งข้อมูลเยอะยิ่งกระตุก

### P2-1 · API เป็น sync และฝังอยู่ใน constructor
engine ถูกสร้างใน `useRef` ([`usePixelEditor.ts:3877-3880`](../src/hooks/usePixelEditor.ts#L3877-L3880),
[`useTank.ts:2297-2300`](../src/hooks/useTank.ts#L2297-L2300)) และ constructor อ่านข้อมูลเอง
→ การย้ายไป async ต้องเพิ่ม "สถานะกำลังโหลด" ให้ทั้งแอป

### P2-2 · ไม่มี schema version รวม
เวอร์ชันอยู่ที่ชื่อ key (`.v1` / `.v2`) → migration ต้องเขียนแยกทีละ key และไม่มีที่ไหนบอกว่า "ข้อมูลชุดนี้เป็นเวอร์ชันอะไร"

---

## 3. สถาปัตยกรรมปลายทาง

```
components / hooks (React)
        │  เรียกผ่าน repository เท่านั้น — ห้ามแตะ localStorage ตรง ๆ
        ▼
src/lib/data/repository.ts     SpriteRepo / TankRepo / PrefsRepo   (async ทั้งหมด + cache ในหน่วยความจำ)
        │
        ▼
src/lib/data/adapter.ts        interface StorageAdapter
        ├── LocalStorageAdapter   (P3 — ห่อ storage.ts เดิม ไม่เปลี่ยนพฤติกรรม)
        ├── IndexedDbAdapter      (P4 — ปลดล็อกโควตา เขียนทีละ record)
        └── RemoteAdapter         (P5 — HTTP + outbox + sync)
```

หลักการที่ห้ามละเมิด:
1. **โค้ด UI ไม่รู้จัก backend** — เปลี่ยน backend = สลับ adapter ที่จุดเดียว (`src/lib/data/index.ts`)
2. **adapter เป็น async ตั้งแต่วันแรก** แม้ implementation แรกจะ sync ข้างใน (`Promise.resolve`)
3. **normalize / validate อยู่ที่ repository** ไม่ใช่ adapter — `normalizeSprite()` / `isValidSprite()` เดิมย้ายมาอยู่ตรงนี้
4. **format ที่เก็บ (wire format) ≠ format ในหน่วยความจำ** — engine ต้องเห็น `Frame` เป็น array เหมือนเดิมเสมอ

---

## 4. แผนรายเฟส

### P0 — อุดรูรั่ว (ทำได้ทันที ไม่กระทบสถาปัตยกรรม)

**งาน**

1. เพิ่ม helper ใน storage.ts แล้วให้ทุก `save*()` เรียกผ่านมัน:
   ```ts
   class StorageQuotaError extends Error { constructor(public key: string, public size: number) { super('quota'); } }

   function writeKey(key: string, value: string): void {
     try {
       localStorage.setItem(key, value);
     } catch (e) {
       if (isQuotaError(e)) throw new StorageQuotaError(key, value.length);
       throw e;
     }
   }
   ```
   (ยัง throw ต่อเหมือนเดิม แต่เป็น error ที่แยกแยะได้ — caller จะบอกผู้ใช้ว่า "พื้นที่เต็ม" ต่างจาก error ทั่วไป)
2. ครอบ try/catch ที่ [`usePixelEditor.ts:455`](../src/hooks/usePixelEditor.ts#L455) + โหมดอ่านอย่างเดียว (P0-2)
3. `TankEngine.save()` คืนผลลัพธ์ + toast (P0-3)
4. เติม 3 key ที่ตกหล่นเข้า `ALL_STORAGE_KEYS` + กวาด prefix ตอน reset (P0-4)
5. เพิ่ม `estimateUsage(): { bytes: number; percent: number }` (วน `ALL_STORAGE_KEYS` บวกความยาว string)
   แล้วเตือนใน UI เมื่อเกิน ~70%

**เสร็จเมื่อ:** เทสต์ใหม่ใน [`src/lib/__tests__/storage.test.ts`](../src/lib/__tests__/storage.test.ts) ที่ stub
`localStorage.setItem` ให้ throw `QuotaExceededError` แล้วยืนยันว่า (ก) แอปยังเปิดได้ (ข) error ถึง caller ไม่ใช่เงียบหาย

---

### P1 — เพิ่ม metadata ลง record (ทำก่อนข้อมูลผู้ใช้จะเยอะ)

**เปลี่ยน type** ใน [`types.ts`](../src/lib/types.ts):
```ts
export interface RecordMeta {
  /** epoch ms — เขียนใหม่ทุกครั้งที่ record ถูกแก้ ใช้ตัดสิน last-write-wins ตอน sync */
  updatedAt: number;
  /** epoch ms ตอนถูกลบ (tombstone) — 0 = ยังไม่ถูกลบ · ห้ามลบแถวทิ้งเฉย ๆ อีกต่อไป */
  deletedAt: number;
  /** revision ที่ server เป็นคนเพิ่ม — ฝั่ง client เป็น 0 จนกว่าจะ sync สำเร็จ */
  rev: number;
}
export interface Sprite extends RecordMeta { id: string; /* ...เดิม... */ }
```

**กับดักที่ต้องระวัง:** `Sprite.id` ทุกวันนี้เป็น `null` ระหว่างที่ยังไม่เคยเซฟ และโค้ดหลายจุดใช้
`if (this.current.id)` เป็นตัวบอกว่า "เคยเซฟหรือยัง" ([`usePixelEditor.ts:3798-3803`](../src/hooks/usePixelEditor.ts#L3798-L3803))
→ เปลี่ยนเป็นออก id ตั้งแต่ `blankSprite()` แล้วใช้ธง `persisted: boolean` แทน
**ต้อง grep `current.id` ให้ครบทุกจุดก่อนแก้**

**migration:** ทำใน `normalizeSprite()` / `normalizeInstance()` แบบเดียวกับที่ทำอยู่แล้วกับ lifecycle fields
([`storage.ts:173-184`](../src/lib/storage.ts#L173-L184)) — record เก่าที่ไม่มี `updatedAt` ให้ตั้งเป็น `Date.now()` ตอนโหลด
และ **อย่าเขียนกลับทันที** ตามธรรมเนียมเดิมของไฟล์นี้ ("migrate on load, never write until the next real save")

**ขอบเขตที่ทำจริงในเฟสนี้ (อ่านก่อนทำ P5):**
- **sprite: tombstone ครบ** — ลบแล้วเหลือแถวที่ `deletedAt > 0` และ `frames: []`
- **instance / group / roomInstance: มี `RecordMeta` ครบ แต่ยังไม่มี tombstone** — เพราะตู้ถูกเขียนทั้งก้อน
  (array เดียว) การลบจึงหายไปกับการเขียนทับ ซึ่งไม่กำกวมตราบใดที่ยังอยู่เครื่องเดียว
  → **ตอนทำ P5 ต้องเพิ่ม tombstone ให้ record ของตู้ด้วย** ไม่งั้น server จะเอาปลาที่ลบแล้วกลับมา
- `updatedAt` ของ record ในตู้ถูกประทับพร้อมกันทั้งก้อนตอน `save()` (ไม่ใช่ต่อ record ที่แก้จริง)
  เพราะโมเดลเซฟเป็น manual/batch — ความละเอียดระดับ record จะมาพร้อมการเขียนทีละ record ใน P4/P5

**เสร็จเมื่อ:** ลบ sprite แล้วยังมีแถวอยู่ใน storage โดยมี `deletedAt > 0` และ UI ไม่แสดงมันแล้ว

---

### P2 — บีบ pixel (RLE)

**wire format ใหม่** — key เดิม แต่รูปร่างของ layer เปลี่ยน:
```ts
// ในหน่วยความจำ (ไม่เปลี่ยน):  cells: (string | null)[]
// บนดิสก์ (ใหม่):              { enc: 'rle1', palette: string[], runs: number[] }
//   runs = [count, paletteIndex, count, paletteIndex, ...]   ·   paletteIndex 0 = โปร่งใส (null)
```
- ทำ `encodeFrame(cells) → RleFrame` / `decodeFrame(rle) → Frame` ในไฟล์ใหม่ `src/lib/pixelCodec.ts` + unit test round-trip
- **อ่านได้ทั้งสองแบบ เขียนแบบใหม่อย่างเดียว** — `normalizeSprite()` เช็ค `Array.isArray(layer.cells)` (เก่า)
  vs `layer.cells.enc` (ใหม่) — pattern เดียวกับ `isLegacyFrame()` ที่มีอยู่แล้ว ([`storage.ts:87`](../src/lib/storage.ts#L87))
- `isValidSprite()` ([`storage.ts:114`](../src/lib/storage.ts#L114)) เช็ค `cells.length === cellCount` อยู่
  → ต้องแก้ให้เช็คหลัง decode ไม่ใช่ก่อน
- อัตราบีบที่คาดหวังกับ pixel art: **5–20 เท่า** (พื้นที่โปร่งใส/สีเดียวยาว ๆ บีบได้เยอะมาก)

**ผลจริงที่วัดได้ (2026-09-08 · JSON.stringify ก่อน/หลัง encode):**

| ข้อมูล | เดิม | หลังบีบ | อัตรา |
|--------|------|---------|-------|
| sprite ตัวอย่าง 2 ตัว (16×16, 2 เฟรม) | 7.3KB | 1.9KB | **3.9×** |
| ปลา 32×32 4 เฟรม (ลายกระจาย = worst case) | 24.5KB | 7.1KB | **3.5×** |
| พื้นหลัง 640×360 | 2,250KB | 36.7KB | **61×** |
| พื้นหลัง 1400×900 | 12,305KB | 200KB | **61×** |

→ พื้นหลัง 1400×900 ที่เมื่อก่อน **เกินโควตา 5MB ด้วยตัวเดียว** ตอนนี้เหลือ 200KB (เก็บได้ ~25 ชิ้น)
· กรณีแย่สุดของ RLE (ทุกช่องสีไม่ซ้ำกันเลย) ยังเล็กกว่าเดิมเพราะเก็บสีเป็น palette index ไม่ใช่ hex string ซ้ำ ๆ

**เสร็จแล้ว:** round-trip test ผ่านทุกขนาด · library ที่เซฟด้วยฟอร์แมตเก่ายังอ่านได้ (มีเทสต์คุม) ·
เฟรมที่ decode แล้วความยาวผิดยังถูก `isValidSprite()` จับได้เหมือนเดิม (ไม่ใช่ว่า decode แล้วเงียบ)

---

### P3 — Storage Adapter แบบ async (**เฟสใหญ่ที่สุด — วางแผนให้ดีก่อนพิมพ์โค้ด**)

**ไฟล์ใหม่**
```
src/lib/data/adapter.ts        interface StorageAdapter
src/lib/data/localAdapter.ts   LocalStorageAdapter (ห่อ storage.ts เดิมทั้งดุ้น)
src/lib/data/repository.ts     SpriteRepo / TankRepo / PrefsRepo + in-memory cache
src/lib/data/index.ts          getRepos() — จุดเดียวที่เลือก adapter
```

```ts
export interface StorageAdapter {
  listSprites(): Promise<Sprite[]>;
  putSprite(sprite: Sprite): Promise<void>;      // เขียนทีละตัว ไม่ใช่ทั้ง array
  deleteSprite(id: string): Promise<void>;       // = เขียน tombstone
  loadTankState(): Promise<TankState>;           // instances + groups + roomInstances + settings ก้อนเดียว
  saveTankState(state: TankState): Promise<void>;
  loadPrefs(): Promise<Prefs>;
  savePrefs(patch: Partial<Prefs>): Promise<void>;
}
```

**สิ่งที่ต้องแก้ฝั่ง engine (จุดเจ็บจริง):**

1. **แยก "สร้าง engine" ออกจาก "โหลดข้อมูล"**
   ```ts
   // เดิม: constructor โหลดเอง (usePixelEditor.ts:452, useTank.ts:286)
   const engine = new PixelEditorEngine();   // เริ่มด้วย state ว่างที่ปลอดภัย
   await engine.hydrate(repos);              // แล้วค่อยเติมข้อมูล + reactNotify()
   ```
2. **hook ต้องมีสถานะ loading** — `usePixelEditor()` / `useTank()` คืน `{ ready: boolean, ... }`
   และ `App.tsx` แสดง skeleton จนกว่าจะ ready (อย่าปล่อยให้ canvas วาดด้วย state ว่าง แล้วค่อยกระโดด)
3. **`'ft:sprites-updated'` ต้องเปลี่ยนวิธีคิด** — ผู้ฟังทั้ง 3 จุด (`LifePanel.tsx:31`, `TankSection.tsx:30`,
   `TankPixiLayer.tsx:42`) ตอนนี้อ่าน localStorage ใหม่แบบ sync ทันที เลือกทางใดทางหนึ่ง:
   - **(แนะนำ)** `SpriteRepo` ถือ `Map<string, Sprite>` เป็น cache — ผู้ฟังอ่านจาก cache แบบ sync ได้เหมือนเดิม
     ไม่ต้องแก้ผู้ฟังเลย แค่เปลี่ยนแหล่งอ่าน
   - หรือ ส่ง sprite ที่เพิ่งเซฟไปกับ event (`detail: { sprite }`) แล้วผู้ฟังอัปเดต state ตัวเอง
   > ทางแรกจำเป็นอยู่ดีตอน P5 เพราะ **render loop ของ Pixi ห้ามเป็น async เด็ดขาด**
4. **`TankEngine.refresh()`** ([`useTank.ts:800`](../src/hooks/useTank.ts#L800)) กลายเป็น async → ปุ่ม Refresh ต้อง disable ระหว่างทำงาน
5. **beforeunload** — ตอนนี้เตือนเมื่อ `dirty` ([`useTank.ts:280`](../src/hooks/useTank.ts#L280)) ยังใช้ได้เหมือนเดิม
   แต่ **ห้าม await การเซฟใน `beforeunload`** (เบราว์เซอร์ไม่รอ) — เตือนอย่างเดียวพอ

**ข้อยกเว้นที่ตัดสินใจตอนลงมือ (P3):** ค่า preference ที่เป็นของ *เครื่องนี้* เท่านั้น — dock layout,
UI scale, panel collapsed, theme — **ไม่ผ่าน data layer** แต่เรียก `loadRawPref()`/`saveRawPref()` ใน
storage.ts แบบ sync ต่อไป เพราะมันจะไม่มีวันขึ้น database (ดู §5) และถ้าทำเป็น async จะได้ผลข้างเคียง
คือ layout กระพริบผิดทุกครั้งที่โหลด · ที่ยังต้องประกาศ key ไว้ใน storage.ts คือเพื่อให้ backup/reset เห็น

**กฎเหล็กของเฟสนี้:** ห้ามเปลี่ยน backend พร้อมกับเปลี่ยน API
P3 ต้องจบด้วย **พฤติกรรมเหมือนเดิม 100%** โดยข้างในยังเป็น localStorage ทุกประการ
จะได้แยกออกว่าถ้าพัง คือพังเพราะ async ไม่ใช่เพราะ backend

**เสร็จเมื่อ:** เทสต์เดิมผ่านหมด (`storage.test.ts`, `useTank.test.ts`) ·
`grep -rn "localStorage" src --include=*.tsx --include=*.ts` ไม่เหลือผลนอก `src/lib/data/` ·
Playwright: เปิดแอป → วาด → เซฟ → reload → ข้อมูลครบ

---

### P4 — เปลี่ยน backend เป็น IndexedDB

ทำไมต้องแวะ IndexedDB ก่อนไป server:
- โควตาระดับหลายร้อย MB–GB → ปัญหา quota จบจริง
- async ของจริง (ไม่ใช่ `Promise.resolve` ปลอม) → เจอ race condition ทั้งหมดตั้งแต่ยังไม่มี network
- เขียนทีละ record ได้ → เลิกเขียนทั้ง array ต่อการแก้ 1 ครั้ง (P1-3)
- ยัง offline-first เหมือนเดิม ผู้ใช้ไม่รู้สึกถึงความต่าง

**งาน:** `IndexedDbAdapter` (แนะนำใช้ `idb` เป็น dependency เดียว) · object stores:
`sprites` (keyPath `id`), `tank` (ก้อนเดียว key `'current'`), `prefs`
**migration ครั้งเดียวตอนเปิดแอป:** ถ้ามีข้อมูลใน localStorage ให้ก๊อปเข้ามาแล้วตั้งธง `fishtank.migratedTo.idb`
(ยังไม่มีผู้ใช้จริงนอกจากเจ้าของ → ถ้า migration ยากเกินไปในบางเฟส "backup ด้วย `downloadDataBackup()` แล้ว reset"
เป็นทางออกที่ยอมรับได้ แต่ **ต้องเขียนบอกไว้ใน commit message ทุกครั้ง**)
— **ห้ามลบข้อมูลใน localStorage ทิ้งอย่างน้อย 1 เวอร์ชัน** (เผื่อ rollback)

**ทำเพิ่มในเฟสนี้เพราะเลือก "หลายตู้ + แชร์ตู้กันได้":** `TankEngine` ต้องรับ `tankId` เป็นพารามิเตอร์
(ตอนนี้อ่าน key ตายตัวจาก storage) และ IndexedDB store `tank` เปลี่ยน keyPath เป็น `tankId` แทน key `'current'`
· UI สลับ/สร้าง/ลบตู้ ทำทีหลังได้ แต่ **โครงข้อมูลต้องรองรับตั้งแต่ตอนนี้**

**เตรียม id ล่วงหน้า:** ตอน migrate ให้สร้าง `tankId = uid('tank')` และ
`localUserId = uid('local')` เก็บไว้เลย — จะได้ไม่ต้องมาเติม id ทีหลังตอนที่ผู้ใช้มีข้อมูลจริงแล้ว (§5, §4 P6.1)

**สิ่งที่ต้องแก้ตามมา (เจอตอนลงมือ — อย่าลืมถ้าเปลี่ยน backend อีก):**
- `downloadDataBackup()` / `resetAllData()` เดิมรู้จักแค่ localStorage → **ถ้าไม่แก้ ปุ่มกู้ภัยใน ErrorBoundary
  จะได้ไฟล์ backup ที่ไม่มี sprite เลย และ reset จะล้างไม่หมด** · ย้ายไป [`src/lib/data/backup.ts`](../src/lib/data/backup.ts) ที่อ่าน/ล้างทั้งสองที่
- `StorageBanner` เดิมวัดจาก localStorage → เปลี่ยนไปใช้ `navigator.storage.estimate()` ซึ่งครอบคลุม IndexedDB
  (โควตาจริงเป็น GB → banner แทบไม่ขึ้นอีกเลย ซึ่งถูกต้อง)
- `hydrate()` ของทั้งสอง engine ต้อง try/catch → storage ที่อ่านไม่ได้ต้องได้แอปว่าง ๆ ที่ยังใช้ได้ **ไม่ใช่หน้า Loading ค้างตลอดกาล**

**เสร็จแล้ว:** เปิดแอปที่มีข้อมูลเก่า → migrate ครบและ localStorage ยังอยู่ · เปิดซ้ำ → ไม่ migrate ซ้ำ ·
เปิด IndexedDB ไม่ได้ → fallback ไป localStorage เงียบ ๆ · backup มีข้อมูลจาก IndexedDB จริง (มีเทสต์คุมทุกข้อ)

---

### P5 — Supabase + sync (offline-first)

> ข้อตัดสินใจล็อกแล้ว (§0): **Supabase · offline-first · หลายผู้ใช้แชร์ตู้กันได้**

**สถาปัตยกรรม sync**
```
เขียน:  UI → repo → IndexedDB (ทันที ผู้ใช้ไม่ต้องรอ) → outbox → ส่งขึ้น Supabase เมื่อออนไลน์
อ่าน:   pull delta ตั้งแต่ updated_at ล่าสุดที่รู้ → merge เข้า IndexedDB → แจ้ง UI
merge:  เทียบ updated_at ต่อ record · ฝั่งใหม่กว่าชนะ · deleted_at ชนะการแก้ไขที่เก่ากว่า
```

**ไฟล์ใหม่**
```
src/lib/data/supabaseAdapter.ts   RemoteAdapter คุยกับ Supabase (ไม่ใช่ adapter ที่ UI ใช้ตรง ๆ)
src/lib/data/syncEngine.ts        outbox + delta pull + merge + backoff
src/lib/data/outbox.ts            คิวใน IndexedDB (object store 'outbox')
src/lib/supabase.ts               createClient() ที่เดียวในโปรเจกต์
```

**สำคัญ: adapter ที่ UI ใช้ยังเป็น `IndexedDbAdapter` เสมอ** — Supabase ไม่ได้มาแทนที่ P4
แต่มาเป็นชั้น sync ที่ทำงานอยู่เบื้องหลัง ถ้าทำสลับกัน (UI เรียก Supabase ตรง) offline-first จะพังทันทีที่เน็ตหลุด

**รายละเอียดฝั่ง Supabase**
- **client เดียว** ใน `src/lib/supabase.ts` ใช้ anon key (ปลอดภัยเพราะมี RLS — ดู §5) ผ่าน `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
  · **ห้าม commit `.env`** และ **ห้ามใช้ service_role key ในฝั่ง client เด็ดขาด**
- **upsert เป็นหลัก** — `id` มาจาก client (`uid()` [`storage.ts:79`](../src/lib/storage.ts#L79)) ทำให้ทุก request idempotent
  ส่งซ้ำหลังเน็ตหลุดแล้วไม่เกิดของซ้ำ
- **delta pull:** `select ... where user_id = auth.uid() and updated_at > :lastPulledAt order by updated_at`
  เก็บ `lastPulledAt` ต่อ table ไว้ใน IndexedDB
- **outbox:** เก็บ `{ table, id, op: 'upsert'|'delete', payload, tries, nextAttemptAt }`
  · retry แบบ exponential backoff · **บีบให้เหลือรายการเดียวต่อ id** (เขียนทับกันเองได้ ไม่ต้องส่งทุกครั้งที่แก้)
  · flush ตอน: กด Save, กลับมาออนไลน์ (`window.online`), แอปเปิด, และทุก ๆ N วินาที
- **sprite ก้อนใหญ่:** ถ้า RLE (P2) แล้วยังเกิน ~1MB ต่อชิ้น ให้ย้ายไป **Supabase Storage** (bucket `sprites`,
  path `<user_id>/<sprite_id>.json.gz`) แล้วในตารางเก็บแค่ `frames_url` — ตัดสินใจตอนรู้ตัวเลขจริงจาก P2
- **Realtime:** ยังไม่ต้องทำใน P5 — ค่อยเพิ่มตอนที่ต้องการให้ตู้ที่แชร์อัปเดตสด (ดู P6)

**เสร็จเมื่อ:** ตัดเน็ต → วาด/เซฟได้ปกติ → ต่อเน็ต → ข้อมูลขึ้น Supabase ครบโดยไม่ซ้ำ ·
เปิดอีกเครื่องด้วยบัญชีเดียวกัน → เห็นงานเดียวกัน · แก้คนละเครื่องพร้อมกัน → ฝั่งที่ `updated_at` ใหม่กว่าชนะ ไม่มีข้อมูลพัง

---

### P6 — Auth, guest mode และการแชร์ตู้

> ข้อตัดสินใจล็อกแล้ว (§0): **ต้องเล่นได้โดยไม่ต้องสมัคร** และ **ผู้ใช้แชร์/ดูตู้กันได้**

**6.1 Guest mode (ค่าเริ่มต้น)**
- ยังไม่ล็อกอิน = ทำงาน local ล้วน (IndexedDB) ไม่มี network เลย — เหมือนวันนี้ทุกประการ
- ตั้ง `localUserId = uid('local')` เก็บใน IndexedDB ตั้งแต่เปิดครั้งแรก แล้วใช้เป็น `user_id` ชั่วคราวของทุก record
  → ตอนล็อกอินแค่ map `localUserId → auth.uid()` ครั้งเดียว ไม่ต้องไล่แก้โครงข้อมูล
- UI: ปุ่ม "เข้าสู่ระบบเพื่อสำรองงาน" แบบไม่รบกวน · **ห้ามมี modal บังคับล็อกอิน**

**6.2 ล็อกอินครั้งแรก (จุดที่ข้อมูลหายง่ายที่สุด — ทำให้ดี)**
1. เลือกวิธี auth ของ Supabase: **magic link + Google** (ไม่ต้องจัดการรหัสผ่านเอง)
2. ตอนล็อกอินสำเร็จ ถาม 3 ทางชัด ๆ: **อัปโหลดงานในเครื่องขึ้นบัญชีนี้** / **ใช้งานจากบัญชี (เก็บงาน local ไว้เฉย ๆ)** / ยกเลิก
3. ถ้าเลือกอัปโหลด: ยิงทุก record เข้า outbox แล้ว flush ทีละก้อน พร้อม progress
4. **ห้ามลบข้อมูล local จนกว่าจะยืนยันว่าอัปโหลดครบ** (เทียบจำนวน record + `rev > 0`)
5. ออกจากระบบ: ล้าง cache ของบัญชีนั้น แต่ **ห้ามลบงาน local ที่ยังไม่เคยอัปโหลดโดยไม่ถาม**

**6.3 การแชร์ตู้**
- ตู้มี `visibility`: `private` (ค่าเริ่มต้น) · `unlisted` (ใครมีลิงก์ก็ดูได้) · `public` (ขึ้น gallery)
- แชร์เจาะจงคนผ่านตาราง `tank_shares` (owner + viewer + `role`) — **P5 นี้รองรับแค่ `viewer` (อ่านอย่างเดียว)**
  · การแก้ร่วมกัน (`editor`) เป็นงานคนละก้อน ต้องมี conflict resolution ที่ดีกว่า last-write-wins → **อย่าเพิ่งทำ**
- หน้าดูตู้ของคนอื่น = โหมด read-only จริง ๆ: ซ่อนปุ่ม Save/แก้ไข และ **ห้ามให้ข้อมูลของคนอื่นเข้ามาปนใน IndexedDB
  ของเรา** — แยก store `remoteTanks` ที่ล้างทิ้งได้ ไม่เข้า sync loop
- sprite ที่ตู้สาธารณะใช้ต้องดูได้ด้วย ไม่งั้นตู้จะโล่ง → policy ของ `sprites` ต้องยอมให้อ่าน sprite ที่ถูกอ้างโดยตู้ที่เปิดสาธารณะ (ดู §5)
**6.4 Sprite gallery + fork**
- `sprites.visibility = 'public'` = ขึ้น gallery ให้คนอื่นเห็นและก๊อปไปใช้ได้ (แยกจากการแชร์ตู้ — แชร์ sprite เดี่ยว ๆ ได้)
- **fork = คัดลอกจริง ไม่ใช่การอ้างอิง**: สร้าง sprite ใหม่ `id = uid('sprite')`, `user_id = ฉัน`,
  `forked_from = <id ต้นฉบับ>` แล้วก๊อป `frames` มาเลย
  → ต้นฉบับถูกแก้/ลบทีหลังแล้วงานเราไม่พัง และ **ไม่มีปัญหา RLS ตอนต้นฉบับเปลี่ยนเป็น private**
- fork ของ fork ให้ `forked_from` ชี้กลับต้นฉบับแรกเสมอ (ไม่เก็บเป็นห่วงโซ่)
- **moderation:** เมื่อมี gallery สาธารณะ (ทั้ง sprite และตู้) ต้องมีอย่างน้อย ปุ่มรายงาน + ธง `hidden_by_admin`
  + หน้ารายการที่ถูกรายงาน — **ห้ามเปิด public โดยยังไม่มีสิ่งนี้**

---

## 5. Schema ที่เสนอ (Supabase / Postgres)

> `auth.users` มาจาก Supabase Auth อยู่แล้ว ไม่ต้องสร้างเอง · ทุกตารางเปิด RLS และ **ห้ามมี policy ไหนกว้างกว่าที่เขียนไว้**

```sql
-- ---------- sprites ----------
create table sprites (
  id           text primary key,            -- id ที่ client สร้าง (uid('sprite')) → upsert ซ้ำได้ปลอดภัย
  user_id      uuid   not null references auth.users(id) on delete cascade default auth.uid(),
  name         text   not null,
  type         text   not null,             -- SpriteType: fish | plant | object | background | room
  width        int    not null,
  height       int    not null,
  frame_ms     int    not null,
  frames       jsonb,                       -- RLE ตาม §P2 · null ได้ถ้าย้ายไป Storage แล้ว
  frames_url   text,                        -- path ใน Supabase Storage เมื่อ sprite ใหญ่เกิน (§4 P5)
  visibility   text   not null default 'private',    -- private | public (ขึ้น sprite gallery)
  forked_from  text   references sprites(id),        -- ที่มา เมื่อผู้ใช้ก๊อป sprite ของคนอื่นมาคลังตัวเอง
  hidden_by_admin boolean not null default false,    -- moderation
  updated_at   bigint not null,             -- epoch ms จาก client (ใช้ตัดสิน last-write-wins)
  deleted_at   bigint not null default 0,   -- tombstone
  rev          bigint not null default 0,   -- server เพิ่มเอง (ตัวตัดสินเมื่อ updated_at ใกล้กันมาก)
  created_at   timestamptz not null default now()
);
create index on sprites (user_id, updated_at);   -- delta pull
create index on sprites (visibility) where deleted_at = 0 and not hidden_by_admin;   -- sprite gallery

-- ---------- ตู้ ----------
create table tanks (                         -- ใหม่: เดิมมีตู้เดียวต่อเครื่อง ตอนนี้ 1 ผู้ใช้มีได้หลายตู้ + แชร์ได้
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null default 'My Tank',
  visibility  text not null default 'private',   -- private | unlisted | public
  hidden_by_admin boolean not null default false, -- ช่องทาง moderation (§4 P6.3)
  settings    jsonb not null,                -- ยุบ 7 key เดิม: size, shape, cornerRadiusFrac, ovalTopCutFrac,
                                             -- backgroundSpriteId, backgroundTransform, lastTick
  updated_at  bigint not null,
  deleted_at  bigint not null default 0,
  rev         bigint not null default 0
);
create index on tanks (visibility) where deleted_at = 0 and not hidden_by_admin;

create table tank_instances (
  id text primary key,
  tank_id text not null references tanks(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  sprite_id text references sprites(id),     -- ห้าม on delete cascade (ดูหมายเหตุด้านล่าง)
  data jsonb not null,                       -- x, y, scale, zone, groupId, visible, bornAt, lifespanMs,
                                             -- dead, diedAt, hunger, starvingSince
  updated_at bigint not null, deleted_at bigint not null default 0, rev bigint not null default 0
);
create index on tank_instances (tank_id, updated_at);

create table tank_groups    (id text primary key, tank_id text not null references tanks(id) on delete cascade,
                             user_id uuid not null default auth.uid(), data jsonb not null,
                             updated_at bigint not null, deleted_at bigint not null default 0);
create table room_instances (id text primary key, tank_id text not null references tanks(id) on delete cascade,
                             user_id uuid not null default auth.uid(), data jsonb not null,
                             updated_at bigint not null, deleted_at bigint not null default 0);

-- ---------- แชร์ ----------
create table tank_shares (
  tank_id   text not null references tanks(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'viewer',   -- P5/P6 รองรับแค่ 'viewer' · 'editor' เป็นงานคนละก้อน
  created_at timestamptz not null default now(),
  primary key (tank_id, viewer_id)
);

-- ---------- preference ----------
create table user_prefs (user_id uuid primary key references auth.users(id) on delete cascade,
                         data jsonb not null, updated_at bigint not null);
```

### RLS (ด่านความปลอดภัยหลัก — ไม่มี API server มาช่วยกรองแล้ว)

```sql
alter table sprites         enable row level security;
alter table tanks           enable row level security;
alter table tank_instances  enable row level security;
alter table tank_groups     enable row level security;
alter table room_instances  enable row level security;
alter table tank_shares     enable row level security;
alter table user_prefs      enable row level security;

-- เจ้าของทำได้ทุกอย่างกับของตัวเอง (ใช้ pattern เดียวกันกับทุกตารางที่มี user_id)
create policy own_all on sprites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ตู้ที่เปิดสาธารณะ/แชร์ไว้ → คนอื่นอ่านได้อย่างเดียว
create policy read_shared on tanks for select using (
  user_id = auth.uid()
  or (deleted_at = 0 and not hidden_by_admin and visibility in ('public','unlisted'))
  or exists (select 1 from tank_shares s where s.tank_id = tanks.id and s.viewer_id = auth.uid())
);

-- ของในตู้ที่อ่านได้ ก็ต้องอ่านได้ด้วย ไม่งั้นตู้จะโล่ง (ทำแบบเดียวกันกับ tank_groups / room_instances)
create policy read_shared on tank_instances for select using (
  user_id = auth.uid()
  or exists (select 1 from tanks t where t.id = tank_instances.tank_id
             and (t.visibility in ('public','unlisted')
                  or exists (select 1 from tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())))
);

-- sprite ที่ถูกใช้ในตู้ที่คนอื่นดูได้ ต้องอ่านได้ (แต่ sprite อื่นในคลังของเจ้าของยังเป็นความลับ)
create policy read_used_in_shared on sprites for select using (
  user_id = auth.uid()
  or (deleted_at = 0 and not hidden_by_admin and visibility = 'public')   -- sprite gallery
  or exists (select 1 from tank_instances i join tanks t on t.id = i.tank_id
             where i.sprite_id = sprites.id
               and (t.visibility in ('public','unlisted')
                    or exists (select 1 from tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())))
);
```

**หมายเหตุการออกแบบ**
- ใช้ `jsonb` กับ `data` ของ instance / group / room โดยตั้งใจ — โครงยังเปลี่ยนบ่อย (lifecycle P5 ของ PIXI plan)
  ยังไม่คุ้มที่จะแตกเป็นคอลัมน์ ยกเว้นฟิลด์ที่ต้อง query จริง ๆ
- **ต้องมีตาราง `tanks` ตั้งแต่แรก** — เพราะเลือกทั้ง "หลายตู้ต่อผู้ใช้" และ "แชร์ตู้กันได้"
  ฝั่ง client ตอน P4 ให้ตั้ง `tankId = uid('tank')` ไว้เลย แล้วค่อยเพิ่ม UI สลับตู้ทีหลัง
- **`forked_from` ชี้ไปที่ sprite ต้นทางเสมอ (ไม่ใช่ห่วงโซ่)** — fork ของ fork ให้ชี้กลับไปที่ต้นฉบับแรก
  จะได้นับ/แสดงที่มาได้โดยไม่ต้องไล่ recursive
- `tankLastTick` อยู่ใน `tanks.settings` — เป็นสถานะเวลา ไม่ใช่ preference
- `canvasBackground` / `uiTheme` / `uiScale` / `editorLayout` / `sidePanel.collapsed.*` **ไม่ขึ้น server**
  เป็น per-device จริง ๆ ให้อยู่ localStorage ต่อไป (แต่ยังต้องอยู่ใน `ALL_STORAGE_KEYS` ตาม P0-4)
- FK `sprite_id`: **ห้าม `on delete cascade`** — การลบ sprite ที่ยังมีปลาว่ายอยู่ในตู้ต้องเป็นการตัดสินใจของ UI ไม่ใช่ของ DB
  (และเมื่อลบเป็น tombstone แล้ว แถวจะไม่หายไปจริงอยู่แล้ว)
- `updated_at` เป็น `bigint` (epoch ms จาก client) ไม่ใช่ `timestamptz` โดยตั้งใจ — เทียบตรงกับค่าใน IndexedDB
  ได้โดยไม่ต้องแปลง timezone · เวลาแบบ "อ่านให้มนุษย์ดู" ใช้ `created_at` แทน

---

## 6. ความเสี่ยง / กับดักที่รู้อยู่แล้ว

| ความเสี่ยง | ทางกัน |
|-----------|--------|
| ทำ P3 (async) พร้อม P4/P5 ในทีเดียว | ห้าม — แยกให้จบทีละเฟส แต่ละเฟสต้อง merge ได้ด้วยตัวเอง |
| render loop ของ Pixi กลายเป็น async | ห้ามเด็ดขาด — sprite ต้องอยู่ใน memory cache ที่อ่านแบบ sync ได้เสมอ (§4 P3 ข้อ 3) |
| ผู้ใช้เดิมข้อมูลหายตอน migrate | ธง `migratedTo.*` + ไม่ลบข้อมูลเดิมอย่างน้อย 1 เวอร์ชัน + `downloadDataBackup()` ต้องทำงานได้ตลอดทาง |
| เซฟล้มเหลวแบบเงียบ (เป็นอยู่วันนี้) | P0-3 — ทุกเส้นทางการเขียนต้องมีทางแจ้งผู้ใช้ |
| นาฬิกาเครื่อง client เพี้ยน → last-write-wins ตัดสินผิด | server เขียน `rev` ของตัวเอง และใช้ `rev` ตัดสินเมื่อ `updated_at` ใกล้กันมาก |
| เทสต์ปัจจุบัน stub `globalThis.localStorage` | ดู [`USETANK_TEST_AUDIT.md`](./USETANK_TEST_AUDIT.md) — ตอน P3 เปลี่ยนไป stub adapter แทน (ง่ายกว่าเดิม) |
| แก้ `Sprite.id` ให้ไม่เป็น null แล้วลืม call site | grep `current.id` ให้ครบก่อนแก้ (P1) |
| RLS เขียนพลาด → ข้อมูลผู้ใช้รั่ว (ไม่มี API server มากรองแล้ว) | เขียนเทสต์ policy ด้วยบัญชีทดสอบ 2 คน: A ต้องอ่านของ B ไม่ได้ทุกตาราง · รันซ้ำทุกครั้งที่แก้ policy |
| ใช้ Supabase client ตรงจาก component | ห้ามเด็ดขาด — เข้าผ่าน repository เท่านั้น ไม่งั้น offline-first พังทันทีที่เน็ตหลุด (§0) |
| งาน guest หายตอนล็อกอินครั้งแรก | ห้ามลบ local จนกว่าจะยืนยันว่าอัปโหลดครบ (§4 P6.2 ข้อ 4) + backup ก่อนเริ่มอัปโหลด |
| ข้อมูลตู้ของคนอื่นปนเข้ามาใน sync loop ของเรา | เก็บใน store `remoteTanks` แยก ล้างทิ้งได้ ไม่เข้า outbox (§4 P6.3) |
| ไม่มี `tank_id` ตั้งแต่แรกแล้วมาเติมทีหลัง | สร้างตาราง `tanks` + `tankId` ฝั่ง client ตั้งแต่ P4 แม้จะมีตู้เดียว (§5) |
| service_role key หลุดไปฝั่ง client | ใช้ anon key เท่านั้น · `.env` ไม่เข้า git · ความปลอดภัยพึ่ง RLS ไม่ใช่การซ่อน key |

---

## 7. Checklist สำหรับคนทำต่อ

- [x] **P0-1** `writeKey()` + `StorageQuotaError` ใน storage.ts — เสร็จ (ทุก `setItem` ผ่าน `writeKey()` แล้ว)
- [x] **P0-2** try/catch ตอน bootstrap + ธง `engine.readOnly` + banner สีแดง
- [x] **P0-3** `TankEngine.save()` คืน `{ ok, error }` + `TankCanvas` แจ้ง error (ไม่ขึ้นติ๊ก "saved" เวลาเซฟไม่ผ่าน)
- [x] **P0-4** `allOwnedKeys()` รวม `editorLayout` / `uiScale` / `sidePanel.collapsed.*` (3 ไฟล์นั้น import key จาก storage.ts แล้ว)
- [x] **P0-5** `estimateUsage()` + `StorageBanner.tsx` เตือนที่ 70% พร้อมปุ่ม export backup
- [x] **P1-1** `RecordMeta` ใน types.ts (Sprite / Instance / TankGroup / RoomInstance) + `Sprite.id` เป็น `string` เสมอ (ออก id ตั้งแต่ `blankSprite()` — เลิกใช้ id เป็นตัวบอกว่า "เคยเซฟหรือยัง" เปลี่ยนไปหาใน library แทน)
- [x] **P1-2** ลบแบบ tombstone — `saveSprites()` เทียบกับของเดิมในสตอเรจแล้วเขียน tombstone ให้ตัวที่หายไป (ตัด `frames` ทิ้งเพื่อคืนพื้นที่จริง) · `loadSprites()` กรอง tombstone ออกให้ UI ไม่ต้องรู้เรื่อง
- [x] **P2-1** [`src/lib/pixelCodec.ts`](../src/lib/pixelCodec.ts) (`rle1`) + round-trip test 10 เคส (รวม worst case ทุกช่องสีต่างกัน และข้อมูลเสียหาย)
- [x] **P2-2** อ่านได้ทั้งเก่า/ใหม่ เขียนแบบใหม่อย่างเดียว + ตัวเลขจริงบันทึกไว้ใน §4 P2 แล้ว
- [x] **P3-1** [`src/lib/data/`](../src/lib/data/) — `StorageAdapter` (async ทั้งหมด) + `LocalStorageAdapter` + `SpriteRepo`/`TankRepo`/`EditorPrefsRepo` + `getRepos()`
- [x] **P3-2** `hydrate()` แยกออกจาก constructor/`init()` ทั้งสอง engine + ธง `ready` + หน้าจอ loading ใน `App.tsx` และ `TankSection.tsx`
- [x] **P3-3** `SpriteRepo` ถือ cache ในหน่วยความจำ · `refreshPalette()` อ่านจาก cache แบบ sync (render loop ไม่ต้อง await) · ผู้ฟัง event ทั้ง 3 จุดไม่ต้องแก้เลย
- [x] **P3-4** ไม่มีการเรียก `localStorage` เหลือนอก `src/lib/storage.ts` (ตัว backend) และ `src/lib/data/` — ค่า per-device (layout / uiScale / panel collapsed) ใช้ `loadRawPref`/`saveRawPref` แบบ sync โดยตั้งใจ ดูเหตุผลใน §4 P3
- [x] **P4-1** [`IndexedDbAdapter`](../src/lib/data/indexedDbAdapter.ts) + migration ครั้งเดียว + ธง `migratedFrom.localStorage` (ไม่ลบข้อมูลเดิม) + fallback กลับไป localStorage เมื่อเปิด IndexedDB ไม่ได้
- [x] **P4-2** `currentTankId` + `localUserId` ถูกสร้างตั้งแต่รันครั้งแรก (แม้ไม่มีอะไรให้ migrate)
- [x] **P4-3** `TankEngine.tankId` + ทุก load/save ระบุตู้ · store `tanks` ใช้ `id` เป็น keyPath · `listTanks()` พร้อมใช้
- [ ] **P4-4** (ยังไม่ทำ — ตั้งใจ) UI สลับ/สร้าง/ลบตู้ · โครงข้อมูลรองรับแล้ว เหลือแค่งาน UI
- [x] **P5-1** `src/lib/supabase.ts` + [`.env.example`](../.env.example) (anon key เท่านั้น · `.env` เข้า .gitignore แล้ว) — **เหลือฝั่งคุณ: สร้างโปรเจกต์จริงแล้วเติมค่า**
- [x] **P5-2** [`supabase/schema.sql`](../supabase/schema.sql) พร้อมรัน (ตาราง + RLS + trigger `bump_rev` · re-runnable) — **เหลือฝั่งคุณ: รันจริง + เทสต์ policy ด้วยบัญชีทดสอบ 2 คน**
- [x] **P5-3** [`outbox.ts`](../src/lib/data/outbox.ts) — คิวใน IndexedDB store `outbox` + exponential backoff (cap 5 นาที) + coalesce เหลือรายการเดียวต่อ record
- [x] **P5-4** [`syncEngine.ts`](../src/lib/data/syncEngine.ts) (flush + delta pull + merge) · [`rows.ts`](../src/lib/data/rows.ts) (map record ↔ row) · [`merge.ts`](../src/lib/data/merge.ts) (last-write-wins + tiebreak ด้วย `rev`)
- [ ] **P5-5** ⚠️ **ยังทดสอบกับ Supabase จริงไม่ได้** (ไม่มี credential) — logic ทั้งหมดมี unit test 13 เคส แต่ยังไม่เคยยิงขึ้น server จริงสักครั้ง · ต้องทำเมื่อมีโปรเจกต์: ตัดเน็ต → ทำงาน → ต่อเน็ต → ข้อมูลครบไม่ซ้ำ · 2 เครื่องบัญชีเดียวกัน
- [ ] **P5-6** ตัดสินใจว่า sprite ต้องย้ายไป Supabase Storage ไหม (ใช้ตัวเลขจริงจาก P2)
- [ ] **P6-1** guest mode: `localUserId` + ปุ่มล็อกอินแบบไม่บังคับ
- [ ] **P6-2** magic link + Google + flow อัปโหลดงานเดิมตอนล็อกอินครั้งแรก (พร้อม progress)
- [ ] **P6-3** `visibility` + `tank_shares` + หน้าดูตู้คนอื่นแบบ read-only (store `remoteTanks` แยก)
- [ ] **P6-4** sprite gallery (`visibility = 'public'`) + ปุ่ม fork (คัดลอกจริง + `forked_from`)
- [ ] **P6-5** ปุ่มรายงาน + ธง `hidden_by_admin` + หน้ารายการที่ถูกรายงาน — ก่อนเปิด public ทุกชนิด
