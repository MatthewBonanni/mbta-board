import { describe, expect, it } from "vitest";
import type { Departure } from "../src/normalize";
import { leaveView } from "../src/view";
import { T0 } from "./helpers";

const dep = (min: number, kind: Departure["kind"] = "live", headsign: string | null = null): Departure => ({
  key: String(min),
  tripId: String(min),
  stopId: "s",
  time: T0 + min * 60_000,
  kind,
  headsign,
});

describe("leaveView", () => {
  it("targets the first departure reachable at walking pace, not simply the next one", () => {
    const v = leaveView([dep(3), dep(11), dep(20)], 5, T0, false, false, "train")!;
    expect(v.lead).toBe("Leave in 6 min");
    expect(v.detail).toBe("catch the train in 11 min · 5 min walk");
    expect(v.targetKey).toBe("11");
  });

  it("says Leave now within the grace window and Too late when nothing is reachable", () => {
    expect(leaveView([dep(5)], 5, T0 + 20_000, false, false)!.lead).toBe("Leave now");
    expect(leaveView([dep(3)], 5, T0, false, false)!.lead).toBe("Too late for listed departures");
  });

  it("never counts down from schedule estimates or stale data", () => {
    expect(leaveView([dep(20, "scheduled")], 5, T0, false, false, "bus")).toMatchObject({ lead: "Leave by 1:15 PM", detail: "catch the est. 1:20 PM bus · 5 min walk" });
    expect(leaveView([dep(20)], 5, T0, true, false, "bus")).toMatchObject({ lead: "Leave by 1:15 PM", detail: "last known · catch the 1:20 PM bus · 5 min walk" });
  });

  it("shows nothing without an explicit walk time", () => {
    expect(leaveView([dep(20)], undefined, T0, false, false)).toBeNull();
  });
});
