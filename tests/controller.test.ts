import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestQueue } from "../src/api";
import { emptyConfig, type BoardConfig } from "../src/config";
import { BoardController } from "../src/controller";
import { Metadata } from "../src/metadata";
import { buildBoardView } from "../src/view";
import { advance, group, jsonResponse, prediction, T0 } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const config: BoardConfig = {
  ...emptyConfig(),
  groups: [
    group({ id: "a", routeId: "39", stopId: "1001", directionId: 1 }),
    group({ id: "b", routeId: "57", stopId: "1001", directionId: 0 }),
    group({ id: "c", routeId: "1", stopId: "1003", directionId: 0 }),
    group({ id: "d", routeId: "1", stopId: "1004", directionId: 1 }),
  ].map((g, i) => ({ ...g, order: i })),
};

function setup() {
  const calls: string[] = [];
  let fail = false;
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(new URL(u).pathname);
    if (fail) throw new TypeError("network down");
    if (u.includes("/predictions")) {
      return jsonResponse({ data: [prediction({ route: "39", stop: "1001", trip: "t", dir: 1, dep: Date.now() + 5 * 60_000 })], included: [] });
    }
    return jsonResponse({ data: [] });
  });
  const queue = new RequestQueue({ fetch: fetch as typeof globalThis.fetch, random: () => 1, online: () => true, baseBackoffMs: 1_000 });
  const metadata = new Metadata(queue, null);
  const controller = new BoardController(queue, metadata);
  controller.setConfig(config);
  const polls = () => calls.filter((p) => p === "/predictions").length;
  return { controller, calls, polls, metadata, setFail: (v: boolean) => (fail = v) };
}

describe("BoardController", () => {
  it("batches all configured stops into one predictions request per interval", async () => {
    const { controller, polls } = setup();
    controller.start();
    await advance(1_000);
    expect(polls()).toBe(1);
    await advance(60_000);
    expect(polls()).toBe(3);
  });

  it("pauses while hidden and makes a single catch-up request on return", async () => {
    const { controller, polls } = setup();
    controller.start();
    await advance(1_000);
    controller.setVisible(false);
    await advance(5 * 60_000);
    expect(polls()).toBe(1);
    controller.setVisible(true);
    await advance(1_000);
    expect(polls()).toBe(2);
  });

  it("a failed refresh ends Live immediately and keeps old times only as last-known; success restores Live", async () => {
    const { controller, metadata, setFail } = setup();
    controller.start();
    await advance(1_000);
    const view = () => buildBoardView(config, metadata, controller.state, Date.now());
    expect(view().freshness).toBe("live");
    expect(view().sections[0]!.rows[0]!.times[0]!.kind).toBe("live");

    setFail(true);
    await advance(30_000);
    expect(view().freshness).toBe("stale");
    expect(view().sections[0]!.rows[0]!.times[0]).toMatchObject({ kind: "last-known", prefix: "Last known" });

    setFail(false);
    await advance(120_000);
    expect(view().freshness).toBe("live");
  });

  it("crossing the freshness cutoff without a new success removes Live", async () => {
    const { controller, metadata } = setup();
    controller.start();
    await advance(1_000);
    controller.setVisible(false);
    vi.setSystemTime(Date.now() + 61_000);
    expect(buildBoardView(config, metadata, controller.state, Date.now()).freshness).toBe("stale");
  });
});
