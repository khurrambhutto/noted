const { invoke } = window.__TAURI__.core;

const THEME_STORAGE_KEY = 'noted.themes';
const ACTIVE_THEME_KEY = 'noted.activeTheme';
const DEFAULT_THEME_NAME = 'Noted Paper';
let themeLoadWarnings = [];

export const ANTINOTE_THEME_KEYS = [
  'name', 'isDarkTheme',
  'background', 'backgroundFade',
  'typeMain', 'typeSubtle', 'typeSubtlePlus', 'typeHighlight',
  'typeLight', 'typeSuperlight', 'typeHyperLight', 'typeReverse',
  'accent1Main', 'accent1Secondary', 'accent1Tertiary',
  'accent2Main', 'accent2Secondary',
  'accent3Main', 'accent3Secondary',
  'accent4Main', 'accent4Secondary',
  'accent5Main', 'accent5Secondary',
  'gridSuperlight', 'gridClear', 'gridBold'
];

export const DEFAULT_THEMES = [
  {
    name: 'Noted Light',
    isDarkTheme: false,
    background: '#ffffff',
    backgroundFade: '#f4f4f4',
    typeMain: '#242424',
    typeSubtle: '#6d6d6d',
    typeSubtlePlus: '#4f7d9d',
    typeHighlight: '#e9e9e9',
    typeLight: '#a0a0a0',
    typeSuperlight: '#dddddd',
    typeHyperLight: '#f6f6f6',
    typeReverse: '#ffffff',
    accent1Main: '#7d7d7d',
    accent1Secondary: '#666666',
    accent1Tertiary: '#555555',
    accent2Main: '#7b61a8',
    accent2Secondary: '#684f93',
    accent3Main: '#5c8a55',
    accent3Secondary: '#477240',
    accent4Main: '#b97835',
    accent4Secondary: '#965d24',
    accent5Main: '#c75d55',
    accent5Secondary: '#9f443d',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false
  },
  {
    name: 'Noted Paper',
    isDarkTheme: false,
    background: '#f5f0eb',
    backgroundFade: '#eee7df',
    typeMain: '#2c2c2c',
    typeSubtle: '#7b7168',
    typeSubtlePlus: '#a89e94',
    typeHighlight: '#dfd5ca',
    typeLight: '#8f857b',
    typeSuperlight: '#d8ccc0',
    typeHyperLight: '#eee6de',
    typeReverse: '#ffffff',
    accent1Main: '#a89e94',
    accent1Secondary: '#8f857b',
    accent1Tertiary: '#766c63',
    accent2Main: '#b88764',
    accent2Secondary: '#9d7150',
    accent3Main: '#7a8f72',
    accent3Secondary: '#607357',
    accent4Main: '#d09354',
    accent4Secondary: '#a66d37',
    accent5Main: '#c35c51',
    accent5Secondary: '#9a443c',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false
  },
  {
    name: 'Noted Dark',
    isDarkTheme: true,
    background: '#1f1d1b',
    backgroundFade: '#292622',
    typeMain: '#eee7dc',
    typeSubtle: '#b6aa9d',
    typeSubtlePlus: '#d18f65',
    typeHighlight: '#3a342e',
    typeLight: '#8e8378',
    typeSuperlight: '#39342f',
    typeHyperLight: '#2a2723',
    typeReverse: '#1f1d1b',
    accent1Main: '#d18f65',
    accent1Secondary: '#b87952',
    accent1Tertiary: '#9d6546',
    accent2Main: '#b990d8',
    accent2Secondary: '#9e74bd',
    accent3Main: '#9ab37a',
    accent3Secondary: '#7f9961',
    accent4Main: '#d6a45f',
    accent4Secondary: '#b18445',
    accent5Main: '#d66d62',
    accent5Secondary: '#aa5149',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false
  },
  {
    name: 'Noted Glass',
    isDarkTheme: true,
    background: '#0B182026',
    backgroundFade: '#FFFFFF12',
    typeMain: '#F7FBFF',
    typeSubtle: '#D7E2EA',
    typeSubtlePlus: '#AEE7FF',
    typeHighlight: '#7DD6FF33',
    typeLight: '#B7C7D3',
    typeSuperlight: '#FFFFFF30',
    typeHyperLight: '#FFFFFF14',
    typeReverse: '#07121A',
    accent1Main: '#9DE7FF',
    accent1Secondary: '#63C7F2',
    accent1Tertiary: '#2F8FBE',
    accent2Main: '#D7C6FF',
    accent2Secondary: '#A68EF0',
    accent3Main: '#A8F0D5',
    accent3Secondary: '#62C5A4',
    accent4Main: '#FFE0A3',
    accent4Secondary: '#D9A85C',
    accent5Main: '#FF9AAE',
    accent5Secondary: '#D7667A',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false,
    isTranslucent: true,
    isGlass: true
  }
];

export function validateAntinoteTheme(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Theme must be a JSON object.');
  }

  if (!value.name || typeof value.name !== 'string') {
    throw new Error('Theme is missing a string "name" field.');
  }

  if (value.name.length > 100) {
    throw new Error('Theme name exceeds maximum length of 100 characters.');
  }

  const theme = { ...DEFAULT_THEMES[0], ...value };
  theme.gridEnabled = typeof value.gridEnabled === 'boolean'
    ? value.gridEnabled
    : hasVisibleGrid(value);
  theme.isTranslucent = typeof value.isTranslucent === 'boolean'
    ? value.isTranslucent
    : hasAlpha(theme.background) || hasAlpha(theme.backgroundFade);

  for (const key of ANTINOTE_THEME_KEYS) {
    if (key === 'name') continue;
    if (key === 'isDarkTheme') {
      theme[key] = Boolean(theme[key]);
      continue;
    }
    if (typeof theme[key] !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(theme[key])) {
      throw new Error(`Theme field "${key}" must be a hex color.`);
    }
  }

  return theme;
}

export async function loadThemes() {
  themeLoadWarnings = [];
  const fileThemes = await loadThemesFromDisk();
  const legacyThemes = loadLegacyLocalStorageThemes();
  return mergeThemes(DEFAULT_THEMES, legacyThemes, fileThemes);
}

export function getThemeLoadWarnings() {
  return [...themeLoadWarnings];
}

export async function saveImportedTheme(theme) {
  const validated = validateAntinoteTheme(theme);
  await invoke('save_theme_file', {
    name: validated.name,
    json: JSON.stringify(validated, null, 2)
  });
}

async function loadThemesFromDisk() {
  try {
    const files = await invoke('list_theme_files');
    const loaded = [];
    files.forEach((file) => {
      try {
        loaded.push(validateAntinoteTheme(JSON.parse(file.json)));
      } catch (error) {
        const name = file.name || 'unknown theme';
        themeLoadWarnings.push(`Skipped invalid theme "${name}"`);
        console.warn(`Could not load theme "${name}":`, error);
      }
    });
    return loaded;
  } catch (error) {
    console.warn('Could not load themes from disk:', error);
    return [];
  }
}

function loadLegacyLocalStorageThemes() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.map(validateAntinoteTheme) : [];
  } catch (error) {
    console.warn('Could not load legacy localStorage themes:', error);
    return [];
  }
}

export function getActiveThemeName() {
  return localStorage.getItem(ACTIVE_THEME_KEY) || DEFAULT_THEME_NAME;
}

export function setActiveThemeName(name) {
  localStorage.setItem(ACTIVE_THEME_KEY, name);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const mapped = mapThemeToCss(theme);
  Object.entries(mapped).forEach(([key, value]) => root.style.setProperty(key, value));
  root.dataset.theme = theme.isDarkTheme ? 'dark' : 'light';
  root.dataset.grid = theme.gridEnabled ? 'on' : 'off';
  root.dataset.translucent = theme.isTranslucent ? 'on' : 'off';
  root.dataset.glass = theme.isGlass ? 'on' : 'off';
}

export function mergeThemes(...groups) {
  const byName = new Map();
  groups.flat().forEach((theme) => byName.set(theme.name, validateAntinoteTheme(theme)));
  return [...byName.values()];
}

function hasAlpha(color) {
  return /^#[0-9a-fA-F]{8}$/.test(color) && color.slice(7).toLowerCase() !== 'ff';
}

function hasVisibleGrid(theme) {
  const gridKeys = ['gridSuperlight', 'gridClear', 'gridBold'];
  return gridKeys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(theme, key)) return false;
    const color = theme[key];
    if (typeof color !== 'string') return false;
    if (/^#[0-9a-fA-F]{8}$/.test(color) && color.slice(7).toLowerCase() === '00') return false;
    return stripAlpha(color).toLowerCase() !== stripAlpha(String(theme.background || '')).toLowerCase();
  });
}

function stripAlpha(color) {
  return /^#[0-9a-fA-F]{8}$/.test(color) ? color.slice(0, 7) : color;
}

function mapThemeToCss(theme) {
  return {
    '--theme-background': theme.background,
    '--theme-background-fade': theme.backgroundFade,
    '--theme-type-main': theme.typeMain,
    '--theme-type-subtle': theme.typeSubtle,
    '--theme-type-subtle-plus': theme.typeSubtlePlus,
    '--theme-type-highlight': theme.typeHighlight,
    '--theme-type-light': theme.typeLight,
    '--theme-type-superlight': theme.typeSuperlight,
    '--theme-type-hyperlight': theme.typeHyperLight,
    '--theme-type-reverse': theme.typeReverse,
    '--theme-accent-main': theme.accent1Main,
    '--theme-accent-secondary': theme.accent1Secondary,
    '--theme-accent-tertiary': theme.accent1Tertiary,
    '--theme-danger': theme.accent5Main,
    '--theme-control-text': readableTextColor(theme.accent1Main, theme),
    '--theme-accent-2-text': readableTextColor(theme.accent2Secondary, theme),
    '--theme-grid-superlight': theme.gridSuperlight,
    '--theme-grid-clear': theme.gridClear,
    '--theme-grid-bold': theme.gridBold,

    /* Antinote compatibility stubs: accepted now, available for future features. */
    '--theme-accent-2-main': theme.accent2Main,
    '--theme-accent-2-secondary': theme.accent2Secondary,
    '--theme-accent-3-main': theme.accent3Main,
    '--theme-accent-3-secondary': theme.accent3Secondary,
    '--theme-accent-4-main': theme.accent4Main,
    '--theme-accent-4-secondary': theme.accent4Secondary,
    '--theme-accent-5-main': theme.accent5Main,
    '--theme-accent-5-secondary': theme.accent5Secondary
  };
}

function readableTextColor(backgroundColor, theme) {
  const background = colorOnOpaqueBackground(backgroundColor, theme.background);
  const candidates = [theme.typeReverse, theme.typeMain, '#ffffff', '#000000'];

  return candidates
    .map((color) => ({
      color,
      contrast: contrastRatio(colorOnOpaqueBackground(color, theme.background), background)
    }))
    .sort((a, b) => b.contrast - a.contrast)[0].color;
}

function colorOnOpaqueBackground(color, fallbackBackground) {
  const foreground = hexToRgba(color);
  if (foreground.a >= 1) return foreground;

  const background = hexToRgba(fallbackBackground);
  return {
    r: Math.round((foreground.r * foreground.a) + (background.r * (1 - foreground.a))),
    g: Math.round((foreground.g * foreground.a) + (background.g * (1 - foreground.a))),
    b: Math.round((foreground.b * foreground.a) + (background.b * (1 - foreground.a))),
    a: 1
  };
}

function hexToRgba(color) {
  const value = color.replace('#', '');
  const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: alpha
  };
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ r, g, b }) {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
