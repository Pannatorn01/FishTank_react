import type { ToolContext } from '../types';

/** A minimal in-memory frame + ToolContext for tool unit tests - a flat `string | null` grid, no DOM. */
export function makeFrame(width: number, height: number, fill: (x: number, y: number) => string | null = () => null) {
  const cells: (string | null)[] = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cells[y * width + x] = fill(x, y);
  }
  return { width, height, cells };
}

export function makeContext(
  frame: ReturnType<typeof makeFrame>,
  overrides: Partial<ToolContext> = {}
): ToolContext {
  return {
    width: frame.width,
    height: frame.height,
    getCell: (x, y) => (x >= 0 && y >= 0 && x < frame.width && y < frame.height ? frame.cells[y * frame.width + x] : null),
    getVisibleColor: (x, y) => (x >= 0 && y >= 0 && x < frame.width && y < frame.height ? frame.cells[y * frame.width + x] : null),
    sprayDensity: 1,
    color: '#ff0000',
    secondaryColor: '#0000ff',
    brushSize: 1,
    ditherEnabled: false,
    pixelPerfect: true,
    shapeFilled: false,
    symmetry: 'none',
    symmetryAxisX: frame.width / 2,
    symmetryAxisY: frame.height / 2,
    selection: null,
    selectionMask: null,
    fillTolerance: 0,
    wandContiguous: true,
    selectionMode: 'new',
    ...overrides,
  };
}
