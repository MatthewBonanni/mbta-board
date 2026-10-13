import type { Origin } from "./config";

/**
 * OpenStreetMap community services. Their usage policies allow light, user-triggered use:
 * at most 1 request/second, an identifying Referer, attribution, no search-as-you-type,
 * and no periodic requests. Results are saved in the board config, never polled.
 */
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
export const FOOT_ROUTING_URL = "https://routing.openstreetmap.de/routed-foot";

export class OsmError extends Error {}

export interface Place {
  label: string;
  detail: string;
  lat: number;
  lon: number;
}

export interface Point {
  id: string;
  lat: number;
  lon: number;
}

export interface OsmOptions {
  fetch?: typeof fetch;
  now?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
}

/** Massachusetts bounding box, used to prefer local geocoding results. */
const MA_VIEWBOX = "-73.51,42.89,-69.86,41.19";
const TABLE_BATCH = 40;

export class OsmClient {
  private readonly opts: Required<OsmOptions>;
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(options: OsmOptions = {}) {
    this.opts = {
      fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
      now: options.now ?? Date.now,
      minIntervalMs: options.minIntervalMs ?? 1_100,
      timeoutMs: options.timeoutMs ?? 15_000,
    };
  }

  /** Runs requests one at a time, starting at most one per interval across both services. */
  private getJson(url: string): Promise<unknown> {
    const run = async () => {
      const wait = this.lastStart + this.opts.minIntervalMs - this.opts.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = this.opts.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        let res: Response;
        try {
          res = await this.opts.fetch(url, {
            signal: controller.signal,
            // The page sets no-referrer; these services ask apps to identify themselves.
            referrerPolicy: "strict-origin-when-cross-origin",
            headers: { Accept: "application/json" },
          });
        } catch {
          throw new OsmError(controller.signal.aborted ? "The map service did not respond in time" : "Could not reach the map service");
        }
        if (res.status === 429) throw new OsmError("The map service is busy; try again in a minute");
        if (!res.ok) throw new OsmError(`Map service error (${res.status})`);
        try {
          return await res.json();
        } catch {
          throw new OsmError("Unexpected response from the map service");
        }
      } finally {
        clearTimeout(timer);
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async search(query: string): Promise<Place[]> {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "6",
      countrycodes: "us",
      viewbox: MA_VIEWBOX,
      addressdetails: "0",
    });
    const body = await this.getJson(`${NOMINATIM_URL}/search?${params}`);
    if (!Array.isArray(body)) throw new OsmError("Unexpected response from the address search");
    return body.flatMap((r) => {
      const lat = Number(r?.lat);
      const lon = Number(r?.lon);
      const full = typeof r?.display_name === "string" ? r.display_name : "";
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !full) return [];
      const [first, ...rest] = full.split(", ");
      return [{ label: first!, detail: rest.join(", "), lat, lon }];
    });
  }

  /** Walking time in seconds from the origin to each point; null where no route was found. */
  async walkSeconds(origin: Origin, points: Point[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    for (let i = 0; i < points.length; i += TABLE_BATCH) {
      const batch = points.slice(i, i + TABLE_BATCH);
      const coords = [origin, ...batch].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
      const body = (await this.getJson(`${FOOT_ROUTING_URL}/table/v1/foot/${coords}?sources=0&annotations=duration`)) as {
        code?: string;
        durations?: (number | null)[][];
      };
      const row = body?.durations?.[0];
      if (body?.code !== "Ok" || !Array.isArray(row)) throw new OsmError("The walking-route service could not plan these walks");
      batch.forEach((p, j) => {
        const d = row[j + 1];
        out.set(p.id, typeof d === "number" && Number.isFinite(d) ? d : null);
      });
    }
    return out;
  }
}

/** Accepts "42.3736, -71.1189" as typed or copied from a map. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
