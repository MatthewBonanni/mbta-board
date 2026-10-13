import type { BoardView, RowView, SectionView, TimeView } from "../view";
import { h } from "./dom";

export interface BoardRenderOptions {
  openAlerts: Set<string>;
  onToggleAlert: (key: string) => void;
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
    t.headsign ? h("span", { class: "t-head", "aria-hidden": "true" }, t.headsign) : null,
  );
}

function row(r: RowView, opts: BoardRenderOptions): HTMLElement {
  const [next, ...later] = r.times;
  const alertKey = (id: string) => `${r.groupId}:${id}`;
  return h(
    "li",
    { class: "row" + (r.message ? " row-empty" : "") },
    h(
      "span",
      { class: r.badge.text.length > 4 ? "badge badge-long" : "badge", style: `background:${r.badge.background};color:${r.badge.color}`, "data-mode": r.badge.mode },
      r.badge.text,
    ),
    h(
      "span",
      { class: "dest" },
      h("span", { class: "visually-hidden" }, "to "),
      r.destination,
      r.lastKnown ? h("span", { class: "row-tag" }, "Last known") : null,
    ),
    r.message
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
    r.alerts.length
      ? h(
          "div",
          { class: "row-alerts" },
          ...r.alerts.map((a) => {
            const key = alertKey(a.id);
            const open = opts.openAlerts.has(key);
            const panelId = `alert-${r.groupId}-${a.id}`.replace(/[^A-Za-z0-9_-]/g, "_");
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
                h("span", { class: "alert-tag" }, "Alert"),
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
          }),
        )
      : null,
  );
}

function section(s: SectionView, opts: BoardRenderOptions): HTMLElement {
  return h(
    "section",
    { class: "stop", "aria-label": s.heading },
    h(
      "div",
      { class: "stop-head" },
      h("h2", {}, s.heading),
      s.meta ? h("p", { class: "stop-meta" }, s.meta) : null,
    ),
    h("ul", { class: "rows" }, ...s.rows.map((r) => row(r, opts))),
  );
}

export function renderSections(view: BoardView, opts: BoardRenderOptions): Node[] {
  return view.sections.map((s) => section(s, opts));
}
