import { ApiError, chunk, query, type Document, type RequestQueue } from "./api";
import { toAlert, type AlertInfo } from "./alerts";
import type { BoardConfig } from "./config";
import type { Metadata } from "./metadata";
import { normalizePredictions, type Departure } from "./normalize";

export interface Feed<T> {
  data: T | null;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  error: ApiError | null;
  pending: boolean;
}

export interface ControllerState {
  predictions: Feed<Map<string, Departure[]>>;
  alerts: Feed<AlertInfo[]>;
}

export interface ControllerOptions {
  predictionIntervalMs?: number;
  alertIntervalMs?: number;
  now?: () => number;
  /** Stops per /predictions request; keeps URLs short. */
  batchSize?: number;
}

const emptyFeed = <T>(): Feed<T> => ({ data: null, lastSuccessAt: null, lastAttemptAt: null, error: null, pending: false });

type FeedName = keyof ControllerState;

/** Polls one batched predictions request and one alerts request for the whole board. */
export class BoardController {
  readonly state: ControllerState = { predictions: emptyFeed(), alerts: emptyFeed() };
  private config: BoardConfig | null = null;
  private visible = true;
  private running = false;
  private timers: Partial<Record<FeedName, ReturnType<typeof setTimeout>>> = {};
  private generation = 0;
  private listeners = new Set<() => void>();
  private readonly opts: Required<ControllerOptions>;

  constructor(
    private readonly queue: RequestQueue,
    private readonly metadata: Metadata,
    options: ControllerOptions = {},
  ) {
    this.opts = {
      predictionIntervalMs: options.predictionIntervalMs ?? 30_000,
      alertIntervalMs: options.alertIntervalMs ?? 90_000,
      now: options.now ?? Date.now,
      batchSize: options.batchSize ?? 30,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setConfig(config: BoardConfig): void {
    this.config = config;
    this.generation++;
    this.state.predictions = emptyFeed();
    this.state.alerts = emptyFeed();
    this.emit();
    if (this.running) this.refreshAll();
  }

  start(): void {
    this.running = true;
    this.refreshAll();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
  }

  /** Pauses polling while hidden; on return, refreshes only feeds whose interval has elapsed. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.clearTimers();
      return;
    }
    // Failures while hidden usually mean the device slept; don't make the user wait them out.
    this.queue.clearNetworkBackoff();
    if (this.running) this.refreshDue();
  }

  /** Reconnect: drop network backoff and refresh whatever is due. */
  onOnline(): void {
    this.queue.clearNetworkBackoff();
    if (this.running && this.visible) this.refreshDue();
  }

  private clearTimers(): void {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    this.timers = {};
  }

  private interval(name: FeedName): number {
    return name === "predictions" ? this.opts.predictionIntervalMs : this.opts.alertIntervalMs;
  }

  private refreshAll(): void {
    this.clearTimers();
    void this.poll("predictions");
    void this.poll("alerts");
  }

  private refreshDue(): void {
    const now = this.opts.now();
    for (const name of ["predictions", "alerts"] as const) {
      const feed = this.state[name];
      const due = feed.lastAttemptAt === null || now - feed.lastAttemptAt >= this.interval(name);
      if (due) void this.poll(name);
      else this.schedule(name, feed.lastAttemptAt! + this.interval(name) - now);
    }
  }

  private schedule(name: FeedName, delay: number): void {
    clearTimeout(this.timers[name]);
    if (!this.running || !this.visible) return;
    this.timers[name] = setTimeout(() => void this.poll(name), Math.max(0, delay));
  }

  private async poll(name: FeedName): Promise<void> {
    const feed = this.state[name];
    if (feed.pending || !this.config) return;
    clearTimeout(this.timers[name]);
    if (!this.config.groups.length) return;
    const generation = this.generation;
    feed.pending = true;
    feed.lastAttemptAt = this.opts.now();
    try {
      const data = name === "predictions" ? await this.fetchPredictions(this.config) : await this.fetchAlerts(this.config);
      if (generation !== this.generation) return;
      // Replace atomically: all batches succeeded.
      (feed as Feed<unknown>).data = data;
      feed.lastSuccessAt = this.opts.now();
      feed.error = null;
    } catch (err) {
      if (generation !== this.generation) return;
      feed.error = err instanceof ApiError ? err : new ApiError("malformed", "Unexpected error while reading MBTA data");
    } finally {
      if (generation === this.generation) {
        feed.pending = false;
        this.emit();
        this.schedule(name, this.interval(name));
      }
    }
  }

  private async fetchPredictions(config: BoardConfig): Promise<Map<string, Departure[]>> {
    const groups = config.groups;
    await this.metadata.ensure(
      groups.map((g) => g.routeId),
      groups.map((g) => g.stopId),
    ).catch(() => undefined);
    const stopIds = [...new Set(groups.flatMap((g) => g.resolvedStopIds))].sort();
    const routeIds = [...new Set(groups.map((g) => g.routeId))].sort();
    const docs: Document[] = [];
    for (const batch of chunk(stopIds, this.opts.batchSize)) {
      docs.push(
        await this.queue.getAll(
          query("/predictions", {
            "filter[stop]": batch.join(","),
            "filter[route]": routeIds.join(","),
            include: "trip",
            "fields[prediction]":
              "departure_time,departure_uncertainty,direction_id,schedule_relationship,stop_sequence,revenue,trip_headsign",
            "fields[trip]": "headsign",
          }),
          1,
        ),
      );
    }
    const merged: Document = { data: docs.flatMap((d) => d.data), included: docs.flatMap((d) => d.included) };
    return normalizePredictions(merged, groups, (id) => this.metadata.route(id)?.type, this.opts.now());
  }

  private async fetchAlerts(config: BoardConfig): Promise<AlertInfo[]> {
    const routeIds = [...new Set(config.groups.map((g) => g.routeId))].sort();
    const doc = await this.queue.getAll(
      query("/alerts", {
        "filter[route]": routeIds.join(","),
        "filter[datetime]": "NOW",
        "fields[alert]": "header,short_header,service_effect,description,effect,severity,active_period,informed_entity",
      }),
      2,
    );
    return doc.data.map(toAlert);
  }
}
