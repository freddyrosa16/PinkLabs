import { packager } from "@electron/packager";
import { access, copyFile, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(desktopRoot, "release");
const stagingRoot = path.join(releaseRoot, "staging");
const manifest = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const electronVersion = JSON.parse(await readFile(require.resolve("electron/package.json"), "utf8")).version;
const zipName = `electron-v${electronVersion}-${process.platform}-${process.arch}.zip`;

async function cachedElectronDirectory() {
  const cacheRoot = process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Caches", "electron")
    : process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "electron", "Cache")
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "electron");
  try {
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    for (const directory of [cacheRoot, ...entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(cacheRoot, entry.name))]) {
      try { await access(path.join(directory, zipName)); return directory; } catch { /* Try the next cache bucket. */ }
    }
  } catch { /* Packager can download the installed Electron version if no cache exists. */ }
  return undefined;
}

async function copyBuiltClient() {
  const source = path.join(desktopRoot, "dist", "client");
  await access(path.join(source, "index.html"));
  await cp(source, path.join(stagingRoot, "dist", "client"), {
    recursive: true,
    filter: async (entry) => {
      const relative = path.relative(source, entry);
      if ((await lstat(entry)).isSymbolicLink()) throw new Error(`Do not package symlinks in the client build: ${relative}`);
      if (relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules") || /\.(?:py|pyc|pem|key)$/i.test(relative)) {
        throw new Error(`Unexpected file in the client build: ${relative}`);
      }
      return true;
    },
  });
}

await access(path.join(desktopRoot, "dist", "client", "index.html")).catch(() => {
  throw new Error("Build the interface first with npm run build.");
});
await mkdir(releaseRoot, { recursive: true });
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

// Explicit runtime allowlist: the Python project, .env files, dependencies,
// browser-preview server, and source workspace are never copied into the app.
for (const file of ["electron/main.mjs", "electron/preload.cjs", "server/github.mjs", "server/validation.mjs"]) {
  const destination = path.join(stagingRoot, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(desktopRoot, file), destination);
}
await copyBuiltClient();
await copyFile(path.join(desktopRoot, "THIRD_PARTY_NOTICES.md"), path.join(stagingRoot, "dist", "client", "THIRD_PARTY_NOTICES.md"));
await writeFile(path.join(stagingRoot, "package.json"), JSON.stringify({
  name: manifest.name,
  productName: "Pink Labs",
  version: manifest.version,
  private: true,
  type: "module",
  main: "electron/main.mjs",
}, null, 2) + "\n");

const electronZipDir = await cachedElectronDirectory();
console.log(`Packaging Pink Labs ${manifest.version} for ${process.platform}/${process.arch} with Electron ${electronVersion}${electronZipDir ? " (cached)" : ""}.`);
const outputs = await packager({
  dir: stagingRoot,
  out: releaseRoot,
  name: "Pink Labs",
  appBundleId: "com.pinklabs.desktop",
  appCategoryType: "public.app-category.developer-tools",
  appVersion: manifest.version,
  electronVersion,
  ...(electronZipDir ? { electronZipDir } : {}),
  platform: process.platform,
  arch: process.arch,
  asar: true,
  prune: false,
  overwrite: true,
  darwinDarkModeSupport: true,
});
for (const output of outputs) console.log(`Created ${process.platform === "darwin" ? path.join(output, "Pink Labs.app") : output}`);
