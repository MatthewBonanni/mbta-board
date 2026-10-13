# MBTA Departure Board

**Live:** https://matthewbonanni.github.io/mbta-board/

A configurable personal departure board for MBTA stops, made for an iPad on the
wall and any browser. It runs entirely in the browser against the public
[MBTA V3 API](https://api-v3.mbta.com/): no account, API key, or backend.

Unofficial personal departure board • Data from MBTA.

## Use it

1. Open the site and choose **Set up your board**. Nothing is preset.
2. Search for a stop by name, street, or stop ID (optionally only stops on one route).
3. For a station, pick a platform or the whole station.
4. Tick the routes and directions you want. Where a direction has branches
   (e.g. Red Line southbound), keep them together or split one row per destination.
5. Optionally give the stop a heading label, check the preview, and add the rows.

Rows can be relabelled, reordered (↑/↓), or removed in Settings. Adjacent rows
with the same label share a heading.

### Leave times

Under **Starting point and walking**, search an address or place (press Find)
or paste coordinates like `42.3736, -71.1189`. The app estimates the walk to
every stop once, using free OpenStreetMap services, and saves the minutes. Edit
any stop's walk time under **Edit** in the row list; re-estimating overwrites
them. Each row then shows a separate line such as `Leave in 6 min — for the
1:42 PM · 5 min walk`, aimed at the first departure you can still reach.
Schedule estimates and stale data show `Leave by <clock time>` instead of a
countdown.

Searching sends what you type, and estimating sends the starting point and stop
locations, to [Nominatim](https://nominatim.org/) and the
[FOSSGIS routing server](https://routing.openstreetmap.de/about.html). Nothing
is sent while the board runs. The starting point is saved in the backup file.
Map data © OpenStreetMap contributors.

### Reading the board

| Shows | Meaning |
| --- | --- |
| `4 min`, `Now` | Realtime prediction |
| `Approx. 4 min` | Realtime, but the bus appears stalled or delayed |
| `Est. 4:32 PM` | Schedule-based estimate (no vehicle assigned yet) |
| `Last known 4:32 PM` | Updates have failed; old times kept as clock times, not countdowns |
| `No predictions right now` | The MBTA answered with nothing usable; not proof that service ended |
| `No service — see alert` | Only when an active alert for that service says so |
| `Leave in 6 min` (under a row) | When to leave the starting point; the departure it targets is named beside it |

The header shows **Live** with the update age, or **Not live** with the last
successful update and the reason. Live ends immediately on a failed refresh and
60 seconds after the last success.

### iPad

Open the site in Safari → Share → **Add to Home Screen**, turn on **Open as Web
App** if shown, then launch it from the Home Screen. In Settings, **Keep screen
awake** uses the Screen Wake Lock API where the browser allows it. Otherwise set
Settings → Display & Brightness → Auto-Lock to Never (where permitted) and keep
the iPad on power. iPadOS may pause the board in the background; it refreshes
when you return.

### Backup and moving devices

Settings live only in this browser's storage: clearing website data removes
them and devices don't sync. Use **Export backup** in Settings and **Import** on
the other device (choose Replace or Add new rows). A backup reveals which stops
you use, so share it carefully. Imports are validated and previewed first;
duplicates and stops missing from current MBTA data are reported.

### Troubleshooting

- **Not live · Could not reach the MBTA server**: network or MBTA outage; the
  board retries with backoff and returns to Live after the next success.
- **Request limit reached**: the keyless MBTA API allows about 20 requests per
  minute *per IP address*, shared by every screen on your network. One board
  uses about 2–3 per minute; the app keeps itself under 12.
- **Settings disappeared**: website data was cleared, or a private window was
  used. Import your backup.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/mbta-board/
npm test
npm run build      # static site in dist/
npm run preview    # serves dist/ under /mbta-board/
```

`npm run dev` also serves a development-only demo with fictional data at
`/mbta-board/?demo` (and `?demo=stale`). It is excluded from production builds.

### Layout

| Module | Role |
| --- | --- |
| `src/config.ts` | Versioned board configuration: validation, migration, storage, import/merge |
| `src/api.ts` | Shared request queue: one request in flight, rolling budget, backoff, pagination |
| `src/metadata.ts` | Routes, stops, stop search index, services at a stop (cached) |
| `src/normalize.ts` | Predictions → departures: exact tuple filter, dedupe, uncertainty semantics |
| `src/alerts.ts` | Alert parsing and matching to configured services |
| `src/osm.ts`, `src/walking.ts` | Address search and walking times (OpenStreetMap, throttled to 1 request/s, user-triggered only) |
| `src/controller.ts` | Polling: batched predictions every 30 s, alerts every 90 s, visibility pause |
| `src/view.ts` | Pure state → view model (freshness, labels, messages) |
| `src/ui/` | Board and settings DOM rendering (text nodes only, never `innerHTML`) |

Deployment: pushing to `main` runs `.github/workflows/deploy.yml`, which tests,
builds, and publishes `dist/` to GitHub Pages.
