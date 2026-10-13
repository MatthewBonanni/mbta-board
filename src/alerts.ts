import type { Resource } from "./api";
import type { DepartureGroup } from "./config";

export interface AlertInfo {
  id: string;
  header: string;
  summary: string;
  description: string;
  effect: string;
  severity: number;
  periods: { start: number; end: number | null }[];
  entities: AlertEntity[];
}

interface AlertEntity {
  route?: string;
  routeType?: number;
  stop?: string;
  directionId?: number;
  trip?: string;
  activities?: string[];
}

export const NO_SERVICE_EFFECTS = new Set(["SUSPENSION", "NO_SERVICE", "STOP_CLOSURE", "STATION_CLOSURE"]);
const RELEVANT_ACTIVITIES = ["BOARD", "RIDE"];

const s = (v: unknown): string => (typeof v === "string" ? v : "");

export function toAlert(r: Resource): AlertInfo {
  const a = r.attributes;
  const periods = (Array.isArray(a.active_period) ? a.active_period : []).flatMap((p) => {
    const start = Date.parse(s((p as Record<string, unknown>)?.start));
    const endRaw = (p as Record<string, unknown>)?.end;
    const end = typeof endRaw === "string" ? Date.parse(endRaw) : null;
    return Number.isFinite(start) ? [{ start, end: end !== null && Number.isFinite(end) ? end : null }] : [];
  });
  const entities = (Array.isArray(a.informed_entity) ? a.informed_entity : []).map((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    return {
      route: typeof x.route === "string" ? x.route : undefined,
      routeType: typeof x.route_type === "number" ? x.route_type : undefined,
      stop: typeof x.stop === "string" ? x.stop : undefined,
      directionId: typeof x.direction_id === "number" ? x.direction_id : undefined,
      trip: typeof x.trip === "string" ? x.trip : undefined,
      activities: Array.isArray(x.activities) ? x.activities.filter((v): v is string => typeof v === "string") : undefined,
    };
  });
  const header = s(a.header);
  return {
    id: r.id,
    header,
    summary: s(a.short_header) || s(a.service_effect) || header,
    description: s(a.description),
    effect: s(a.effect),
    severity: typeof a.severity === "number" ? a.severity : 0,
    periods,
    entities,
  };
}

export function isActive(alert: AlertInfo, now: number): boolean {
  if (!alert.periods.length) return false;
  return alert.periods.some((p) => p.start <= now && (p.end === null || now < p.end));
}

export function alertMatchesGroup(alert: AlertInfo, g: DepartureGroup, routeType: number | undefined): boolean {
  const stops = new Set([g.stopId, ...g.resolvedStopIds]);
  return alert.entities.some((e) => {
    if (e.trip) return false;
    if (e.activities && !e.activities.some((x) => RELEVANT_ACTIVITIES.includes(x))) return false;
    if (e.route !== undefined) {
      if (e.route !== g.routeId) return false;
    } else if (e.routeType === undefined || e.routeType !== routeType) {
      return false;
    }
    if (e.stop !== undefined && !stops.has(e.stop)) return false;
    if (e.directionId !== undefined && e.directionId !== g.directionId) return false;
    return true;
  });
}

export function alertsForGroup(alerts: AlertInfo[], g: DepartureGroup, routeType: number | undefined, now: number): AlertInfo[] {
  return alerts
    .filter((a) => isActive(a, now) && alertMatchesGroup(a, g, routeType))
    .sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

