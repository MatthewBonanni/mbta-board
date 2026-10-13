export const API_BASE = "https://api-v3.mbta.com";

export type ApiErrorKind = "offline" | "timeout" | "http" | "rate-limited" | "malformed";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }>;
}

export interface Document {
  data: Resource[];
  included: Resource[];
}

export interface QueueOptions {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  /** Self-imposed budget. The MBTA's keyless limit (20/min, observed) is per IP and shared by every screen. */
  maxPerWindow?: number;
  windowMs?: number;
  timeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Network errors (offline, timeout) usually come from a sleeping device; retry sooner. */
  maxNetworkBackoffMs?: number;
  online?: () => boolean;
}

interface Job {
  key: string;
  path: string;
  priority: number;
  resolve: (doc: RawDocument) => void;
  reject: (err: unknown) => void;
  promise: Promise<RawDocument>;
}

interface RawDocument {
  data: Resource | Resource[];
  included?: Resource[];
  links?: { next?: string | null };
}

export interface QueueStats {
  sent: number;
  inFlight: number;
  queued: number;
  backoffUntil: number;
}

/**
 * One shared queue for every MBTA request: at most one request in flight, a rolling
 * request budget, and exponential backoff with jitter after failures.
 */
export class RequestQueue {
  private readonly opts: Required<QueueOptions>;
  private readonly jobs: Job[] = [];
  private readonly sentAt: number[] = [];
  private running = false;
  private failures = 0;
  private backoffUntil = 0;
  private wake: (() => void) | null = null;
  private lastErrorKind: ApiErrorKind | null = null;
  sent = 0;
  inFlight = 0;

  constructor(options: QueueOptions = {}) {
    this.opts = {
      fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      maxPerWindow: options.maxPerWindow ?? 12,
      windowMs: options.windowMs ?? 60_000,
      timeoutMs: options.timeoutMs ?? 15_000,
      baseBackoffMs: options.baseBackoffMs ?? 5_000,
      maxBackoffMs: options.maxBackoffMs ?? 300_000,
      maxNetworkBackoffMs: options.maxNetworkBackoffMs ?? 60_000,
      online: options.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine)),
    };
  }

  stats(): QueueStats {
    return { sent: this.sent, inFlight: this.inFlight, queued: this.jobs.length, backoffUntil: this.backoffUntil };
  }

  /** Lets a reconnect cut a long network backoff short; rate-limit backoffs are kept. */
  clearNetworkBackoff(): void {
    if (this.lastErrorKind === "offline" || this.lastErrorKind === "timeout") {
      this.backoffUntil = 0;
      this.failures = 0;
      this.wake?.();
    }
  }

  /**
   * Identical pending requests share one network call. Lower priority numbers run first.
   * Priority 0 is user-initiated: it skips a leftover network-error wait (not a rate-limit wait).
   */
  request(path: string, priority = 1): Promise<RawDocument> {
    if (priority === 0) this.clearNetworkBackoff();
    const existing = this.jobs.find((j) => j.key === path);
    if (existing) {
      if (priority < existing.priority) {
        existing.priority = priority;
        this.sortJobs();
      }
      return existing.promise;
    }
    let resolve!: Job["resolve"];
    let reject!: Job["reject"];
    const promise = new Promise<RawDocument>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.jobs.push({ key: path, path, priority, resolve, reject, promise });
    this.sortJobs();
    void this.pump();
    return promise;
  }

  /** Fetches every page, each page drawing on the same budget. */
  async getAll(path: string, priority = 1): Promise<Document> {
    const data: Resource[] = [];
    const included = new Map<string, Resource>();
    let next: string | null | undefined = path;
    let pages = 0;
    while (next) {
      if (++pages > 20) throw new ApiError("malformed", "Too many result pages");
      const doc: RawDocument = await this.request(next, priority);
      data.push(...(Array.isArray(doc.data) ? doc.data : [doc.data]));
      for (const r of doc.included ?? []) included.set(`${r.type}/${r.id}`, r);
      next = doc.links?.next ? toPath(doc.links.next) : null;
    }
    return { data, included: [...included.values()] };
  }

  private sortJobs(): void {
    this.jobs.sort((a, b) => a.priority - b.priority);
  }

  private delayUntilAllowed(): number {
    const now = this.opts.now();
    while (this.sentAt.length && this.sentAt[0] <= now - this.opts.windowMs) this.sentAt.shift();
    let until = this.backoffUntil;
    if (this.sentAt.length >= this.opts.maxPerWindow) {
      until = Math.max(until, this.sentAt[0] + this.opts.windowMs);
    }
    return Math.max(0, until - now);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const wait = this.delayUntilAllowed();
        if (wait > 0) {
          await this.sleep(wait);
          continue;
        }
        const job = this.jobs.shift()!;
        try {
          job.resolve(await this.send(job.path));
        } catch (err) {
          job.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async send(path: string): Promise<RawDocument> {
    const now = this.opts.now();
    this.sentAt.push(now);
    this.sent++;
    this.inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.opts.fetch(API_BASE + path, {
          headers: { Accept: "application/vnd.api+json" },
          signal: controller.signal,
          cache: "no-store",
        });
      } catch {
        if (controller.signal.aborted) throw new ApiError("timeout", "The MBTA server did not respond in time");
        throw new ApiError(
          "offline",
          this.opts.online() ? "Could not reach the MBTA server" : "This device is offline",
        );
      }
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        const retryMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined;
        throw new ApiError("rate-limited", "Request limit reached; waiting before retrying", 429, retryMs);
      }
      if (!res.ok) throw new ApiError("http", `MBTA server error (${res.status})`, res.status);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ApiError("malformed", "Unexpected response from the MBTA server");
      }
      if (!isDocument(body)) throw new ApiError("malformed", "Unexpected response from the MBTA server");
      this.failures = 0;
      this.lastErrorKind = null;
      return body;
    } catch (err) {
      this.onFailure(err);
      throw err;
    } finally {
      clearTimeout(timer);
      this.inFlight--;
    }
  }

  private onFailure(err: unknown): void {
    const kind = err instanceof ApiError ? err.kind : "offline";
    this.lastErrorKind = kind;
    if (err instanceof ApiError && err.kind === "http" && err.status !== undefined && err.status < 500) return;
    this.failures++;
    const network = kind === "offline" || kind === "timeout";
    const cap = network ? this.opts.maxNetworkBackoffMs : this.opts.maxBackoffMs;
    const exp = Math.min(cap, this.opts.baseBackoffMs * 2 ** (this.failures - 1));
    let delay = exp * (0.5 + this.opts.random() * 0.5);
    const retryAfterMs = err instanceof ApiError ? err.retryAfterMs : undefined;
    if (retryAfterMs) delay = Math.max(delay, retryAfterMs);
    if (kind === "rate-limited") delay = Math.max(delay, this.opts.windowMs);
    this.backoffUntil = this.opts.now() + delay;
  }
}

function isDocument(v: unknown): v is RawDocument {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as { data?: unknown }).data;
  return Array.isArray(d) || (typeof d === "object" && d !== null);
}

function toPath(link: string): string {
  return link.startsWith(API_BASE) ? link.slice(API_BASE.length) : link;
}

export function query(path: string, params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `${path}?${parts.join("&")}` : path;
}

export function relId(r: Resource, name: string): string | null {
  const d = r.relationships?.[name]?.data;
  return d && !Array.isArray(d) ? d.id : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
