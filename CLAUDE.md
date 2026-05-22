# CLAUDE.md — internal guide for this repo

Custom front end for **imapsync**'s CGI. Static files only (no build, no
framework). End-user docs and server setup live in `README.md`; this file is the
working knowledge for editing the code.

## Stack & layout

- Vanilla HTML/CSS/jQuery. Loads Tailwind, jQuery 3.6, Font Awesome from CDNs.
- `imapsync_form_extra.html` — the wizard (the page customers load).
- `imapsync_form.css` — all styling ("Noxity Design System": CSS variables in
  `:root`, dark theme under `[data-theme="dark"]`).
- `imapsync_form.js` — everything: it's one big `$(document).ready` closure.
- `noxity-ips.js` — runtime config: `window.NOXITY_DEST_IPS` (allowlist) +
  `window.NOXITY_SUPPORT`. Loaded before the main JS.
- `credits.html` — standalone page, its own tiny vanilla theme script (no jQuery).

Origin of the code: a fork of imapsync's stock `imapsync_form*` files, heavily
rewritten. The CSS/JS keep the stock filenames, so the custom UI and the stock
UI **cannot** live in the same directory (see README "/bypass/").

## Request flow

The form `POST`s to `/cgi-bin/imapsync` (imapsync in CGI mode). The XHR response
streams imapsync's run log; `imapsync_form.js` polls it and parses the
`ETA: <date> <secs> s <left>/<total> msgs left` line into % done, time left, and
"N of M". `handleRun` updates on `readyState` 3 (live) and 4 (final); a 6 s
interval is the fallback.

## Key behaviours (and where)

- **Provider detection** — `detectProvider()`. `CONSUMER_DOMAINS` is an instant
  map (gmail.com, outlook.com, …); custom domains get a DoH **MX** lookup matched
  against `MX_PROVIDERS` (catches Google Workspace / M365). Runs on **source
  only** (`#next1`). Auto-fills `#host1` (green `.prefilled` cue) and shows the
  app-password modal (`PROVIDER_INFO`).
- **Destination allowlist** — `isAllowedDestination()` resolves `#host2` via DoH
  and checks `NOXITY_DEST_IPS`. **Client-side only — not a real control.** A
  direct POST to the CGI bypasses it. If asked to "enforce" it, that needs a
  server-side wrapper, not JS.
- **Host fields reject IPs** — `isIpAddress()`/`isHostname()` in `#next2`'s
  `checkHost`. Reason: IP = no TLS verification. So the destination must be a
  *hostname* that resolves to an allowlisted IP.
- **Wizard nav** — `navTo()` + a `navStack` array; each step has an inline
  `.btn-back`. No History API (deliberate — it's an in-page show/hide wizard).
- **Validation** — custom JS (`isEmail`, `requireFields`, `setFieldValidity`),
  inline `role="alert"` errors. The form is `novalidate` and Enter is wired
  manually (`advanceVisibleStep`) because there is **no submit button**.
- **Migration view** — `#consoleLogs`: progress header, indeterminate bar until
  the first ETA, collapsible **folder-tabbed** logs, and a completion panel
  (`#sync-done`) with "Sync artifact messages" (idempotent second pass) +
  "Start over" (clears localStorage, reloads). `showSyncComplete()` handles both
  done and aborted states.
- **Theme** — `[data-theme]` on `<html>`, persisted in `localStorage` (`nox-theme`);
  an inline `<head>` script applies it before first paint to avoid a flash.

## CSS gotchas (these have bitten us repeatedly)

- The codebase is **`!important`-heavy** to override the Tailwind CDN utilities.
  Match that style.
- There are broad primary-button rules: `.box button` **and `#consoleLogs button`**.
  The latter has **ID specificity**, so any custom button inside `#consoleLogs`
  (Back, tabs, Start over) needs an **ID-scoped** selector (`#consoleLogs .btn-back`,
  `#consoleLogs .tabs .tab`) to win. `.box .x` alone will silently lose.
- **`.hidden { display:none }` is defined locally** (not just Tailwind) so the
  modal + inactive cards don't flash before the Tailwind CDN loads. It has **no
  `!important`**, so an element that sets its own `display` (e.g. `.nav-btn`,
  `.sync-done`) won't be hidden by the class — toggle those via inline
  `style="display:none"` + `.css({display})` instead.
- **Centering** the active card uses `margin: auto` on the flex child of `#main`
  (collapses to 0 when taller than the viewport, so the log view scrolls instead
  of clipping). `#consoleLogs` needs `margin: auto !important` (a `margin: 0 auto`
  beat the `margin-block:auto` rule). The empty `#form` is hidden during a run so
  `#consoleLogs` centers alone.
- **One-screen fit**: `body` is a flex column; a `@media (max-height: 820px)`
  block shrinks the hero so content-heavy steps still fit short windows.

## Testing

No test runner. Verify with Playwright against a local static server:

```bash
python3 -m http.server 8765
# scripts import: /Users/<you>/.npm-global/lib/node_modules/playwright (CJS):
#   import pw from '.../playwright/index.js'; const { chromium } = pw;
```

Patterns that matter:
- **Block DoH** (`page.route('**/cloudflare-dns.com/**', …)`) for determinism, or
  **mock it** to return an A record = an allowlisted IP so the destination passes.
- **Mock the CGI** by replacing `window.XMLHttpRequest` in `addInitScript` with a
  fake that fires `readyState` 3 (a mid `ETA:` line) then 4 (final) — this drives
  the real progress/completion code. `abort=on` in the body = the stop path.
- A literal allowlist IP in `#host2` no longer works in tests (IPs are blocked) —
  use a hostname + the DoH mock.

Always re-render screenshots after CSS changes and actually look at them; several
bugs here were specificity issues invisible in assertions.

## Deploy

`git push origin master`, then on the server: `cd /opt/imapsync-ui && git pull`
and `cp` the changed files into the served dir (`/var/www/html`). No CI, no auto
deploy. There's no `sonar-project.properties`, so the sonar autocheck skill is a
no-op here. Full server setup is in `README.md`.

## Conventions

- 4-space indent (JS/CSS/HTML).
- Push to `master` (the only branch).
- Keep user-facing copy plain and human — no AI-slop ("seamless", "robust",
  rule-of-three, em-dash pile-ups). Run the humanizer instinct on any prose.
- Don't overwrite `noxity-ips.js` on deploy unless the allowlist changed.

## Known dead/legacy bits

`#congratsPage` exists but is never shown (completion lives in `#sync-done`).
Some upstream imapsync leftovers (`store`/`retrieve` of `#subfolder*`,
`#showpassword*`, the `tests()` harness, `swap`) reference elements absent from
the HTML; they're `.length`-guarded no-ops. Don't wire them up without a reason.
