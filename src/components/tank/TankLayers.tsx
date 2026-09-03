import { useState } from 'react';
import type { TankEngine } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import type { Instance, RoomInstance, SpriteType, TankGroup } from '@/lib/types';
import { PaletteThumb } from './TankPalette';

type Row = { kind: 'group'; group: TankGroup; members: Instance[] } | { kind: 'instance'; inst: Instance };

/** The Layers panel shows one sprite-type at a time (icon tabs switch between them), instead of
 *  one flat list mixing fish/decorations/room-decor together. */
type LayerTab = SpriteType;
const LAYER_TABS: LayerTab[] = ['fish', 'object', 'room'];
const TAB_ICON: Record<LayerTab, string> = { fish: 'fish', object: 'leaf', room: 'image' };

/** Front-to-back rows for the panel (front first, same convention as the sprite editor's LayerPanel):
 *  walk `instances` back-to-front and, the first time a grouped instance is seen, emit its whole
 *  (already-contiguous) member block as one group row instead of emitting members individually. */
function buildRows(engine: TankEngine): Row[] {
  const rows: Row[] = [];
  const seenGroups = new Set<string>();
  for (let i = engine.instances.length - 1; i >= 0; i--) {
    const inst = engine.instances[i];
    if (!inst.groupId) {
      rows.push({ kind: 'instance', inst });
      continue;
    }
    if (seenGroups.has(inst.groupId)) continue;
    seenGroups.add(inst.groupId);
    const group = engine.groups.find((g) => g.id === inst.groupId);
    if (!group) continue;
    const members = engine.instances
      .filter((m) => m.groupId === inst.groupId)
      .slice()
      .reverse();
    rows.push({ kind: 'group', group, members });
  }
  return rows;
}

/** Keeps only what belongs on `tab`: plain instance rows whose sprite matches, and - for a group
 *  row - only the members whose sprite matches (a group can mix fish and decorations, so it may
 *  show up on more than one tab with a different subset of members each time; dropped entirely if
 *  none of its members match). */
function filterRowsForTab(rows: Row[], engine: TankEngine, tab: 'fish' | 'object'): Row[] {
  const out: Row[] = [];
  rows.forEach((row) => {
    if (row.kind === 'instance') {
      if (engine.spriteFor(row.inst)?.type === tab) out.push(row);
      return;
    }
    const members = row.members.filter((m) => engine.spriteFor(m)?.type === tab);
    if (members.length) out.push({ kind: 'group', group: row.group, members });
  });
  return out;
}

function InstanceRow({
  engine,
  inst,
  nested,
  draggedId,
  setDraggedId,
  overId,
  setOverId,
}: {
  engine: TankEngine;
  inst: Instance;
  nested: boolean;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
  overId: string | null;
  setOverId: (id: string | null) => void;
}) {
  const { t } = useLanguage();
  const sprite = engine.spriteFor(inst);
  if (!sprite) return null;
  return (
    <div
      className={[
        'tank-layer-row',
        nested && 'nested',
        inst.id === engine.selectedId && 'active',
        engine.marqueeIds?.includes(inst.id) && 'selected',
        draggedId === inst.id && 'dragging',
        overId === inst.id && draggedId !== null && draggedId !== inst.id && 'drag-over',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        setDraggedId(inst.id);
      }}
      onDragEnd={() => {
        setDraggedId(null);
        setOverId(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (overId !== inst.id) setOverId(inst.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (draggedId) engine.moveRow(draggedId, 'instance', inst.id);
        setDraggedId(null);
        setOverId(null);
      }}
      onClick={(e) => (e.shiftKey ? engine.toggleMarqueeSelect([inst.id]) : engine.selectInstance(inst.id))}
    >
      <span className="tank-layer-drag-handle">
        <i className="fa-solid fa-grip-vertical" />
      </span>
      <PaletteThumb sprite={sprite} />
      <span className="tank-layer-name">
        <i className={`fa-solid fa-${sprite.type === 'fish' ? 'fish' : sprite.type === 'room' ? 'image' : 'leaf'}`} /> {sprite.name}
      </span>
      <button
        type="button"
        className="tank-layer-eye"
        title={t('layer.visible')}
        onClick={(e) => {
          e.stopPropagation();
          engine.setInstanceVisible(inst.id, !(inst.visible ?? true));
        }}
      >
        <i className={`fa-solid ${inst.visible ?? true ? 'fa-eye' : 'fa-eye-slash'}`} />
      </button>
    </div>
  );
}

/** Room decorations don't group, swim, or z-reorder against each other via the panel - just a
 *  flat list, click to select (wires into the same action-bar Delete used from the canvas) and an
 *  eye toggle, mirroring the plain (ungrouped) row above but backed by RoomInstance instead. */
function RoomInstanceRow({ engine, inst }: { engine: TankEngine; inst: RoomInstance }) {
  const { t } = useLanguage();
  const sprite = engine.spriteFor(inst);
  if (!sprite) return null;
  return (
    <div
      className={['tank-layer-row', inst.id === engine.selectedRoomId && 'active'].filter(Boolean).join(' ')}
      onClick={() => engine.selectRoomInstance(inst.id)}
    >
      <PaletteThumb sprite={sprite} />
      <span className="tank-layer-name">
        <i className="fa-solid fa-image" /> {sprite.name}
      </span>
      <button
        type="button"
        className="tank-layer-eye"
        title={t('layer.visible')}
        onClick={(e) => {
          e.stopPropagation();
          engine.setRoomInstanceVisible(inst.id, !(inst.visible ?? true));
        }}
      >
        <i className={`fa-solid ${inst.visible ?? true ? 'fa-eye' : 'fa-eye-slash'}`} />
      </button>
    </div>
  );
}

export function TankLayers({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<LayerTab>('fish');
  const rows = tab === 'room' ? [] : filterRowsForTab(buildRows(engine), engine, tab);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const commitRename = (id: string) => {
    engine.renameGroup(id, draftName);
    setRenamingId(null);
  };

  return (
    <div className="tank-layers">
      <div className="panel-title">{t('tank.layersTitle')}</div>
      <div className="tank-layer-type-tabs">
        {LAYER_TABS.map((tt) => (
          <button
            key={tt}
            type="button"
            className={`tank-layer-type-tab${tab === tt ? ' active' : ''}`}
            title={t(`tank.layerTab.${tt}`)}
            onClick={() => setTab(tt)}
          >
            <i className={`fa-solid fa-${TAB_ICON[tt]}`} />
          </button>
        ))}
      </div>

      {tab === 'room' ? (
        <div className="tank-layer-list">
          {engine.roomInstances.length === 0 && <p className="palette-hint">{t('tank.layersEmpty')}</p>}
          {engine.roomInstances
            .slice()
            .reverse()
            .map((inst) => (
              <RoomInstanceRow key={inst.id} engine={engine} inst={inst} />
            ))}
        </div>
      ) : (
        <>
          {rows.length === 0 && <p className="palette-hint">{t('tank.layersEmpty')}</p>}
          <div className="tank-layer-list">
        {rows.map((row) => {
          if (row.kind !== 'group') {
            return (
              <InstanceRow
                key={row.inst.id}
                engine={engine}
                inst={row.inst}
                nested={false}
                draggedId={draggedId}
                setDraggedId={setDraggedId}
                overId={overId}
                setOverId={setOverId}
              />
            );
          }
          const collapsed = collapsedGroups.has(row.group.id);
          const anyVisible = row.members.some((m) => m.visible ?? true);
          return (
            <div key={row.group.id}>
              <div
                className={[
                  'tank-layer-row',
                  'group-header',
                  row.members.length > 0 && row.members.every((m) => engine.marqueeIds?.includes(m.id)) && 'selected',
                  draggedId === row.group.id && 'dragging',
                  overId === row.group.id && draggedId !== null && draggedId !== row.group.id && 'drag-over',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedId(row.group.id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overId !== row.group.id) setOverId(row.group.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId) engine.moveRow(draggedId, 'group', row.group.id);
                  setDraggedId(null);
                  setOverId(null);
                }}
                onClick={(e) => {
                  if (e.shiftKey) engine.toggleMarqueeSelect(row.members.map((m) => m.id));
                }}
              >
                <div className="tank-layer-row-main">
                  <span className="tank-layer-drag-handle">
                    <i className="fa-solid fa-grip-vertical" />
                  </span>
                  <button
                    type="button"
                    className="tank-layer-collapse"
                    title={collapsed ? t('tank.expandGroup') : t('tank.collapseGroup')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapsed(row.group.id);
                    }}
                  >
                    <i className={`fa-solid ${collapsed ? 'fa-folder' : 'fa-folder-open'} tank-layer-folder-icon`} />
                  </button>
                  {renamingId === row.group.id ? (
                    <input
                      className="layer-name-input"
                      value={draftName}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(row.group.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(row.group.id);
                        else if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span
                      className="tank-layer-name"
                      title={t('tank.renameGroupHint')}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setDraftName(row.group.name);
                        setRenamingId(row.group.id);
                      }}
                    >
                      {row.group.name}
                    </span>
                  )}
                  <button
                    type="button"
                    className="tank-layer-eye"
                    title={t('layer.visible')}
                    onClick={(e) => {
                      e.stopPropagation();
                      engine.setInstancesVisible(row.members.map((m) => m.id), !anyVisible);
                    }}
                  >
                    <i className={`fa-solid ${anyVisible ? 'fa-eye' : 'fa-eye-slash'}`} />
                  </button>
                </div>
                <div className="tank-layer-row-actions">
                  <span className="tank-layer-count">{t('tank.groupMembers', { n: row.members.length })}</span>
                  <button
                    type="button"
                    className="tank-layer-ungroup"
                    title={t('tank.ungroup')}
                    onClick={(e) => {
                      e.stopPropagation();
                      engine.ungroup(row.group.id);
                    }}
                  >
                    <i className="fa-solid fa-object-ungroup" />
                  </button>
                  <button
                    type="button"
                    className="tank-layer-del"
                    title={t('tank.deleteGroup')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(t('tank.deleteGroupConfirm'))) engine.deleteGroup(row.group.id);
                    }}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
              {!collapsed &&
                row.members.map((inst) => (
                  <InstanceRow
                    key={inst.id}
                    engine={engine}
                    inst={inst}
                    nested
                    draggedId={draggedId}
                    setDraggedId={setDraggedId}
                    overId={overId}
                    setOverId={setOverId}
                  />
                ))}
            </div>
          );
        })}
          </div>
        </>
      )}
    </div>
  );
}
