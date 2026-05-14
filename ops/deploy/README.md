# tuner.fi nginx deploy assets

Reference nginx configuration and remote installer for hosting tuner.fi on a Debian/Ubuntu server with nginx + njs.

- `ops/nginx/tuner-log.js` — njs helper, deployed to `/etc/nginx/njs/tuner-log.js`
- `ops/nginx/tuner.fi-privacy-log.conf` — http-scope `js_import`, `js_set`, and `log_format`
- `ops/nginx/tuner.fi.conf` — vhost with certbot-managed TLS lines preserved
- `ops/deploy/apply-on-server.sh` — idempotent remote installer

Run the remote apply step from the repo root:

```bash
ssh "$DEPLOY_HOST" 'bash -s' < ops/deploy/apply-on-server.sh
```

The script:

1. installs `libnginx-mod-http-js` if needed
2. writes `/etc/nginx/njs/tuner-log.js`
3. writes `/etc/nginx/conf.d/tuner.fi-privacy-log.conf`
4. writes `/etc/nginx/sites-available/tuner.fi`
5. runs `sudo nginx -t`
6. reloads nginx

After that, run `scripts/deploy.sh` to push the built static files.
