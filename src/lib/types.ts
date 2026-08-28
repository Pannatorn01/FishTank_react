export type CellColor = string | null;
export type Frame = CellColor[];
export type SpriteType = 'fish' | 'object';

export interface Sprite {
  id: string | null;
  name: string;
  type: SpriteType;
  size: number;
  frames: Frame[];
}

export type ToolName =
  | 'pen'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'select'
  | 'move';

export type SymmetryMode = 'none' | 'vertical' | 'horizontal' | 'both';

export interface Cell {
  x: number;
  y: number;
}

export interface SelectionBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Instance {
  id: string;
  spriteId: string;
  kind: SpriteType;
  x: number;
  y: number;
  dir: 1 | -1;
  vx: number;
  frameIndex: number;
  frameTimer: number;
  bobPhase: number;
  isDragging: boolean;
}
