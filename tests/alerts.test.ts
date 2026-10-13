import { describe, expect, it } from "vitest";
import { alertsForGroup, toAlert } from "../src/alerts";
import { group, T0 } from "./helpers";

const iso = (m: number) => new Date(T0 + m * 60_000).toISOString();
const alert = (id: string, entities: object[], start = -60, end: number | null = null) =>
  toAlert({
    id,
    type: "alert",
    attributes: { header: id, effect: "DELAY", severity: 3, active_period: [{ start: iso(start), end: end === null ? null : iso(end) }], informed_entity: entities },
  });

describe("alertsForGroup", () => {
  const g = group({ routeId: "Red", stopId: "place-pktrm", resolvedStopIds: ["70075", "70076"], directionId: 0 });

  it("matches active route, stop-platform and route-type alerts, and rejects expired, future and unrelated ones", () => {
    const alerts = [
      alert("route-wide", [{ route: "Red", activities: ["BOARD", "EXIT", "RIDE"] }]),
      alert("platform", [{ route: "Red", stop: "70075", activities: ["BOARD"] }]),
      alert("mode-wide", [{ route_type: 1, activities: ["BOARD"] }]),
      alert("expired", [{ route: "Red", activities: ["BOARD"] }], -120, -10),
      alert("upcoming", [{ route: "Red", activities: ["BOARD"] }], 30),
      alert("other-route", [{ route: "Orange", activities: ["BOARD"] }]),
      alert("other-stop", [{ route: "Red", stop: "70087", activities: ["BOARD"] }]),
      alert("other-direction", [{ route: "Red", direction_id: 1, activities: ["BOARD"] }]),
      alert("elevator", [{ route: "Red", stop: "70075", activities: ["USING_WHEELCHAIR"] }]),
      alert("one-trip", [{ route: "Red", trip: "123", activities: ["BOARD"] }]),
    ];
    expect(alertsForGroup(alerts, g, 1, T0).map((a) => a.id).sort()).toEqual(["mode-wide", "platform", "route-wide"]);
  });
});
