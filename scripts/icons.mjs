// Regenerates PNG icons from public/icons/icon.svg. Requires rsvg-convert (librsvg).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../public/icons/", import.meta.url).pathname;
const svg = `${dir}icon.svg`;
const render = (src, size, out) => execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), src, "-o", `${dir}${out}`]);

render(svg, 192, "icon-192.png");
render(svg, 512, "icon-512.png");
render(svg, 180, "apple-touch-icon.png");

// Maskable: shrink the mark into the 80% safe zone.
const maskable = readFileSync(svg, "utf8").replace(
  /<svg([^>]*)>([\s\S]*)<\/svg>/,
  (_, attrs, body) => {
    const [bg, ...rest] = body.trim().split("\n");
    return `<svg${attrs}>${bg}<g transform="translate(51.2 51.2) scale(0.8)">${rest.join("\n")}</g></svg>`;
  },
);
const tmp = `${dir}.maskable.svg`;
writeFileSync(tmp, maskable);
render(tmp, 512, "icon-maskable-512.png");
execFileSync("rm", [tmp]);
