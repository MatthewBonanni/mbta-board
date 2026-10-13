import { describe, expect, it } from "vitest";
import { classify, normalizePredictions } from "../src/normalize";
import { group, prediction, T0, trip } from "./helpers";

const BUS = 3;
const SUBWAY = 1;
const routeType = (id: string) => (id === "Red" ? SUBWAY : BUS);
const min = (m: number) => T0 + m * 60_000;

describe("uncertainty semantics (MBTA gtfs-realtime.md)", () => {
  it("bus: <300 live, 300 scheduled, 301 approximate, >301 suppressed", () => {
    expect(classify("bus", 120)).toBe("live");
    expect(classify("bus", 300)).toBe("scheduled");
    expect(classify("bus", 301)).toBe("approx");
    expect(classify("bus", 302)).toBeNull();
  });

  it("rail values 60/120/360 are trip-progress codes, not schedule estimates", () => {
    expect(classify("subway", 360)).toBe("live");
    expect(classify("light-rail", 300)).toBe("live");
  });
});

describe("normalizePredictions", () => {
  const g64 = group({ routeId: "39", stopId: "1001", directionId: 1 });

  it("keeps only the exact stop/route/direction tuple from a batched response", () => {
    const doc = {
      data: [
        prediction({ route: "39", stop: "1001", trip: "a", dir: 1, dep: min(4) }),
        prediction({ route: "39", stop: "1001", trip: "b", dir: 0, dep: min(5) }),
        prediction({ route: "39", stop: "1002", trip: "c", dir: 1, dep: min(6) }),
        prediction({ route: "57", stop: "1001", trip: "d", dir: 1, dep: min(7) }),
      ],
      included: [],
    };
    const out = normalizePredictions(doc, [g64], routeType, T0);
    expect(out.get(g64.id)!.map((d) => d.tripId)).toEqual(["a"]);
  });

  it("drops cancelled, skipped, non-revenue, arrival-only, past and suppressed predictions", () => {
    const doc = {
      data: [
        prediction({ route: "39", stop: "1001", trip: "cancel", dir: 1, dep: min(3), rel: "CANCELLED" }),
        prediction({ route: "39", stop: "1001", trip: "skip", dir: 1, dep: min(3), rel: "SKIPPED" }),
        prediction({ route: "39", stop: "1001", trip: "deadhead", dir: 1, dep: min(3), revenue: "NON_REVENUE" }),
        prediction({ route: "39", stop: "1001", trip: "dropoff", dir: 1, dep: null }),
        prediction({ route: "39", stop: "1001", trip: "gone", dir: 1, dep: min(-2) }),
        prediction({ route: "39", stop: "1001", trip: "bad", dir: 1, dep: min(3), unc: 400 }),
        prediction({ route: "39", stop: "1001", trip: "ok", dir: 1, dep: min(9), unc: 300 }),
      ],
      included: [],
    };
    const out = normalizePredictions(doc, [g64], routeType, T0).get(g64.id)!;
    expect(out.map((d) => [d.tripId, d.kind])).toEqual([["ok", "scheduled"]]);
  });

  it("deduplicates by trip, stop and stop sequence, and sorts by time", () => {
    const doc = {
      data: [
        prediction({ id: "p1", route: "39", stop: "1001", trip: "a", dir: 1, dep: min(8), seq: 5 }),
        prediction({ id: "p2", route: "39", stop: "1001", trip: "a", dir: 1, dep: min(8), seq: 5 }),
        prediction({ route: "39", stop: "1001", trip: "b", dir: 1, dep: min(2) }),
      ],
      included: [],
    };
    expect(normalizePredictions(doc, [g64], routeType, T0).get(g64.id)!.map((d) => d.tripId)).toEqual(["b", "a"]);
  });

  it("splits branches by validated trip headsign and resolves parent stations to child platforms", () => {
    const station = { stopId: "place-pktrm", resolvedStopIds: ["70075", "70076"], routeId: "Red", directionId: 0 as const };
    const ashmont = group({ ...station, destinationFilter: "Ashmont" });
    const braintree = group({ ...station, destinationFilter: "Braintree" });
    const doc = {
      data: [
        prediction({ route: "Red", stop: "70075", trip: "t1", dir: 0, dep: min(2), unc: 60 }),
        prediction({ route: "Red", stop: "70075", trip: "t2", dir: 0, dep: min(6), unc: 360 }),
        prediction({ route: "Red", stop: "70076", trip: "t3", dir: 1, dep: min(3) }),
      ],
      included: [trip("t1", "Ashmont"), trip("t2", "Braintree"), trip("t3", "Alewife")],
    };
    const out = normalizePredictions(doc, [ashmont, braintree], routeType, T0);
    expect(out.get(ashmont.id)!.map((d) => d.tripId)).toEqual(["t1"]);
    expect(out.get(braintree.id)!.map((d) => [d.tripId, d.kind])).toEqual([["t2", "live"]]);
  });
});
