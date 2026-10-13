import type { Store } from "./config";

const DEVICE_KEY = "mbta-departure-board:device:v1";

export type ThemePref = "light" | "dark" | "night" | "system";
export type LayoutPref = "list" | "timeline";

/** Display choices for this screen only; not part of the exported board. */
export interface DevicePrefs {
  keepAwake: boolean;
  theme: ThemePref;
  layout: LayoutPref;
  nextLeave: boolean;
  statusStrip: boolean;
  /** Shrink the board to fit the screen instead of scrolling. */
  fitScreen: boolean;
}

export const DEFAULT_PREFS: DevicePrefs = {
  keepAwake: false,
  theme: "light",
  layout: "list",
  nextLeave: true,
  statusStrip: false,
  fitScreen: true,
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

export function readPrefs(store: Store | null): DevicePrefs {
  let raw: Record<string, unknown> = {};
  try {
    const s = store?.getItem(DEVICE_KEY);
    if (s) raw = JSON.parse(s) ?? {};
  } catch {
    /* defaults */
  }
  return {
    keepAwake: raw.keepAwake === true,
    theme: pick(raw.theme, ["light", "dark", "night", "system"] as const, DEFAULT_PREFS.theme),
    layout: pick(raw.layout, ["list", "timeline"] as const, DEFAULT_PREFS.layout),
    nextLeave: typeof raw.nextLeave === "boolean" ? raw.nextLeave : DEFAULT_PREFS.nextLeave,
    statusStrip: typeof raw.statusStrip === "boolean" ? raw.statusStrip : DEFAULT_PREFS.statusStrip,
    fitScreen: typeof raw.fitScreen === "boolean" ? raw.fitScreen : DEFAULT_PREFS.fitScreen,
  };
}

export function writePrefs(store: Store | null, prefs: DevicePrefs): void {
  try {
    store?.setItem(DEVICE_KEY, JSON.stringify(prefs));
  } catch {
    /* lasts for this session only */
  }
}
