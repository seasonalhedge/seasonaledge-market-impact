# Going live — GitHub → Railway → seasonaledge.ai

```
TradingView alert
      ↓  HTTPS POST
impact.seasonaledge.ai/webhook/mags-lre     ← Railway, auto-deploys from GitHub
      ↓
normalize → SQLite (Railway volume)
      ↓
impact.seasonaledge.ai                       ← public dashboard, live via SSE
```

Six steps. Budget about 20 minutes, most of it waiting on DNS.

---

## 1. Pick your webhook token

Generate one now and keep it somewhere safe — you'll paste it twice (Railway, then Pine).

```bash
openssl rand -hex 24
```

This is the only thing standing between the public internet and your dashboard state.
Don't reuse a password, and don't commit it.

---

## 2. Push to GitHub

From this folder:

```bash
git init
git add .
git commit -m "SeasonalEDGE Market Impact — MAGS LRE dashboard"
git branch -M main
git remote add origin https://github.com/seasonalhedge/seasonaledge-market-impact.git
git push -u origin main
```

Create the repo on GitHub first (empty — no README, no .gitignore, since this folder
has its own). Private is fine; Railway can read private repos once you authorize it.

`.gitignore` already excludes `data/`, `preview.html` and any `.env`, so no runtime
state or secrets travel with the code.

---

## 3. Create the Railway service

1. **railway.app → New Project → Deploy from GitHub repo** → pick the repo you just pushed.
2. Railway detects Node via Nixpacks and reads `railway.json`. No build config needed —
   there are zero dependencies, so the build is just a Node runtime.
3. **Variables** tab → add:

   | Variable | Value |
   | --- | --- |
   | `WEBHOOK_TOKEN` | the token from step 1 |
   | `DATA_DIR` | `/data` |

   Leave `PORT` alone — Railway injects it and the server reads it.

4. **Settings → Volumes → New Volume**, mount path `/data`.

   Skip this and every redeploy wipes your event history. The volume is what makes the
   dashboard survive a restart.

5. **Settings → Networking → Generate Domain** to get a `*.up.railway.app` URL for testing.

Confirm it came up:

```bash
curl https://YOUR-APP.up.railway.app/api/mags-lre/health
```

You want `"store":"sqlite"` and `"node":"v22.x"`. If you see `"store":"json"`, Railway
built on an older Node — check that `engines.node` in `package.json` survived the push.
The JSON store works fine, it's just not what we're aiming for.

---

## 4. Point seasonaledge.ai at it

**In Railway:** Settings → Networking → Custom Domain → enter `impact.seasonaledge.ai`.
Railway shows you a CNAME target that looks like `abc123.up.railway.app`.

**In GoDaddy:** My Products → DNS for `seasonaledge.ai` → Add record:

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Name | `impact` |
| Value | the target Railway gave you |
| TTL | 600 seconds |

One caveat specific to GoDaddy: if you're using their Website Builder, the root domain
is locked to their hosting — but subdomains are yours. That's why this goes on
`impact.` rather than the apex. Don't touch the existing `@` or `www` records or you'll
take the marketing site down.

DNS usually propagates in 10–30 minutes. Railway issues the TLS certificate
automatically once it resolves. Check with:

```bash
dig impact.seasonaledge.ai CNAME +short
curl -I https://impact.seasonaledge.ai
```

---

## 5. Point TradingView at it

In your alert:

- **Webhook URL:** `https://impact.seasonaledge.ai/webhook/mags-lre`
- **Message:** the JSON from `pine/DASHBOARD_SNAPSHOT.pine`, with your token in the
  `token` field.

TradingView can only send a body — no custom headers — which is why the receiver
accepts an in-body `token`. The server strips it before anything touches disk.

Minimum viable message to prove the pipe works:

```json
{
  "event": "TRANSMISSION_CONCENTRATED",
  "token": "YOUR_TOKEN",
  "ticker": "MAG7",
  "spy_return": {{close}},
  "mag7_contribution_points": 0.62,
  "mag7_impact_share": 93.3,
  "transmission": "CONCENTRATED",
  "score": 93.3
}
```

Set the alert to **Once per bar close** so you get one clean event per bar.

---

## 6. Verify end to end

Fire a test alert by hand before trusting TradingView:

```bash
curl -X POST https://impact.seasonaledge.ai/webhook/mags-lre \
  -H 'Content-Type: application/json' \
  -d '{"event":"TRANSMISSION_CONCENTRATED","token":"YOUR_TOKEN","ticker":"MAG7",
       "spy_return":0.58,"mag7_contribution_points":0.62,"mag7_impact_share":93.3,
       "direction":"DRIVING","transmission":"CONCENTRATED","score":93.3}'
```

Expect `202` and `{"ok":true,...}`. Open `https://impact.seasonaledge.ai` — the figures
should roll into place within a second, with the footer LED showing **LIVE STREAM**.

Then seed the full seven-stock view:

```bash
BASE_URL=https://impact.seasonaledge.ai WEBHOOK_TOKEN=YOUR_TOKEN npm run seed
```

---

## Operating notes

**Redeploys are automatic.** Push to `main` and Railway rebuilds. The volume persists,
so event history survives.

**Cost.** Railway's trial credit covers this comfortably — it's a zero-dependency Node
process holding a small SQLite file. Watch the usage graph for the first week; if the
service is idle most of the day, consider Railway's serverless setting, though note that
cold starts will briefly drop SSE connections (the dashboard falls back to polling on
its own, so nothing breaks).

**The dashboard is public.** Anyone with the URL sees it, by design. Only the webhook is
authenticated. If you later want it unlisted, add a `noindex` meta tag to
`public/index.html`; if you want it gated, that's a real auth layer and worth doing
properly rather than with basic auth.

**Failed-token throttle.** Twenty rejected attempts from one address in ten minutes gets
that address a `429` for the rest of the window. Valid alerts are never throttled, no
matter how fast they arrive — there's a test covering exactly that, because a rate
limiter that drops real market data is worse than no rate limiter.

**Until `DASHBOARD_SNAPSHOT` fires** from Pine, the rotation table fills in one ticker at
a time from ordinary events and shows `n of 7 constituents known`. That's expected. The
snapshot payload is what completes it.

**If the dashboard shows STALE**, the page is fine and the data isn't — no accepted
webhook within the expected trading window. Check `/api/mags-lre/health` for
`last_update`, then check whether TradingView actually fired.
