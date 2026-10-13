import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsmClient, parseCoordinates } from "../src/osm";
import { advance, jsonResponse, T0 } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("OsmClient", () => {
  it("starts at most one request per 1.1 s across services (OSM usage policy)", async () => {
    const starts: number[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      starts.push(Date.now() - T0);
      expect(init?.referrerPolicy).toBe("strict-origin-when-cross-origin");
      return String(url).includes("/table/")
        ? jsonResponse({ code: "Ok", durations: [[0, 301, null]] })
        : jsonResponse([{ display_name: "Harvard Square, Cambridge, Massachusetts", lat: "42.37", lon: "-71.12" }]);
    });
    const osm = new OsmClient({ fetch: fetch as typeof globalThis.fetch });
    const search = osm.search("harvard square");
    const walk = osm.walkSeconds({ label: "o", lat: 42.37, lon: -71.12 }, [
      { id: "a", lat: 42.36, lon: -71.1 },
      { id: "b", lat: 42.35, lon: -71.0 },
    ]);
    const again = osm.search("central square");
    await advance(4_000);
    expect((await search)[0]).toMatchObject({ label: "Harvard Square", detail: "Cambridge, Massachusetts", lat: 42.37 });
    expect([...(await walk)]).toEqual([
      ["a", 301],
      ["b", null],
    ]);
    await again;
    expect(starts).toEqual([0, 1_100, 2_200]);
  });
});

describe("parseCoordinates", () => {
  it("accepts map-copied pairs and rejects addresses", () => {
    expect(parseCoordinates("42.3736, -71.1189")).toEqual({ lat: 42.3736, lon: -71.1189 });
    expect(parseCoordinates("42.3736 -71.1189")).toEqual({ lat: 42.3736, lon: -71.1189 });
    expect(parseCoordinates("12 Main St")).toBeNull();
    expect(parseCoordinates("95, 10")).toBeNull();
  });
});
