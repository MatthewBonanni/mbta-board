import "./style.css";
import { RequestQueue } from "./api";
import { browserStore, loadConfig, saveConfig, type BoardConfig } from "./config";
import { BoardController, type ControllerState } from "./controller";
import { Metadata } from "./metadata";
import { formatClock } from "./time";
import { renderSections } from "./ui/board";
import { announce, h, replaceKeepingFocus } from "./ui/dom";
import { mountSettings } from "./ui/settings";
import { buildBoardView, type Freshness, type Lookup } from "./view";
import { WakeLockManager } from "./wake";

const app = document.getElementById("app")!;
const store = browserStore();
const loaded = loadConfig(store);
let config: BoardConfig = loaded.config;
let storageWarning: string | null = loaded.warning ?? null;

const queue = new RequestQueue();
const metadata = new Metadata(queue, store);
const controller = new BoardController(queue, metadata);
const wake = new WakeLockManager(store);

interface DataSource {
  lookup: Lookup;
  state: () => ControllerState;
  now: () => number;
  banner: string | null;
}

let source: DataSource = { lookup: metadata, state: () => controller.state, now: Date.now, banner: null };
let demo = false;

const openAlerts = new Set<string>();
const liveRegion = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });
let lastFreshness: Freshness | null = null;
let lastSignature = "";

const clock = h("time", { class: "clock" });
const freshnessEl = h("p", { class: "freshness" });
const boardMain = h("main", { class: "board", id: "main" });
const banners = h("div", { class: "banners" });

function settingsButton(): HTMLElement {
  return h("a", { href: "#settings", class: "btn btn-band", "aria-label": "Settings" }, "Settings");
}

function boardShell(): void {
  app.replaceChildren(
    h(
      "header",
      { class: "masthead" },
      h("span", { class: "mark", "aria-hidden": "true" }),
      h("h1", { class: "masthead-title" }, config.title),
      clock,
      freshnessEl,
      settingsButton(),
    ),
    banners,
    boardMain,
    liveRegion,
  );
  lastSignature = "";
  renderBoard();
}

function renderBoard(): void {
  const now = source.now();
  const view = buildBoardView(config, source.lookup, source.state(), now);
  clock.textContent = formatClock(now);
  clock.dateTime = new Date(now).toISOString();
  document.documentElement.dataset.density = config.density;

  freshnessEl.dataset.state = view.freshness;
  freshnessEl.replaceChildren(
    view.freshness === "idle" ? "" : h("span", { class: "fresh-mark", "aria-hidden": "true" }),
    h("strong", {}, view.freshness === "idle" ? "" : view.freshnessText),
    view.freshnessDetail ? h("span", { class: "fresh-detail" }, view.freshnessDetail) : "",
  );

  if (lastFreshness !== null && view.freshness !== lastFreshness) {
    if (view.freshness === "stale") announce(liveRegion, `Departures are not live. ${view.freshnessDetail ?? ""}`);
    else if (view.freshness === "live" && lastFreshness === "stale") announce(liveRegion, "Departures are live again.");
  }
  lastFreshness = view.freshness;

  const bannerItems = [
    source.banner ? h("p", { class: "notice notice-demo" }, source.banner) : null,
    storageWarning ? h("p", { class: "notice notice-warn" }, storageWarning) : null,
    view.alertsStale ? h("p", { class: "notice" }, "Service alerts may be out of date.") : null,
  ].filter((x): x is HTMLParagraphElement => x !== null);
  banners.replaceChildren(...bannerItems);

  // Rebuild rows only when something visible changed, so focus and screen readers aren't disturbed every tick.
  const signature = JSON.stringify([view.sections, [...openAlerts]]);
  if (signature === lastSignature) return;
  lastSignature = signature;

  boardMain.classList.toggle("is-empty", !config.groups.length);
  if (!config.groups.length) {
    replaceKeepingFocus(
      boardMain,
      h(
        "div",
        { class: "empty" },
        h("h2", {}, "No departures yet"),
        h("p", {}, "Choose the stops, routes and directions you want to see. Nothing is preset."),
        h("a", { href: "#settings", class: "btn btn-primary" }, "Set up your board"),
        h("p", { class: "muted" }, "Have a backup? Import it in Settings."),
      ),
    );
    return;
  }
  replaceKeepingFocus(
    boardMain,
    ...renderSections(view, {
      openAlerts,
      onToggleAlert: (key) => {
        if (openAlerts.has(key)) openAlerts.delete(key);
        else openAlerts.add(key);
        renderBoard();
      },
    }),
  );
}

function commit(next: BoardConfig): void {
  config = next;
  if (demo) return;
  const err = saveConfig(store, next);
  storageWarning = err ?? (store ? null : storageWarning);
  controller.setConfig(next);
}

function route(): void {
  if (location.hash === "#settings") {
    mountSettings(app, {
      getConfig: () => config,
      commit,
      metadata,
      wake,
      storageWarning: () => storageWarning,
      close: () => {
        location.hash = "";
      },
    });
    document.title = "Settings · " + config.title;
    app.querySelector<HTMLElement>("h1")?.focus();
  } else {
    document.title = config.title;
    boardShell();
  }
}

async function init(): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
    const { demoSource } = await import("./demo");
    const mode = new URLSearchParams(location.search).get("demo") ?? "";
    const d = demoSource(mode);
    config = d.config;
    source = d;
    demo = true;
  } else {
    controller.setConfig(config);
    controller.subscribe(() => {
      if (location.hash !== "#settings") renderBoard();
    });
    controller.start();
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    controller.setVisible(visible);
    if (visible && location.hash !== "#settings") renderBoard();
  });
  window.addEventListener("online", () => controller.onOnline());
  window.addEventListener("offline", () => renderBoard());
  window.setInterval(() => {
    if (document.visibilityState === "visible" && location.hash !== "#settings") renderBoard();
  }, 5_000);

  route();
  void wake.start();
}

void init();
