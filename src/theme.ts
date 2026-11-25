/**
 * Theme system — Found-inspired tokens (see expo-build-spec.md §3).
 *
 * Appearance (Light / System / Dark) and the color scheme (preset or custom
 * hex) are per-device and persist in AsyncStorage. They are NEVER stored in
 * Supabase (schema v3, decision D6).
 *
 * A preset supplies five colors: brand (primary), needs, wants, background,
 * card. The dark variant is derived by this module, not stored per preset:
 * dark surfaces/ink are fixed, and the preset's accent colors are lightened
 * so they stay readable on dark backgrounds.
 */
import { createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearanceMode = 'light' | 'system' | 'dark';
export type ColorSchemeMode = 'light' | 'dark';

export interface ThemeColors {
  /** Primary: buttons, hero card, savings. */
  brand: string;
  /** Needs bars and dots. */
  needs: string;
  /** Wants bars and dots. */
  wants: string;
  /** App background. */
  bg: string;
  /** Cards and sheets. */
  card: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'sage',
    name: 'Sage Meadow',
    description: 'Warm greens & cream — the original',
    colors: { brand: '#4F6B3A', needs: '#7D8F5F', wants: '#C07F45', bg: '#ECE7D8', card: '#FFFDF7' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Calm blues & sea glass',
    colors: { brand: '#1F6F7A', needs: '#2F8F7A', wants: '#D98A4A', bg: '#DCEBE8', card: '#FFFFFF' },
  },
  {
    id: 'sunset',
    name: 'Desert Sunset',
    description: 'Terracotta & warm sand',
    colors: { brand: '#B4552F', needs: '#8A7D3A', wants: '#C97A2E', bg: '#F3E2D3', card: '#FFFDF7' },
  },
  {
    id: 'berry',
    name: 'Berry',
    description: 'Plum, berry & soft rose',
    colors: { brand: '#7A3A5E', needs: '#5F7A9E', wants: '#C07A6A', bg: '#EFE2E8', card: '#FFFBFD' },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Cool grey-blue & brass',
    colors: { brand: '#3A4A5E', needs: '#5A7A6A', wants: '#B08D3A', bg: '#DDE2E6', card: '#FFFFFF' },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green & moss',
    colors: { brand: '#2F4A2E', needs: '#6A8A4A', wants: '#C0A045', bg: '#E2E8D8', card: '#FBFDF5' },
  },
];

export const DEFAULT_PRESET_ID = 'sage';

export interface ThemeTokens {
  mode: ColorSchemeMode;
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  brand: string;
  brandInk: string;
  brandSoft: string;
  needs: string;
  needsSoft: string;
  wants: string;
  wantsSoft: string;
  savings: string;
  savingsSoft: string;
  unallocated: string;
  danger: string;
  dangerSoft: string;
  tabBarBg: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Mix a hex color toward white by `amount` (0–1). Used to derive dark-mode accents. */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** Mix a hex color toward black by `amount` (0–1). */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

/**
 * Parse a pasted hex scheme from the Settings → Theme → Advanced flow.
 * Accepts a plain list of five hex codes in order
 * Primary, Needs, Wants, Background, Card — or a JSON object with keys
 * brand/needs/wants/background/card. Returns null when it cannot be parsed.
 * The app never generates themes itself; the user's AI agent produces the
 * hexes and inputs them here.
 */
export function parseHexScheme(input: string): ThemeColors | null {
  const text = input.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const brand = typeof obj.brand === 'string' ? obj.brand : typeof obj.primary === 'string' ? obj.primary : null;
      const needs = typeof obj.needs === 'string' ? obj.needs : null;
      const wants = typeof obj.wants === 'string' ? obj.wants : null;
      const bg = typeof obj.background === 'string' ? obj.background : typeof obj.bg === 'string' ? obj.bg : null;
      const card = typeof obj.card === 'string' ? obj.card : null;
      if (brand && needs && wants && bg && card && [brand, needs, wants, bg, card].every(isValidHex)) {
        return {
          brand: normalizeHex(brand),
          needs: normalizeHex(needs),
          wants: normalizeHex(wants),
          bg: normalizeHex(bg),
          card: normalizeHex(card),
        };
      }
      return null;
    } catch {
      return null;
    }
  }
  const hexes = text.match(/#[0-9a-fA-F]{3,6}\b/g);
  if (!hexes || hexes.length < 5 || !hexes.every(isValidHex)) return null;
  const [brand, needs, wants, bg, card] = hexes.slice(0, 5);
  return { brand: normalizeHex(brand), needs: normalizeHex(needs), wants: normalizeHex(wants), bg: normalizeHex(bg), card: normalizeHex(card) };
}

/** Build the full token set for a preset's colors in a given mode. */
export function buildTokens(colors: ThemeColors, mode: ColorSchemeMode): ThemeTokens {
  if (mode === 'dark') {
    // Fixed dark neutrals (Sage Meadow dark column); accents are the
    // preset's colors lightened so they stay readable on dark surfaces.
    const brand = lighten(colors.brand, 0.55);
    const needs = lighten(colors.needs, 0.5);
    const wants = lighten(colors.wants, 0.45);
    return {
      mode,
      bg: '#14130D',
      surface: '#2A281D',
      surface2: '#36331F',
      ink: '#F2EDDA',
      ink2: '#BDB89F',
      ink3: '#8A866E',
      line: '#3D3A28',
      brand,
      brandInk: '#232A16',
      brandSoft: '#39412A',
      needs,
      needsSoft: '#333B26',
      wants,
      wantsSoft: '#453520',
      savings: brand,
      savingsSoft: '#39412A',
      unallocated: '#4A4632',
      danger: '#E79A76',
      dangerSoft: '#46291C',
      tabBarBg: 'rgba(34, 32, 22, 0.94)',
    };
  }
  return {
    mode,
    bg: colors.bg,
    surface: colors.card,
    surface2: '#F0ECDD',
    ink: '#33382A',
    ink2: '#6D7260',
    ink3: '#A09A86',
    line: '#E4DDC9',
    brand: colors.brand,
    brandInk: '#FFFFFF',
    brandSoft: '#E6ECD9',
    needs: colors.needs,
    needsSoft: '#E9EDDC',
    wants: colors.wants,
    wantsSoft: '#F6EAD9',
    savings: colors.brand,
    savingsSoft: '#E6ECD9',
    unallocated: '#D8D2BD',
    danger: '#B4552F',
    dangerSoft: '#F8E7DC',
    tabBarBg: 'rgba(255, 253, 247, 0.92)',
  };
}

export const THEME_STORAGE_KEYS = {
  appearance: '@budget-app/appearance',
  presetId: '@budget-app/theme-preset',
  customColors: '@budget-app/theme-custom',
} as const;

export interface ThemeContextValue {
  tokens: ThemeTokens;
  mode: ColorSchemeMode;
  appearance: AppearanceMode;
  setAppearance: (mode: AppearanceMode) => Promise<void>;
  preset: ThemePreset;
  setPreset: (presetId: string) => Promise<void>;
  customColors: ThemeColors | null;
  setCustomColors: (colors: ThemeColors | null) => Promise<void>;
  resetTheme: () => Promise<void>;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

export async function loadAppearance(): Promise<AppearanceMode> {
  const raw = await AsyncStorage.getItem(THEME_STORAGE_KEYS.appearance);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export async function loadPresetId(): Promise<string> {
  const raw = await AsyncStorage.getItem(THEME_STORAGE_KEYS.presetId);
  return raw && THEME_PRESETS.some((p) => p.id === raw) ? raw : DEFAULT_PRESET_ID;
}

export async function loadCustomColors(): Promise<ThemeColors | null> {
  const raw = await AsyncStorage.getItem(THEME_STORAGE_KEYS.customColors);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemeColors>;
    if (
      typeof parsed.brand === 'string' &&
      typeof parsed.needs === 'string' &&
      typeof parsed.wants === 'string' &&
      typeof parsed.bg === 'string' &&
      typeof parsed.card === 'string'
    ) {
      return parsed as ThemeColors;
    }
  } catch {
    // Corrupt stored value: fall through to null (preset applies).
  }
  return null;
}
