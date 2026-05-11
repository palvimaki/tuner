# PATCH REPORT

Date: 2026-05-11
Branch: `dev`

## Landed

1. `public/sw.js`
   - added same-origin short-circuit at the top of the `fetch` handler
   - gated both `cacheFirst` and `networkFirst` `cache.put(...)` calls behind `response.ok && response.type === "basic"`
   - changed `networkFirst` offline fallback to the precached navigation entry instead of URL-derived cached navigations

2. `public/app.webmanifest`
   - added `"id": "/app/"`

3. `src/ui/controls.ts` + `src/ui/theme.css`
   - removed the inline `style="height:..."`
   - replaced it with `style.setProperty("--preset-line-h", ...)`
   - added `.preset-line { height: var(--preset-line-h); }`

4. `scripts/deploy.sh`
   - kept build/test/deploy flow
   - added post-rsync smoke assertions for `/sw.js`, the built hashed JS bundle, and one built `/audio/*.m4a`
   - added 404 assertions for `/assets/does-not-exist.js`, `/.env`, and `/.DS_Store`

5. `ops/nginx/`
   - kept `ops/nginx/tuner-log.js` unchanged
   - preserved the PLAN-v2 `ops/nginx/tuner.fi-privacy-log.conf` shape (`js_import` + `js_set` + `log_format`)
   - added merged `ops/nginx/tuner.fi.conf` with:
     - certbot-managed TLS lines preserved from live haukka
     - privacy `access_log ... tuner_privacy`
     - per-location full security headers + cache headers
     - explicit `/sw.js` `Service-Worker-Allowed: /`
     - explicit file locations for `/app.webmanifest`, `/version.json`, `/sw.js`, `/assets/`, `/worklets/`, `/icons/`, `/audio/`, `/attribution/`
     - dotfile deny with `.well-known` carve-out
     - explicit `/.well-known/` file-only handling to keep ACME paths out of SPA fallback

6. `ops/deploy/`
   - added `apply-on-haukka.sh` as the idempotent remote installer for fixes 6-14
   - added `README.md` documenting the remote apply step and follow-up deploy/verify flow

## Skipped

- Local `nginx -t`: not runnable in this workspace because `nginx` is not installed here, and the task explicitly scoped remote nginx apply/testing to TARS.

## Verification

- `npm test` passed: 12/12 tests
- `npm run build` passed
- `bash -n ops/deploy/apply-on-haukka.sh` passed
- `bash -n scripts/deploy.sh` passed

## dist

- Final `dist/` size: `136,928` bytes
