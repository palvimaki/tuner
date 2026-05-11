# tuner.fi nginx deploy assets

Use these files for the CASE-audit nginx hardening rollout:

- `ops/nginx/tuner-log.js`: njs helper shipped to `/etc/nginx/njs/tuner-log.js`
- `ops/nginx/tuner.fi-privacy-log.conf`: http-scope `js_import`, `js_set`, and `log_format`
- `ops/nginx/tuner.fi.conf`: merged tuner.fi vhost with certbot-managed TLS lines preserved
- `ops/deploy/apply-on-haukka.sh`: idempotent remote installer for fixes 6-14

TARS runs the remote apply step from the repo root with:

```bash
ssh haukka 'bash -s' < ops/deploy/apply-on-haukka.sh
```

The script:

1. installs `libnginx-mod-http-js` if needed
2. writes `/etc/nginx/njs/tuner-log.js`
3. writes `/etc/nginx/conf.d/tuner.fi-privacy-log.conf`
4. writes `/etc/nginx/sites-available/tuner.fi`
5. runs `sudo nginx -t`
6. reloads nginx

After that, run `scripts/deploy.sh` and verify live with the CASE-AUDIT-REVIEW fix 14 curl probe list.
