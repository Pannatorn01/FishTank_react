import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';

export function CanvasMetaBar({
  engine,
  name,
  setName,
  type,
  setType,
  onError,
  onConfirmDiscard,
}: {
  engine: PixelEditorEngine;
  name: string;
  setName: (name: string) => void;
  type: SpriteType;
  setType: (type: SpriteType) => void;
  onError: (msg: string) => void;
  onConfirmDiscard: () => boolean;
}) {
  const { t } = useLanguage();
  const importJsonInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="canvas-meta-bar">
      <Input
        className="status-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('form.namePlaceholder')}
      />
      <Select value={type} onValueChange={(v) => setType(v as SpriteType)}>
        <SelectTrigger className="w-48 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fish">{t('form.typeFish')}</SelectItem>
          <SelectItem value="object">{t('form.typeObject')}</SelectItem>
          <SelectItem value="room">{t('form.typeRoom')}</SelectItem>
          <SelectItem value="background">{t('form.typeBackground')}</SelectItem>
        </SelectContent>
      </Select>

      <Button
        type="button"
        size="sm"
        title={t('form.save')}
        onClick={() => engine.saveCurrentSprite(name, type, onError)}
      >
        <i className="fa-solid fa-floppy-disk" />
        {t('form.save')}
      </Button>

      <Button type="button" size="sm" variant="secondary" title={t('form.exportJson')} onClick={() => engine.exportSpriteJson()}>
        <i className="fa-solid fa-file-export" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        title={t('form.importJson')}
        onClick={() => importJsonInputRef.current?.click()}
      >
        <i className="fa-solid fa-file-import" />
      </Button>
      <input
        ref={importJsonInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) engine.importSpriteFromFile(file, onConfirmDiscard, onError);
        }}
      />
    </div>
  );
}
