import { describe, expect, it } from "vitest";
import { toAlert } from "../src/alerts";
import { emptyConfig, type BoardConfig } from "../src/config";
import type { ControllerState, Feed } from "../src/controller";
import type { RouteInfo } from "../src/metadata";
import type { Departure } from "../src/normalize";
import { readPrefs } from "../src/prefs";
import { buildBoardView } from "../src/view";
import { group, T0 } from "./helpers";

const route = (id: string, type: number): RouteInfo => ({
  id,
  shortName: id,
  longName: id,
  color: "#FFC72C",
  textColor: "#000000",
  type,
  directionNames: ["Outbound", "Inbound"],
  directionDestinations: ["Out", "In"],
  sortOrder: 0,
});
const lookup = { route: (id: string) => route(id, 3), stop: () => undefined };
const dep = (key: string, min: number, kind: Departure["kind"] = "live"): Departure => ({ key, tripId: key, stopId: "s", time: T0 + min * 60_000 + 5_000, kind, headsign: null });
const feed = <T,>(data: T): Feed<T> => ({ data, lastSuccessAt: T0, lastAttemptAt: T0, error: null, pending: false });
const state = (deps: Record<string, Departure[]>, alerts: ReturnType<typeof toAlert>[] = []): ControllerState => ({
  predictions: feed(new Map(Object.entries(deps))),
  alerts: feed(alerts),
});

describe("next-leave banner", () => {
  it("picks the earliest leave time across stops, not the earliest departure", () => {
    const config: BoardConfig = {
      ...emptyConfig(),
      groups: [
        { ...group({ id: "far", routeId: "39", stopId: "1001", directionId: 0 }), displayLabel: "Far", walkMinutes: 15 },
        { ...group({ id: "near", routeId: "57", stopId: "1002", directionId: 0 }), displayLabel: "Near", walkMinutes: 2 },
      ],
    };
    // Far: bus in 20 → leave in 5. Near: bus in 10 → leave in 8.
    const v = buildBoardView(config, lookup, state({ far: [dep("a", 20)], near: [dep("b", 10)] }), T0);
    expect(v.nextLeave).toMatchObject({ lead: "Leave in 5 min", place: "Far", destination: "Out" });
  });

  it("is absent without walk times", () => {
    const config: BoardConfig = { ...emptyConfig(), groups: [group({ id: "a", routeId: "39", stopId: "1001", directionId: 0 })] };
    expect(buildBoardView(config, lookup, state({ a: [dep("a", 5)] }), T0).nextLeave).toBeNull();
  });
});

describe("alert strip", () => {
  it("groups active alerts by route once and lists the rest as having no alerts", () => {
    const alert = toAlert({
      id: "x",
      type: "alert",
      attributes: { header: "Detour", effect: "DETOUR", active_period: [{ start: new Date(T0 - 1).toISOString(), end: null }], informed_entity: [{ route: "39", activities: ["BOARD"] }] },
    });
    const config: BoardConfig = {
      ...emptyConfig(),
      groups: [
        group({ id: "a", routeId: "39", stopId: "1001", directionId: 0 }),
        group({ id: "b", routeId: "39", stopId: "1002", directionId: 1 }),
        group({ id: "c", routeId: "57", stopId: "1001", directionId: 0 }),
      ],
    };
    const v = buildBoardView(config, lookup, state({}, [alert]), T0);
    expect(v.status.withAlerts.map((i) => [i.routeId, i.alerts.map((a) => a.id)])).toEqual([["39", ["x"]]]);
    expect(v.status.quiet.map((i) => i.routeId)).toEqual(["57"]);
  });
});

describe("timeline", () => {
  const config = (walk?: number): BoardConfig => ({
    ...emptyConfig(),
    groups: [{ ...group({ id: "a", routeId: "39", stopId: "1001", directionId: 0 }), ...(walk !== undefined ? { walkMinutes: walk } : {}) }],
  });

  it("places departures in the 45-minute window and ends the walk bar at the target", () => {
    const t = buildBoardView(config(9), lookup, state({ a: [dep("1", 3), dep("2", 18), dep("3", 50)] }), T0).sections[0]!.rows[0]!.timeline;
    expect(t.ticks.map((k) => [k.pos, k.reach])).toEqual([
      [3 / 45, "missed"],
      [18 / 45, "target"],
    ]);
    expect(t.walk).toEqual({ from: 9 / 45, to: 18 / 45 });
  });

  it("says when the next departure is beyond the window", () => {
    const t = buildBoardView(config(), lookup, state({ a: [dep("1", 52)] }), T0).sections[0]!.rows[0]!.timeline;
    expect(t.ticks).toEqual([]);
    expect(t.beyond).toBe("Next in 52 min · 1:52 PM");
  });
});

describe("device prefs", () => {
  it("falls back to defaults for unknown stored values", () => {
    const store = { getItem: () => JSON.stringify({ theme: "neon", layout: "timeline", statusStrip: "yes" }), setItem: () => {} };
    expect(readPrefs(store)).toMatchObject({ theme: "light", layout: "timeline", statusStrip: false, nextLeave: true });
  });
});
