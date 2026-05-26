import type { TrafficLensMobilePreset } from "@fenrir/contracts";

export interface TrafficLensMobilePresetDefinition {
  id: TrafficLensMobilePreset;
  label: string;
  screenWidth: number;
  screenHeight: number;
}

export const TRAFFIC_LENS_MOBILE_PRESETS: Record<
  TrafficLensMobilePreset,
  TrafficLensMobilePresetDefinition
> = {
  "iphone-15-pro": {
    id: "iphone-15-pro",
    label: "Phone Narrow",
    screenWidth: 390,
    screenHeight: 844,
  },
  "pixel-8": {
    id: "pixel-8",
    label: "Phone Wide",
    screenWidth: 412,
    screenHeight: 760,
  },
  "ipad-mini": {
    id: "ipad-mini",
    label: "Tablet",
    screenWidth: 744,
    screenHeight: 940,
  },
};

export const TRAFFIC_LENS_MOBILE_PRESET_OPTIONS = (
  Object.values(
    TRAFFIC_LENS_MOBILE_PRESETS,
  ) satisfies readonly TrafficLensMobilePresetDefinition[]
).map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

export function getTrafficLensMobilePreset(
  preset: TrafficLensMobilePreset | undefined,
): TrafficLensMobilePresetDefinition {
  return TRAFFIC_LENS_MOBILE_PRESETS[preset ?? "iphone-15-pro"];
}
