import { describe, expect, it } from "vitest";
import {
  CONFIG_BACKUP_KEY,
  CONFIG_KEY,
  emptyConfig,
  exportConfig,
  loadConfig,
  mergeConfigs,
  parseImport,
  saveConfig,
  type BoardConfig,
  type Store,
} from "../src/config";
import { group } from "./helpers";

class MemoryStore implements Store {
  data = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
}

const board = (): BoardConfig => ({
  ...emptyConfig(),
  title: "Home",
  groups: [
    { ...group({ id: "a", routeId: "Red", stopId: "place-pktrm", resolvedStopIds: ["70075", "70076"], directionId: 0 }), displayLabel: "Park", destinationFilter: "Ashmont", order: 0 },
    { ...group({ id: "b", routeId: "39", stopId: "1001", directionId: 1 }), order: 1, walkMinutes: 4 },
  ],
});

describe("configuration", () => {
  it("first launch is empty", () => {
    expect(loadConfig(new MemoryStore()).config.groups).toEqual([]);
  });

  it("export → import round-trips exactly, including order and optional fields", () => {
    const cfg = board();
    const back = parseImport(exportConfig(cfg), emptyConfig()).config;
    expect(back).toEqual(cfg);
    expect(back.groups[0]).not.toHaveProperty("walkMinutes");
  });

  it("rejects invalid JSON, unknown schema versions, bad IDs and over-long labels", () => {
    const ok = JSON.parse(exportConfig(board()));
    expect(() => parseImport("{nope", emptyConfig())).toThrow(/not valid JSON/);
    expect(() => parseImport(JSON.stringify({ ...ok, schemaVersion: 0 }), emptyConfig())).toThrow(/not supported/);
    expect(() => parseImport(JSON.stringify({ ...ok, schemaVersion: 2 }), emptyConfig())).toThrow(/Unknown schema/);
    const badId = structuredClone(ok);
    badId.groups[0].stopId = "<img src=x>";
    expect(() => parseImport(JSON.stringify(badId), emptyConfig())).toThrow(/stopId/);
    const longLabel = structuredClone(ok);
    longLabel.groups[0].displayLabel = "x".repeat(61);
    expect(() => parseImport(JSON.stringify(longLabel), emptyConfig())).toThrow(/longer than/);
  });

  it("reports duplicates and merge skips them, re-keying colliding ids", () => {
    const existing = board();
    const incoming = { ...emptyConfig(), groups: [{ ...existing.groups[0]!, id: "z" }, { ...group({ id: "a", routeId: "1", stopId: "1003", directionId: 0 }) }] };
    const preview = parseImport(exportConfig(incoming), existing);
    expect(preview.duplicates.map((g) => g.id)).toEqual(["z"]);
    const merged = mergeConfigs(existing, preview.config);
    expect(merged.groups.map((g) => g.routeId)).toEqual(["Red", "39", "1"]);
    expect(new Set(merged.groups.map((g) => g.id)).size).toBe(3);
  });

  it("restores the last valid copy when the saved config is corrupt", () => {
    const store = new MemoryStore();
    saveConfig(store, board());
    saveConfig(store, { ...board(), title: "Second" });
    expect(JSON.parse(store.data.get(CONFIG_BACKUP_KEY)!).title).toBe("Home");
    store.data.set(CONFIG_KEY, "{corrupt");
    const loaded = loadConfig(store);
    expect(loaded.config.title).toBe("Home");
    expect(loaded.warning).toMatch(/last valid copy/);
  });

  it("reports a storage failure instead of throwing", () => {
    const store = new MemoryStore();
    store.failWrites = true;
    expect(saveConfig(store, board())).toMatch(/could not be saved/);
  });
});
