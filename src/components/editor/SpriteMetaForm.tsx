import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
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
  const { t } = useLanguage();
  const [name, setName] = useState(engine.current.name);
  const [type, setType] = useState<SpriteType>(engine.current.type);

  useEffect(() => {
    setName(engine.current.name);
    setType(engine.current.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.loadToken]);

  return (
    <div className="sprite-meta">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.namePlaceholder')} />
      <Select value={type} onValueChange={(v) => setType(v as SpriteType)}>
        <SelectTrigger className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fish">{t('form.typeFish')}</SelectItem>
          <SelectItem value="object">{t('form.typeObject')}</SelectItem>
        </SelectContent>
      </Select>
      <div className="sprite-meta-buttons">
        <Button type="button" onClick={() => engine.saveCurrentSprite(name, type, onError)}>
          <i className="fa-solid fa-floppy-disk" /> {t('form.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => engine.newSprite(onConfirmDiscard)}>
          <i className="fa-solid fa-file" /> {t('form.new')}
        </Button>
      </div>
      <div className="export-buttons">
        <Button type="button" variant="secondary" onClick={() => engine.exportFramePng()}>
          <i className="fa-solid fa-download" /> {t('form.exportPng')}
        </Button>
        <Button type="button" variant="secondary" title={t('form.exportSheetTitle')} onClick={() => engine.exportSpriteSheetPng()}>
          <i className="fa-solid fa-download" /> {t('form.exportSheet')}
        </Button>
      </div>
    </div>
  );
}
