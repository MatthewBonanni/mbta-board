/**
 * Development-only demo: fictional stops and times for reviewing layout and states.
 * Loaded with ?demo (or ?demo=stale) under `vite dev`; never part of the production build or first launch.
 */
import { toAlert, type AlertInfo } from "./alerts";
import { ApiError } from "./api";
import { emptyConfig, type BoardConfig, type DepartureGroup } from "./config";
import type { ControllerState, Feed } from "./controller";
import type { RouteInfo, StopInfo } from "./metadata";
import type { Departure, TimeKind } from "./normalize";

const route = (id: string, short: string, long: string, color: string, text: string, type: number, dest: [string, string]): RouteInfo => ({
  id,
  shortName: short,
  longName: long,
  color,
  textColor: text,
  type,
  directionNames: type === 3 ? ["Outbound", "Inbound"] : ["South", "North"],
  directionDestinations: dest,
  sortOrder: 0,
});

const ROUTES: Record<string, RouteInfo> = Object.fromEntries(
  [
    route("demo-red", "", "Red Line", "#DA291C", "#FFFFFF", 1, ["Southfield/Easton", "Northgate"]),
    route("demo-orange", "", "Orange Line", "#ED8B00", "#FFFFFF", 1, ["Lowell Yard", "Fenmore"]),
    route("demo-7", "7", "Example Sq - Harbor Point", "#FFC72C", "#000000", 3, ["Harbor Point", "Example Square"]),
    route("demo-42", "42", "Millbrook - Union Yard", "#FFC72C", "#000000", 3, ["Union Yard", "Millbrook"]),
    route("demo-58", "58", "Cedar Ave - Example Square", "#FFC72C", "#000000", 3, ["Cedar Avenue", "Example Square"]),
    route("demo-SL9", "SL9", "Silver Demo", "#7C878E", "#FFFFFF", 3, ["Pier Road", "Example Square"]),
  ].map((r) => [r.id, r]),
);

const stop = (id: string, name: string, locationType = 0): StopInfo => ({
  id,
  name,
  locationType,
  parentId: null,
  platformName: null,
  onStreet: null,
  atStreet: null,
  municipality: "Exampleton",
  vehicleType: null,
});

const STOPS: Record<string, StopInfo> = Object.fromEntries(
  [
    stop("demo-station", "Example Square", 1),
    stop("demo-sb", "Example Square"),
    stop("demo-nb", "Example Square"),
    stop("demo-101", "Main St @ Elm St"),
    stop("demo-102", "Main St opp Elm St"),
    stop("demo-201", "Cedar Ave @ Pine St"),
    stop("demo-202", "Cedar Ave opp Pine St"),
    stop("demo-301", "Harbor Rd @ Dock St"),
  ].map((s) => [s.id, s]),
);

let n = 0;
const group = (stopId: string, routeId: string, directionId: 0 | 1, displayLabel: string, destinationFilter?: string): DepartureGroup => ({
  id: `demo-${n++}`,
  stopId,
  resolvedStopIds: [stopId],
  routeId,
  directionId,
  displayLabel,
  order: n,
  ...(destinationFilter ? { destinationFilter } : {}),
});

function demoConfig(): BoardConfig {
  n = 0;
  return {
    ...emptyConfig(),
    title: "Demo board",
    groups: [
      group("demo-station", "demo-red", 0, "Example Square", "Southfield"),
      group("demo-station", "demo-red", 0, "Example Square", "Easton"),
      group("demo-station", "demo-red", 1, "Example Square"),
      group("demo-station", "demo-orange", 0, "Example Square"),
      group("demo-101", "demo-7", 0, "Main & Elm"),
      group("demo-102", "demo-7", 1, "Main & Elm"),
      group("demo-201", "demo-42", 1, "Cedar & Pine"),
      group("demo-201", "demo-58", 0, "Cedar & Pine"),
      group("demo-201", "demo-SL9", 0, "Cedar & Pine"),
      group("demo-202", "demo-42", 0, "Cedar opposite Pine"),
      group("demo-202", "demo-58", 1, "Cedar opposite Pine"),
      group("demo-301", "demo-42", 1, ""),
    ].map((g, i) => ({ ...g, order: i })),
  };
}

const PLAN: [number, TimeKind, string | null][][] = [
  [[2, "live", "Southfield"], [11, "live", "Southfield"], [23, "live", "Southfield"]],
  [[6, "live", "Easton"], [19, "live", "Easton"], [34, "live", "Easton"]],
  [[0.4, "live", "Northgate"], [8, "live", "Northgate"], [15, "live", "Northgate"]],
  [[4, "live", "Lowell Yard"], [12, "live", "Lowell Yard"], [75, "live", "Lowell Yard"]],
  [[3, "live", "Harbor Point"], [18, "scheduled", "Harbor Point"], [38, "scheduled", "Harbor Point"]],
  [[9, "approx", "Example Square"], [27, "live", "Example Square"]],
  [[1, "live", "Union Yard"], [14, "live", "Dock Street"], [29, "live", "Union Yard"]],
  [],
  [[13, "scheduled", "Pier Road"]],
  [[5, "live", "Millbrook"], [21, "live", "Millbrook"], [44, "live", "Millbrook"]],
  [[16, "live", "Example Square"], [46, "scheduled", "Example Square"]],
  [[7, "live", "Union Yard"], [22, "live", "Union Yard"], [37, "live", "Union Yard"]],
];

function feed<T>(data: T, lastSuccessAt: number, error: ApiError | null = null): Feed<T> {
  return { data, lastSuccessAt, lastAttemptAt: lastSuccessAt, error, pending: false };
}

export function demoSource(mode: string) {
  const config = demoConfig();
  const start = Date.now();
  const departures = new Map<string, Departure[]>(
    config.groups.map((g, i) => [
      g.id,
      (PLAN[i] ?? []).map(([min, kind, headsign], j) => ({
        key: `${g.id}-${j}`,
        tripId: `${g.id}-${j}`,
        stopId: g.stopId,
        time: start + min * 60_000 + 20_000,
        kind,
        headsign,
      })),
    ]),
  );
  const alerts: AlertInfo[] = [
    toAlert({
      id: "demo-alert",
      type: "alert",
      attributes: {
        header: "Fictional demo alert: Route 58 detoured around Pine St for street work. Board at the temporary stop on Oak St.",
        short_header: "Route 58 detour at Pine St (demo)",
        description: "This alert is fictional and only appears in demo mode.\n\nIt shows how alert details expand.",
        effect: "DETOUR",
        severity: 5,
        active_period: [{ start: new Date(start - 3600_000).toISOString(), end: null }],
        informed_entity: [{ route: "demo-58", activities: ["BOARD"] }],
      },
    }),
    toAlert({
      id: "demo-closed",
      type: "alert",
      attributes: {
        header: "Fictional demo alert: SL9 suspended for the evening.",
        short_header: "SL9 suspended (demo)",
        description: "",
        effect: "SUSPENSION",
        severity: 7,
        active_period: [{ start: new Date(start - 3600_000).toISOString(), end: null }],
        informed_entity: [{ route: "demo-SL9", activities: ["BOARD"] }],
      },
    }),
  ];
  const stale = mode === "stale";
  return {
    config,
    banner: stale ? "Demo with fictional data, showing the not-live state." : "Demo with fictional data. Not live MBTA service.",
    lookup: { route: (id: string) => ROUTES[id], stop: (id: string) => STOPS[id] },
    now: () => Date.now(),
    state: (): ControllerState => {
      const now = Date.now();
      return {
        predictions: stale
          ? feed(departures, now - 3 * 60_000, new ApiError("offline", "This device is offline"))
          : feed(departures, now - 12_000),
        alerts: feed(alerts, now - 30_000),
      };
    },
  };
}
