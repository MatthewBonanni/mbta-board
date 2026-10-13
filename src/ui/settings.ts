import {
  ConfigError,
  exportConfig,
  LIMITS,
  mergeConfigs,
  newGroupId,
  parseImport,
  renumber,
  serviceKey,
  type BoardConfig,
  type DepartureGroup,
  type ImportPreview,
} from "../config";
import {
  describeStop,
  directionLabel,
  routeLabel,
  searchStops,
  type Metadata,
  type RouteInfo,
  type ServiceOption,
  type StopInfo,
  type StopServices,
} from "../metadata";
import { OsmError, parseCoordinates, type OsmClient, type Place } from "../osm";
import { badgeTextColor } from "../view";
import { applyWalks, estimateWalks } from "../walking";
import type { WakeLockManager } from "../wake";
import { h, replaceKeepingFocus } from "./dom";

export interface SettingsDeps {
  getConfig(): BoardConfig;
  commit(next: BoardConfig): void;
  metadata: Metadata;
  osm: OsmClient;
  wake: WakeLockManager;
  storageWarning(): string | null;
  close(): void;
}

type Split = "together" | "split" | `only:${string}`;

interface Pick {
  service: ServiceOption;
  checked: boolean;
  split: Split;
}

interface Wizard {
  stop: StopInfo | null;
  /** Parent station chosen in search, kept while choosing a platform. */
  station: StopInfo | null;
  platforms: StopInfo[] | null;
  services: StopServices | null;
  picks: Pick[];
  label: string;
  loading: string | null;
  error: string | null;
}

const newWizard = (): Wizard => ({
  stop: null,
  station: null,
  platforms: null,
  services: null,
  picks: [],
  label: "",
  loading: null,
  error: null,
});

function badge(route: RouteInfo | undefined, routeId: string): HTMLElement {
  const bg = route?.color ?? "#575752";
  return h(
    "span",
    { class: "badge badge-sm", style: `background:${bg};color:${badgeTextColor(bg, route?.textColor ?? "#FFFFFF")}` },
    routeLabel(route, routeId),
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function mountSettings(root: HTMLElement, deps: SettingsDeps): void {
  const { metadata } = deps;
  let wizard = newWizard();
  let importPreview: (ImportPreview & { missingStops: string[]; missingRoutes: string[]; checking: boolean }) | null = null;
  let importError: string | null = null;
  let editing: string | null = null;
  let routes: RouteInfo[] = [];
  let stopIndex: StopInfo[] | null = null;
  let indexStatus: string | null = null;
  let routeFilter = "";
  let routeStopIds: Set<string> | undefined;
  let queryText = "";

  const boardBox = h("div");
  const groupsBox = h("div");
  const resultsBox = h("div", { class: "results" });
  const wizardBox = h("div");
  const displayBox = h("div");
  const originBox = h("div");
  const importBox = h("div");
  const statusRegion = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });

  const commit = (next: BoardConfig) => {
    deps.commit(next);
    renderGroups();
    renderBoardBox();
  };

  // ---------- Board ----------
  function renderBoardBox(): void {
    const cfg = deps.getConfig();
    const warning = deps.storageWarning();
    replaceKeepingFocus(
      boardBox,
      warning ? h("p", { class: "notice notice-warn", role: "alert" }, warning) : h("span"),
      h(
        "div",
        { class: "field" },
        h("label", { for: "board-title" }, "Board name"),
        h("input", {
          id: "board-title",
          type: "text",
          maxlength: LIMITS.title,
          value: cfg.title,
          autocomplete: "off",
          "data-focus-key": "board-title",
          onchange: (e: Event) => {
            const title = (e.target as HTMLInputElement).value.trim() || "Departures";
            commit({ ...deps.getConfig(), title });
          },
        }),
      ),
      h(
        "fieldset",
        { class: "field" },
        h("legend", {}, "Spacing"),
        ...(["comfortable", "compact"] as const).map((d) =>
          h(
            "label",
            { class: "choice" },
            h("input", {
              type: "radio",
              name: "density",
              value: d,
              checked: cfg.density === d,
              "data-focus-key": `density-${d}`,
              onchange: () => commit({ ...deps.getConfig(), density: d }),
            }),
            d === "comfortable" ? "Comfortable" : "Compact (text stays the same size)",
          ),
        ),
      ),
    );
  }

  // ---------- Configured groups ----------
  function move(index: number, delta: number): void {
    const cfg = deps.getConfig();
    const groups = [...cfg.groups];
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    [groups[index], groups[target]] = [groups[target]!, groups[index]!];
    commit({ ...cfg, groups: renumber(groups) });
    const g = groups[target]!;
    statusRegion.textContent = `Moved to position ${target + 1} of ${groups.length}`;
    groupsBox.querySelector<HTMLElement>(`[data-focus-key="${delta < 0 ? "up" : "down"}-${g.id}"]`)?.focus();
  }

  function groupTitle(g: DepartureGroup): string {
    return `${routeLabel(metadata.route(g.routeId), g.routeId)} to ${g.destinationFilter ?? directionLabel(metadata.route(g.routeId), g.directionId)}`;
  }

  function renderGroups(): void {
    const cfg = deps.getConfig();
    if (!cfg.groups.length) {
      replaceKeepingFocus(groupsBox, h("p", { class: "muted" }, "Nothing on the board yet. Add a stop below."));
      return;
    }
    const items = cfg.groups.map((g, i) => {
      const stop = metadata.stop(g.stopId);
      const title = groupTitle(g);
      const isEditing = editing === g.id;
      return h(
        "li",
        { class: "group-item" },
        h(
          "div",
          { class: "group-main" },
          badge(metadata.route(g.routeId), g.routeId),
          h(
            "div",
            {},
            h("p", { class: "group-title" }, title.replace(/^\S+ to /, "to ")),
            h(
              "p",
              { class: "muted" },
              [
                g.displayLabel ? `“${g.displayLabel}”` : null,
                stop?.name ?? null,
                `${stop?.locationType === 1 ? "Station" : "Stop"} ${g.stopId}`,
                g.walkMinutes !== undefined ? `${g.walkMinutes} min walk` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
        ),
        isEditing
          ? h(
              "form",
              {
                class: "label-edit",
                onsubmit: (e: Event) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const label = (form.elements.namedItem("label") as HTMLInputElement).value.trim().slice(0, LIMITS.label);
                  const walkRaw = (form.elements.namedItem("walk") as HTMLInputElement).value.trim();
                  const walk = walkRaw === "" ? undefined : Math.round(Number(walkRaw));
                  if (walk !== undefined && !(walk >= 0 && walk <= LIMITS.walkMinutes)) {
                    statusRegion.textContent = `Walk time must be 0 to ${LIMITS.walkMinutes} minutes`;
                    return;
                  }
                  editing = null;
                  const next = deps.getConfig();
                  const relabelled = { ...next, groups: next.groups.map((x) => (x.id === g.id ? { ...x, displayLabel: label } : x)) };
                  commit(applyWalks(relabelled, new Map([[g.stopId, walk]])));
                  groupsBox.querySelector<HTMLElement>(`[data-focus-key="edit-${g.id}"]`)?.focus();
                },
              },
              h("label", { for: `label-${g.id}` }, "Heading label"),
              h("input", {
                id: `label-${g.id}`,
                name: "label",
                type: "text",
                maxlength: LIMITS.label,
                value: g.displayLabel,
                placeholder: stop?.name ?? "",
                "data-focus-key": `label-${g.id}`,
              }),
              h("label", { for: `walk-${g.id}` }, "Walk from starting point (minutes, applies to every row at this stop; blank for none)"),
              h("input", {
                id: `walk-${g.id}`,
                name: "walk",
                type: "number",
                inputmode: "numeric",
                min: 0,
                max: LIMITS.walkMinutes,
                step: 1,
                value: g.walkMinutes ?? "",
                class: "input-short",
              }),
              h("button", { type: "submit", class: "btn" }, "Save"),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-quiet",
                  onclick: () => {
                    editing = null;
                    renderGroups();
                  },
                },
                "Cancel",
              ),
            )
          : null,
        h(
          "div",
          { class: "group-actions" },
          h("button", { type: "button", class: "btn btn-icon", "aria-label": `Move ${title} up`, disabled: i === 0, "data-focus-key": `up-${g.id}`, onclick: () => move(i, -1) }, "↑"),
          h(
            "button",
            { type: "button", class: "btn btn-icon", "aria-label": `Move ${title} down`, disabled: i === cfg.groups.length - 1, "data-focus-key": `down-${g.id}`, onclick: () => move(i, 1) },
            "↓",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-quiet",
              "data-focus-key": `edit-${g.id}`,
              "aria-label": `Edit label and walk time for ${title}`,
              onclick: () => {
                editing = g.id;
                renderGroups();
                groupsBox.querySelector<HTMLInputElement>(`#label-${CSS.escape(g.id)}`)?.focus();
              },
            },
            "Edit",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-quiet btn-danger",
              "aria-label": `Remove ${title}`,
              onclick: () => {
                if (!window.confirm(`Remove ${title} from the board?`)) return;
                const next = deps.getConfig();
                commit({ ...next, groups: renumber(next.groups.filter((x) => x.id !== g.id)) });
                statusRegion.textContent = `Removed ${title}`;
              },
            },
            "Remove",
          ),
        ),
      );
    });
    replaceKeepingFocus(
      groupsBox,
      h("p", { class: "muted" }, "Adjacent rows with the same heading label share one heading on the board."),
      h("ol", { class: "group-list" }, ...items),
    );
  }

  // ---------- Stop search ----------
  async function loadIndex(): Promise<void> {
    if (stopIndex || indexStatus === "Loading stop list…") return;
    indexStatus = "Loading stop list…";
    renderResults();
    try {
      [stopIndex, routes] = await Promise.all([metadata.stops(), metadata.routes()]);
      indexStatus = null;
      renderRouteOptions();
    } catch (err) {
      indexStatus = `Could not load the stop list: ${errorText(err)}`;
    }
    renderResults();
  }

  const routeSelect = h("select", {
    id: "route-filter",
    onfocus: () => void loadIndex(),
    onchange: async (e: Event) => {
      routeFilter = (e.target as HTMLSelectElement).value;
      routeStopIds = undefined;
      if (routeFilter) {
        indexStatus = "Loading stops on this route…";
        renderResults();
        try {
          routeStopIds = await metadata.stopIdsForRoute(routeFilter);
          indexStatus = null;
        } catch (err) {
          indexStatus = `Could not load stops for this route: ${errorText(err)}`;
        }
      }
      renderResults();
    },
  });

  function renderRouteOptions(): void {
    const groups = new Map<string, RouteInfo[]>();
    const typeName = (t: number) => (t === 3 ? "Bus" : t === 2 ? "Commuter Rail" : t === 4 ? "Ferry" : "Subway");
    for (const r of routes) {
      const k = typeName(r.type);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    routeSelect.replaceChildren(
      h("option", { value: "" }, "Any route"),
      ...[...groups].map(([name, rs]) =>
        h(
          "optgroup",
          { label: name },
          ...rs.map((r) => h("option", { value: r.id, selected: r.id === routeFilter }, r.shortName ? `${r.shortName} · ${r.longName}` : r.longName)),
        ),
      ),
    );
  }
  routeSelect.append(h("option", { value: "" }, "Any route"));

  let searchTimer = 0;
  const searchInput = h("input", {
    id: "stop-search",
    type: "search",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "e.g. Park Street, Washington St, 1234",
    "aria-describedby": "stop-search-hint",
    onfocus: () => void loadIndex(),
    oninput: (e: Event) => {
      queryText = (e.target as HTMLInputElement).value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(renderResults, 120);
    },
  });

  function renderResults(): void {
    if (indexStatus) {
      resultsBox.replaceChildren(h("p", { class: "muted", role: "status" }, indexStatus));
      return;
    }
    if (!stopIndex || (!queryText.trim() && !routeFilter)) {
      resultsBox.replaceChildren();
      return;
    }
    const found = searchStops(stopIndex, queryText, routeStopIds, 40);
    if (!found.length) {
      resultsBox.replaceChildren(h("p", { class: "muted", role: "status" }, "No matching stops."));
      return;
    }
    const parents = new Map(stopIndex.filter((s) => s.locationType === 1).map((s) => [s.id, s]));
    resultsBox.replaceChildren(
      h("p", { class: "visually-hidden", role: "status" }, `${found.length} stops found`),
      h(
        "ul",
        { class: "result-list" },
        ...found.map((s) =>
          h(
            "li",
            {},
            h(
              "button",
              { type: "button", class: "result", onclick: () => void chooseStop(s) },
              h("span", { class: "result-name" }, s.name),
              h(
                "span",
                { class: "result-meta" },
                [
                  describeStop(s),
                  s.parentId && parents.get(s.parentId) ? `in ${parents.get(s.parentId)!.name}` : null,
                  s.municipality,
                  `ID ${s.id}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- Wizard ----------
  async function chooseStop(s: StopInfo): Promise<void> {
    wizard = { ...newWizard(), loading: `Loading ${s.name}…` };
    renderWizard();
    wizardBox.scrollIntoView({ block: "start" });
    try {
      if (s.locationType === 1) {
        const svc = await metadata.stopServices(s.id);
        wizard = { ...newWizard(), station: s, platforms: svc.children, services: svc };
      } else {
        await loadServices(s);
        return;
      }
    } catch (err) {
      wizard = { ...newWizard(), error: `Could not load this stop: ${errorText(err)}` };
    }
    renderWizard();
    wizardBox.querySelector<HTMLElement>("h3")?.focus();
  }

  async function loadServices(s: StopInfo, station: StopInfo | null = null, preloaded?: StopServices): Promise<void> {
    wizard = { ...wizard, loading: `Loading routes at ${s.name}…`, error: null };
    renderWizard();
    try {
      const services = preloaded ?? (await metadata.stopServices(s.id));
      wizard = {
        ...newWizard(),
        station,
        stop: s,
        services,
        picks: services.services.map((service) => ({ service, checked: service.routeId === routeFilter, split: "together" })),
      };
    } catch (err) {
      wizard = { ...wizard, loading: null, error: `Could not load routes for this stop: ${errorText(err)}` };
    }
    renderWizard();
    wizardBox.querySelector<HTMLElement>("h3")?.focus();
  }

  function pendingGroups(): { group: DepartureGroup; duplicate: boolean }[] {
    const stop = wizard.stop;
    const svc = wizard.services;
    if (!stop || !svc) return [];
    const resolved = stop.locationType === 1 ? svc.children.map((c) => c.id) : [stop.id];
    const existing = new Set(deps.getConfig().groups.map(serviceKey));
    const out: { group: DepartureGroup; duplicate: boolean }[] = [];
    for (const p of wizard.picks) {
      if (!p.checked) continue;
      const base = {
        stopId: stop.id,
        resolvedStopIds: resolved.length ? resolved : [stop.id],
        routeId: p.service.routeId,
        directionId: p.service.directionId,
        displayLabel: wizard.label.trim().slice(0, LIMITS.label),
        order: 0,
      };
      const filters: (string | undefined)[] =
        p.split === "together" ? [undefined] : p.split === "split" ? p.service.headsigns : [p.split.slice("only:".length)];
      for (const f of filters) {
        const group: DepartureGroup = { id: newGroupId(), ...base, ...(f ? { destinationFilter: f } : {}) };
        out.push({ group, duplicate: existing.has(serviceKey(group)) });
      }
    }
    return out;
  }

  function renderWizard(): void {
    const w = wizard;
    if (w.loading) {
      replaceKeepingFocus(wizardBox, h("p", { class: "muted", role: "status" }, w.loading));
      return;
    }
    if (w.error) {
      replaceKeepingFocus(wizardBox, h("p", { class: "notice notice-warn", role: "alert" }, w.error));
      return;
    }
    if (w.station && !w.stop) {
      const st = w.station;
      replaceKeepingFocus(
        wizardBox,
        h(
          "div",
          { class: "wizard" },
          h("h3", { tabindex: "-1" }, `Where do you board at ${st.name}?`),
          h("p", { class: "muted" }, `Station ${st.id}. Pick a platform for one direction, or the whole station.`),
          h(
            "ul",
            { class: "result-list" },
            h(
              "li",
              {},
              h(
                "button",
                { type: "button", class: "result", onclick: () => void loadServices(st, st, w.services ?? undefined) },
                h("span", { class: "result-name" }, "Whole station"),
                h("span", { class: "result-meta" }, `All ${w.platforms?.length ?? 0} platforms · ID ${st.id}`),
              ),
            ),
            ...(w.platforms ?? []).map((p) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { type: "button", class: "result", onclick: () => void loadServices(p, st) },
                  h("span", { class: "result-name" }, p.platformName ? `${p.platformName} platform` : p.name),
                  h("span", { class: "result-meta" }, `${describeStop(p)} · ID ${p.id}`),
                ),
              ),
            ),
          ),
          h("button", { type: "button", class: "btn btn-quiet", onclick: resetWizard }, "Cancel"),
        ),
      );
      return;
    }
    if (!w.stop || !w.services) {
      replaceKeepingFocus(wizardBox);
      return;
    }
    const stop = w.stop;
    const pending = pendingGroups();
    const toAdd = pending.filter((p) => !p.duplicate);
    const serviceRows = w.picks.map((p, i) => {
      const route = metadata.route(p.service.routeId) ?? w.services!.routes.find((r) => r.id === p.service.routeId);
      const dest = directionLabel(route, p.service.directionId);
      const dirName = route?.directionNames[p.service.directionId];
      const id = `svc-${i}`;
      return h(
        "li",
        { class: "service" },
        h(
          "label",
          { class: "choice", for: id },
          h("input", {
            id,
            type: "checkbox",
            checked: p.checked,
            "data-focus-key": id,
            onchange: (e: Event) => {
              wizard.picks[i] = { ...p, checked: (e.target as HTMLInputElement).checked };
              renderWizard();
            },
          }),
          badge(route, p.service.routeId),
          h("span", {}, `to ${dest}`, dirName ? h("span", { class: "muted" }, ` · ${dirName}`) : null),
        ),
        p.checked && p.service.headsigns.length > 1
          ? h(
              "div",
              { class: "field field-inline" },
              h("label", { for: `${id}-split` }, "Destinations"),
              h(
                "select",
                {
                  id: `${id}-split`,
                  "data-focus-key": `${id}-split`,
                  onchange: (e: Event) => {
                    wizard.picks[i] = { ...p, split: (e.target as HTMLSelectElement).value as Split };
                    renderWizard();
                  },
                },
                h("option", { value: "together", selected: p.split === "together" }, `All together (${p.service.headsigns.join(", ")})`),
                h("option", { value: "split", selected: p.split === "split" }, "One row per destination"),
                ...p.service.headsigns.map((hs) => h("option", { value: `only:${hs}`, selected: p.split === `only:${hs}` }, `Only ${hs}`)),
              ),
            )
          : null,
      );
    });
    replaceKeepingFocus(
      wizardBox,
      h(
        "div",
        { class: "wizard" },
        h("h3", { tabindex: "-1" }, stop.name),
        h(
          "p",
          { class: "muted" },
          [
            describeStop(stop),
            w.station && w.station.id !== stop.id ? `in ${w.station.name}` : null,
            stop.municipality,
            `ID ${stop.id}`,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        w.picks.length
          ? h(
              "fieldset",
              { class: "field" },
              h("legend", {}, "Routes and directions served here"),
              h("ul", { class: "service-list" }, ...serviceRows),
            )
          : h("p", { class: "notice" }, "The MBTA lists no regular routes at this stop. Try another boarding location."),
        h(
          "div",
          { class: "field" },
          h("label", { for: "wizard-label" }, "Heading label (optional)"),
          h("input", {
            id: "wizard-label",
            type: "text",
            maxlength: LIMITS.label,
            value: w.label,
            placeholder: w.station?.name ?? stop.name,
            "data-focus-key": "wizard-label",
            oninput: (e: Event) => {
              wizard.label = (e.target as HTMLInputElement).value;
            },
            onchange: () => renderWizard(),
          }),
          h("p", { class: "muted" }, `The official name “${stop.name}” stays visible under your label.`),
        ),
        pending.length
          ? h(
              "div",
              { class: "preview" },
              h("h4", {}, "Preview"),
              h(
                "ul",
                { class: "preview-list" },
                ...pending.map(({ group, duplicate }) =>
                  h(
                    "li",
                    { class: duplicate ? "is-duplicate" : "" },
                    badge(metadata.route(group.routeId), group.routeId),
                    h(
                      "span",
                      {},
                      `to ${group.destinationFilter ?? directionLabel(metadata.route(group.routeId), group.directionId)} — under “${group.displayLabel || (w.station?.name ?? stop.name)}”`,
                      duplicate ? h("strong", {}, " · Already on the board, will be skipped") : null,
                    ),
                  ),
                ),
              ),
            )
          : null,
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn btn-primary",
              disabled: !toAdd.length,
              onclick: () => {
                const cfg = deps.getConfig();
                if (cfg.groups.length + toAdd.length > LIMITS.groups) {
                  wizard.error = `A board holds at most ${LIMITS.groups} rows.`;
                  renderWizard();
                  return;
                }
                const known = new Map(cfg.groups.filter((x) => x.walkMinutes !== undefined).map((x) => [x.stopId, x.walkMinutes]));
                const added = toAdd.map((p) =>
                  known.has(p.group.stopId) ? { ...p.group, walkMinutes: known.get(p.group.stopId) } : p.group,
                );
                commit({ ...cfg, groups: renumber([...cfg.groups, ...added]) });
                statusRegion.textContent = `Added ${toAdd.length} row${toAdd.length === 1 ? "" : "s"} to the board`;
                const unknown = added.filter((x) => x.walkMinutes === undefined).map((x) => x.stopId);
                if (cfg.origin && unknown.length) void runEstimate(unknown);
                resetWizard();
                searchInput.focus();
              },
            },
            toAdd.length ? `Add ${toAdd.length} row${toAdd.length === 1 ? "" : "s"}` : "Add rows",
          ),
          h("button", { type: "button", class: "btn btn-quiet", onclick: resetWizard }, "Cancel"),
        ),
      ),
    );
  }

  function resetWizard(): void {
    wizard = newWizard();
    renderWizard();
  }

  // ---------- Starting point and walking ----------
  let originResults: Place[] | null = null;
  let originStatus: string | null = null;
  let originBusy = false;
  let changingOrigin = false;

  const originInput = h("input", {
    id: "origin-search",
    type: "search",
    autocomplete: "off",
    placeholder: "e.g. 100 Main St, Cambridge — or 42.3736, -71.1189",
  });
  const originForm = h(
    "form",
    {
      class: "origin-form",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void findOrigin(originInput.value);
      },
    },
    h("label", { for: "origin-search" }, "Address, place, or coordinates"),
    h("div", { class: "inline-row" }, originInput, h("button", { type: "submit", class: "btn" }, "Find")),
  );

  async function findOrigin(text: string): Promise<void> {
    const q = text.trim();
    if (!q || originBusy) return;
    const coords = parseCoordinates(q);
    if (coords) {
      await setOrigin({ label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, detail: "", ...coords });
      return;
    }
    originBusy = true;
    originStatus = "Searching…";
    originResults = null;
    renderOrigin();
    try {
      originResults = await deps.osm.search(q);
      originStatus = originResults.length ? null : "No matching places. Try adding the town, or paste coordinates.";
    } catch (err) {
      originStatus = errorText(err);
    }
    originBusy = false;
    renderOrigin();
  }

  async function setOrigin(place: Place): Promise<void> {
    const label = (place.detail ? `${place.label}, ${place.detail.split(", ")[0]}` : place.label).slice(0, LIMITS.originLabel);
    commit({ ...deps.getConfig(), origin: { label, lat: place.lat, lon: place.lon } });
    changingOrigin = false;
    originResults = null;
    originInput.value = "";
    await runEstimate();
  }

  async function runEstimate(stopIds?: string[]): Promise<void> {
    const cfg = deps.getConfig();
    const origin = cfg.origin;
    const ids = stopIds ?? cfg.groups.map((g) => g.stopId);
    if (!origin || !ids.length) {
      renderOrigin();
      return;
    }
    originBusy = true;
    originStatus = "Estimating walking times…";
    renderOrigin();
    try {
      const est = await estimateWalks(origin, ids, metadata, deps.osm);
      const current = deps.getConfig();
      if (current.origin === origin) {
        commit(applyWalks(current, est.minutes));
        const name = (id: string) => metadata.stop(id)?.name ?? `stop ${id}`;
        const parts = [
          est.minutes.size ? `Set walk times for ${est.minutes.size} stop${est.minutes.size === 1 ? "" : "s"}.` : null,
          est.tooFar.length ? `Over ${LIMITS.walkMinutes} min, not set: ${est.tooFar.map(name).join(", ")}.` : null,
          est.failed.length ? `No walking route found: ${est.failed.map(name).join(", ")}.` : null,
        ];
        originStatus = parts.filter(Boolean).join(" ") || "Nothing to estimate.";
      }
    } catch (err) {
      originStatus = `Could not estimate walking times: ${err instanceof OsmError ? err.message : errorText(err)}`;
    }
    originBusy = false;
    renderOrigin();
  }

  function renderOrigin(): void {
    const cfg = deps.getConfig();
    const o = cfg.origin;
    const showSearch = !o || changingOrigin;
    replaceKeepingFocus(
      originBox,
      o
        ? h(
            "div",
            { class: "origin-current" },
            h("p", {}, h("strong", {}, "From: "), o.label),
            h("p", { class: "muted" }, `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`),
            h(
              "div",
              { class: "actions" },
              h(
                "button",
                { type: "button", class: "btn", disabled: originBusy || !cfg.groups.length, "data-focus-key": "re-estimate", onclick: () => void runEstimate() },
                "Re-estimate all walk times",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-quiet",
                  "data-focus-key": "change-origin",
                  onclick: () => {
                    changingOrigin = !changingOrigin;
                    renderOrigin();
                    if (changingOrigin) originInput.focus();
                  },
                },
                changingOrigin ? "Keep this starting point" : "Change starting point",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-quiet btn-danger",
                  onclick: () => {
                    if (!window.confirm("Remove the starting point and every walk time? Leave times will no longer show.")) return;
                    const next = deps.getConfig();
                    const { origin: _, ...rest } = next;
                    commit(applyWalks(rest, new Map(next.groups.map((g) => [g.stopId, undefined]))));
                    originStatus = "Starting point and walk times removed.";
                    renderOrigin();
                  },
                },
                "Remove",
              ),
            ),
          )
        : h("p", {}, "Set where you leave from to see when to leave for each departure. Walk times are estimated once and saved; you can edit any of them under Rows on the board."),
      showSearch ? originForm : null,
      showSearch && originResults?.length
        ? h(
            "ul",
            { class: "result-list" },
            ...originResults.map((p) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { type: "button", class: "result", onclick: () => void setOrigin(p) },
                  h("span", { class: "result-name" }, p.label),
                  h("span", { class: "result-meta" }, p.detail),
                ),
              ),
            ),
          )
        : null,
      originStatus ? h("p", { class: "muted", role: "status" }, originStatus) : null,
      h(
        "p",
        { class: "muted" },
        "Searching sends what you type, and estimating sends the starting point and stop locations, to OpenStreetMap community services. Nothing is sent while the board runs. Addresses and walking routes © ",
        h("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener" }, "OpenStreetMap contributors"),
        " (",
        h("a", { href: "https://www.openstreetmap.org/fixthemap", target: "_blank", rel: "noopener" }, "fix the map"),
        "); routing by ",
        h("a", { href: "https://routing.openstreetmap.de/about.html", target: "_blank", rel: "noopener" }, "FOSSGIS"),
        ".",
      ),
    );
  }

  // ---------- Display ----------
  function renderDisplay(): void {
    const wake = deps.wake;
    const statusText: Record<string, string> = {
      off: "",
      active: "Screen will stay awake while the board is open.",
      waiting: "Will keep the screen awake when the board is visible.",
      denied: "This browser declined to keep the screen awake.",
      unsupported: "This browser cannot keep the screen awake.",
    };
    const showFallback = wake.status === "unsupported" || wake.status === "denied";
    replaceKeepingFocus(
      displayBox,
      h(
        "label",
        { class: "choice" },
        h("input", {
          type: "checkbox",
          checked: wake.enabled,
          disabled: !wake.supported,
          "data-focus-key": "wake",
          onchange: (e: Event) => void wake.setEnabled((e.target as HTMLInputElement).checked),
        }),
        "Keep screen awake (this device only)",
      ),
      statusText[wake.status] ? h("p", { class: "muted", role: "status" }, statusText[wake.status]) : null,
      showFallback
        ? h(
            "p",
            { class: "muted" },
            "Instead, you can set Settings → Display & Brightness → Auto-Lock to Never on the iPad, where permitted, and keep it on power.",
          )
        : null,
    );
  }
  deps.wake.onChange = renderDisplay;

  // ---------- Backup ----------
  function download(): void {
    const blob = new Blob([exportConfig(deps.getConfig())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: "mbta-board.json" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function previewImport(text: string): Promise<void> {
    importError = null;
    importPreview = null;
    if (text.length > 200_000) {
      importError = "That file is too large to be a board configuration.";
      renderImport();
      return;
    }
    try {
      const preview = parseImport(text, deps.getConfig());
      importPreview = { ...preview, missingStops: [], missingRoutes: [], checking: true };
      renderImport();
      try {
        const missing = await metadata.ensure(
          preview.config.groups.map((g) => g.routeId),
          preview.config.groups.map((g) => g.stopId),
        );
        importPreview = { ...preview, ...missing, checking: false };
      } catch {
        importPreview = { ...preview, missingStops: [], missingRoutes: [], checking: false };
        importError = "Could not check the stops against current MBTA data.";
      }
    } catch (err) {
      importError = err instanceof ConfigError ? err.message : `Could not read that file: ${errorText(err)}`;
    }
    renderImport();
  }

  const pasteArea = h("textarea", { id: "import-text", rows: 4, spellcheck: "false", placeholder: "Paste exported JSON here" });

  function renderImport(): void {
    const p = importPreview;
    replaceKeepingFocus(
      importBox,
      importError ? h("p", { class: "notice notice-warn", role: "alert" }, importError) : h("span"),
      p
        ? h(
            "div",
            { class: "preview" },
            h("h4", {}, `Import preview: “${p.config.title}”, ${p.config.groups.length} row${p.config.groups.length === 1 ? "" : "s"}`),
            h(
              "ul",
              { class: "preview-list" },
              ...p.config.groups.map((g) =>
                h(
                  "li",
                  { class: p.duplicates.includes(g) ? "is-duplicate" : "" },
                  badge(metadata.route(g.routeId), g.routeId),
                  h(
                    "span",
                    {},
                    `to ${g.destinationFilter ?? directionLabel(metadata.route(g.routeId), g.directionId)} at ${metadata.stop(g.stopId)?.name ?? "stop"} ${g.stopId}`,
                    p.duplicates.includes(g) ? h("strong", {}, " · already on the board") : null,
                    p.missingStops.includes(g.stopId) ? h("strong", {}, " · stop not found in current MBTA data") : null,
                    p.missingRoutes.includes(g.routeId) ? h("strong", {}, " · route not found in current MBTA data") : null,
                  ),
                ),
              ),
            ),
            p.checking ? h("p", { class: "muted", role: "status" }, "Checking stops against MBTA data…") : null,
            h(
              "div",
              { class: "actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-primary",
                  onclick: () => {
                    commit(p.config);
                    importPreview = null;
                    renderImport();
                    statusRegion.textContent = "Board replaced from import";
                  },
                },
                "Replace board",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  disabled: p.duplicates.length === p.config.groups.length,
                  onclick: () => {
                    try {
                      commit(mergeConfigs(deps.getConfig(), p.config));
                      importPreview = null;
                      statusRegion.textContent = "Imported rows added to the board";
                    } catch (err) {
                      importError = errorText(err);
                    }
                    renderImport();
                  },
                },
                `Add ${p.config.groups.length - p.duplicates.length} new row${p.config.groups.length - p.duplicates.length === 1 ? "" : "s"}`,
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-quiet",
                  onclick: () => {
                    importPreview = null;
                    renderImport();
                  },
                },
                "Cancel",
              ),
            ),
          )
        : h("span"),
    );
  }

  // ---------- Layout ----------
  root.replaceChildren(
    h(
      "header",
      { class: "masthead" },
      h("h1", { class: "masthead-title" }, "Settings"),
      h("button", { type: "button", class: "btn btn-band", onclick: deps.close }, "Done"),
    ),
    h(
      "main",
      { class: "settings", id: "main" },
      statusRegion,
      h("section", { class: "panel", "aria-labelledby": "s-board" }, h("h2", { id: "s-board" }, "Board"), boardBox),
      h("section", { class: "panel", "aria-labelledby": "s-rows" }, h("h2", { id: "s-rows" }, "Rows on the board"), groupsBox),
      h(
        "section",
        { class: "panel", "aria-labelledby": "s-add" },
        h("h2", { id: "s-add" }, "Add a stop"),
        h(
          "div",
          { class: "search-controls" },
          h(
            "div",
            { class: "field" },
            h("label", { for: "stop-search" }, "Stop name, street or stop ID"),
            searchInput,
            h("p", { class: "muted", id: "stop-search-hint" }, "Searches a stop list saved on this device; typing doesn’t send requests."),
          ),
          h("div", { class: "field" }, h("label", { for: "route-filter" }, "Only stops on route"), routeSelect),
        ),
        resultsBox,
        wizardBox,
      ),
      h("section", { class: "panel", "aria-labelledby": "s-origin" }, h("h2", { id: "s-origin" }, "Starting point and walking"), originBox),
      h("section", { class: "panel", "aria-labelledby": "s-display" }, h("h2", { id: "s-display" }, "This device"), displayBox),
      h(
        "section",
        { class: "panel", "aria-labelledby": "s-backup" },
        h("h2", { id: "s-backup" }, "Backup and import"),
        h(
          "p",
          { class: "muted" },
          "Settings live only in this browser. Clearing website data removes them, and devices don’t sync. Export a backup to move the board to another device. The file shows which stops you use, so share it carefully.",
        ),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "btn", onclick: download }, "Export backup"),
          h(
            "label",
            { class: "btn file-btn" },
            "Import file…",
            h("input", {
              type: "file",
              accept: ".json,application/json",
              class: "visually-hidden",
              onchange: async (e: Event) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                input.value = "";
                if (file) await previewImport(await file.text());
              },
            }),
          ),
        ),
        h("div", { class: "field" }, h("label", { for: "import-text" }, "Or paste a backup"), pasteArea),
        h("button", { type: "button", class: "btn", onclick: () => void previewImport(pasteArea.value) }, "Preview pasted backup"),
        importBox,
      ),
      h(
        "section",
        { class: "panel", "aria-labelledby": "s-about" },
        h("h2", { id: "s-about" }, "About"),
        h("p", {}, "Unofficial personal departure board • Data from MBTA"),
        h(
          "p",
          { class: "muted" },
          "Times refresh about every 30 seconds while the board is visible. “Est.” marks schedule-based estimates; “Approx.” marks buses that appear stalled or delayed; “Last” marks old times kept while updates are failing.",
        ),
        h(
          "p",
          { class: "muted" },
          "On iPad: open this page in Safari, choose Share → Add to Home Screen, turn on “Open as Web App” if shown, then launch it from the Home Screen.",
        ),
      ),
    ),
  );
  renderBoardBox();
  renderGroups();
  renderDisplay();
  renderOrigin();
  renderImport();
  void metadata
    .ensure(
      deps.getConfig().groups.map((g) => g.routeId),
      deps.getConfig().groups.map((g) => g.stopId),
    )
    .then(renderGroups, () => undefined);
}
