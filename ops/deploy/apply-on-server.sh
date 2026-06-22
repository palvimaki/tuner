#!/usr/bin/env bash
set -euo pipefail

if ! dpkg -s libnginx-mod-http-js >/dev/null 2>&1; then
  sudo apt-get install -y libnginx-mod-http-js
fi

sudo install -d -m 0755 -o root -g root /etc/nginx/njs /etc/nginx/conf.d /etc/nginx/sites-available

sudo tee /etc/nginx/njs/tuner-log.js >/dev/null <<'EOF_TUNER_LOG'
function safe(fn, fallback) {
  try {
    return fn();
  } catch (_e) {
    return fallback;
  }
}

function v4MappedToV6(v4) {
  const octets = v4.split(".").map((value) => Number(value));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  const hi = ((octets[0] << 8) | octets[1]).toString(16).padStart(4, "0");
  const lo = ((octets[2] << 8) | octets[3]).toString(16).padStart(4, "0");
  return `0000:0000:0000:0000:0000:ffff:${hi}:${lo}`;
}

function expandIpv6(ip) {
  let raw = (ip || "").toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("::ffff:") && raw.includes(".")) {
    const mapped = v4MappedToV6(raw.slice(7));
    if (!mapped) return null;
    raw = mapped;
  }

  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  const parts = left.concat(Array(missing).fill("0"), right).map((part) => part.padStart(4, "0"));
  return parts.length === 8 ? parts : null;
}

function anonymizeIp(r) {
  return safe(function () {
    const raw = r.remoteAddress || "";
    const v4 = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
    const match = v4.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
    if (match) return `${match[1]}.${match[2]}.${match[3]}.0`;

    const parts = expandIpv6(raw);
    if (!parts) return "::";
    return `${parts[0]}:${parts[1]}:${parts[2]}:0000:0000:0000:0000:0000`;
  }, "::");
}

function classifyUa(r) {
  return safe(function () {
    const ua = String(r.headersIn["User-Agent"] || "").toLowerCase();
    if (ua.includes("bot") || ua.includes("spider") || ua.includes("crawler")) return "bot";
    if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
    if (ua.includes("android")) return "android";
    if (ua.includes("safari") && !ua.includes("chrome") && !ua.includes("crios")) return "safari";
    if (ua.includes("chrome") || ua.includes("crios") || ua.includes("chromium")) return "chromium";
    return "other";
  }, "other");
}

export default { anonymizeIp, classifyUa };
EOF_TUNER_LOG

sudo tee /etc/nginx/conf.d/tuner.fi-privacy-log.conf >/dev/null <<'EOF_TUNER_PRIVACY_LOG'
js_import tuner_log from /etc/nginx/njs/tuner-log.js;
js_set $tuner_anon_ip tuner_log.anonymizeIp;
js_set $tuner_ua_class tuner_log.classifyUa;

log_format tuner_privacy
  '$tuner_anon_ip - - [$time_local] '
  '"$request_method $uri $server_protocol" $status $body_bytes_sent '
  '"-" "$tuner_ua_class"';
EOF_TUNER_PRIVACY_LOG

sudo tee /etc/nginx/sites-available/tuner.fi >/dev/null <<'EOF_TUNER_VHOST'
server {
    server_name tuner.fi www.tuner.fi;
    root /var/www/tuner.fi;
    access_log /var/log/nginx/tuner.fi.access.log tuner_privacy;

    location ^~ /.well-known/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location ~ /\.(?!well-known/) {
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
        return 404;
    }

    location = /index.html {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location = /app/ {
        try_files /app/index.html =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location = /app.webmanifest {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location = /version.json {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location = /sw.js {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
        add_header Service-Worker-Allowed "/" always;
    }

    location ^~ /assets/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ^~ /worklets/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ^~ /icons/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ^~ /audio/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;
    }

    location ^~ /attribution/ {
        try_files $uri =404;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
        add_header Cache-Control "public, max-age=3600" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
        add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/tuner.fi/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/tuner.fi/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = www.tuner.fi) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    if ($host = tuner.fi) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name tuner.fi www.tuner.fi;
    return 404; # managed by Certbot
}
EOF_TUNER_VHOST

sudo chown root:root /etc/nginx/njs/tuner-log.js /etc/nginx/conf.d/tuner.fi-privacy-log.conf /etc/nginx/sites-available/tuner.fi
sudo chmod 0644 /etc/nginx/njs/tuner-log.js /etc/nginx/conf.d/tuner.fi-privacy-log.conf /etc/nginx/sites-available/tuner.fi
sudo ln -sfn /etc/nginx/sites-available/tuner.fi /etc/nginx/sites-enabled/tuner.fi

sudo nginx -t
sudo systemctl reload nginx
