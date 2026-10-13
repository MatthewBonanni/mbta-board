import { describe, expect, it } from "vitest";
import { BOSTON, isDark, sunTimes } from "../src/sun";

// Reference: api.sunrise-sunset.org for Boston (42.3601, -71.0589).
const REF: [string, string, string][] = [
  ["2026-10-13T16:00:00Z", "2026-10-13T10:53:39Z", "2026-10-13T22:07:11Z"],
  ["2026-06-21T16:00:00Z", "2026-06-21T09:05:53Z", "2026-06-22T00:26:19Z"],
  ["2026-12-21T16:00:00Z", "2026-12-21T12:08:28Z", "2026-12-21T21:16:18Z"],
];

describe("sunTimes", () => {
  it.each(REF)("matches published Boston times within 3 minutes (%s)", (at, rise, set) => {
    const t = sunTimes(Date.parse(at), BOSTON.lat, BOSTON.lon)!;
    expect(Math.abs(t.sunrise - Date.parse(rise))).toBeLessThan(3 * 60_000);
    expect(Math.abs(t.sunset - Date.parse(set))).toBeLessThan(3 * 60_000);
  });

  it("is dark late evening and before dawn local time, light mid-afternoon", () => {
    expect(isDark(Date.parse("2026-10-13T23:30:00Z"))).toBe(true); // 7:30 PM EDT
    expect(isDark(Date.parse("2026-10-14T09:30:00Z"))).toBe(true); // 5:30 AM EDT
    expect(isDark(Date.parse("2026-10-13T19:00:00Z"))).toBe(false); // 3 PM EDT
  });
});
