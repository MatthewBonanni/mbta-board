import { describe, expect, it } from "vitest";
import { emptyConfig, type BoardConfig, type DepartureGroup } from "../src/config";
import type { ControllerState } from "../src/controller";
import type { StopInfo } from "../src/metadata";
import { buildBoardView, shortStreet } from "../src/view";
import { group, T0 } from "./helpers";

const bus = (id: string, on: string, at: string): StopInfo => ({
  id,
  name: id,
  locationType: 0,
  parentId: null,
  platformName: null,
  onStreet: on,
  atStreet: at,
  municipality: null,
  vehicleType: 3,
});
const STOPS: Record<string, StopInfo> = {
  near: bus("near", "Elm Street", "Oak Avenue"),
  opp: bus("opp", "Elm Street", "Oak Avenue"),
  other: bus("other", "Elm Street", "Pine Road"),
};
const lookup = { route: () => undefined, stop: (id: string) => STOPS[id] };
const empty: ControllerState = {
  predictions: { data: new Map(), lastSuccessAt: T0, lastAttemptAt: T0, error: null, pending: false },
  alerts: { data: [], lastSuccessAt: T0, lastAttemptAt: T0, error: null, pending: false },
};
const g = (id: string, stopId: string, label: string): DepartureGroup => ({ ...group({ id, routeId: "39", stopId, directionId: 0 }), displayLabel: label });
const corners = (groups: DepartureGroup[]) => {
  const config: BoardConfig = { ...emptyConfig(), groups };
  return buildBoardView(config, lookup, empty, T0).sections.map((s) => s.corner?.heading ?? null);
};

describe("street-corner pairing", () => {
  it("pairs adjacent bus stops the MBTA lists at the same street and cross street", () => {
    expect(corners([g("a", "near", "This side"), g("b", "opp", "Other side")])).toEqual(["Elm St & Oak Ave", "Elm St & Oak Ave"]);
  });

  it("does not pair different cross streets, or same-corner stops separated by another section", () => {
    expect(corners([g("a", "near", "A"), g("b", "other", "B")])).toEqual([null, null]);
    expect(corners([g("a", "near", "A"), g("b", "other", "B"), g("c", "opp", "C")])).toEqual([null, null, null]);
  });

  it("abbreviates street suffixes only as whole words", () => {
    expect(shortStreet("Massachusetts Avenue")).toBe("Massachusetts Ave");
    expect(shortStreet("Streeter Road")).toBe("Streeter Rd");
  });
});
