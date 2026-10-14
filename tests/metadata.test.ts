import { describe, expect, it } from "vitest";
import { routeLabel, type RouteInfo } from "../src/metadata";

const r = (id: string, type: number, longName: string, shortName = ""): RouteInfo => ({
  id,
  shortName,
  longName,
  color: "#000000",
  textColor: "#FFFFFF",
  type,
  directionNames: ["", ""],
  directionDestinations: ["", ""],
  sortOrder: 0,
});

describe("routeLabel", () => {
  it("abbreviates MBTA rapid transit, rail and ferry routes and keeps bus numbers (names as in the V3 API)", () => {
    expect(routeLabel(r("Red", 1, "Red Line"), "Red")).toBe("RL");
    expect(routeLabel(r("Orange", 1, "Orange Line"), "Orange")).toBe("OL");
    expect(routeLabel(r("Blue", 1, "Blue Line"), "Blue")).toBe("BL");
    expect(routeLabel(r("Green-B", 0, "Green Line B", "B"), "Green-B")).toBe("GL·B");
    expect(routeLabel(r("Mattapan", 0, "Mattapan Line"), "Mattapan")).toBe("M");
    expect(routeLabel(r("CR-Fitchburg", 2, "Fitchburg Line"), "CR-Fitchburg")).toBe("CR");
    expect(routeLabel(r("Boat-F4", 4, "Charlestown Ferry"), "Boat-F4")).toBe("F4");
    expect(routeLabel(r("Boat-Lynn", 4, "Lynn Ferry"), "Boat-Lynn")).toBe("F");
    expect(routeLabel(r("64", 3, "Oak Square - Kendall/MIT Station", "64"), "64")).toBe("64");
    expect(routeLabel(r("741", 3, "Logan Airport Terminals - South Station", "SL1"), "741")).toBe("SL1");
  });
});
