import { isMacPlatform } from "./utils";

export const DESKTOP_TITLEBAR_LEADING_INSET_CLASS_NAME =
  "pl-[90px] sm:pl-[90px] wco:pl-[calc(env(titlebar-area-x)+1em)]";

export const DESKTOP_TITLEBAR_TRAILING_CONTROLS_INSET_CLASS_NAME =
  "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]";

export function shouldReserveDesktopTitlebarLeadingInset(input: {
  isElectron: boolean;
  isMobile: boolean;
  platform: string;
  sidebarOpen: boolean;
}): boolean {
  return input.isElectron && !input.isMobile && !input.sidebarOpen && isMacPlatform(input.platform);
}
