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

Data status: `LIVE` within 10 minutes of the last accepted webhook during the regular session,
`DELAYED` within 45, `STALE` beyond that, `CLOSED` outside 09:30–16:00 America/New_York.

## Files

```
server.js                    HTTP surface, auth, SSE, static host
lib/normalize.js             validation, aliasing, attribution math, state derivation
lib/store.js                 SQLite backend with atomic-JSON fallback
lib/constants.js             universe, thresholds, session hours
public/index.html            semantic markup, five tabbed views
public/styles.css            all design tokens in :root — rebrand by editing that block only
public/app.js                rendering + digit roll; textContent only, innerHTML never used with data
public/engine.js             canvas capital-flow engine, breath pulse, spotlight, parallax
pine/DASHBOARD_SNAPSHOT.pine Pine v6 snapshot emitter
test/run.js                  37 checks
test/payloads.js             sample snapshot + event payloads
test/build-preview.js        single-file static preview builder
```

## Design system

Lifted from the **SeasonalEDGE Command Core** dashboard
(`seasonalhedge.github.io/seasonaledge-data`), not re-invented. Token names match the
Command Core so the two surfaces stay in sync — change a value there and the same name
carries here.

| Command Core token | Value | Role |
| --- | --- | --- |
| `--paper` / `-2` / `-3` | `#04060a` `#080b11` `#0c1018` | field, panel, panel base |
| `--ink` / `-2` / `-3` | `#ecf1f7` `#99a8bc` `#4f5d74` | primary, secondary, label ink |
| `--rule` / `-2` | `rgb(153 168 188 / .13)` / `.24` | hairlines, panel borders |
| `--on` | `#4dffb8` mint | positive |
| `--neu` | `#ffb534` amber | neutral |
| `--off` | `#ff4d7a` rose | negative |
| `--info` | `#6bb7ff` blue | informational |
| `--spx` | `#ff8a4c` orange | SPX |

Type is the Command Core trio: **Fraunces** italic for categorical readings (transmission
state, breadth count) — the signature move from the regime orb and signal grid; **Space
Grotesk** for prose; **JetBrains Mono** for every figure, at the Command Core's label
tracking of `.22em` uppercase.

Panels use the Command Core node recipe: `linear-gradient(180deg, --paper-2, --paper-3)`,
`1px solid --rule-2`, 13px radius, `backdrop-filter: blur(14px) saturate(1.1)`,
`0 18px 50px rgb(0 0 0 / .5)`. The aurora blob field, 60px substrate grid, CRT scanline
overlay and blue/mint cursor spotlight are carried over verbatim.

**Semantic mapping.** MAG7 is the subject of this page, so it takes `--info` blue; the rest
of the index takes the Command Core's own `--spx` orange. That reads correctly in the
attribution bar without inventing a colour: blue is the thing being measured, orange is the
index it sits inside.

| Dashboard state | Token |
| --- | --- |
| LEADER · DRIVING · BROAD | `--on` |
| ACCUMULATION · HEALTHY | `--on` mixed toward `--ink-2` |
| NEUTRAL | `--ink-2` |
| DISTRIBUTION · CONCENTRATED | `--neu` |
| FRAGILE | `--spx` |
| FUNDING · OFFSETTING · BROKEN | `--off` |

All tokens live in the `:root` block of `styles.css`. Nothing below that block hard-codes a
value, so a rebrand is one edit.

`engine.js` runs four systems on a single rAF loop:

| System | What it shows |
| --- | --- |
| Capital | `--info` blue particles enter from the market edge, route through the substrate and **pool at the nodes currently holding healthy leadership**. Flow volume tracks the MAG7 impact share; a dimmer `--spx` orange slice never pools — that's the residual. With zero healthy leaders, capital pools at the core instead: the index has nowhere to route. |
| Breath | A scoring sweep from the hero core, faster as concentration rises, plus halo respiration at each active node. Fires immediately whenever new data lands. |
| Spotlight | Pointer position published as CSS variables; the stylesheet reveals the substrate grid and moves a specular highlight across whichever glass panel is under the cursor. |
| Parallax | `[data-depth]` elements translate and rotate against pointer travel, layered front to back. |

Performance and restraint: particle budget scales with viewport area and flow intensity
(28–190), device pixel ratio caps at 2, glow is a cached sprite drawn with `lighter` rather than
per-particle `shadowBlur`, the loop stops entirely on a hidden tab, and `prefers-reduced-motion`
disables the canvas and every animation. The canvas is `aria-hidden` and carries no information
that isn't already in the DOM.

**Numbers roll only when data changes.** Each digit is a column that turns a full revolution into
its new value, staggered left to right, with a brief blue print-flash. Nothing is simulated
between updates — the only thing that ticks on its own is the session clock, because time
genuinely passes. The rolling columns contain every digit 0–9, so they are `aria-hidden` and the
real value is exposed to screen readers separately.

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
