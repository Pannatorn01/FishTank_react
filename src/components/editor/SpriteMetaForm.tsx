import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/8bit/button';
import { Input } from '@/components/ui/8bit/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/8bit/select';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import type { SpriteType } from '@/lib/types';

export function SpriteMetaForm({
  engine,
  onConfirmDiscard,
  onError,
}: {
  engine: PixelEditorEngine;
  onConfirmDiscard: () => boolean;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(engine.current.name);
  const [type, setType] = useState<SpriteType>(engine.current.type);

  useEffect(() => {
    setName(engine.current.name);
    setType(engine.current.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.loadToken]);

  return (
    <div className="sprite-meta">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ตั้งชื่อ เช่น ปลานีออน" />
      <Select value={type} onValueChange={(v) => setType(v as SpriteType)}>
        <SelectTrigger className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fish">🐟 ปลา (ว่ายอัตโนมัติ)</SelectItem>
          <SelectItem value="object">🌿 ของตกแต่ง (อยู่นิ่ง)</SelectItem>
        </SelectContent>
      </Select>
      <div className="sprite-meta-buttons">
        <Button type="button" onClick={() => engine.saveCurrentSprite(name, type, onError)}>
          <i className="fa-solid fa-floppy-disk" /> บันทึกลงคลัง
        </Button>
        <Button type="button" variant="secondary" onClick={() => engine.newSprite(onConfirmDiscard)}>
          <i className="fa-solid fa-file" /> สร้างใหม่
        </Button>
      </div>
      <div className="export-buttons">
        <Button type="button" variant="secondary" onClick={() => engine.exportFramePng()}>
          <i className="fa-solid fa-download" /> Export PNG
        </Button>
        <Button type="button" variant="secondary" title="Export Sprite Sheet" onClick={() => engine.exportSpriteSheetPng()}>
          <i className="fa-solid fa-download" /> Export Sheet
        </Button>
      </div>
    </div>
  );
}
