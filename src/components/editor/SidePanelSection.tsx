import { useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'fishtank.sidePanel.collapsed.';

/** Read once per mount. A failure here (private mode, blocked site data) just means "expanded", which
 *  is the state the panel had before this existed - never a reason to fail rendering. */
function loadCollapsed(id: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

/**
 * A collapsible section of the editor's right-hand rail. The rail stacks four panels in a fixed 190px
 * column, which on a short window pushed Layers - the one panel used constantly - below the fold. Each
 * section remembers its own state, so a layout someone sets up once survives a reload.
 *
 * The panels keep rendering their own contents unchanged; this only owns the header and whether the
 * body is shown. Collapsed content is unmounted rather than hidden, since these panels do real work on
 * render (the preview canvas, the layer thumbnails).
 */
export function SidePanelSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(id));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0');
    } catch {
      // Not being able to remember the choice is no reason to refuse to make it.
    }
  };

  return (
    <section className="side-section" data-collapsed={collapsed || undefined}>
      <button type="button" className="panel-title side-section-header" onClick={toggle} aria-expanded={!collapsed}>
        <span>{title}</span>
        <i className={`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`} aria-hidden="true" />
      </button>
      {!collapsed && children}
    </section>
  );
}
