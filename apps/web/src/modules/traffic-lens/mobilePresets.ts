import type { TrafficLensMobilePreset } from "@fenrir/contracts";

export interface TrafficLensMobilePresetDefinition {
  id: TrafficLensMobilePreset;
  label: string;
  screenWidth: number;
  screenHeight: number;
  shellWidth: number;
  shellHeight: number;
  shellKind: "ios-phone" | "android-phone" | "ios-tablet";
}

export const TRAFFIC_LENS_MOBILE_PRESETS: Record<
  TrafficLensMobilePreset,
  TrafficLensMobilePresetDefinition
> = {
  "iphone-15-pro": {
    id: "iphone-15-pro",
    label: "iPhone 15 Pro",
    screenWidth: 393,
    screenHeight: 720,
    shellWidth: 452,
    shellHeight: 926,
    shellKind: "ios-phone",
  },
  "pixel-8": {
    id: "pixel-8",
    label: "Pixel 8",
    screenWidth: 412,
    screenHeight: 760,
    shellWidth: 470,
    shellHeight: 932,
    shellKind: "android-phone",
  },
  "ipad-mini": {
    id: "ipad-mini",
    label: "iPad mini",
    screenWidth: 744,
    screenHeight: 940,
    shellWidth: 812,
    shellHeight: 1094,
    shellKind: "ios-tablet",
  },
};

export const TRAFFIC_LENS_MOBILE_PRESET_OPTIONS = (
  Object.values(TRAFFIC_LENS_MOBILE_PRESETS) satisfies readonly TrafficLensMobilePresetDefinition[]
).map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

export function getTrafficLensMobilePreset(
  preset: TrafficLensMobilePreset | undefined,
): TrafficLensMobilePresetDefinition {
  return TRAFFIC_LENS_MOBILE_PRESETS[preset ?? "iphone-15-pro"];
}
