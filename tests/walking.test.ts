import { describe, expect, it, vi } from "vitest";
import { emptyConfig, type BoardConfig } from "../src/config";
import type { Metadata } from "../src/metadata";
import type { OsmClient } from "../src/osm";
import { applyWalks, estimateWalks } from "../src/walking";
import { group } from "./helpers";

describe("walking estimates", () => {
  it("rounds up, and reports unroutable and over-limit stops instead of storing them", async () => {
    const metadata = {
      coordinates: vi.fn(async (ids: string[]) => ids.filter((id) => id !== "gone").map((id) => ({ id, lat: 1, lon: 1 }))),
    } as unknown as Metadata;
    const osm = {
      walkSeconds: vi.fn(async () => new Map([["near", 241], ["far", 3_700], ["island", null]])),
    } as unknown as OsmClient;
    const est = await estimateWalks({ label: "o", lat: 0, lon: 0 }, ["near", "near", "far", "island", "gone"], metadata, osm);
    expect([...est.minutes]).toEqual([["near", 5]]);
    expect(est.tooFar).toEqual(["far"]);
    expect(est.failed).toEqual(["island", "gone"]);
  });

  it("applies per stop to every row there and removes the field when cleared", () => {
    const cfg: BoardConfig = {
      ...emptyConfig(),
      groups: [
        { ...group({ id: "a", routeId: "39", stopId: "1001", directionId: 0 }), walkMinutes: 9 },
        group({ id: "b", routeId: "57", stopId: "1001", directionId: 1 }),
        { ...group({ id: "c", routeId: "1", stopId: "1003", directionId: 0 }), walkMinutes: 4 },
      ],
    };
    const set = applyWalks(cfg, new Map([["1001", 5]]));
    expect(set.groups.map((g) => g.walkMinutes)).toEqual([5, 5, 4]);
    const cleared = applyWalks(set, new Map([["1001", undefined]]));
    expect(cleared.groups[0]).not.toHaveProperty("walkMinutes");
    expect(cleared.groups[2]!.walkMinutes).toBe(4);
  });
});
