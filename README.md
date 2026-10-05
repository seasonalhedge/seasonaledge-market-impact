# SeasonalEDGE Market Impact

Public-facing SPX leadership transmission dashboard, fed by the MAGS Leadership Rotation Engine.

```
TradingView alert
      ↓
POST /webhook/mags-lre        (token-authenticated, validated)
      ↓
normalize + store             (SQLite, JSON fallback)
      ↓
GET /api/mags-lre/latest      (latest dashboard state)
GET /api/mags-lre/events      (append-only history)
GET /api/mags-lre/stream      (SSE push)
      ↓
public/ dashboard
```

Zero runtime dependencies — `node:http` plus the built-in `node:sqlite`.

## Run

```bash
WEBHOOK_TOKEN=pick-a-long-secret npm start     # http://localhost:8787
WEBHOOK_TOKEN=pick-a-long-secret npm run seed  # push the sample snapshot + events
npm test                                       # 37 checks: math, parsing, storage, HTTP, auth
node test/build-preview.js                     # preview.html — static single-file demo
```

| Env var | Default | Notes |
| --- | --- | --- |
| `WEBHOOK_TOKEN` | *(none)* | Required. Without it every webhook request is rejected. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `./data` | SQLite file or JSON store lives here. |
| `STORE` | *(auto)* | Set to `json` to force the JSON backend. |

## Endpoints

**`POST /webhook/mags-lre`** — accepts TradingView JSON. Token via `X-Webhook-Token`,
`Authorization: Bearer …`, `?token=`, or a `token` / `secret` field in the body (TradingView's
alert box can only send a body, so the in-body form is supported; the secret is stripped before
anything is persisted). Returns `202` on accept, `401` bad token, `400` malformed JSON,
`422` structurally invalid, `413` oversized.

**`GET /api/mags-lre/latest`** — the normalized response documented below.

**`GET /api/mags-lre/events?limit=25`** — reverse chronological, limit clamped to 1–500.

**`GET /api/mags-lre/stream`** — SSE. The page uses it when available and falls back to polling
`/latest` every 30 s automatically.

**`GET /api/mags-lre/health`** — store backend, last update time, connected SSE clients.

## Payload types

**Ordinary events** describe one ticker or the basket and drive the event history. They refresh
whatever fields they happen to carry; the last known row for each ticker is preserved in storage,
so the seven-stock table fills in progressively.

**`DASHBOARD_SNAPSHOT`** carries all seven constituents plus complete basket state and is
authoritative — it replaces the basket blocks wholesale and is rejected if fewer than seven
constituent rows are present. `pine/DASHBOARD_SNAPSHOT.pine` contains the Pine v6 emitter: JSON
helpers, the row assembly, and the `alert(…, alert.freq_once_per_bar_close)` call. Point the
placeholder identifiers (`score_MSFT`, `spxHealth`, `mag7ContribPoints`, …) at the engine's live
series and it is ready to fire.

Field names are aliased on the way in — `mag7_contribution` / `mag7_contrib` / `contribution_points`
all land on the same field, `"+42.5"` and `"0.58%"` coerce to numbers, and `DISTR` / `Distribution`
normalize to `DIST` — so the receiver tolerates variation in how the alerts are written.

## Calculations

```
residual_contribution_points = spy_return − mag7_contribution_points
gross_attribution            = |mag7_contribution_points| + |residual_contribution_points|
mag7_impact_share            = |mag7_contribution_points| / gross_attribution × 100
```

Direction is `DRIVING` when the contribution and the SPY return share a sign, `OFFSETTING` when
they oppose, `FLAT` when the contribution is under 0.01 points, and `N/A` when gross attribution
falls below the 0.02-point reliability floor. The engine's own `mag7_impact_share` is used when
present; otherwise it is derived. **All arithmetic runs on raw values — rounding happens once, at
the presentation boundary in `buildDashboard`.** A regression test asserts that computing from
rounded display values produces a different answer, so the shortcut can't creep back in.

Transmission and breadth states are taken from the webhook when supplied and derived otherwise:

| State | Derivation when not supplied |
| --- | --- |
| `BROKEN` | SPX health < 30, or divergence risk ≥ 60 |
| `FRAGILE` | direction `OFFSETTING`, or SPX health < 50, or structural risk ≥ 70 |
| `CONCENTRATED` | impact share ≥ 60% with ≤ 3 healthy leaders |
| `BROAD` | ≥ 5 healthy leaders with positive diffusion and velocity |
| `HEALTHY` | otherwise |

Breadth: 7 `EXPANSIVE` · 5–6 `STRONG` · 3–4 `MODERATE` · 2 `WEAK` · 0–1 `CRITICAL`.
`LEADER` and `ACCUM` count as positive leadership.

Data status for the daily engine: `CONFIRMED` while the latest reading reflects the most recent
16:00 ET close, `STALE` once a close passes without one. Intraday timeframes use `LIVE` (10 min),
`DELAYED` (45 min), `STALE`, and `CLOSED` outside 09:30–16:00 America/New_York.

## Files

```
server.js                    HTTP surface, auth, SSE, static host
lib/normalize.js             validation, aliasing, attribution math, state derivation
lib/store.js                 SQLite backend with atomic-JSON fallback
lib/constants.js             universe, thresholds, session hours
public/index.html            semantic markup, five tabbed views (Impact, Internals, Constituents, Timeline, Data)
public/styles.css            all design tokens in :root — rebrand by editing that block only
public/app.js                rendering + digit roll; textContent only, innerHTML never used with data
public/engine.js             canvas capital-flow engine, breath pulse, spotlight, parallax
pine/DASHBOARD_SNAPSHOT.pine Pine v6 snapshot emitter
test/run.js                  37 checks
test/payloads.js             sample snapshot + event payloads
test/build-preview.js        single-file static preview builder
```

## Design system (v2)

Built to the **SeasonalEDGE Portfolio Solutions v11 HTML & Brand Guide**. Every colour lives in
the `:root` block of `public/styles.css`; nothing below it hard-codes one.

| Token | Value | Role |
| --- | --- | --- |
| `--ob` / `--panel` / `--panel-2` | `#0B0B0C` `#121214` `#171719` | ground, panels |
| `--paper` / `--graphite` | `#F6F4EF` `#77787C` | primary and secondary ink |
| `--brass` | `#B2894A` | The Turn, active tab, focus ring — never a fill or background |
| `--spring` `--summer` `--fall` `--winter` | `#4ADE80` `#EAB308` `#F97316` `#60A5FA` | state encoding |

Type is **Archivo** (200 for the verdict and readouts, 300–500 for structure) and **IBM Plex Mono**
for every figure and label. MAG7 is the subject of the page and takes winter blue; the other 493
take plain paper, because they are the context, not a warning. Constituent states use the same
colours as the TradingView panel: Leader green, Accumulation blue, Distribution orange, Funding red.

**Views.** *Impact* — the verdict sentence, an attribution ring built on The Turn's geometry,
headline-versus-internals confirmation, the seven as a hairline tile grid with an entering/leaving
flow summary, the transmission scale, and a three-part plain-English reading. *Internals* — six
0–100 instruments with the engine's own decision bands shaded, leadership dynamics, tripwires and
the 493 confirmation detail. *Constituents* — sortable table with inline score and delta bars.
*Timeline* — every engine event in client language, grouped by session. *Data* — the normalized
JSON and the read-only API.

**Partial data is a first-class state.** Ordinary engine alerts carry the MAG7 impact share and
contribution but not the SPY return. The page leads with the engine's share and says plainly which
figures the latest alert did not carry, rather than blanking the headline until a snapshot lands.
With no data at all it says it is awaiting the first reading and when the next one is due.

`engine.js` runs four systems on one rAF loop — capital particles that pool at healthy leaders and
the ring's MAG7 arc, a breathing scoring pulse, a cursor spotlight, and depth parallax. It reads its
colours from the stylesheet at boot, stops on hidden tabs, and switches off entirely under
`prefers-reduced-motion`. Numbers roll only when data changes; only the clocks tick on their own.

**Embedding.** `?embed=1` drops the brand block for use inside seasonaledge.ai. When framed, the
page posts `{ type: 'se-impact-height' }` with its content height to the seasonaledge.ai origins
only, so the host iframe can size itself.

## Security notes

- Webhook token compared with `crypto.timingSafeEqual` over SHA-256 digests, so neither value nor
  length leaks through timing.
- Malformed JSON is authenticated before the parse failure is reported, so the endpoint doesn't
  confirm its own existence to unauthenticated probes.
- 256 KB body cap; static serving is guarded against path traversal.
- Every rendered value goes through `textContent` or `dataset`. A payload containing
  `<img src=x onerror=alert(1)>` renders as literal text — verified by test.
- The shared secret is deleted from the payload before storage; a test greps the data directory to
  confirm it never lands on disk.
- Event history is append-only and survives snapshot replacement (also tested).

## Not investment advice

Attribution is proxy-based (SPY as the SPX return proxy) and is presented for informational
purposes only.
