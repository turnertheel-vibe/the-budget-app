/** ThemeProvider — loads per-device appearance + scheme, resolves the effective mode, provides tokens. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_PRESET_ID,
  THEME_PRESETS,
  THEME_STORAGE_KEYS,
  ThemeContext,
  buildTokens,
  loadAppearance,
  loadCustomColors,
  loadPresetId,
  type AppearanceMode,
  type ThemeColors,
  type ThemePreset,
} from '../theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<AppearanceMode>('system');
  const [presetId, setPresetIdState] = useState<string>(DEFAULT_PRESET_ID);
  const [customColors, setCustomColorsState] = useState<ThemeColors | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadAppearance(), loadPresetId(), loadCustomColors()]).then(([a, p, c]) => {
      if (!mounted) return;
      setAppearanceState(a);
      setPresetIdState(p);
      setCustomColorsState(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setAppearance = useCallback(async (mode: AppearanceMode) => {
    setAppearanceState(mode);
    await AsyncStorage.setItem(THEME_STORAGE_KEYS.appearance, mode);
  }, []);

  const setPreset = useCallback(async (id: string) => {
    if (!THEME_PRESETS.some((p) => p.id === id)) return;
    setPresetIdState(id);
    // Picking a preset clears any custom hex scheme.
    setCustomColorsState(null);
    await AsyncStorage.setItem(THEME_STORAGE_KEYS.presetId, id);
    await AsyncStorage.removeItem(THEME_STORAGE_KEYS.customColors);
  }, []);

  const setCustomColors = useCallback(async (colors: ThemeColors | null) => {
    setCustomColorsState(colors);
    if (colors) {
      await AsyncStorage.setItem(THEME_STORAGE_KEYS.customColors, JSON.stringify(colors));
    } else {
      await AsyncStorage.removeItem(THEME_STORAGE_KEYS.customColors);
    }
  }, []);

  const resetTheme = useCallback(async () => {
    await setPreset(DEFAULT_PRESET_ID);
  }, [setPreset]);

  const preset: ThemePreset =
    THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0];
  const activeColors: ThemeColors = customColors ?? preset.colors;
  const mode = appearance === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : appearance;

  const value = useMemo(
    () => ({
      tokens: buildTokens(activeColors, mode),
      mode,
      appearance,
      setAppearance,
      preset,
      setPreset,
      customColors,
      setCustomColors,
      resetTheme,
    }),
    [activeColors, appearance, customColors, mode, preset, resetTheme, setAppearance, setCustomColors, setPreset],
  );

  // Defaults (System + Sage Meadow) apply until stored values load.
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
