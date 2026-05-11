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
