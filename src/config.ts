export const SCHEMA_VERSION = 1;
export const TIMEZONE = "America/New_York";
export const CONFIG_KEY = "mbta-departure-board:config:v1";
export const CONFIG_BACKUP_KEY = "mbta-departure-board:config:v1:last-valid";

export type Density = "comfortable" | "compact";

export interface DepartureGroup {
  id: string;
  stopId: string;
  resolvedStopIds: string[];
  routeId: string;
  directionId: 0 | 1;
  displayLabel: string;
  order: number;
  destinationFilter?: string;
  walkMinutes?: number;
}

export interface BoardConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  title: string;
  timezone: typeof TIMEZONE;
  density: Density;
  groups: DepartureGroup[];
}

export const LIMITS = {
  title: 60,
  label: 60,
  destination: 80,
  groups: 40,
  resolvedStops: 40,
  walkMinutes: 60,
};

const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function emptyConfig(): BoardConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: "Departures",
    timezone: TIMEZONE,
    density: "comfortable",
    groups: [],
  };
}

export class ConfigError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined && !required) return "";
  if (typeof v !== "string") throw new ConfigError(`${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new ConfigError(`${field} is longer than ${max} characters`);
  if (required && t.length === 0) throw new ConfigError(`${field} is empty`);
  return t;
}

function id(v: unknown, field: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new ConfigError(`${field} is not a valid ID`);
  return v;
}

function validateGroup(raw: unknown, index: number): DepartureGroup {
  const where = `Group ${index + 1}`;
  if (!isObject(raw)) throw new ConfigError(`${where} is not an object`);
  const directionId = raw.directionId;
  if (directionId !== 0 && directionId !== 1) throw new ConfigError(`${where}: directionId must be 0 or 1`);
  const stopId = id(raw.stopId, `${where} stopId`);
  const resolved = raw.resolvedStopIds ?? [stopId];
  if (!Array.isArray(resolved) || resolved.length === 0 || resolved.length > LIMITS.resolvedStops) {
    throw new ConfigError(`${where}: resolvedStopIds must list 1–${LIMITS.resolvedStops} stops`);
  }
  const group: DepartureGroup = {
    id: id(raw.id, `${where} id`),
    stopId,
    resolvedStopIds: [...new Set(resolved.map((s, i) => id(s, `${where} resolvedStopIds[${i}]`)))],
    routeId: id(raw.routeId, `${where} routeId`),
    directionId,
    displayLabel: text(raw.displayLabel, `${where} displayLabel`, LIMITS.label, false),
    order: index,
  };
  if (raw.destinationFilter !== undefined) {
    group.destinationFilter = text(raw.destinationFilter, `${where} destinationFilter`, LIMITS.destination);
  }
  if (raw.walkMinutes !== undefined) {
    const w = raw.walkMinutes;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w > LIMITS.walkMinutes) {
      throw new ConfigError(`${where}: walkMinutes must be a whole number from 0 to ${LIMITS.walkMinutes}`);
    }
    group.walkMinutes = w;
  }
  return group;
}

/** Older schema versions → current. Add an entry here when the schema changes. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrate(raw: unknown): unknown {
  if (!isObject(raw)) throw new ConfigError("Configuration is not a JSON object");
  let current = raw;
  let version = current.schemaVersion;
  while (typeof version === "number" && version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ConfigError(`Schema version ${version} is not supported`);
    current = step(current);
    version = current.schemaVersion;
  }
  return current;
}

export function validateConfig(input: unknown): BoardConfig {
  const raw = migrate(input) as Record<string, unknown>;
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new ConfigError(`Unknown schema version ${String(raw.schemaVersion)}`);
  }
  if (raw.timezone !== undefined && raw.timezone !== TIMEZONE) {
    throw new ConfigError(`Only the ${TIMEZONE} timezone is supported`);
  }
  const density = raw.density ?? "comfortable";
  if (density !== "comfortable" && density !== "compact") throw new ConfigError("density must be comfortable or compact");
  if (!Array.isArray(raw.groups)) throw new ConfigError("groups must be a list");
  if (raw.groups.length > LIMITS.groups) throw new ConfigError(`At most ${LIMITS.groups} groups are supported`);

  const sorted = raw.groups
    .map((g, i) => ({ g, i, order: isObject(g) && typeof g.order === "number" ? g.order : i }))
    .sort((a, b) => a.order - b.order || a.i - b.i);
  const groups = sorted.map(({ g }, i) => validateGroup(g, i));
  const ids = new Set<string>();
  for (const g of groups) {
    if (ids.has(g.id)) throw new ConfigError(`Duplicate group id ${g.id}`);
    ids.add(g.id);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    title: text(raw.title ?? "Departures", "title", LIMITS.title, false) || "Departures",
    timezone: TIMEZONE,
    density,
    groups,
  };
}

export function serviceKey(g: Pick<DepartureGroup, "stopId" | "routeId" | "directionId" | "destinationFilter">): string {
  return [g.stopId, g.routeId, g.directionId, g.destinationFilter ?? ""].join("|");
}

export function renumber(groups: DepartureGroup[]): DepartureGroup[] {
  return groups.map((g, i) => ({ ...g, order: i }));
}

export function newGroupId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "g-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function exportConfig(config: BoardConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

export interface ImportPreview {
  config: BoardConfig;
  duplicates: DepartureGroup[];
}

export function parseImport(textInput: string, existing: BoardConfig): ImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textInput);
  } catch {
    throw new ConfigError("The file is not valid JSON");
  }
  const config = validateConfig(parsed);
  const have = new Set(existing.groups.map(serviceKey));
  return { config, duplicates: config.groups.filter((g) => have.has(serviceKey(g))) };
}

export function mergeConfigs(existing: BoardConfig, incoming: BoardConfig): BoardConfig {
  const have = new Set(existing.groups.map(serviceKey));
  const ids = new Set(existing.groups.map((g) => g.id));
  const added = incoming.groups
    .filter((g) => !have.has(serviceKey(g)))
    .map((g) => (ids.has(g.id) ? { ...g, id: newGroupId() } : g));
  const merged = { ...existing, groups: renumber([...existing.groups, ...added]) };
  if (merged.groups.length > LIMITS.groups) throw new ConfigError(`Merging would exceed ${LIMITS.groups} groups`);
  return merged;
}

export interface LoadResult {
  config: BoardConfig;
  warning?: string;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadConfig(store: Store | null): LoadResult {
  if (!store) return { config: emptyConfig(), warning: "This browser is not saving settings. Changes will last only while this page stays open." };
  let raw: string | null;
  try {
    raw = store.getItem(CONFIG_KEY);
  } catch {
    return { config: emptyConfig(), warning: "Saved settings could not be read. Changes will last only while this page stays open." };
  }
  if (raw === null) return { config: emptyConfig() };
  try {
    return { config: validateConfig(JSON.parse(raw)) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const backup = store.getItem(CONFIG_BACKUP_KEY);
      if (backup) {
        return { config: validateConfig(JSON.parse(backup)), warning: `Saved settings were invalid (${reason}); restored the last valid copy.` };
      }
    } catch {
      /* fall through */
    }
    return { config: emptyConfig(), warning: `Saved settings were invalid (${reason}) and were not loaded.` };
  }
}

/** Returns an error message if the configuration could not be persisted. */
export function saveConfig(store: Store | null, config: BoardConfig): string | undefined {
  const valid = validateConfig(config);
  if (!store) return "Settings are not being saved on this device.";
  try {
    const previous = store.getItem(CONFIG_KEY);
    if (previous) {
      try {
        validateConfig(JSON.parse(previous));
        store.setItem(CONFIG_BACKUP_KEY, previous);
      } catch {
        /* don't back up an invalid copy */
      }
    }
    store.setItem(CONFIG_KEY, JSON.stringify(valid));
    return undefined;
  } catch {
    return "Settings could not be saved on this device (storage full or blocked). They will last only while this page stays open.";
  }
}

export function browserStore(): Store | null {
  try {
    const s = window.localStorage;
    const probe = "mbta-departure-board:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
