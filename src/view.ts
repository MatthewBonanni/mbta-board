import { alertsForGroup, NO_SERVICE_EFFECTS, type AlertInfo } from "./alerts";
import type { BoardConfig, DepartureGroup } from "./config";
import type { ControllerState } from "./controller";
import { directionLabel, routeLabel, type RouteInfo, type StopInfo } from "./metadata";
import type { Departure } from "./normalize";
import { clockParts, formatAge, formatClock, minutesUntil } from "./time";

export const FRESHNESS_CUTOFF_MS = 60_000;
export const ALERT_STALE_MS = 4 * 60_000;
const TIMES_PER_ROW = 3;
export const TIMELINE_MINUTES = 45;

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
  /** With a walk time set: the departure the leave time targets, or one that can't be reached on foot. */
  reach: "target" | "missed" | null;
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
  targetKey: string | null;
  /** When to leave, for ranking rows against each other. */
  leaveAt: number | null;
}

export interface TimelineTick {
  pos: number;
  label: string;
  kind: TimeView["kind"];
  reach: TimeView["reach"];
}

export interface TimelineView {
  ticks: TimelineTick[];
  /** Walking segment ending at the targeted departure, as fractions of the window. */
  walk: { from: number; to: number } | null;
  /** Shown when nothing departs within the window. */
  beyond: string | null;
}

export interface NextLeaveView {
  lead: string;
  detail: string;
  label: string;
  urgent: boolean;
  badge: RowView["badge"];
  destination: string;
  place: string;
}

export interface StatusItem {
  routeId: string;
  badge: RowView["badge"];
  alerts: AlertView[];
}

export interface StatusView {
  withAlerts: StatusItem[];
  quiet: StatusItem[];
}

export interface RowView {
  groupId: string;
  badge: { text: string; background: string; color: string; mode: string };
  destination: string;
  times: TimeView[];
  message: string | null;
  /** Times shown are from the last successful update, not live. */
  lastKnown: boolean;
  timeline: TimelineView;
  leave: LeaveView | null;
  alerts: AlertView[];
}

export interface SectionView {
  key: string;
  heading: string;
  /** Official stop name when a custom label replaces it, and a shared walk time. */
  meta: string | null;
  rows: RowView[];
  /** Set when this section is one side of a street corner shared with its neighbour. */
  corner: CornerView | null;
}

export interface CornerView {
  key: string;
  heading: string;
  street: string;
}

export interface BoardView {
  freshness: Freshness;
  freshnessText: string;
  freshnessDetail: string | null;
  alertsStale: boolean;
  sections: SectionView[];
  nextLeave: NextLeaveView | null;
  status: StatusView;
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

function timeView(
  d: Departure,
  now: number,
  stale: boolean,
  showHeadsign: boolean,
  reach: TimeView["reach"] = null,
): TimeView {
  const base = timeViewBase(d, now, stale, showHeadsign);
  if (reach === "missed") return { ...base, reach, label: `${base.label}, too soon to reach on foot` };
  if (reach === "target") return { ...base, reach, label: `${base.label}, the one to leave for` };
  return { ...base, reach };
}

function timeViewBase(d: Departure, now: number, stale: boolean, showHeadsign: boolean): Omit<TimeView, "reach"> {
  const headsign = showHeadsign ? d.headsign : null;
  const clock = clockParts(d.time);
  const at = formatClock(d.time);
  const toward = headsign ? ` to ${headsign}` : "";
  if (stale) {
    return { value: clock.time, unit: clock.period, prefix: "", kind: "last-known", label: `Last known time ${at}${toward}, not live`, headsign };
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

export function vehicleNoun(routeType: number | undefined): string {
  if (routeType === 3) return "bus";
  if (routeType === 4) return "boat";
  if (routeType === 0 || routeType === 1 || routeType === 2) return "train";
  return "departure";
}

export function canReach(d: Departure, walkMinutes: number, now: number): boolean {
  return d.time - walkMinutes * 60_000 >= now - LEAVE_GRACE_MS;
}

/** Names the targeted departure the way its time is shown on the row, so the two can be matched by eye. */
function describeTarget(d: Departure, noun: string, toward: string, now: number, stale: boolean): string {
  const vehicle = `${noun}${toward}`;
  if (stale) return `the ${formatClock(d.time)} ${vehicle}`;
  if (d.kind === "scheduled") return `the est. ${formatClock(d.time)} ${vehicle}`;
  const mins = minutesUntil(d.time, now);
  if (mins >= 60) return `the ${formatClock(d.time)} ${vehicle}`;
  return mins === 0 ? `the ${vehicle} due now` : `the ${vehicle} in ${mins} min`;
}

export function leaveView(
  departures: Departure[],
  walkMinutes: number | undefined,
  now: number,
  stale: boolean,
  showHeadsign: boolean,
  noun = "departure",
  includeWalk = true,
): LeaveView | null {
  if (walkMinutes === undefined || !departures.length) return null;
  const walk = `${walkMinutes} min walk`;
  const d = departures.find((x) => canReach(x, walkMinutes, now));
  if (!d) {
    return {
      lead: "Too late for listed departures",
      detail: includeWalk ? walk : "",
      label: `Too late to walk to any listed departure, ${walkMinutes} minute walk`,
      urgent: false,
      targetKey: null,
      leaveAt: null,
    };
  }
  const leaveAt = d.time - walkMinutes * 60_000;
  const toward = showHeadsign && d.headsign ? ` to ${d.headsign}` : "";
  const target = describeTarget(d, noun, toward, now, stale);
  const extras = [`catch ${target}`, includeWalk ? walk : null, d.kind === "approx" ? "may be delayed" : null];
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
    detail: extras.filter(Boolean).join(" · "),
    label: `${lead} to catch ${target}, ${walkMinutes} minute walk${stale ? ", based on last known times" : ""}`,
    urgent: mins <= 2,
    targetKey: d.key,
    leaveAt,
  };
}

function timelineView(
  pending: Departure[],
  target: Departure | undefined,
  walkMinutes: number | undefined,
  reach: (d: Departure) => TimeView["reach"],
  now: number,
  stale: boolean,
): TimelineView {
  const ticks: TimelineTick[] = [];
  let lastLabelled = -Infinity;
  for (const d of pending) {
    const m = minutesUntil(d.time, now);
    if (m > TIMELINE_MINUTES) break;
    const clockLabel = stale || d.kind === "scheduled";
    // Skip labels that would collide with the previous one; the tick still shows.
    let room = m - lastLabelled >= (clockLabel ? 7 : 3);
    if (!room && reach(d) === "target") {
      const prev = [...ticks].reverse().find((t) => t.label);
      if (prev) prev.label = "";
      room = true;
    }
    if (room) lastLabelled = m;
    ticks.push({
      pos: m / TIMELINE_MINUTES,
      label: !room ? "" : clockLabel ? clockParts(d.time).time : m === 0 ? "now" : String(m),
      kind: stale ? "last-known" : d.kind,
      reach: reach(d),
    });
  }
  let walk: TimelineView["walk"] = null;
  if (target && walkMinutes !== undefined) {
    const m = minutesUntil(target.time, now);
    if (m <= TIMELINE_MINUTES) walk = { from: Math.max(0, m - walkMinutes) / TIMELINE_MINUTES, to: m / TIMELINE_MINUTES };
  }
  const first = pending[0];
  const beyond =
    !ticks.length && first
      ? stale || first.kind === "scheduled"
        ? `Next ${first.kind === "scheduled" ? "est. " : ""}${formatClock(first.time)}`
        : `Next in ${minutesUntil(first.time, now)} min`
      : null;
  return { ticks, walk, beyond };
}

function rowView(
  g: DepartureGroup,
  lookup: Lookup,
  state: ControllerState,
  freshness: Freshness,
  now: number,
  includeWalk = true,
): RowView {
  const route = lookup.route(g.routeId);
  const background = route?.color ?? "#575752";
  const all = state.predictions.data?.get(g.id) ?? [];
  const stale = freshness === "stale";
  const pending = all.filter((d) => d.time >= now - LEAVE_GRACE_MS);
  const leave = leaveView(pending, g.walkMinutes, now, stale, !g.destinationFilter && new Set(pending.slice(0, TIMES_PER_ROW).map((d) => d.headsign)).size > 1, vehicleNoun(route?.type), includeWalk);
  let upcoming = pending.slice(0, TIMES_PER_ROW);
  const target = leave?.targetKey ? pending.find((d) => d.key === leave.targetKey) : undefined;
  if (target && !upcoming.includes(target)) upcoming = [...upcoming.slice(0, TIMES_PER_ROW - 1), target];
  const reach = (d: Departure): TimeView["reach"] => {
    if (g.walkMinutes === undefined) return null;
    if (d === target) return "target";
    return canReach(d, g.walkMinutes, now) ? null : "missed";
  };
  const headsigns = new Set(upcoming.map((d) => d.headsign).filter(Boolean));
  const mixed = headsigns.size > 1;
  const destination =
    g.destinationFilter ?? (headsigns.size === 1 ? [...headsigns][0]! : directionLabel(route, g.directionId));
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
    times: upcoming.map((d) => timeView(d, now, stale, mixed && !g.destinationFilter, reach(d))),
    message,
    lastKnown: stale && upcoming.length > 0,
    timeline: timelineView(pending, target, g.walkMinutes, reach, now, stale),
    leave: upcoming.length ? leave : null,
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
  const runs: DepartureGroup[][] = [];
  let lastKey: string | null = null;
  for (const g of config.groups) {
    const key = g.displayLabel ? `label|${g.displayLabel}` : `stop|${g.stopId}`;
    if (key === lastKey) runs[runs.length - 1]!.push(g);
    else runs.push([g]);
    lastKey = key;
  }
  const sections: SectionView[] = runs.map((groups) => {
    const first = groups[0]!;
    const official = lookup.stop(first.stopId)?.name ?? null;
    const walks = new Set(groups.map((g) => g.walkMinutes));
    const sharedWalk = walks.size === 1 ? first.walkMinutes : undefined;
    const meta = [
      first.displayLabel && official && official !== first.displayLabel ? official : null,
      sharedWalk !== undefined ? `${sharedWalk} min walk` : null,
    ].filter(Boolean);
    return {
      key: first.displayLabel ? `label|${first.displayLabel}` : `stop|${first.stopId}`,
      heading: first.displayLabel || official || `Stop ${first.stopId}`,
      meta: meta.length ? meta.join(" · ") : null,
      rows: groups.map((g) => rowView(g, lookup, state, freshness, now, sharedWalk === undefined)),
      corner: cornerOf(groups, lookup),
    };
  });
  // Only adjacent sections at the same corner are shown together; a lone section keeps its normal heading.
  sections.forEach((s, i) => {
    if (!s.corner) return;
    const prev = sections[i - 1]?.corner?.key;
    const next = sections[i + 1]?.corner?.key;
    if (prev !== s.corner.key && next !== s.corner.key) s.corner = null;
  });
  const nextLeave = pickNextLeave(sections);
  const status = statusView(config, lookup, state, now);
  const a = state.alerts;
  const alertsStale =
    config.groups.length > 0 &&
    a.lastAttemptAt !== null &&
    (a.error !== null || a.lastSuccessAt === null || now - a.lastSuccessAt > ALERT_STALE_MS);
  const { text, detail } = freshnessText(freshness, state, now);
  return { freshness, freshnessText: text, freshnessDetail: detail, alertsStale, sections, nextLeave, status };
}

/** The reachable departure, across the whole board, that you have to leave for soonest. */
function pickNextLeave(sections: SectionView[]): NextLeaveView | null {
  let best: { row: RowView; section: SectionView; leave: LeaveView } | null = null;
  for (const section of sections) {
    for (const row of section.rows) {
      const leave = row.leave;
      if (!leave || leave.leaveAt === null) continue;
      if (!best || leave.leaveAt < best.leave.leaveAt!) best = { row, section, leave };
    }
  }
  if (!best) return null;
  const { row, section, leave } = best;
  const walkInHeading = section.meta?.match(/(\d+ min walk)/)?.[1];
  return {
    lead: leave.lead,
    detail: [leave.detail, walkInHeading].filter(Boolean).join(" · "),
    label: `${leave.label}, ${row.badge.text} to ${row.destination} from ${section.heading}`,
    urgent: leave.urgent,
    badge: row.badge,
    destination: row.destination,
    place: section.heading,
  };
}

function statusView(config: BoardConfig, lookup: Lookup, state: ControllerState, now: number): StatusView {
  const byRoute = new Map<string, StatusItem>();
  for (const g of config.groups) {
    let item = byRoute.get(g.routeId);
    const route = lookup.route(g.routeId);
    if (!item) {
      const background = route?.color ?? "#575752";
      item = {
        routeId: g.routeId,
        badge: { text: routeLabel(route, g.routeId), background, color: badgeTextColor(background, route?.textColor ?? WHITE), mode: route ? String(route.type) : "" },
        alerts: [],
      };
      byRoute.set(g.routeId, item);
    }
    for (const a of state.alerts.data ? alertsForGroup(state.alerts.data, g, route?.type, now) : []) {
      if (!item.alerts.some((x) => x.id === a.id)) item.alerts.push(alertView(a));
    }
  }
  const items = [...byRoute.values()];
  return { withAlerts: items.filter((i) => i.alerts.length), quiet: items.filter((i) => !i.alerts.length) };
}

const STREET_ABBREVIATIONS: [RegExp, string][] = [
  [/\bStreet\b/g, "St"],
  [/\bAvenue\b/g, "Ave"],
  [/\bRoad\b/g, "Rd"],
  [/\bBoulevard\b/g, "Blvd"],
  [/\bSquare\b/g, "Sq"],
  [/\bPlace\b/g, "Pl"],
  [/\bTerrace\b/g, "Ter"],
  [/\bParkway\b/g, "Pkwy"],
  [/\bHighway\b/g, "Hwy"],
  [/\bDrive\b/g, "Dr"],
  [/\bCourt\b/g, "Ct"],
];

export function shortStreet(name: string): string {
  return STREET_ABBREVIATIONS.reduce((s, [re, abbr]) => s.replace(re, abbr), name);
}

/** Bus stops the MBTA lists on the same street at the same cross street are sides of one corner. */
function cornerOf(groups: DepartureGroup[], lookup: Lookup): CornerView | null {
  const stops = [...new Set(groups.map((g) => g.stopId))].map((id) => lookup.stop(id));
  const first = stops[0];
  if (!first?.onStreet || !first.atStreet) return null;
  const same = stops.every((s) => s && s.locationType === 0 && s.vehicleType === 3 && s.onStreet === first.onStreet && s.atStreet === first.atStreet);
  if (!same) return null;
  return {
    key: `${first.onStreet}|${first.atStreet}`,
    heading: `${shortStreet(first.onStreet)} & ${shortStreet(first.atStreet)}`,
    street: shortStreet(first.onStreet),
  };
}
