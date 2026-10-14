import { TIMEZONE } from "./config";

const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true });

/** Boston clock time split into "4:32" and "PM" so the suffix can be set smaller. */
export function clockParts(ms: number): { time: string; period: string } {
  const parts = clockFmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { time: `${get("hour")}:${get("minute")}`, period: get("dayPeriod").toUpperCase() };
}

export function formatClock(ms: number): string {
  const { time, period } = clockParts(ms);
  return `${time} ${period}`;
}

export function minutesUntil(ms: number, now: number): number {
  return Math.max(0, Math.floor((ms - now) / 60_000));
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${Math.floor(s / 10) * 10} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short", month: "short", day: "numeric" });

/** "Tue, Oct 14" in Boston time. */
export function formatDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}
