import { alertsForGroup, NO_SERVICE_EFFECTS, type AlertInfo } from "./alerts";
import type { BoardConfig, DepartureGroup } from "./config";
import type { ControllerState } from "./controller";
import { directionLabel, routeLabel, type RouteInfo, type StopInfo } from "./metadata";
import type { Departure } from "./normalize";
import { clockParts, formatAge, formatClock, minutesUntil } from "./time";

export const FRESHNESS_CUTOFF_MS = 60_000;
export const ALERT_STALE_MS = 4 * 60_000;
const TIMES_PER_ROW = 3;

export type Freshness = "idle" | "loading" | "live" | "stale";

export interface TimeView {
  /** Large value, e.g. "4", "Now", "4:32". */
  value: string;
  /** Smaller suffix, e.g. "min", "PM". */
  unit: string;
  /** Prefix that marks a non-live value, e.g. "Est.", "Last". */
  prefix: string;
  kind: "live" | "approx" | "scheduled" | "last-known";
  /** Full text for assistive technology. */
  label: string;
  headsign: string | null;
}

export interface AlertView {
  id: string;
  summary: string;
  header: string;
  description: string;
}

/** Time to leave the starting point; deliberately phrased and placed apart from departure times. */
export interface LeaveView {
  lead: string;
  detail: string;
  label: string;
  urgent: boolean;
}

export interface RowView {
  groupId: string;
  badge: { text: string; background: string; color: string; mode: string };
  destination: string;
  times: TimeView[];
  message: string | null;
  leave: LeaveView | null;
  alerts: AlertView[];
}

export interface SectionView {
  key: string;
  heading: string;
  official: string | null;
  stopRef: string;
  rows: RowView[];
}

export interface BoardView {
  freshness: Freshness;
  freshnessText: string;
  freshnessDetail: string | null;
  alertsStale: boolean;
  sections: SectionView[];
}

export interface Lookup {
  route(id: string): RouteInfo | undefined;
  stop(id: string): StopInfo | undefined;
}

export function freshnessOf(state: ControllerState, hasGroups: boolean, now: number): Freshness {
  if (!hasGroups) return "idle";
  const p = state.predictions;
  if (p.lastSuccessAt === null) return p.error ? "stale" : "loading";
  if (p.error || now - p.lastSuccessAt > FRESHNESS_CUTOFF_MS) return "stale";
  return "live";
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INK = "#161616";
const WHITE = "#FFFFFF";

/** Keeps the agency's text color unless it misses WCAG AA on the badge (e.g. white on Orange Line). */
export function badgeTextColor(background: string, preferred: string): string {
  if (contrast(background, preferred) >= 4.5) return preferred;
  return contrast(background, INK) >= contrast(background, WHITE) ? INK : WHITE;
}

function timeView(d: Departure, now: number, stale: boolean, showHeadsign: boolean, first: boolean): TimeView {
  const headsign = showHeadsign ? d.headsign : null;
  const clock = clockParts(d.time);
  const at = formatClock(d.time);
  const toward = headsign ? ` to ${headsign}` : "";
  if (stale) {
    return { value: clock.time, unit: clock.period, prefix: first ? "Last known" : "", kind: "last-known", label: `Last known time ${at}${toward}, not live`, headsign };
  }
  if (d.kind === "scheduled") {
    return { value: clock.time, unit: clock.period, prefix: "Est.", kind: "scheduled", label: `Scheduled estimate ${at}${toward}`, headsign };
  }
  const mins = minutesUntil(d.time, now);
  const approx = d.kind === "approx";
  if (mins >= 60) {
    return { value: clock.time, unit: clock.period, prefix: approx ? "Approx." : "", kind: d.kind, label: `${approx ? "About " : ""}${at}${toward}`, headsign };
  }
  if (mins === 0) {
    return { value: "Now", unit: "", prefix: approx ? "Approx." : "", kind: d.kind, label: `${approx ? "About now, may be delayed" : "Now"}${toward}`, headsign };
  }
  const minsText = `${mins} minute${mins === 1 ? "" : "s"}`;
  return {
    value: String(mins),
    unit: "min",
    prefix: approx ? "Approx." : "",
    kind: d.kind,
    label: `${approx ? `About ${minsText}, may be delayed` : `In ${minsText}`}${toward}`,
    headsign,
  };
}

const LEAVE_GRACE_MS = 30_000;

export function leaveView(
  departures: Departure[],
  walkMinutes: number | undefined,
  now: number,
  stale: boolean,
  showHeadsign: boolean,
): LeaveView | null {
  if (walkMinutes === undefined || !departures.length) return null;
  const walk = `${walkMinutes} min walk`;
  const walkMs = walkMinutes * 60_000;
  const d = departures.find((x) => x.time - walkMs >= now - LEAVE_GRACE_MS);
  if (!d) {
    return { lead: "Too late for listed departures", detail: walk, label: `Too late to walk to the listed departures, ${walkMinutes} minute walk`, urgent: false };
  }
  const leaveAt = d.time - walkMs;
  const toward = showHeadsign && d.headsign ? ` to ${d.headsign}` : "";
  const dep = `${d.kind === "scheduled" ? "est. " : ""}${formatClock(d.time)}${toward}`;
  const extras = [stale ? "last known" : null, `for the ${dep}`, walk, d.kind === "approx" ? "bus may be delayed" : null];
  const detail = extras.filter(Boolean).join(" · ");
  let lead: string;
  let mins = Infinity;
  if (stale || d.kind === "scheduled") {
    lead = `Leave by ${formatClock(leaveAt)}`;
  } else {
    mins = Math.max(0, Math.floor((leaveAt - now) / 60_000));
    lead = mins === 0 ? "Leave now" : mins < 60 ? `Leave in ${mins} min` : `Leave by ${formatClock(leaveAt)}`;
  }
  return {
    lead,
    detail,
    label: `${lead}, to catch the ${dep} departure, ${walkMinutes} minute walk${stale ? ", based on last known times" : ""}`,
    urgent: mins <= 2,
  };
}

function rowView(
  g: DepartureGroup,
  lookup: Lookup,
  state: ControllerState,
  freshness: Freshness,
  now: number,
): RowView {
  const route = lookup.route(g.routeId);
  const background = route?.color ?? "#575752";
  const all = state.predictions.data?.get(g.id) ?? [];
  const upcoming = all.filter((d) => d.time >= now - 30_000).slice(0, TIMES_PER_ROW);
  const headsigns = new Set(upcoming.map((d) => d.headsign).filter(Boolean));
  const mixed = headsigns.size > 1;
  const destination =
    g.destinationFilter ?? (headsigns.size === 1 ? [...headsigns][0]! : directionLabel(route, g.directionId));
  const stale = freshness === "stale";
  const alerts = (state.alerts.data ? alertsForGroup(state.alerts.data, g, route?.type, now) : []).map(alertView);

  let message: string | null = null;
  if (!upcoming.length) {
    if (freshness === "loading") message = "Loading…";
    else if (state.predictions.data === null) message = "No data — MBTA not reachable";
    else if (alerts.length && (state.alerts.data ?? []).some((a) => alerts.some((v) => v.id === a.id) && NO_SERVICE_EFFECTS.has(a.effect)))
      message = "No service — see alert";
    else message = stale ? "No departures in last update" : "No predictions right now";
  }

  return {
    groupId: g.id,
    badge: {
      text: routeLabel(route, g.routeId),
      background,
      color: badgeTextColor(background, route?.textColor ?? WHITE),
      mode: route ? String(route.type) : "",
    },
    destination,
    times: upcoming.map((d, i) => timeView(d, now, stale, mixed && !g.destinationFilter, i === 0)),
    message,
    leave: upcoming.length
      ? leaveView(all.filter((d) => d.time >= now - LEAVE_GRACE_MS), g.walkMinutes, now, stale, mixed && !g.destinationFilter)
      : null,
    alerts,
  };
}

function alertView(a: AlertInfo): AlertView {
  return { id: a.id, summary: a.summary, header: a.header, description: a.description };
}

function freshnessText(f: Freshness, state: ControllerState, now: number): { text: string; detail: string | null } {
  const p = state.predictions;
  switch (f) {
    case "idle":
      return { text: "No departures configured", detail: null };
    case "loading":
      return { text: "Connecting…", detail: null };
    case "live":
      return { text: "Live", detail: `Updated ${formatAge(now - p.lastSuccessAt!)}` };
    case "stale": {
      const last = p.lastSuccessAt === null ? "No successful update yet" : `Last update ${formatAge(now - p.lastSuccessAt)}`;
      const reason = p.error?.message ?? "Updates have stopped";
      return { text: "Not live", detail: `${last} · ${reason}` };
    }
  }
}

export function buildBoardView(config: BoardConfig, lookup: Lookup, state: ControllerState, now: number): BoardView {
  const freshness = freshnessOf(state, config.groups.length > 0, now);
  const sections: SectionView[] = [];
  for (const g of config.groups) {
    const stop = lookup.stop(g.stopId);
    const official = stop?.name ?? null;
    const heading = g.displayLabel || official || `Stop ${g.stopId}`;
    const key = g.displayLabel ? `label|${g.displayLabel}` : `stop|${g.stopId}`;
    const last = sections[sections.length - 1];
    const row = rowView(g, lookup, state, freshness, now);
    const ref = stop?.locationType === 1 ? `Station ${g.stopId}` : `Stop ${g.stopId}`;
    if (last && last.key === key) {
      last.rows.push(row);
      if (!last.stopRef.split(" · ").includes(ref)) last.stopRef += ` · ${ref}`;
      continue;
    }
    sections.push({
      key,
      heading,
      official: g.displayLabel && official && official !== g.displayLabel ? official : null,
      stopRef: ref,
      rows: [row],
    });
  }
  const a = state.alerts;
  const alertsStale =
    config.groups.length > 0 &&
    a.lastAttemptAt !== null &&
    (a.error !== null || a.lastSuccessAt === null || now - a.lastSuccessAt > ALERT_STALE_MS);
  const { text, detail } = freshnessText(freshness, state, now);
  return { freshness, freshnessText: text, freshnessDetail: detail, alertsStale, sections };
}
