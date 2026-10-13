import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, RequestQueue } from "../src/api";
import { advance, jsonResponse, T0, textResponse } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

function setup(responder: (url: string) => Response | Promise<Response>, opts = {}) {
  const calls: { url: string; at: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), at: Date.now() });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const aborted = new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      return await Promise.race([responder(String(url)), aborted]);
    } finally {
      inFlight--;
    }
  });
  const queue = new RequestQueue({ fetch: fetch as typeof globalThis.fetch, random: () => 1, online: () => true, ...opts });
  return { queue, calls, max: () => maxInFlight };
}

describe("RequestQueue", () => {
  it("runs one request at a time and holds to the rolling budget", async () => {
    const { queue, calls, max } = setup(() => jsonResponse({ data: [] }), { maxPerWindow: 3, windowMs: 60_000 });
    const all = Promise.all([1, 2, 3, 4, 5].map((i) => queue.request(`/x?${i}`)));
    await advance(61_000);
    await all;
    expect(max()).toBe(1);
    expect(calls.map((c) => c.at - T0)).toEqual([0, 100, 200, 60_000, 60_100]);
  });

  it("shares one network call between identical pending requests", async () => {
    const { queue, calls } = setup(() => jsonResponse({ data: [] }));
    const first = queue.request("/busy");
    const a = queue.request("/same");
    const b = queue.request("/same");
    await advance(500);
    await Promise.all([first, a, b]);
    expect(calls.filter((c) => c.url.endsWith("/same"))).toHaveLength(1);
  });

  it("waits at least a full window after a 429 before the next request", async () => {
    let n = 0;
    const { queue, calls } = setup(() => (n++ === 0 ? jsonResponse({}, 429) : jsonResponse({ data: [] })));
    const first = queue.request("/a").catch((e) => e);
    const second = queue.request("/b");
    await advance(200);
    expect(await first).toMatchObject({ kind: "rate-limited" });
    await advance(59_000);
    expect(calls).toHaveLength(1);
    await advance(2_000);
    await second;
    expect(calls).toHaveLength(2);
  });

  it("follows pagination links through the same queue", async () => {
    const { queue, calls } = setup((url) =>
      url.includes("page[offset]=2")
        ? jsonResponse({ data: [{ id: "3", type: "stop", attributes: {} }], links: { next: null } })
        : jsonResponse({
            data: [
              { id: "1", type: "stop", attributes: {} },
              { id: "2", type: "stop", attributes: {} },
            ],
            links: { next: "https://api-v3.mbta.com/stops?page[offset]=2" },
          }),
    );
    const p = queue.getAll("/stops");
    await advance(500);
    expect((await p).data.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(calls).toHaveLength(2);
  });

  it("classifies malformed bodies, server errors and hung requests distinctly", async () => {
    const bodies: Record<string, () => Response | Promise<Response>> = {
      "/html": () => textResponse("<html>"),
      "/500": () => jsonResponse({}, 500),
      "/hang": () => new Promise<Response>(() => {}),
    };
    const { queue } = setup((url) => bodies[new URL(url).pathname]!(), { timeoutMs: 5_000, baseBackoffMs: 1 });
    const kinds = ["/html", "/500", "/hang"].map((p) => queue.request(p).catch((e: ApiError) => e.kind));
    await advance(10_000);
    expect(await Promise.all(kinds)).toEqual(["malformed", "http", "timeout"]);
  });
});
