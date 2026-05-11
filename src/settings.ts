import type { Settings } from './types';

export const DEFAULTS: Settings = {
  widthMm: 80,
  heightMm: 30,
  gapMm: 2,
  density: 8,
  speed: 4,
  baud: 9600,
  threshold: 128,
  copies: 1,
  autoFit: true,
  manualRotate: false,
  manualX: 0,
  manualY: 0,
  manualWidth: 1,
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const partial = (stored[KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULTS, ...partial };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}
