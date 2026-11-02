// Colour tokens for the approval page (docs/DESIGN.md section 2). The ONE source of truth:
// styles.ts turns them into CSS custom properties and scripts/checkContrast.ts checks them.

export const COLOR_TOKEN_NAMES = [
  'bg',
  'surface',
  'surfaceSunken',
  'surfaceRaised',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'accent',
  'accentHover',
  'accentEdge',
  'onAccent',
  'accentTint',
  'accentInk',
  'link',
  'focus',
  'sevHighTint',
  'sevHighInk',
  'sevHighGlyph',
  'sevMediumTint',
  'sevMediumInk',
  'sevMediumGlyph',
  'sevLowTint',
  'sevLowInk',
  'sevLowGlyph',
  'sevInfoTint',
  'sevInfoInk',
  'sevInfoGlyph',
  'modeBarBg',
  'modeBarText',
  'warnTint',
  'warnInk',
  'warnEdge',
  'sidebarBg',
  'sidebarText',
  'sidebarMuted',
  'sidebarActive',
  'sidebarActiveText',
  'sidebarBorder',
  'successTint',
  'successInk',
  'successEdge',
] as const;
export type ColorToken = (typeof COLOR_TOKEN_NAMES)[number];
/** Light mode only (Prompt 6 decision): one theme, designed for office daylight. */
export type ThemeName = 'light';
export type Theme = Record<ColorToken, string>;

/**
 * Prompt 8 palette scales (D-125). The semantic tokens take their values from these steps; styles.ts also publishes
 * every step as --blue-<n> / --gray-<n>. Blue is a clear, confident brand blue (hue about 221deg, not indigo); the
 * greys are slate, tinted towards the blue, so the whole page reads as one cool, light family.
 */
export const BLUE = {
  50: '#EEF4FF',
  100: '#DDE8FE',
  200: '#BFD3FD',
  300: '#93B4FA',
  400: '#4F80EC',
  500: '#3A72F0',
  600: '#2160E0',
  700: '#1A4DB8',
  800: '#173F91',
  900: '#14336F',
} as const;

export const GRAY = {
  25: '#F9FBFE',
  50: '#F3F6FB',
  100: '#E9EEF6',
  200: '#DCE3EE',
  300: '#C5CFDE',
  400: '#98A5BA',
  500: '#6B7891',
  600: '#4E5B74',
  700: '#36425A',
  800: '#1F2A44',
  900: '#0F1B3D',
} as const;

/**
 * Light and blue: white cards on a light blue-grey ground, deep navy ink, one brand blue for actions, links, focus
 * and the current page. Status colours are clear and saturated enough to read at a glance, always as pale tint +
 * dark ink of the same hue, and never the brand blue (Low is teal, Info is blue-grey).
 */
export const THEMES: Record<ThemeName, Theme> = {
  light: {
    bg: GRAY[50],
    surface: '#FFFFFF',
    surfaceSunken: GRAY[25],
    surfaceRaised: '#FFFFFF',
    border: '#D6DEEA',
    borderStrong: '#7A88A1',
    text: GRAY[900],
    textMuted: GRAY[600],
    accent: BLUE[600],
    accentHover: BLUE[700],
    accentEdge: BLUE[400],
    onAccent: '#FFFFFF',
    accentTint: BLUE[50],
    accentInk: BLUE[800],
    link: BLUE[600],
    focus: BLUE[600],
    sevHighTint: '#FEEBEC',
    sevHighInk: '#A3161B',
    sevHighGlyph: '#E5484D',
    sevMediumTint: '#FFF3D6',
    sevMediumInk: '#7F4500',
    sevMediumGlyph: '#B87300',
    sevLowTint: '#DEF7F1',
    sevLowInk: '#0A5E52',
    sevLowGlyph: '#0E8A7C',
    sevInfoTint: '#EBF0F8',
    sevInfoInk: '#3F4D68',
    sevInfoGlyph: '#74829E',
    modeBarBg: '#FFF7E3',
    modeBarText: '#6E3F00',
    warnTint: '#FFF5DE',
    warnInk: '#7F4500',
    warnEdge: '#C27A00',
    sidebarBg: '#FFFFFF',
    sidebarText: GRAY[900],
    sidebarMuted: GRAY[600],
    sidebarActive: BLUE[50],
    sidebarActiveText: BLUE[700],
    sidebarBorder: '#D6DEEA',
    successTint: '#E2F7EA',
    successInk: '#11643A',
    successEdge: '#1F9D55',
  },
};

/** 'surfaceSunken' -> '--surface-sunken'. */
export function cssVarName(token: ColorToken): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export type PairKind = 'text' | 'ui' | 'decorative';

export interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  kind: PairKind;
  why: string;
}

/** WCAG 2.x 1.4.3 (text 4.5:1) and 1.4.11 (control boundaries, focus, meaningful graphics 3:1). */
export const THRESHOLDS: Record<PairKind, number> = { text: 4.5, ui: 3, decorative: 1.2 };

const textOn = (fg: ColorToken, bgs: ColorToken[], why: string): ContrastPair[] => bgs.map((bg) => ({ fg, bg, kind: 'text' as const, why }));

/** Every foreground/background pair the stylesheet actually uses. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...textOn('text', ['bg', 'surface', 'surfaceSunken', 'surfaceRaised', 'accentTint', 'warnTint'], 'body text'),
  ...textOn('textMuted', ['bg', 'surface', 'surfaceSunken', 'surfaceRaised'], 'secondary text'),
  ...textOn('link', ['bg', 'surface', 'surfaceSunken', 'surfaceRaised'], 'links'),
  ...textOn('accentHover', ['bg', 'surface', 'surfaceRaised'], 'hovered links'),
  { fg: 'onAccent', bg: 'accent', kind: 'text', why: 'primary button label' },
  { fg: 'onAccent', bg: 'accentHover', kind: 'text', why: 'primary button label (hover)' },
  { fg: 'accentInk', bg: 'accentTint', kind: 'text', why: 'resolved banner text' },
  { fg: 'sevHighInk', bg: 'sevHighTint', kind: 'text', why: 'High badge word' },
  { fg: 'sevMediumInk', bg: 'sevMediumTint', kind: 'text', why: 'Medium badge word' },
  { fg: 'sevLowInk', bg: 'sevLowTint', kind: 'text', why: 'Low badge word' },
  { fg: 'sevInfoInk', bg: 'sevInfoTint', kind: 'text', why: 'Info badge word' },
  { fg: 'modeBarText', bg: 'modeBarBg', kind: 'text', why: 'FAKE-LLM bar' },
  { fg: 'warnInk', bg: 'warnTint', kind: 'text', why: 'sync-failure banner text' },
  { fg: 'sevHighGlyph', bg: 'sevHighTint', kind: 'ui', why: 'High shape' },
  { fg: 'sevMediumGlyph', bg: 'sevMediumTint', kind: 'ui', why: 'Medium shape' },
  { fg: 'sevLowGlyph', bg: 'sevLowTint', kind: 'ui', why: 'Low shape' },
  { fg: 'sevInfoGlyph', bg: 'sevInfoTint', kind: 'ui', why: 'Info shape' },
  { fg: 'warnEdge', bg: 'warnTint', kind: 'ui', why: 'sync-failure banner shape' },
  { fg: 'accentInk', bg: 'accentTint', kind: 'ui', why: 'resolved banner shape' },
  { fg: 'borderStrong', bg: 'surface', kind: 'ui', why: 'secondary button outline' },
  { fg: 'borderStrong', bg: 'surfaceRaised', kind: 'ui', why: 'secondary button outline in the decision panel' },
  { fg: 'borderStrong', bg: 'bg', kind: 'ui', why: 'chip outline on the page' },
  { fg: 'accent', bg: 'surface', kind: 'ui', why: 'primary button edge' },
  { fg: 'accent', bg: 'surfaceRaised', kind: 'ui', why: 'primary button edge in the decision panel' },
  { fg: 'focus', bg: 'bg', kind: 'ui', why: 'focus ring' },
  { fg: 'focus', bg: 'surface', kind: 'ui', why: 'focus ring' },
  { fg: 'focus', bg: 'surfaceRaised', kind: 'ui', why: 'focus ring' },
  { fg: 'focus', bg: 'accentTint', kind: 'ui', why: 'focus ring inside the resolved banner' },
  { fg: 'sidebarText', bg: 'sidebarBg', kind: 'text', why: 'sidebar links and product name' },
  { fg: 'sidebarText', bg: 'sidebarActive', kind: 'text', why: 'current sidebar link and counts' },
  { fg: 'sidebarMuted', bg: 'sidebarBg', kind: 'text', why: 'sidebar notes and role' },
  { fg: 'onAccent', bg: 'accent', kind: 'ui', why: 'logo mark letters' },
  { fg: 'accentInk', bg: 'surface', kind: 'ui', why: 'approved banner icon on its white disc' },
  { fg: 'warnEdge', bg: 'surface', kind: 'ui', why: 'warning banner icon on its white disc' },
  { fg: 'accentInk', bg: 'surface', kind: 'text', why: 'highlighted KPI number' },
  { fg: 'warnInk', bg: 'warnTint', kind: 'text', why: 'sync problem note in a decided row' },
  { fg: 'sidebarText', bg: 'sidebarBg', kind: 'ui', why: 'focus ring inside the sidebar' },
  // Prompt 7: upload pages.
  { fg: 'borderStrong', bg: 'surfaceSunken', kind: 'ui', why: 'file input outline on its sunken drop area' },
  { fg: 'accent', bg: 'accentTint', kind: 'ui', why: 'finished / current progress step ring' },
  { fg: 'text', bg: 'warnTint', kind: 'text', why: 'consent tick label on its tinted box' },
  // Prompt 8: blue redesign.
  { fg: 'sidebarActiveText', bg: 'sidebarActive', kind: 'text', why: 'current sidebar link and its count' },
  { fg: 'sidebarActiveText', bg: 'sidebarActive', kind: 'ui', why: 'sliding sidebar indicator edge' },
  { fg: 'successInk', bg: 'successTint', kind: 'text', why: 'approved banner, Approved pill, High confidence, finished checks' },
  { fg: 'successEdge', bg: 'successTint', kind: 'ui', why: 'approved banner edge and done icon' },
  { fg: 'successInk', bg: 'surface', kind: 'ui', why: 'approved banner icon on its white disc' },
  { fg: 'accentInk', bg: 'accentTint', kind: 'text', why: 'public demo bar and current progress step' },
  { fg: 'link', bg: 'accentTint', kind: 'text', why: 'links inside a blue-tinted band' },
  { fg: 'textMuted', bg: 'accentTint', kind: 'text', why: 'secondary text on the current progress step' },
  { fg: 'onAccent', bg: 'accentInk', kind: 'ui', why: 'logo mark letters on the dark end of its gradient' },
  { fg: 'accentEdge', bg: 'surface', kind: 'ui', why: 'blue outline of the row Approve buttons' },
  { fg: 'accentEdge', bg: 'surfaceSunken', kind: 'ui', why: 'blue outline of the row Approve buttons on a hovered row' },
  { fg: 'accentHover', bg: 'accentTint', kind: 'text', why: 'row Approve label on its hover tint' },
  { fg: 'border', bg: 'surface', kind: 'decorative', why: 'hairline between content (not a control; WCAG 1.4.11 does not apply)' },
  { fg: 'border', bg: 'bg', kind: 'decorative', why: 'hairline around cards' },
];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of '#RRGGBB'. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => channel(Number.parseInt(part as string, 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastResult extends ContrastPair {
  theme: ThemeName;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Every pair in every theme. Strict comparison: 2.999 does not meet 3 (WCAG wording). */
export function checkAllContrast(): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const theme of Object.keys(THEMES) as ThemeName[]) {
    for (const pair of CONTRAST_PAIRS) {
      const ratio = contrastRatio(THEMES[theme][pair.fg], THEMES[theme][pair.bg]);
      const min = THRESHOLDS[pair.kind];
      results.push({ ...pair, theme, ratio, min, pass: ratio >= min });
    }
  }
  return results;
}
