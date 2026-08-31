import { useSyncExternalStore } from 'react';

export type Lang = 'th' | 'en';

const STORAGE_KEY = 'fishtank.lang.v1';

type Dict = Record<string, string>;

const th: Dict = {
  'tab.editor': 'วาดปลา/ของตกแต่ง',
  'tab.tank': 'ตู้ปลา',
  'lang.name': 'ไทย',

  'tool.pen.desc': 'ปากกา — วาดพิกเซลทีละจุด (B)',
  'tool.line.desc': 'เส้นตรง — ลากเพื่อวาดเส้นตรง (L)',
  'tool.fill.desc': 'เทสี — เทสีเต็มพื้นที่ต่อเนื่อง (G)',
  'tool.eyedropper.desc': 'ดูดสี — คลิกเพื่อหยิบสีจากพิกเซล (I)',
  'tool.eraser.desc': 'ยางลบ — ลบพิกเซล (E)',
  'tool.rect.desc': 'สี่เหลี่ยม — ลากเพื่อวาดกรอบสี่เหลี่ยม (R)',
  'tool.ellipse.desc': 'วงรี — ลากเพื่อวาดวงรี (C)',
  'tool.select.desc': 'เลือกพื้นที่ — ลากเพื่อเลือกพื้นที่สี่เหลี่ยม (S) • ลากในกรอบเพื่อย้าย, ลากจุดสีเหลืองที่มุม/ขอบเพื่อขยาย/หดพร้อมยืดภาพในกรอบตามไปด้วย',
  'tool.move.desc': 'ย้ายพื้นที่ — ลากเพื่อย้ายพิกเซลในพื้นที่ที่เลือก (M)',
  'action.undo': 'ย้อนกลับ (Ctrl+Z)',
  'action.redo': 'ทำซ้ำ (Ctrl+Y)',

  'transform.title': 'แปลงรูป',
  'transform.flipH': 'พลิกแนวนอน',
  'transform.flipV': 'พลิกแนวตั้ง',
  'transform.rotateCCW': 'หมุนทวนเข็ม',
  'transform.rotateCW': 'หมุนตามเข็ม',
  'transform.allFrames': 'ใช้กับทุกเฟรม',

  'status.zoomOut': 'ซูมออก',
  'status.zoomIn': 'ซูมเข้า',
  'status.showGrid': 'เส้นกริด',
  'status.fillShape': 'เติมสีเต็ม',
  'status.symmetryTitle': 'วาดแบบสมมาตร (V)',
  'status.selectionSize': 'พื้นที่เลือก {w}×{h}',
  'status.selectionHint': 'ลากในกรอบเพื่อย้าย • ลากจุดสีเหลืองที่มุม/ขอบเพื่อปรับขนาด (ภาพจะยืด/หดตาม)',
  'status.gridCustom': 'กำหนดเอง...',
  'status.gridCustomTitle': 'กำหนดขนาดกริดเอง',
  'status.gridCustomDesc': 'ใส่ความกว้างและความสูง (จำนวนช่อง) ตั้งแต่ {min} ถึง {max} ต่อด้าน ไม่จำเป็นต้องเท่ากัน',
  'status.gridWidthLabel': 'ความกว้าง',
  'status.gridHeightLabel': 'ความสูง',
  'status.gridCustomConfirm': 'ตกลง',
  'status.gridCustomCancel': 'ยกเลิก',
  'symmetry.none': 'ไม่มีสมมาตร',
  'symmetry.vertical': 'สมมาตรแนวตั้ง',
  'symmetry.horizontal': 'สมมาตรแนวนอน',
  'symmetry.both': 'สมมาตรทั้งคู่',

  'palette.addColor': 'เก็บสีปัจจุบันลงถาด',
  'palette.removeColor': 'ลบสีนี้ออกจากถาด',

  'frame.add': 'เฟรม',
  'frame.duplicate': 'คัดลอก',
  'frame.delete': 'ลบ',
  'frame.clear': 'ล้าง',

  'form.namePlaceholder': 'ตั้งชื่อ เช่น ปลานีออน',
  'form.typeFish': '🐟 ปลา (ว่ายอัตโนมัติ)',
  'form.typeObject': '🌿 ของตกแต่ง (อยู่นิ่ง)',
  'form.save': 'บันทึกลงคลัง',
  'form.new': 'สร้างใหม่',
  'form.exportPng': 'Export PNG',
  'form.exportSheet': 'Export Sheet',
  'form.exportSheetTitle': 'Export Sprite Sheet',

  'library.title': 'คลังของฉัน',
  'library.deleteConfirm': 'ลบชิ้นนี้ออกจากคลัง? (ของในตู้ปลาที่ใช้ชิ้นนี้จะถูกลบไปด้วย)',

  'confirm.discard': 'งานปัจจุบันยังไม่ได้บันทึก จะทิ้งงานนี้หรือไม่?',
  'error.saveFailed': 'บันทึกไม่สำเร็จ (พื้นที่จัดเก็บในเบราว์เซอร์อาจเต็ม) กรุณาลบของเก่าออกแล้วลองใหม่',
  'error.deleteFailed': 'ลบไม่สำเร็จ กรุณาลองใหม่',
  'sprite.defaultFishName': 'ปลาไม่มีชื่อ',
  'sprite.defaultObjectName': 'ของตกแต่งไม่มีชื่อ',

  'preview.onionSkin': 'Onion Skin',

  'tank.dragHint': 'ลากปลา/ของตกแต่งลงตู้ปลา',
  'tank.clearConfirm': 'ล้างของทั้งหมดในตู้ปลา?',
  'tank.clearAll': 'ล้างตู้ปลาทั้งหมด',
  'tank.deleteSelected': 'ลบตัวที่เลือก',
  'tank.bringToFront': 'เอามาไว้หน้าสุด',
  'tank.sendToBack': 'ส่งไปไว้หลังสุด',
};

const en: Dict = {
  'tab.editor': 'Draw Fish/Decor',
  'tab.tank': 'Fish Tank',
  'lang.name': 'English',

  'tool.pen.desc': 'Pen — draw pixels one at a time (B)',
  'tool.line.desc': 'Line — drag to draw a straight line (L)',
  'tool.fill.desc': 'Fill — flood-fill a connected area (G)',
  'tool.eyedropper.desc': 'Eyedropper — click to pick a color from a pixel (I)',
  'tool.eraser.desc': 'Eraser — erase pixels (E)',
  'tool.rect.desc': 'Rectangle — drag to draw a rectangle (R)',
  'tool.ellipse.desc': 'Ellipse — drag to draw an ellipse (C)',
  'tool.select.desc': 'Select — drag to select a rectangular area (S) • drag inside to move it, drag a yellow corner/edge handle to resize (scales the artwork inside)',
  'tool.move.desc': 'Move — drag to move pixels inside the selection (M)',
  'action.undo': 'Undo (Ctrl+Z)',
  'action.redo': 'Redo (Ctrl+Y)',

  'transform.title': 'Transform',
  'transform.flipH': 'Flip horizontal',
  'transform.flipV': 'Flip vertical',
  'transform.rotateCCW': 'Rotate counter-clockwise',
  'transform.rotateCW': 'Rotate clockwise',
  'transform.allFrames': 'all frames',

  'status.zoomOut': 'Zoom out',
  'status.zoomIn': 'Zoom in',
  'status.showGrid': 'Grid lines',
  'status.fillShape': 'Fill shape',
  'status.symmetryTitle': 'Symmetry drawing (V)',
  'status.selectionSize': 'Selection {w}×{h}',
  'status.gridCustom': 'Custom...',
  'status.gridCustomTitle': 'Custom grid size',
  'status.gridCustomDesc': 'Enter a width and height (cells) from {min} to {max} per side - they do not need to match',
  'status.gridWidthLabel': 'Width',
  'status.gridHeightLabel': 'Height',
  'status.gridCustomConfirm': 'OK',
  'status.gridCustomCancel': 'Cancel',
  'status.selectionHint': 'Drag inside to move • drag a yellow corner/edge handle to resize (scales the artwork)',
  'symmetry.none': 'No symmetry',
  'symmetry.vertical': 'Vertical symmetry',
  'symmetry.horizontal': 'Horizontal symmetry',
  'symmetry.both': 'Both symmetry',

  'palette.addColor': 'Save current color',
  'palette.removeColor': 'Remove this color',

  'frame.add': 'Frame',
  'frame.duplicate': 'Duplicate',
  'frame.delete': 'Delete',
  'frame.clear': 'Clear',

  'form.namePlaceholder': 'Name it, e.g. Neon Tetra',
  'form.typeFish': '🐟 Fish (swims automatically)',
  'form.typeObject': '🌿 Decoration (stays still)',
  'form.save': 'Save to library',
  'form.new': 'New',
  'form.exportPng': 'Export PNG',
  'form.exportSheet': 'Export Sheet',
  'form.exportSheetTitle': 'Export Sprite Sheet',

  'library.title': 'My library',
  'library.deleteConfirm': 'Delete this from the library? (Any tank decorations using it will be removed too.)',

  'confirm.discard': 'The current work is not saved. Discard it?',
  'error.saveFailed': 'Save failed (browser storage may be full). Please delete old items and try again.',
  'error.deleteFailed': 'Delete failed. Please try again.',
  'sprite.defaultFishName': 'Unnamed fish',
  'sprite.defaultObjectName': 'Unnamed decoration',

  'preview.onionSkin': 'Onion Skin',

  'tank.dragHint': 'Drag fish/decorations into the tank',
  'tank.clearConfirm': 'Clear everything in the tank?',
  'tank.clearAll': 'Clear tank',
  'tank.deleteSelected': 'Delete selected',
  'tank.bringToFront': 'Bring to front',
  'tank.sendToBack': 'Send to back',
};

const dict: Record<Lang, Dict> = { th, en };

function detectDefaultLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'th' || saved === 'en') return saved;
  } catch {
    // ignore
  }
  return 'th';
}

let currentLang: Lang = detectDefaultLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let str = dict[currentLang][key] ?? dict.th[key] ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(`{${k}}`, String(v));
    });
  }
  return str;
}

export function useLanguage(): { lang: Lang; setLang: (lang: Lang) => void; t: typeof t } {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  return { lang, setLang, t };
}
