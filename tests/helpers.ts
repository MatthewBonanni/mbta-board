import type { Resource } from "../src/api";
import type { DepartureGroup } from "../src/config";

export const T0 = Date.parse("2026-10-13T17:00:00Z");

export function prediction(o: {
  id?: string;
  route: string;
  stop: string;
  trip: string;
  dir: 0 | 1;
  dep: number | null;
  unc?: number | null;
  rel?: string | null;
  seq?: number;
  revenue?: string;
}): Resource {
  return {
    id: o.id ?? `prediction-${o.trip}-${o.stop}-${o.seq ?? 1}`,
    type: "prediction",
    attributes: {
      departure_time: o.dep === null ? null : new Date(o.dep).toISOString(),
      departure_uncertainty: o.unc ?? null,
      direction_id: o.dir,
      schedule_relationship: o.rel ?? null,
      stop_sequence: o.seq ?? 1,
      revenue: o.revenue ?? "REVENUE",
    },
    relationships: {
      route: { data: { id: o.route, type: "route" } },
      stop: { data: { id: o.stop, type: "stop" } },
      trip: { data: { id: o.trip, type: "trip" } },
    },
  };
}

export const trip = (id: string, headsign: string): Resource => ({ id, type: "trip", attributes: { headsign } });

export function group(o: Partial<DepartureGroup> & Pick<DepartureGroup, "routeId" | "stopId" | "directionId">): DepartureGroup {
  return {
    id: o.id ?? `g-${o.routeId}-${o.stopId}-${o.directionId}-${o.destinationFilter ?? ""}`,
    resolvedStopIds: o.resolvedStopIds ?? [o.stopId],
    displayLabel: "",
    order: 0,
    ...o,
  };
}

/** Response stand-in whose body resolves in a microtask, so fake timers fully control request timing. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response;
}

export function textResponse(text: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => JSON.parse(text) } as Response;
}

/** Advances fake time in small steps so long promise chains between timers settle. */
export async function advance(ms: number, step = 50): Promise<void> {
  const { vi } = await import("vitest");
  for (let t = 0; t < ms; t += step) await vi.advanceTimersByTimeAsync(Math.min(step, ms - t));
}
