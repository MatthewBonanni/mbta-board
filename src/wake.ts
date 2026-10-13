import type { DevicePrefs } from "./prefs";

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

export type WakeStatus = "off" | "unsupported" | "active" | "waiting" | "denied";

/** Progressive enhancement: "Keep screen awake" is a per-device preference, not part of the exported board. */
export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted: boolean;
  status: WakeStatus = "off";
  onChange: () => void = () => {};

  constructor(
    private readonly prefs: () => DevicePrefs,
    private readonly savePrefs: (p: DevicePrefs) => void,
  ) {
    this.wanted = prefs().keepAwake;
    if (!this.supported) this.status = "unsupported";
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.wanted) void this.acquire();
    });
  }

  get supported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  get enabled(): boolean {
    return this.wanted;
  }

  async setEnabled(on: boolean): Promise<void> {
    this.wanted = on;
    this.savePrefs({ ...this.prefs(), keepAwake: on });
    if (on) await this.acquire();
    else await this.releaseLock();
  }

  async start(): Promise<void> {
    if (this.wanted) await this.acquire();
  }

  private set(status: WakeStatus): void {
    this.status = status;
    this.onChange();
  }

  private async acquire(): Promise<void> {
    if (!this.supported) return this.set("unsupported");
    if (this.sentinel && !this.sentinel.released) return this.set("active");
    if (document.visibilityState !== "visible") return this.set("waiting");
    try {
      const wl = (navigator as unknown as { wakeLock: { request(t: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
      const s = await wl.request("screen");
      this.sentinel = s;
      s.addEventListener("release", () => {
        if (this.sentinel === s) this.sentinel = null;
        this.set(this.wanted ? "waiting" : "off");
      });
      this.set("active");
    } catch {
      this.set("denied");
    }
  }

  private async releaseLock(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* already released */
    }
    this.set(this.supported ? "off" : "unsupported");
  }
}
