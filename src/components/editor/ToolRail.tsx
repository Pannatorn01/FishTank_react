import { useEffect, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { ToolName } from '@/lib/types';

/** How long (ms) a press must be held before a grouped button opens its flyout instead of just
 *  quick-activating its remembered tool - matches Aseprite's press-and-hold convention. */
const HOLD_MS = 380;

type ToolIcon = { tool: ToolName; icon: string };

/** Aseprite-style single narrow column: standalone tools plus four flyout groups (Select/Lasso,
 *  Line/Curve, Rect/Ellipse, Fill/Gradient), split into draw / shape / selection clusters by thin
 *  dividers instead of the old boxed 4-wide grids with text labels. */
type RailEntry =
  | { kind: 'single'; tool: ToolName; icon: string }
  | { kind: 'flyout'; id: string; tools: ToolIcon[] }
  | { kind: 'divider' };

const RAIL_ENTRIES: RailEntry[] = [
  { kind: 'single', tool: 'pen', icon: 'pen' },
  { kind: 'single', tool: 'eraser', icon: 'eraser' },
  { kind: 'flyout', id: 'line', tools: [{ tool: 'line', icon: 'slash' }, { tool: 'curve', icon: 'bezier-curve' }] },
  { kind: 'flyout', id: 'fill', tools: [{ tool: 'fill', icon: 'fill-drip' }, { tool: 'gradient', icon: 'circle-half-stroke' }] },
  { kind: 'single', tool: 'eyedropper', icon: 'eye-dropper' },
  { kind: 'single', tool: 'spray', icon: 'spray-can' },
  { kind: 'divider' },
  { kind: 'flyout', id: 'shape', tools: [{ tool: 'rect', icon: 'square' }, { tool: 'ellipse', icon: 'circle' }] },
  { kind: 'divider' },
  {
    kind: 'flyout',
    id: 'select',
    tools: [
      { tool: 'select', icon: 'vector-square' },
      { tool: 'lasso', icon: 'draw-polygon' },
      { tool: 'magicWand', icon: 'wand-magic-sparkles' },
    ],
  },
  { kind: 'single', tool: 'move', icon: 'up-down-left-right' },
];

const FLYOUT_GROUPS = RAIL_ENTRIES.filter((e): e is Extract<RailEntry, { kind: 'flyout' }> => e.kind === 'flyout');

function ToolButton({ tool, icon, engine, t }: { tool: ToolName; icon: string; engine: PixelEditorEngine; t: (k: string) => string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant={engine.tool === tool ? 'default' : 'secondary'}
      title={t(`tool.${tool}.desc`)}
      onClick={() => engine.setTool(tool)}
    >
      <i className={`fa-solid fa-${icon}`} />
    </Button>
  );
}

function ToolFlyoutButton({
  group,
  remembered,
  onRemember,
  engine,
  t,
}: {
  group: Extract<RailEntry, { kind: 'flyout' }>;
  remembered: ToolName;
  onRemember: (tool: ToolName) => void;
  engine: PixelEditorEngine;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => () => clearHoldTimer(), []);

  const activeMember = group.tools.find((x) => x.tool === engine.tool);
  const displayed = activeMember ?? group.tools.find((x) => x.tool === remembered) ?? group.tools[0];
  const isSelected = activeMember != null;

  const activate = (tool: ToolName) => {
    engine.setTool(tool);
    onRemember(tool);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    openedByHoldRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      openedByHoldRef.current = true;
      setOpen(true);
    }, HOLD_MS);
  };

  const handlePointerUp = () => {
    if (holdTimerRef.current != null) {
      // Released before the hold threshold - a normal quick click, not a flyout open.
      clearHoldTimer();
      if (!openedByHoldRef.current) activate(displayed.tool);
    }
  };

  const handlePointerLeaveOrCancel = () => {
    // Aborted press (dragged off the button) - just stop the pending timer, no activation and no open.
    clearHoldTimer();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(displayed.tool);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <Button
          type="button"
          size="icon"
          variant={isSelected ? 'default' : 'secondary'}
          title={t(`tool.${displayed.tool}.desc`)}
          className="tool-flyout-trigger"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeaveOrCancel}
          onPointerCancel={handlePointerLeaveOrCancel}
          onKeyDown={handleKeyDown}
        >
          <i className={`fa-solid fa-${displayed.icon}`} />
        </Button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={4}
          className="retro pixel-panel-chrome tool-flyout-content"
          onEscapeKeyDown={() => setOpen(false)}
        >
          {group.tools.map(({ tool, icon }) => (
            <button
              key={tool}
              type="button"
              className="tool-flyout-item"
              data-active={tool === engine.tool || undefined}
              onClick={() => {
                activate(tool);
                setOpen(false);
              }}
            >
              <i className={`fa-solid fa-${icon}`} />
              <span>{t(`tool.${tool}.short`)}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ToolRail({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const [remembered, setRemembered] = useState<Record<string, ToolName>>(() => {
    const initial: Record<string, ToolName> = {};
    for (const g of FLYOUT_GROUPS) initial[g.id] = g.tools[0].tool;
    return initial;
  });

  // Keep each group's "remembered" slot in sync when engine.tool changes to one of its members via any
  // path (keyboard shortcut, flyout item click, etc.) - so a quick click always repeats the last tool
  // actually used from that group, not just the last one picked from the popup.
  useEffect(() => {
    for (const g of FLYOUT_GROUPS) {
      if (g.tools.some((x) => x.tool === engine.tool) && remembered[g.id] !== engine.tool) {
        setRemembered((prev) => ({ ...prev, [g.id]: engine.tool }));
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.tool]);

  return (
    <>
      <div className="tool-rail">
        <div className="tool-rail-icons">
          {RAIL_ENTRIES.map((entry, i) => {
            if (entry.kind === 'divider') return <div key={`div-${i}`} className="tool-divider" />;
            if (entry.kind === 'single') return <ToolButton key={entry.tool} tool={entry.tool} icon={entry.icon} engine={engine} t={t} />;
            return (
              <ToolFlyoutButton
                key={entry.id}
                group={entry}
                remembered={remembered[entry.id] ?? entry.tools[0].tool}
                onRemember={(tool) => setRemembered((prev) => ({ ...prev, [entry.id]: tool }))}
                engine={engine}
                t={t}
              />
            );
          })}
        </div>
      </div>
      <div className="tool-actions">
        <Button type="button" size="icon" variant="secondary" title={t('action.undo')} disabled={!engine.canUndo()} onClick={() => engine.undo()}>
          <i className="fa-solid fa-arrow-rotate-left w-100" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('action.redo')} disabled={!engine.canRedo()} onClick={() => engine.redo()}>
          <i className="fa-solid fa-arrow-rotate-right w-100" />
        </Button>
      </div>
    </>
  );
}
