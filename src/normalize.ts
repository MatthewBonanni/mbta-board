import { relId, type Document, type Resource } from "./api";
import type { DepartureGroup } from "./config";
import { routeMode, type RouteMode } from "./metadata";

/** live: realtime; approx: realtime but bus appears stalled (301); scheduled: schedule-based estimate (bus 300). */
export type TimeKind = "live" | "approx" | "scheduled";

export interface Departure {
  key: string;
  tripId: string | null;
  stopId: string;
  time: number;
  kind: TimeKind;
  headsign: string | null;
}

/**
 * MBTA uncertainty semantics (gtfs-documentation/reference/gtfs-realtime.md):
 * bus <300 realtime, 300 schedule-based, 301 realtime but stalled/delayed, >301 suppress.
 * Rail values (60/120/360) describe trip progress; all are realtime predictions.
 */
export function classify(mode: RouteMode, uncertainty: unknown): TimeKind | null {
  if (mode !== "bus") return "live";
  if (typeof uncertainty !== "number") return "live";
  if (uncertainty < 300) return "live";
  if (uncertainty === 300) return "scheduled";
  if (uncertainty === 301) return "approx";
  return null;
}

const EXCLUDED_RELATIONSHIPS = new Set(["CANCELLED", "SKIPPED", "NO_DATA"]);

export function normalizePredictions(
  doc: Document,
  groups: DepartureGroup[],
  routeType: (routeId: string) => number | undefined,
  now: number,
): Map<string, Departure[]> {
  const headsigns = new Map<string, string | null>();
  for (const r of doc.included) {
    if (r.type === "trip") headsigns.set(r.id, typeof r.attributes.headsign === "string" ? r.attributes.headsign : null);
  }
  const out = new Map<string, Departure[]>(groups.map((g) => [g.id, []]));
  const seen = new Set<string>();
  for (const p of doc.data) {
    const d = toDeparture(p, headsigns, routeType, now);
    if (!d) continue;
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    const routeId = relId(p, "route");
    const dir = p.attributes.direction_id;
    for (const g of groups) {
      if (g.routeId !== routeId || g.directionId !== dir) continue;
      if (!g.resolvedStopIds.includes(d.stopId)) continue;
      if (g.destinationFilter && d.headsign !== g.destinationFilter) continue;
      out.get(g.id)!.push(d);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.time - b.time);
  return out;
}

function toDeparture(
  p: Resource,
  headsigns: Map<string, string | null>,
  routeType: (routeId: string) => number | undefined,
  now: number,
): Departure | null {
  if (p.type !== "prediction") return null;
  const a = p.attributes;
  if (typeof a.schedule_relationship === "string" && EXCLUDED_RELATIONSHIPS.has(a.schedule_relationship)) return null;
  if (a.revenue === "NON_REVENUE") return null;
  // No departure time means no boarding here (e.g. the last stop of a trip).
  if (typeof a.departure_time !== "string") return null;
  const time = Date.parse(a.departure_time);
  if (!Number.isFinite(time) || time < now - 30_000) return null;
  const routeId = relId(p, "route");
  const stopId = relId(p, "stop");
  if (!routeId || !stopId) return null;
  const type = routeType(routeId);
  const kind = classify(type === undefined ? "other" : routeMode(type), a.departure_uncertainty);
  if (!kind) return null;
  const tripId = relId(p, "trip");
  const seq = typeof a.stop_sequence === "number" ? a.stop_sequence : "";
  const fallbackHeadsign = typeof a.trip_headsign === "string" ? a.trip_headsign : null;
  return {
    key: tripId ? `${tripId}|${stopId}|${seq}` : p.id,
    tripId,
    stopId,
    time,
    kind,
    headsign: (tripId ? headsigns.get(tripId) : null) ?? fallbackHeadsign,
  };
}
