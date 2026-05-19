export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
export const RIGHT_PANEL_SHEET_CLASS_NAME =
  "w-[min(88vw,820px)] max-w-[820px] p-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]";

export const RIGHT_PANEL_WIDTH_STORAGE_KEY = "chat_right_panel_width";
export const RIGHT_PANEL_MIN_WIDTH = 22.5 * 16;
export const RIGHT_PANEL_DEFAULT_MAX_WIDTH = 44 * 16;
export const RIGHT_PANEL_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function resolveRightPanelMaxWidth(containerWidth: number): number {
  return Math.max(0, containerWidth - RIGHT_PANEL_MAIN_CONTENT_MIN_WIDTH);
}

export function clampRightPanelWidth(width: number, containerWidth: number): number {
  const maxWidth = resolveRightPanelMaxWidth(containerWidth);
  const minWidth = Math.min(RIGHT_PANEL_MIN_WIDTH, maxWidth);
  return Math.max(minWidth, Math.min(width, maxWidth));
}

export function resolveDefaultRightPanelWidth(containerWidth: number): number {
  return clampRightPanelWidth(
    Math.min(containerWidth * 0.42, RIGHT_PANEL_DEFAULT_MAX_WIDTH),
    containerWidth,
  );
}
