import type { AlertView, BoardView, NextLeaveView, RowView, SectionView, StatusView, TimelineView, TimeView } from "../view";
import { TIMELINE_MINUTES } from "../view";
import { h } from "./dom";

export interface BoardRenderOptions {
  openAlerts: Set<string>;
  onToggleAlert: (key: string) => void;
  layout: "list" | "timeline";
  /** Alerts are shown in the status strip instead of on each row. */
  hideRowAlerts: boolean;
}

function badge(b: RowView["badge"], small = false): HTMLElement {
  const cls = ["badge", small ? "badge-sm" : "", b.text.length > 4 ? "badge-long" : ""].filter(Boolean).join(" ");
  return h("span", { class: cls, style: `background:${b.background};color:${b.color}`, "data-mode": b.mode }, b.text);
}

function timeCell(t: TimeView, primary: boolean): HTMLElement {
  return h(
    "span",
    { class: `t ${primary ? "t-next" : "t-later"} t-${t.kind}${t.reach ? ` t-${t.reach}` : ""}` },
    h("span", { class: "visually-hidden" }, t.label),
    h("span", { class: "t-prefix", "aria-hidden": "true" }, t.prefix),
    h(
      "span",
      { class: "t-main", "aria-hidden": "true" },
      h("span", { class: "t-val" }, t.value),
      t.unit ? h("span", { class: "t-unit" }, t.unit) : null,
    ),
    t.clock ? h("span", { class: "t-clock", "aria-hidden": "true" }, t.clock) : null,
    t.headsign ? h("span", { class: "t-head", "aria-hidden": "true" }, t.headsign) : null,
  );
}

function alertBlock(a: AlertView, key: string, opts: BoardRenderOptions, tag: Node): HTMLElement {
  const open = opts.openAlerts.has(key);
  const panelId = `alert-${key}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return h(
    "div",
    { class: "alert" },
    h(
      "button",
      {
        class: "alert-toggle",
        type: "button",
        "aria-expanded": String(open),
        "aria-controls": panelId,
        "data-focus-key": key,
        onclick: () => opts.onToggleAlert(key),
      },
      tag,
      h("span", { class: "alert-summary" }, a.summary),
    ),
    h(
      "div",
      { class: "alert-detail", id: panelId, hidden: !open },
      a.header && a.header !== a.summary ? h("p", {}, a.header) : null,
      ...a.description
        .split(/\n{2,}|\r\n\r\n/)
        .filter(Boolean)
        .map((p) => h("p", {}, p)),
    ),
  );
}

function timeline(t: TimelineView, r: RowView): HTMLElement {
  return h(
    "span",
    { class: "lane" },
    h("span", { class: "visually-hidden" }, r.times.map((x) => x.label).join("; ") || r.message || ""),
    h(
      "span",
      { class: "lane-track", "aria-hidden": "true" },
      t.walk
        ? h("span", { class: "lane-walk", style: `left:${t.walk.from * 100}%;width:${(t.walk.to - t.walk.from) * 100}%` })
        : null,
      ...t.ticks.map((k) =>
        h(
          "span",
          {
            class: `tick tick-${k.kind}${k.reach ? ` tick-${k.reach}` : ""}${k.pos < 0.06 ? " tick-start" : k.pos > 0.94 ? " tick-end" : ""}`,
            style: `left:${k.pos * 100}%`,
          },
          h("span", { class: "tick-label" }, k.label),
        ),
      ),
      t.beyond ? h("span", { class: "lane-beyond" }, t.beyond) : null,
      !t.ticks.length && !t.beyond && r.message ? h("span", { class: "lane-beyond" }, r.message) : null,
    ),
  );
}

function row(r: RowView, opts: BoardRenderOptions): HTMLElement {
  const [next, ...later] = r.times;
  const timelineMode = opts.layout === "timeline";
  return h(
    "li",
    { class: "row" + (r.message ? " row-empty" : "") + (timelineMode ? " row-timeline" : "") },
    badge(r.badge),
    h(
      "span",
      { class: "dest" },
      h("span", { class: "visually-hidden" }, "to "),
      r.destination,
      r.lastKnown ? h("span", { class: "row-tag" }, "Last known") : null,
    ),
    timelineMode
      ? timeline(r.timeline, r)
      : r.message
        ? h("span", { class: "row-msg" }, r.message)
        : h("span", { class: "times" }, timeCell(next!, true), ...later.map((t) => timeCell(t, false))),
    r.leave
      ? h(
          "p",
          { class: "leave" + (r.leave.urgent ? " leave-urgent" : "") },
          h("span", { class: "visually-hidden" }, r.leave.label),
          h("span", { class: "leave-lead", "aria-hidden": "true" }, r.leave.lead),
          h("span", { class: "leave-detail", "aria-hidden": "true" }, r.leave.detail),
        )
      : null,
    r.alerts.length && !opts.hideRowAlerts
      ? h(
          "div",
          { class: "row-alerts" },
          ...r.alerts.map((a) => alertBlock(a, `${r.groupId}:${a.id}`, opts, h("span", { class: "alert-tag" }, "Alert"))),
        )
      : null,
  );
}

function axis(): HTMLElement {
  const marks = [0, 15, 30, 45].filter((m) => m <= TIMELINE_MINUTES);
  return h(
    "div",
    { class: "axis", "aria-hidden": "true" },
    h(
      "span",
      { class: "axis-track" },
      ...marks.map((m) => h("span", { class: "axis-mark", style: `left:${(m / TIMELINE_MINUTES) * 100}%` }, m === 0 ? "now" : m === TIMELINE_MINUTES ? `${m} min` : String(m))),
    ),
  );
}

function section(s: SectionView, opts: BoardRenderOptions, side = false): HTMLElement {
  return h(
    "section",
    { class: side ? "stop stop-side" : "stop", "aria-label": s.heading },
    h("div", { class: "stop-head" }, h(side ? "h3" : "h2", {}, s.heading), s.meta ? h("p", { class: "stop-meta" }, s.meta) : null),
    opts.layout === "timeline" ? axis() : null,
    h("ul", { class: "rows" }, ...s.rows.map((r) => row(r, opts))),
  );
}

/** Sides of one street corner share a heading, with the street drawn between them. */
function corner(sides: SectionView[], opts: BoardRenderOptions): HTMLElement {
  const c = sides[0]!.corner!;
  return h(
    "section",
    { class: "stop stop-corner", "aria-label": `${c.heading}, both sides of ${c.street}` },
    h("div", { class: "stop-head" }, h("h2", {}, c.heading)),
    ...sides.flatMap((s, i) => [
      i > 0 ? h("p", { class: "street-band", "aria-hidden": "true" }, h("span", {}, c.street)) : null,
      section(s, opts, true),
    ]).filter((n): n is HTMLElement => n !== null),
  );
}

export function renderSections(view: BoardView, opts: BoardRenderOptions): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < view.sections.length; ) {
    const s = view.sections[i]!;
    let j = i + 1;
    while (s.corner && view.sections[j]?.corner?.key === s.corner.key) j++;
    out.push(j - i > 1 ? corner(view.sections.slice(i, j), opts) : section(s, opts));
    i = j;
  }
  return out;
}

export function renderNextLeave(n: NextLeaveView): HTMLElement {
  return h(
    "section",
    { class: "next-leave" + (n.urgent ? " next-leave-urgent" : ""), "aria-label": "Next departure to leave for" },
    h("span", { class: "visually-hidden" }, n.label),
    h("p", { class: "nl-lead", "aria-hidden": "true" }, n.lead),
    h(
      "p",
      { class: "nl-what", "aria-hidden": "true" },
      badge(n.badge, true),
      h("span", { class: "nl-dest" }, `to ${n.destination}`),
      h("span", { class: "nl-place" }, `from ${n.place}`),
    ),
    h("p", { class: "nl-detail", "aria-hidden": "true" }, n.detail),
  );
}

export function renderStatus(status: StatusView, opts: BoardRenderOptions): HTMLElement {
  return h(
    "section",
    { class: "status-strip", "aria-label": "Service alerts" },
    ...status.withAlerts.flatMap((item) => item.alerts.map((a) => alertBlock(a, `status:${item.routeId}:${a.id}`, opts, badge(item.badge, true)))),
    status.quiet.length
      ? h(
          "p",
          { class: "status-quiet" },
          `${status.withAlerts.length ? "No alerts for" : "No service alerts for"} ${status.quiet.map((i) => i.badge.text).join(", ")}`,
        )
      : null,
  );
}

/** Hides timeline labels that would touch a neighbour at the current width and text size; the target's label wins. */
export function declutter(root: ParentNode): void {
  const GAP = 6;
  for (const track of root.querySelectorAll<HTMLElement>(".lane-track, .axis-track")) {
    const labels = [...track.querySelectorAll<HTMLElement>(".tick-label, .axis-mark")];
    for (const l of labels) l.classList.remove("is-crowded");
    let prev: HTMLElement | null = null;
    for (const l of labels) {
      if (!l.textContent) continue;
      if (prev && l.getBoundingClientRect().left < prev.getBoundingClientRect().right + GAP) {
        const isTarget = (el: HTMLElement) => el.parentElement?.classList.contains("tick-target") ?? false;
        const isLastAxis = l.classList.contains("axis-mark") && l === labels[labels.length - 1];
        if ((isTarget(l) || isLastAxis) && !isTarget(prev)) {
          prev.classList.add("is-crowded");
          prev = l;
        } else {
          l.classList.add("is-crowded");
        }
        continue;
      }
      prev = l;
    }
  }
}
