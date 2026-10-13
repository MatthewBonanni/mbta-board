import { describe, expect, it } from "vitest";
import { formatClock } from "../src/time";

describe("Boston clock", () => {
  it("formats across midnight and the 2026 fall-back DST change", () => {
    expect(formatClock(Date.parse("2026-10-14T03:59:00Z"))).toBe("11:59 PM");
    expect(formatClock(Date.parse("2026-10-14T04:01:00Z"))).toBe("12:01 AM");
    // 1 Nov 2026: 1:30 EDT (05:30Z) and 1:30 EST (06:30Z) are both 1:30 AM local.
    expect(formatClock(Date.parse("2026-11-01T05:30:00Z"))).toBe("1:30 AM");
    expect(formatClock(Date.parse("2026-11-01T06:30:00Z"))).toBe("1:30 AM");
    expect(formatClock(Date.parse("2026-11-01T07:30:00Z"))).toBe("2:30 AM");
  });
});
