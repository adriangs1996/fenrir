export interface GlyphFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RoundedCornerGlyphStroke {
  startX: number;
  startY: number;
  cornerX: number;
  cornerY: number;
  endX: number;
  endY: number;
  radius: number;
  thickness: number;
}

type PowerlineGlyphKind = "triangleLeft" | "triangleRight" | "roundLeft" | "roundRight";

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

function lightBoxStrokeThickness(cellWidth: number): number {
  return Math.max(1, cellWidth / 10);
}

function heavyBoxStrokeThickness(cellWidth: number): number {
  const lightThickness = lightBoxStrokeThickness(cellWidth);
  return Math.max(lightThickness + 0.5, cellWidth / 6);
}

function roundedCornerStroke(
  cp: number,
  cellWidth: number,
  cellHeight: number,
): RoundedCornerGlyphStroke | null {
  const centerX = cellWidth / 2;
  const centerY = cellHeight / 2;
  const thickness = lightBoxStrokeThickness(cellWidth);
  const radius = Math.max(thickness * 1.5, Math.min(cellWidth, cellHeight) * 0.3);

  switch (cp) {
    case 0x256d:
      return {
        startX: cellWidth,
        startY: centerY,
        cornerX: centerX,
        cornerY: centerY,
        endX: centerX,
        endY: cellHeight,
        radius,
        thickness,
      };
    case 0x256e:
      return {
        startX: 0,
        startY: centerY,
        cornerX: centerX,
        cornerY: centerY,
        endX: centerX,
        endY: cellHeight,
        radius,
        thickness,
      };
    case 0x256f:
      return {
        startX: 0,
        startY: centerY,
        cornerX: centerX,
        cornerY: centerY,
        endX: centerX,
        endY: 0,
        radius,
        thickness,
      };
    case 0x2570:
      return {
        startX: cellWidth,
        startY: centerY,
        cornerX: centerX,
        cornerY: centerY,
        endX: centerX,
        endY: 0,
        radius,
        thickness,
      };
    default:
      return null;
  }
}

function strokeRoundedCornerGlyph(
  ctx: CanvasRenderingContext2D,
  slotX: number,
  slotY: number,
  stroke: RoundedCornerGlyphStroke,
): void {
  // Draw rounded prompt borders ourselves so the centerline reaches the cell
  // edge and stays connected to adjacent box-drawing glyphs.
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = stroke.thickness;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(slotX + stroke.startX, slotY + stroke.startY);
  ctx.arcTo(
    slotX + stroke.cornerX,
    slotY + stroke.cornerY,
    slotX + stroke.endX,
    slotY + stroke.endY,
    stroke.radius,
  );
  ctx.lineTo(slotX + stroke.endX, slotY + stroke.endY);
  ctx.stroke();
}

function powerlineGlyphKind(cp: number): PowerlineGlyphKind | null {
  switch (cp) {
    case 0xe0b0:
      return "triangleRight";
    case 0xe0b2:
      return "triangleLeft";
    case 0xe0b4:
      return "roundRight";
    case 0xe0b6:
      return "roundLeft";
    default:
      return null;
  }
}

function fillPowerlineGlyph(
  ctx: CanvasRenderingContext2D,
  slotX: number,
  slotY: number,
  cellWidth: number,
  cellHeight: number,
  kind: PowerlineGlyphKind,
): void {
  const centerY = slotY + cellHeight / 2;
  ctx.beginPath();
  switch (kind) {
    case "triangleRight":
      ctx.moveTo(slotX, slotY);
      ctx.lineTo(slotX + cellWidth, centerY);
      ctx.lineTo(slotX, slotY + cellHeight);
      break;
    case "triangleLeft":
      ctx.moveTo(slotX + cellWidth, slotY);
      ctx.lineTo(slotX, centerY);
      ctx.lineTo(slotX + cellWidth, slotY + cellHeight);
      break;
    case "roundRight":
      ctx.moveTo(slotX, slotY);
      ctx.ellipse(slotX, centerY, cellWidth, cellHeight / 2, 0, -Math.PI / 2, Math.PI / 2);
      break;
    case "roundLeft":
      ctx.moveTo(slotX + cellWidth, slotY);
      ctx.ellipse(
        slotX + cellWidth,
        centerY,
        cellWidth,
        cellHeight / 2,
        0,
        -Math.PI / 2,
        Math.PI / 2,
        true,
      );
      break;
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Procedural glyphs for the characters most likely to show seams in a cell
 * renderer. Fonts often leave vertical padding around these glyphs, which
 * creates visible gaps between rows for indent guides and rounded prompt
 * borders.
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

  const lightThickness = lightBoxStrokeThickness(cellWidth);
  const heavyThickness = heavyBoxStrokeThickness(cellWidth);
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
  if (rects) {
    for (const rect of rects) {
      ctx.fillRect(slotX + rect.x, slotY + rect.y, rect.width, rect.height);
    }
    return true;
  }

  const powerlineGlyph = powerlineGlyphKind(cp);
  if (powerlineGlyph) {
    // Powerline prompt separators depend on the fg/bg color pair of the cell.
    // Font rasterization often pads them vertically, which leaves visible
    // seams in connected chips, so draw the common solid separators ourselves.
    fillPowerlineGlyph(ctx, slotX, slotY, cellWidth, cellHeight, powerlineGlyph);
    return true;
  }

  const roundedCorner = roundedCornerStroke(cp, cellWidth, cellHeight);
  if (!roundedCorner) return false;
  strokeRoundedCornerGlyph(ctx, slotX, slotY, roundedCorner);
  return true;
}
