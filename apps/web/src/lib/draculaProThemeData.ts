export type DraculaProPalette = {
  fg: string;
  bg: string;
  bgdark: string;
  bgdarker: string;
  bglight: string;
  bglighter: string;
  comment: string;
  selection: string;
  subtle: string;
  cyan: string;
  green: string;
  orange: string;
  pink: string;
  purple: string;
  red: string;
  yellow: string;
};

const DRACULA_PRO_BASE_PALETTE = {
  fg: "#F8F8F2",
  bg: "#22212C",
  bgdark: "#17161D",
  bgdarker: "#0B0B0F",
  bglight: "#2E2B3B",
  bglighter: "#393649",
  comment: "#7970A9",
  selection: "#454158",
  subtle: "#424450",
  cyan: "#80FFEA",
  green: "#8AFF80",
  orange: "#FFCA80",
  pink: "#FF80BF",
  purple: "#9580FF",
  red: "#FF9580",
  yellow: "#FFFF80",
} as const satisfies DraculaProPalette;

export const DRACULA_PRO_VARIANTS = [
  {
    name: "dracula-pro",
    label: "Dracula Pro",
    palette: DRACULA_PRO_BASE_PALETTE,
  },
  {
    name: "dracula-pro-blade",
    label: "Dracula Pro Blade",
    palette: {
      ...DRACULA_PRO_BASE_PALETTE,
      comment: "#70A99F",
      selection: "#415854",
      bglighter: "#364946",
      bglight: "#2B3B38",
      bg: "#212C2A",
      bgdark: "#161D1C",
      bgdarker: "#0B0F0E",
    },
  },
  {
    name: "dracula-pro-buffy",
    label: "Dracula Pro Buffy",
    palette: {
      ...DRACULA_PRO_BASE_PALETTE,
      comment: "#9F70A9",
      selection: "#544158",
      bglighter: "#463649",
      bglight: "#382B3B",
      bg: "#2A212C",
      bgdark: "#1C161D",
      bgdarker: "#0E0B0F",
    },
  },
  {
    name: "dracula-pro-lincoln",
    label: "Dracula Pro Lincoln",
    palette: {
      ...DRACULA_PRO_BASE_PALETTE,
      comment: "#A99F70",
      selection: "#585441",
      bglighter: "#494636",
      bglight: "#3B382B",
      bg: "#2C2A21",
      bgdark: "#1D1C16",
      bgdarker: "#0F0E0B",
    },
  },
  {
    name: "dracula-pro-morbius",
    label: "Dracula Pro Morbius",
    palette: {
      ...DRACULA_PRO_BASE_PALETTE,
      comment: "#A97079",
      selection: "#584145",
      bglighter: "#493639",
      bglight: "#3B2B2E",
      bg: "#2C2122",
      bgdark: "#1D1617",
      bgdarker: "#0F0B0B",
    },
  },
  {
    name: "dracula-pro-van-helsing",
    label: "Dracula Pro Van Helsing",
    palette: {
      ...DRACULA_PRO_BASE_PALETTE,
      comment: "#708CA9",
      selection: "#414D58",
      bglighter: "#161A1D",
      bglight: "#111417",
      bg: "#0B0D0F",
      bgdark: "#070809",
      bgdarker: "#000000",
    },
  },
] as const;

export type DraculaProThemeName = (typeof DRACULA_PRO_VARIANTS)[number]["name"];
export type DraculaProVariant = (typeof DRACULA_PRO_VARIANTS)[number];

export const DRACULA_PRO_THEME_NAMES = DRACULA_PRO_VARIANTS.map(
  (variant) => variant.name,
) as readonly DraculaProThemeName[];

export const DRACULA_PRO_THEME_OPTIONS = DRACULA_PRO_VARIANTS.map((variant) => ({
  value: variant.name,
  label: variant.label,
})) as readonly { readonly value: DraculaProThemeName; readonly label: string }[];

export const DRACULA_PRO_CUSTOM_THEME_CONFIG = Object.fromEntries(
  DRACULA_PRO_VARIANTS.map((variant) => [
    variant.name,
    {
      className: variant.name,
      syntaxTheme: variant.name,
    },
  ]),
) as {
  readonly [Name in DraculaProThemeName]: {
    readonly className: Name;
    readonly syntaxTheme: Name;
  };
};
