# tuner.fi nginx deploy assets

Reference nginx configuration and remote installer for hosting tuner.fi on a Debian/Ubuntu server with nginx + njs.

- `ops/nginx/tuner-log.js` — njs helper, deployed to `/etc/nginx/njs/tuner-log.js`
- `ops/nginx/tuner.fi-privacy-log.conf` — http-scope `js_import`, `js_set`, and `log_format`
- `ops/nginx/tuner.fi.conf` — vhost with certbot-managed TLS lines preserved
- `ops/deploy/apply-on-server.sh` — idempotent remote installer

Run the remote apply step from the repo root:

```bash
DEPLOY_HOST=tuner.fi
ssh "$DEPLOY_HOST" 'bash -s' < ops/deploy/apply-on-server.sh
```

The script:

1. installs `libnginx-mod-http-js` if needed
2. writes `/etc/nginx/njs/tuner-log.js`
3. writes `/etc/nginx/conf.d/tuner.fi-privacy-log.conf`
4. writes `/etc/nginx/sites-available/tuner.fi`
5. runs `sudo nginx -t`
6. reloads nginx

After that, run `scripts/deploy.sh` to push the built static files and verify the same public target:

```bash
DEPLOY_HOST=tuner.fi DEPLOY_URL=https://tuner.fi scripts/deploy.sh
```

`DEPLOY_PATH` defaults to `/var/www/tuner.fi/`. If you target another host or path, set `DEPLOY_URL` to that same environment's public URL so the post-deploy checks verify the site you actually updated. The deploy rsync preserves `.well-known/` so webroot-based ACME challenges are not deleted.

For the dev mirror, use `scripts/deploy-dev.sh`. It defaults to the allowlisted `tuner.hoitovirhe.fi` mirror and runs smoke checks from the deploy host so workstation IP allowlists do not create false negatives.
