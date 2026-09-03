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
}: {
  engine: PixelEditorEngine;
  name: string;
  setName: (name: string) => void;
  type: SpriteType;
  setType: (type: SpriteType) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useLanguage();

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
    </div>
  );
}
