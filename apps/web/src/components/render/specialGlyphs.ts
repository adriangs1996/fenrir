export interface GlyphFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function leftBlock(cellWidth: number, cellHeight: number, fraction: number): GlyphFillRect {
  return {
    x: 0,
    y: 0,
    width: cellWidth * fraction,
    height: cellHeight,
  };
}

function rightBlock(cellWidth: number, cellHeight: number, fraction: number): GlyphFillRect {
  const width = cellWidth * fraction;
  return {
    x: cellWidth - width,
    y: 0,
    width,
    height: cellHeight,
  };
}

function upperBlock(cellWidth: number, cellHeight: number, fraction: number): GlyphFillRect {
  return {
    x: 0,
    y: 0,
    width: cellWidth,
    height: cellHeight * fraction,
  };
}

function lowerBlock(cellWidth: number, cellHeight: number, fraction: number): GlyphFillRect {
  const height = cellHeight * fraction;
  return {
    x: 0,
    y: cellHeight - height,
    width: cellWidth,
    height,
  };
}

function verticalStroke(cellWidth: number, cellHeight: number, thickness: number): GlyphFillRect {
  const width = Math.min(cellWidth, Math.max(1, thickness));
  return {
    x: (cellWidth - width) / 2,
    y: 0,
    width,
    height: cellHeight,
  };
}

function dashedVerticalStroke(
  cellWidth: number,
  cellHeight: number,
  thickness: number,
  segments: number,
): GlyphFillRect[] {
  if (segments <= 1) return [verticalStroke(cellWidth, cellHeight, thickness)];
  const width = Math.min(cellWidth, Math.max(1, thickness));
  const segmentHeight = cellHeight / (segments * 2 - 1);
  const x = (cellWidth - width) / 2;
  return Array.from({ length: segments }, (_, index) => ({
    x,
    y: index * segmentHeight * 2,
    width,
    height: segmentHeight,
  }));
}

/**
 * Procedural glyphs for the characters most likely to be used as indent guides
 * or block-based scope markers. Fonts often leave vertical padding around
 * these glyphs, which creates visible gaps between rows in a cell renderer.
 */
export function getSpecialGlyphFillRects(
  cp: number,
  cellWidth: number,
  cellHeight: number,
): GlyphFillRect[] | null {
  if (!Number.isFinite(cp) || !Number.isFinite(cellWidth) || !Number.isFinite(cellHeight))
    return null;
  if (cellWidth <= 0 || cellHeight <= 0) return null;

  if (cp === 0x2588) return [leftBlock(cellWidth, cellHeight, 1)];
  if (cp >= 0x2589 && cp <= 0x258f) {
    return [leftBlock(cellWidth, cellHeight, (0x2590 - cp) / 8)];
  }
  if (cp >= 0x2581 && cp <= 0x2587) {
    return [lowerBlock(cellWidth, cellHeight, (cp - 0x2580) / 8)];
  }
  if (cp === 0x2580) return [upperBlock(cellWidth, cellHeight, 0.5)];
  if (cp === 0x2584) return [lowerBlock(cellWidth, cellHeight, 0.5)];
  if (cp === 0x2590) return [rightBlock(cellWidth, cellHeight, 0.5)];
  if (cp === 0x2594) return [upperBlock(cellWidth, cellHeight, 1 / 8)];
  if (cp === 0x2595) return [rightBlock(cellWidth, cellHeight, 1 / 8)];

  const lightThickness = Math.max(1, cellWidth / 10);
  const heavyThickness = Math.max(lightThickness + 0.5, cellWidth / 6);
  switch (cp) {
    case 0x2502:
      return [verticalStroke(cellWidth, cellHeight, lightThickness)];
    case 0x2503:
      return [verticalStroke(cellWidth, cellHeight, heavyThickness)];
    case 0x2506:
      return dashedVerticalStroke(cellWidth, cellHeight, lightThickness, 3);
    case 0x2507:
      return dashedVerticalStroke(cellWidth, cellHeight, heavyThickness, 3);
    case 0x250a:
      return dashedVerticalStroke(cellWidth, cellHeight, lightThickness, 4);
    case 0x250b:
      return dashedVerticalStroke(cellWidth, cellHeight, heavyThickness, 4);
    default:
      return null;
  }
}

export function rasterizeSpecialGlyph(
  ctx: CanvasRenderingContext2D,
  cp: number,
  slotX: number,
  slotY: number,
  cellWidth: number,
  cellHeight: number,
): boolean {
  const rects = getSpecialGlyphFillRects(cp, cellWidth, cellHeight);
  if (!rects) return false;
  for (const rect of rects) {
    ctx.fillRect(slotX + rect.x, slotY + rect.y, rect.width, rect.height);
  }
  return true;
}
