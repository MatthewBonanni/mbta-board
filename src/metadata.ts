import { query, relId, type RequestQueue, type Resource } from "./api";
import type { Store } from "./config";

export const METADATA_KEY = "mbta-departure-board:metadata:v1";
export const STOP_INDEX_KEY = "mbta-departure-board:stop-index:v1";
const METADATA_TTL_MS = 7 * 24 * 3600_000;
const STOP_INDEX_TTL_MS = 7 * 24 * 3600_000;

export type RouteMode = "subway" | "light-rail" | "rail" | "bus" | "ferry" | "other";

export interface RouteInfo {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  type: number;
  directionNames: [string, string];
  directionDestinations: [string, string];
  sortOrder: number;
}

export interface StopInfo {
  id: string;
  name: string;
  locationType: number;
  parentId: string | null;
  platformName: string | null;
  onStreet: string | null;
  atStreet: string | null;
  municipality: string | null;
  vehicleType: number | null;
}

export interface MetadataCache {
  fetchedAt: number;
  routes: Record<string, RouteInfo>;
  stops: Record<string, StopInfo>;
}

export function routeMode(type: number): RouteMode {
  switch (type) {
    case 0:
      return "light-rail";
    case 1:
      return "subway";
    case 2:
      return "rail";
    case 3:
      return "bus";
    case 4:
      return "ferry";
    default:
      return "other";
  }
}

export function routeLabel(r: RouteInfo | undefined, fallbackId: string): string {
  if (!r) return fallbackId;
  if (r.shortName) return r.shortName;
  return r.longName.replace(/ Line$/, "") || r.id;
}

export function directionLabel(r: RouteInfo | undefined, directionId: 0 | 1): string {
  if (!r) return directionId === 0 ? "Direction 0" : "Direction 1";
  return r.directionDestinations[directionId] || r.directionNames[directionId] || `Direction ${directionId}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const pair = (v: unknown): [string, string] => {
  const a = Array.isArray(v) ? v : [];
  return [String(a[0] ?? ""), String(a[1] ?? "")];
};
const hex = (v: unknown, d: string): string => (typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? `#${v}` : d);

export function toRoute(r: Resource): RouteInfo {
  const a = r.attributes;
  return {
    id: r.id,
    shortName: str(a.short_name) ?? "",
    longName: str(a.long_name) ?? r.id,
    color: hex(a.color, "#575752"),
    textColor: hex(a.text_color, "#FFFFFF"),
    type: num(a.type, -1),
    directionNames: pair(a.direction_names),
    directionDestinations: pair(a.direction_destinations),
    sortOrder: num(a.sort_order, 0),
  };
}

export function toStop(r: Resource): StopInfo {
  const a = r.attributes;
  return {
    id: r.id,
    name: str(a.name) ?? r.id,
    locationType: num(a.location_type, 0),
    parentId: relId(r, "parent_station"),
    platformName: str(a.platform_name),
    onStreet: str(a.on_street),
    atStreet: str(a.at_street),
    municipality: str(a.municipality),
    vehicleType: typeof a.vehicle_type === "number" ? a.vehicle_type : null,
  };
}

const ROUTE_FIELDS = "short_name,long_name,color,text_color,type,direction_names,direction_destinations,sort_order";
const STOP_FIELDS = "name,location_type,platform_name,on_street,at_street,municipality,vehicle_type";

function readJson<T>(store: Store | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Store | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* metadata cache is optional */
  }
}

export class Metadata {
  private cache: MetadataCache;
  private stopIndex: Promise<StopInfo[]> | null = null;
  private routeStops = new Map<string, Promise<Set<string>>>();
  private allRoutes: Promise<RouteInfo[]> | null = null;

  constructor(
    private readonly queue: RequestQueue,
    private readonly store: Store | null,
    private readonly now: () => number = Date.now,
  ) {
    const cached = readJson<MetadataCache>(store, METADATA_KEY);
    this.cache = cached && typeof cached.fetchedAt === "number" ? cached : { fetchedAt: 0, routes: {}, stops: {} };
  }

  route(id: string): RouteInfo | undefined {
    return this.cache.routes[id];
  }

  stop(id: string): StopInfo | undefined {
    return this.cache.stops[id];
  }

  remember(routes: RouteInfo[], stops: StopInfo[]): void {
    for (const r of routes) this.cache.routes[r.id] = r;
    for (const s of stops) this.cache.stops[s.id] = s;
    writeJson(this.store, METADATA_KEY, this.cache);
  }

  /** Loads names, colors and direction labels for configured services; refreshes weekly. */
  async ensure(routeIds: string[], stopIds: string[]): Promise<{ missingRoutes: string[]; missingStops: string[] }> {
    const expired = this.now() - this.cache.fetchedAt > METADATA_TTL_MS;
    const needRoutes = [...new Set(routeIds)].filter((id) => expired || !this.cache.routes[id]);
    const needStops = [...new Set(stopIds)].filter((id) => expired || !this.cache.stops[id]);
    const routes = needRoutes.length
      ? (await this.queue.getAll(query("/routes", { "filter[id]": needRoutes.join(","), "fields[route]": ROUTE_FIELDS }), 0)).data.map(toRoute)
      : [];
    const stops = needStops.length
      ? (await this.queue.getAll(query("/stops", { "filter[id]": needStops.join(","), "fields[stop]": STOP_FIELDS }), 0)).data.map(toStop)
      : [];
    if (expired && (needRoutes.length || needStops.length)) this.cache.fetchedAt = this.now();
    if (!this.cache.fetchedAt) this.cache.fetchedAt = this.now();
    this.remember(routes, stops);
    const gotR = new Set(routes.map((r) => r.id));
    const gotS = new Set(stops.map((s) => s.id));
    return {
      missingRoutes: needRoutes.filter((id) => !gotR.has(id)),
      missingStops: needStops.filter((id) => !gotS.has(id)),
    };
  }

  routes(): Promise<RouteInfo[]> {
    this.allRoutes ??= this.queue
      .getAll(query("/routes", { "fields[route]": ROUTE_FIELDS }), 0)
      .then((doc) => doc.data.map(toRoute).sort((a, b) => a.sortOrder - b.sortOrder))
      .catch((err) => {
        this.allRoutes = null;
        throw err;
      });
    return this.allRoutes;
  }

  /** All stops and stations, fetched once (one request) and cached so search never hits the network per keystroke. */
  stops(): Promise<StopInfo[]> {
    if (this.stopIndex) return this.stopIndex;
    const cached = readJson<{ fetchedAt: number; stops: StopRow[] }>(this.store, STOP_INDEX_KEY);
    if (cached && this.now() - cached.fetchedAt < STOP_INDEX_TTL_MS && Array.isArray(cached.stops)) {
      this.stopIndex = Promise.resolve(cached.stops.map(fromRow));
      return this.stopIndex;
    }
    this.stopIndex = this.queue
      .getAll(query("/stops", { "filter[location_type]": "0,1", "fields[stop]": STOP_FIELDS }), 0)
      .then((doc) => {
        const stops = doc.data.map(toStop);
        writeJson(this.store, STOP_INDEX_KEY, { fetchedAt: this.now(), stops: stops.map(toRow) });
        return stops;
      })
      .catch((err) => {
        this.stopIndex = null;
        throw err;
      });
    return this.stopIndex;
  }

  stopIdsForRoute(routeId: string): Promise<Set<string>> {
    let p = this.routeStops.get(routeId);
    if (!p) {
      p = this.queue
        .getAll(query("/stops", { "filter[route]": routeId, "fields[stop]": "name" }), 0)
        .then((doc) => new Set(doc.data.map((s) => s.id)))
        .catch((err) => {
          this.routeStops.delete(routeId);
          throw err;
        });
      this.routeStops.set(routeId, p);
    }
    return p;
  }

  async coordinates(stopIds: string[]): Promise<{ id: string; lat: number; lon: number }[]> {
    if (!stopIds.length) return [];
    const doc = await this.queue.getAll(
      query("/stops", { "filter[id]": [...new Set(stopIds)].join(","), "fields[stop]": "latitude,longitude" }),
      0,
    );
    return doc.data.flatMap((r) => {
      const { latitude: lat, longitude: lon } = r.attributes;
      return typeof lat === "number" && typeof lon === "number" ? [{ id: r.id, lat, lon }] : [];
    });
  }

  async stopServices(stopId: string): Promise<StopServices> {
    const doc = await this.queue.getAll(
      query("/route_patterns", {
        "filter[stop]": stopId,
        include: "route,representative_trip",
        "fields[route_pattern]": "direction_id,typicality,name",
        "fields[trip]": "headsign",
        "fields[route]": ROUTE_FIELDS,
      }),
      0,
    );
    const stop = this.stop(stopId) ?? (await this.stops()).find((s) => s.id === stopId);
    let children: StopInfo[] = [];
    if (stop?.locationType === 1) {
      const kids = await this.queue.getAll(query(`/stops/${encodeURIComponent(stopId)}`, { include: "child_stops", "fields[stop]": STOP_FIELDS }), 0);
      children = kids.included.filter((r) => r.type === "stop").map(toStop).filter((s) => s.locationType === 0);
    }
    const result = parseServices(doc.data, doc.included);
    this.remember(result.routes, [...(stop ? [stop] : []), ...children]);
    return { ...result, stop, children };
  }
}

export interface ServiceOption {
  routeId: string;
  directionId: 0 | 1;
  /** Destinations of this stop's typical patterns, validated from current route_patterns data. */
  headsigns: string[];
}

export interface StopServices {
  stop: StopInfo | undefined;
  children: StopInfo[];
  routes: RouteInfo[];
  services: ServiceOption[];
}

export function parseServices(patterns: Resource[], included: Resource[]): Omit<StopServices, "stop" | "children"> {
  const trips = new Map(included.filter((r) => r.type === "trip").map((r) => [r.id, str(r.attributes.headsign)]));
  const routes = included.filter((r) => r.type === "route").map(toRoute).sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map<string, ServiceOption>();
  for (const p of patterns) {
    const typicality = num(p.attributes.typicality, 1);
    if (typicality > 3) continue;
    const routeId = relId(p, "route");
    const dir = p.attributes.direction_id;
    if (!routeId || (dir !== 0 && dir !== 1)) continue;
    const key = `${routeId}|${dir}`;
    let opt = byKey.get(key);
    if (!opt) {
      opt = { routeId, directionId: dir, headsigns: [] };
      byKey.set(key, opt);
    }
    const tripId = relId(p, "representative_trip");
    const headsign = tripId ? trips.get(tripId) : null;
    if (headsign && typicality === 1 && !opt.headsigns.includes(headsign)) opt.headsigns.push(headsign);
  }
  const order = new Map(routes.map((r, i) => [r.id, i]));
  const services = [...byKey.values()].sort(
    (a, b) => (order.get(a.routeId) ?? 999) - (order.get(b.routeId) ?? 999) || a.directionId - b.directionId,
  );
  for (const s of services) s.headsigns.sort();
  return { routes, services };
}

type StopRow = [string, string, number, string | null, string | null, string | null, string | null, string | null, number | null];

function toRow(s: StopInfo): StopRow {
  return [s.id, s.name, s.locationType, s.parentId, s.platformName, s.onStreet, s.atStreet, s.municipality, s.vehicleType];
}

function fromRow(r: StopRow): StopInfo {
  return {
    id: r[0],
    name: r[1],
    locationType: r[2],
    parentId: r[3],
    platformName: r[4],
    onStreet: r[5],
    atStreet: r[6],
    municipality: r[7],
    vehicleType: r[8],
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bopp\b/g, "opposite")
    .replace(/\bave\b/g, "avenue")
    .replace(/\bst\b/g, "street")
    .replace(/\bsq\b/g, "square")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchStops(stops: StopInfo[], text: string, allowed?: Set<string>, limit = 40): StopInfo[] {
  const q = text.trim();
  const tokens = norm(q).split(" ").filter(Boolean);
  const scored: { s: StopInfo; score: number }[] = [];
  for (const s of stops) {
    if (allowed && !allowed.has(s.id) && !(s.parentId && allowed.has(s.parentId))) continue;
    if (!tokens.length) {
      if (allowed) scored.push({ s, score: 0 });
      continue;
    }
    if (s.id.toLowerCase() === q.toLowerCase()) {
      scored.push({ s, score: 1000 });
      continue;
    }
    const hay = norm([s.name, s.onStreet, s.atStreet, s.platformName, s.municipality].filter(Boolean).join(" "));
    const name = norm(s.name);
    if (!tokens.every((t) => hay.includes(t) || s.id.toLowerCase().startsWith(t))) continue;
    let score = 0;
    if (name.startsWith(tokens.join(" "))) score += 50;
    if (tokens.every((t) => name.includes(t))) score += 20;
    if (s.locationType === 1) score += 10;
    scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name) || a.s.id.localeCompare(b.s.id));
  return scored.slice(0, limit).map((x) => x.s);
}

export function describeStop(s: StopInfo): string {
  if (s.locationType === 1) return "Station (all platforms)";
  if (s.platformName) return `Platform: ${s.platformName}`;
  const street = [s.onStreet, s.atStreet].filter(Boolean).join(" at ");
  if (s.vehicleType === 3 || !s.parentId) return street ? `Stop on ${street}` : "Stop";
  return "Platform";
}
