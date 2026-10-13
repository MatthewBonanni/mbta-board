import { LIMITS, type BoardConfig, type Origin } from "./config";
import type { Metadata } from "./metadata";
import type { OsmClient } from "./osm";

export interface WalkEstimate {
  /** Whole minutes per stop ID, rounded up. */
  minutes: Map<string, number>;
  tooFar: string[];
  failed: string[];
}

export function toWalkMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.max(0, Math.ceil(seconds / 60));
}

export async function estimateWalks(origin: Origin, stopIds: string[], metadata: Metadata, osm: OsmClient): Promise<WalkEstimate> {
  const unique = [...new Set(stopIds)];
  const points = await metadata.coordinates(unique);
  const seconds = await osm.walkSeconds(origin, points);
  const minutes = new Map<string, number>();
  const tooFar: string[] = [];
  const failed: string[] = [];
  for (const id of unique) {
    const m = toWalkMinutes(seconds.get(id) ?? null);
    if (m === null) failed.push(id);
    else if (m > LIMITS.walkMinutes) tooFar.push(id);
    else minutes.set(id, m);
  }
  return { minutes, tooFar, failed };
}

/** Walk times belong to a stop, so every row at that stop gets the same value. */
export function applyWalks(config: BoardConfig, minutes: Map<string, number | undefined>): BoardConfig {
  return {
    ...config,
    groups: config.groups.map((g) => {
      if (!minutes.has(g.stopId)) return g;
      const m = minutes.get(g.stopId);
      const { walkMinutes: _, ...rest } = g;
      return m === undefined ? rest : { ...rest, walkMinutes: m };
    }),
  };
}
