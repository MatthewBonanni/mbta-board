import "./style.css";
import { RequestQueue } from "./api";
import { browserStore, loadConfig, saveConfig, type BoardConfig } from "./config";
import { BoardController, type ControllerState } from "./controller";
import { Metadata } from "./metadata";
import { OsmClient } from "./osm";
import { readPrefs, writePrefs, type DevicePrefs } from "./prefs";
import { BOSTON, isDark } from "./sun";
import { formatClock } from "./time";
import { declutter, renderNextLeave, renderSections, renderStatus } from "./ui/board";
import { announce, h, replaceKeepingFocus } from "./ui/dom";
import { clearFit, fitToScreen } from "./ui/fit";
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
let prefs: DevicePrefs = readPrefs(store);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function setPrefs(next: DevicePrefs): void {
  prefs = next;
  writePrefs(store, next);
  applyTheme();
  lastSignature = "";
}

function applyTheme(): void {
  const where = config.origin ?? BOSTON;
  const dark =
    prefs.theme === "dark" ||
    (prefs.theme === "night" && isDark(Date.now(), where.lat, where.lon)) ||
    (prefs.theme === "system" && darkQuery.matches);
  const theme = dark ? "dark" : "light";
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#161616");
  }
}

const wake = new WakeLockManager(() => prefs, setPrefs);
const osm = new OsmClient();

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
let lastBanners = "";

const clock = h("time", { class: "clock" });
const freshnessEl = h("p", { class: "freshness" });
const boardMain = h("main", { class: "board", id: "main" });
const banners = h("div", { class: "banners" });
const statusBox = h("div", { class: "status-box" });
const fitBox = h("div", { class: "board-fit" }, banners, statusBox, boardMain);
const masthead = h("header", { class: "masthead" });

function settingsButton(): HTMLElement {
  return h("a", { href: "#settings", class: "btn btn-band", "aria-label": "Settings" }, "Settings");
}

function boardShell(): void {
  masthead.replaceChildren(
    h("img", { class: "mark", src: `${import.meta.env.BASE_URL}icons/mark.svg`, alt: "", width: 28, height: 28 }),
    h("h1", { class: "masthead-title" }, config.title),
    clock,
    freshnessEl,
    settingsButton(),
  );
  app.replaceChildren(masthead, fitBox, liveRegion);
  lastSignature = "";
  renderBoard();
}

function renderBoard(): void {
  const now = source.now();
  applyTheme();
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
  const bannerText = bannerItems.map((b) => b.textContent).join("|");
  const bannersChanged = bannerText !== lastBanners;
  lastBanners = bannerText;
  banners.replaceChildren(...bannerItems);

  // Rebuild rows only when something visible changed, so focus and screen readers aren't disturbed every tick.
  const showStatus = prefs.statusStrip && config.groups.length > 0;
  const nextLeave = prefs.nextLeave ? view.nextLeave : null;
  const signature = JSON.stringify([view.sections, [...openAlerts], prefs, nextLeave, showStatus ? view.status : null]);
  if (signature === lastSignature) {
    if (bannersChanged) refit();
    else if (prefs.layout === "timeline") declutter(boardMain);
    return;
  }
  lastSignature = signature;

  boardMain.classList.toggle("is-empty", !config.groups.length);
  if (!config.groups.length) {
    statusBox.replaceChildren();
    clearFit(fitBox);
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
  const credit = config.origin
    ? h(
        "p",
        { class: "board-credit" },
        "Walk times: © ",
        h("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" }, "OpenStreetMap contributors"),
      )
    : null;
  const opts = {
    openAlerts,
    onToggleAlert: (key: string) => {
      if (openAlerts.has(key)) openAlerts.delete(key);
      else openAlerts.add(key);
      renderBoard();
    },
    layout: prefs.layout,
    hideRowAlerts: showStatus,
  };
  replaceKeepingFocus(statusBox, showStatus ? renderStatus(view.status, opts) : null);
  boardMain.dataset.layout = prefs.layout;
  replaceKeepingFocus(boardMain, nextLeave ? renderNextLeave(nextLeave) : null, ...renderSections(view, opts), credit);
  refit();
}

let fittedSize = "";

function refit(): void {
  if (location.hash === "#settings") return;
  fittedSize = `${window.innerWidth}x${window.innerHeight}`;
  if (prefs.fitScreen && config.groups.length) {
    fitToScreen(fitBox);
  } else {
    clearFit(fitBox);
  }
  if (prefs.layout === "timeline") declutter(boardMain);
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
    clearFit(fitBox);
    mountSettings(app, {
      getConfig: () => config,
      commit,
      metadata,
      osm,
      wake,
      prefs: () => prefs,
      setPrefs,
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
    const q = new URLSearchParams(location.search);
    prefs = {
      ...prefs,
      ...(q.get("theme") ? { theme: q.get("theme") as DevicePrefs["theme"] } : {}),
      ...(q.get("layout") ? { layout: q.get("layout") as DevicePrefs["layout"] } : {}),
      ...(q.has("strip") ? { statusStrip: q.get("strip") !== "0" } : {}),
      ...(q.has("banner") ? { nextLeave: q.get("banner") !== "0" } : {}),
    };
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
  darkQuery.addEventListener("change", applyTheme);
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refit, 150);
  };
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  window.setInterval(applyTheme, 60_000);
  applyTheme();
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    controller.setVisible(visible);
    if (visible && location.hash !== "#settings") renderBoard();
  });
  window.addEventListener("online", () => controller.onOnline());
  window.addEventListener("offline", () => renderBoard());
  window.setInterval(() => {
    if (document.visibilityState !== "visible" || location.hash === "#settings") return;
    renderBoard();
    if (fittedSize !== `${window.innerWidth}x${window.innerHeight}`) refit();
  }, 5_000);
  // Backstop for rotations or window changes that don't fire a resize event.
  new ResizeObserver(() => {
    if (fittedSize && fittedSize !== `${window.innerWidth}x${window.innerHeight}`) onResize();
  }).observe(document.documentElement);

  route();
  void wake.start();
}

void init();
