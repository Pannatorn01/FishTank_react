import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TankEngine } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';

/**
 * Which tank is open, and the three things you can do to the set of them: make one, rename this one,
 * throw one away.
 *
 * It renders nothing at all when the storage backend can only hold a single tank (a browser without
 * IndexedDB - see StorageAdapter.supportsMultipleTanks) or when looking at someone else's shared tank.
 * The switcher is also the only place the tank's *name* appears, which is why renaming lives here
 * rather than in the share panel where the name is merely displayed.
 */
export function TankSwitcher({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (!engine.supportsMultipleTanks || engine.tanks.length === 0) return null;

  // The same question in all three places, and the honest one: the tank is manual-save, so anything
  // that swaps its contents can lose work that is only in memory.
  const confirmDiscard = () => confirm(t('tank.switchDiscard'));

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  if (renaming) {
    const commit = async () => {
      await engine.renameTank(engine.tankId ?? '', draft);
      setRenaming(false);
    };
    return (
      <div className="tank-switcher">
        <Input
          className="tank-switcher-input"
          autoFocus
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
        <Button type="button" size="sm" disabled={busy} onClick={() => void run(commit)}>
          {t('tank.renameSave')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(false)}>
          {t('tank.renameCancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="tank-switcher">
      <Select
        value={engine.tankId ?? undefined}
        onValueChange={(id) => void run(() => engine.switchTank(id, confirmDiscard))}
      >
        <SelectTrigger className="tank-switcher-trigger text-xs" size="sm" title={t('tank.switchTitle')}>
          <SelectValue>
            <i className="fa-solid fa-water" aria-hidden="true" /> {engine.tankName || t('tank.untitled')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" position="popper">
          {engine.tanks.map((tank) => (
            <SelectItem key={tank.id} value={tank.id}>
              {tank.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        className="selection-toolbar-btn"
        title={t('tank.newTank')}
        disabled={busy}
        onClick={() => void run(() => engine.createTank(t('tank.newTankName'), confirmDiscard))}
      >
        <i className="fa-solid fa-plus" />
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        title={t('tank.renameTank')}
        disabled={busy}
        onClick={() => {
          setDraft(engine.tankName);
          setRenaming(true);
        }}
      >
        <i className="fa-solid fa-pen" />
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        // Disabled rather than hidden on the last tank: the control staying put, with a title that
        // explains itself, beats one that disappears whenever you are down to one tank.
        title={engine.tanks.length <= 1 ? t('tank.deleteLastTank') : t('tank.deleteTank')}
        disabled={busy || engine.tanks.length <= 1}
        onClick={() =>
          void run(() => engine.deleteTank(engine.tankId ?? '', () => confirm(t('tank.deleteConfirm', { name: engine.tankName }))))
        }
      >
        <i className="fa-solid fa-trash" />
      </button>
    </div>
  );
}
