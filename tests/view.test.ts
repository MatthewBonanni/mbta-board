import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api";
import { toAlert } from "../src/alerts";
import { emptyConfig, type BoardConfig } from "../src/config";
import type { ControllerState, Feed } from "../src/controller";
import type { RouteInfo } from "../src/metadata";
import { badgeTextColor, buildBoardView, contrast } from "../src/view";
import { group, T0 } from "./helpers";

const bus: RouteInfo = {
  id: "39",
  shortName: "39",
  longName: "Forest Hills - Example Square",
  color: "#FFC72C",
  textColor: "#000000",
  type: 3,
  directionNames: ["Outbound", "Inbound"],
  directionDestinations: ["Forest Hills", "Example Square"],
  sortOrder: 0,
};
const lookup = { route: (id: string) => (id === "39" ? bus : undefined), stop: () => undefined };
const g = group({ id: "a", routeId: "39", stopId: "1001", directionId: 1 });
const config: BoardConfig = { ...emptyConfig(), groups: [g] };

function feed<T>(data: T | null, lastSuccessAt: number | null, error: ApiError | null = null): Feed<T> {
  return { data, lastSuccessAt, lastAttemptAt: T0, error, pending: false };
}

const state = (p: ControllerState["predictions"], alerts: ControllerState["alerts"] = feed([], T0)): ControllerState => ({ predictions: p, alerts });
const row = (s: ControllerState) => buildBoardView(config, lookup, s, T0).sections[0]!.rows[0]!;

describe("board states", () => {
  it("distinguishes an empty successful response from an unreachable server", () => {
    expect(row(state(feed(new Map([["a", []]]), T0))).message).toBe("No predictions right now");
    const failed = buildBoardView(config, lookup, state(feed<Map<string, never[]>>(null, null, new ApiError("http", "MBTA server error (500)", 500))), T0);
    expect(failed.freshness).toBe("stale");
    expect(failed.freshnessDetail).toMatch(/No successful update yet · MBTA server error \(500\)/);
    expect(failed.sections[0]!.rows[0]!.message).toMatch(/not reachable/);
  });

  it("says No service only when an active matching alert supports it", () => {
    const suspension = toAlert({
      id: "s",
      type: "alert",
      attributes: { effect: "SUSPENSION", header: "Suspended", active_period: [{ start: new Date(T0 - 1).toISOString(), end: null }], informed_entity: [{ route: "39", activities: ["BOARD"] }] },
    });
    expect(row(state(feed(new Map([["a", []]]), T0), feed([suspension], T0))).message).toBe("No service — see alert");
  });

  it("labels schedule-based and delayed bus times so they can't be mistaken for live countdowns", () => {
    const deps = [
      { key: "1", tripId: "1", stopId: "1001", time: T0 + 4 * 60_000 + 5_000, kind: "approx" as const, headsign: null },
      { key: "2", tripId: "2", stopId: "1001", time: T0 + 12 * 60_000, kind: "scheduled" as const, headsign: null },
    ];
    const [approx, sched] = row(state(feed(new Map([["a", deps]]), T0))).times;
    expect(approx).toMatchObject({ value: "4", unit: "min", prefix: "Approx." });
    expect(sched).toMatchObject({ value: "1:12", unit: "PM", prefix: "Est." });
  });
});

describe("walk-time markers", () => {
  it("strikes unreachable departures and keeps the targeted one visible even past the first three", () => {
    const walking = { ...config, groups: [{ ...g, walkMinutes: 10 }] };
    const deps = [2, 5, 8, 14, 20].map((m) => ({ key: String(m), tripId: String(m), stopId: "1001", time: T0 + m * 60_000 + 5_000, kind: "live" as const, headsign: null }));
    const section = buildBoardView(walking, lookup, state(feed(new Map([["a", deps]]), T0)), T0).sections[0]!;
    const r = section.rows[0]!;
    expect(r.times.map((t) => [t.value, t.reach])).toEqual([
      ["2", "missed"],
      ["5", "missed"],
      ["14", "target"],
    ]);
    expect(r.leave).toMatchObject({ lead: "Leave in 4 min", detail: "catch the bus in 14 min" });
    expect(section.meta).toBe("10 min walk");
  });

  it("marks nothing without a walk time", () => {
    const deps = [{ key: "1", tripId: "1", stopId: "1001", time: T0 + 60_000 * 2, kind: "live" as const, headsign: null }];
    expect(row(state(feed(new Map([["a", deps]]), T0))).times[0]!.reach).toBeNull();
  });
});

describe("section walk times", () => {
  it("keeps walk time on each row when rows under one heading differ", () => {
    const deps = [{ key: "1", tripId: "1", stopId: "1001", time: T0 + 20 * 60_000, kind: "live" as const, headsign: null }];
    const h = { ...g, displayLabel: "Corner", walkMinutes: 3 };
    const other = { ...g, id: "b", stopId: "1002", displayLabel: "Corner", walkMinutes: 5 };
    const v = buildBoardView({ ...config, groups: [h, other] }, lookup, state(feed(new Map([["a", deps], ["b", deps]]), T0)), T0);
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0]!.meta).toBeNull();
    expect(v.sections[0]!.rows.map((r) => r.leave?.detail)).toEqual(["catch the bus in 20 min · 3 min walk", "catch the bus in 20 min · 5 min walk"]);
  });
});

describe("badge contrast", () => {
  it("overrides agency text colors that miss WCAG AA (white on Orange/Silver Line)", () => {
    expect(badgeTextColor("#ED8B00", "#FFFFFF")).toBe("#161616");
    expect(badgeTextColor("#7C878E", "#FFFFFF")).toBe("#161616");
    expect(badgeTextColor("#DA291C", "#FFFFFF")).toBe("#FFFFFF");
    expect(contrast("#FFC72C", "#000000")).toBeGreaterThan(4.5);
  });
});
