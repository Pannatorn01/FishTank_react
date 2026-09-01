type Dict = Record<string, string>;

const en: Dict = {
  'tab.editor': 'Draw Fish/Decor',
  'tab.tank': 'Fish Tank',

  'tool.pen.desc': 'Pen — draw pixels one at a time (B)',
  'tool.line.desc': 'Line — drag to draw a straight line (L)',
  'tool.fill.desc': 'Fill — flood-fill a connected area (G)',
  'tool.eyedropper.desc': 'Eyedropper — click to pick a color from a pixel (I)',
  'tool.eraser.desc': 'Eraser — erase pixels (E)',
  'tool.rect.desc': 'Rectangle — drag to draw a rectangle (R)',
  'tool.ellipse.desc': 'Ellipse — drag to draw an ellipse (C)',
  'tool.select.desc': 'Select — drag to select a rectangular area (S) • drag inside to move it, drag a yellow corner/edge handle to resize (scales the artwork inside), drag the handle above to rotate freely',
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
  'status.selectionHint': 'Drag inside to move • drag a yellow corner/edge handle to resize (scales the artwork) • drag the handle above to rotate freely',
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

  'layer.title': 'Layers',
  'layer.add': 'Add Layer',
  'layer.visible': 'Show/hide layer',
  'layer.opacity': 'Layer opacity',
  'layer.duplicate': 'Duplicate layer',
  'layer.rename': 'Double-click to rename',
  'layer.mergeDown': 'Merge down',
  'layer.delete': 'Delete layer',
  'layer.drag': 'Drag to reorder',

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
  'preview.speed': 'Speed',
  'preview.fps': 'fps',

  'tank.dragHint': 'Drag fish/decorations into the tank',
  'tank.clearConfirm': 'Clear everything in the tank?',
  'tank.clearAll': 'Clear tank',
  'tank.deleteSelected': 'Delete selected',
  'tank.bringToFront': 'Bring to front',
  'tank.sendToBack': 'Send to back',
};

export function t(key: string, vars?: Record<string, string | number>): string {
  let str = en[key] ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(`{${k}}`, String(v));
    });
  }
  return str;
}

export function useLanguage(): { t: typeof t } {
  return { t };
}
