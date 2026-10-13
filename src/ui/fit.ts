/**
 * Fits the board to the screen without scrolling: first tighter spacing, then a uniform zoom,
 * trying one and two columns and keeping whichever needs the least shrinking.
 */
export interface FitResult {
  compact: boolean;
  columns: "auto" | 1 | 2;
  zoom: number;
}

const MIN_ZOOM = 0.45;

/**
 * `content` is zoomed; `frame` is its unzoomed parent. Measuring the frame's bottom edge gives
 * viewport pixels in every engine, whatever the page's overflow setting and however the engine
 * reports sizes inside a zoomed element (WebKit and Chromium differ there).
 */
export function fitToScreen(frame: HTMLElement, content: HTMLElement): FitResult {
  const root = document.documentElement;
  const fits = () => frame.getBoundingClientRect().bottom <= window.innerHeight + 0.5;
  const apply = (r: FitResult) => {
    root.classList.toggle("fit-compact", r.compact);
    content.dataset.columns = String(r.columns);
    content.style.setProperty("zoom", String(r.zoom));
  };

  root.classList.add("no-scroll");
  const natural: FitResult = { compact: false, columns: "auto", zoom: 1 };
  apply(natural);
  if (fits()) return natural;

  const candidates: FitResult["columns"][] = ["auto", 1, 2];
  let best: FitResult | null = null;
  for (const columns of candidates) {
    const r: FitResult = { compact: true, columns, zoom: 1 };
    apply(r);
    if (fits()) return r;
    let lo = MIN_ZOOM;
    let hi = 1;
    apply({ ...r, zoom: lo });
    if (!fits()) {
      best ??= { ...r, zoom: lo };
      continue;
    }
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      apply({ ...r, zoom: mid });
      if (fits()) lo = mid;
      else hi = mid;
    }
    if (!best || lo > best.zoom) best = { ...r, zoom: lo };
  }
  const chosen = best!;
  apply(chosen);
  while (!fits() && chosen.zoom > MIN_ZOOM) {
    chosen.zoom = Math.max(MIN_ZOOM, chosen.zoom - 0.01);
    apply(chosen);
  }
  return chosen;
}

export function clearFit(content: HTMLElement): void {
  document.documentElement.classList.remove("fit-compact", "no-scroll");
  delete content.dataset.columns;
  content.style.removeProperty("zoom");
}
