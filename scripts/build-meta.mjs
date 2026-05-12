import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const PUBLIC_VERSION_PATH = join(ROOT, "public", "version.json");
const DIST_SW_PATH = join(ROOT, "dist", "sw.js");
const MANIFEST_PATH = join(ROOT, "dist", ".vite", "manifest.json");

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const appVersion = pkg.version;
const buildTime = new Date().toISOString();

const mode = process.argv[2] ?? "prebuild";

if (mode === "prebuild") {
  await writeFile(
    PUBLIC_VERSION_PATH,
    JSON.stringify(
      {
        appVersion,
        buildTime,
      },
      null,
      2,
    ) + "\n",
  );
}

if (mode === "postbuild") {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const hashedAssets = Object.values(manifest)
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const typed = entry;
      return [typed.file, ...(typed.css ?? []), ...(typed.assets ?? [])];
    })
    .filter((asset, index, arr) => typeof asset === "string" && arr.indexOf(asset) === index)
    .map((asset) => `/${asset}`);

  const shellAssets = [
    "/",
    "/app/",
    "/version.json",
    "/app.webmanifest",
    "/icons/favicon-16.png",
    "/icons/favicon-32.png",
    "/icons/apple-touch-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/maskable-512.png",
    `/worklets/tuner-processor.js?v=${appVersion}`,
    ...hashedAssets,
  ];

  const source = await readFile(DIST_SW_PATH, "utf8");
  const next = source
    .replace(/__APP_VERSION__/g, appVersion)
    .replace("__SHELL_ASSETS__", JSON.stringify(shellAssets, null, 2));
  await writeFile(DIST_SW_PATH, next);
}
