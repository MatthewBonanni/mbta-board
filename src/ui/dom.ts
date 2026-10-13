type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Builds elements with text nodes only; never assigns innerHTML, so API and imported text can't inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k === "style") {
      el.setAttribute("style", String(v));
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Replaces children while keeping keyboard focus on the element with the same data-focus-key. */
export function replaceKeepingFocus(container: HTMLElement, ...children: Child[]): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active && container.contains(active) ? active.dataset.focusKey : undefined;
  container.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  if (key) container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

export function announce(region: HTMLElement, message: string): void {
  region.textContent = "";
  window.setTimeout(() => (region.textContent = message), 50);
}
