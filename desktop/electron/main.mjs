import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
} from "electron";
import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  getRepository,
  listRepositories,
  listBranches,
  compareBranches,
  createPullRequest,
  getPullRequest,
  mergePullRequest,
} from "../server/github.mjs";
import {
  assertTrustedSender,
  containedPath,
  desktopPath,
  resolveAppAsset,
  validateClipboardText,
  validateDevURL,
  validateExternalURL,
  validateRepositoryName,
} from "../server/validation.mjs";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(directory, "../dist/client");
const devOrigin = process.env.PINK_DEV_URL
  ? validateDevURL(process.env.PINK_DEV_URL)
  : null;
const selectedFolders = new Set();
let mainWindow = null;
let pickerBusy = false;

// Finder launches do not inherit the user's interactive shell PATH. Add only
// standard Homebrew executable locations so gh works in the native window too.
if (process.platform === "darwin")
  process.env.PATH = desktopPath(process.env.PATH);

app.setName("Pink Labs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pink",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const productionCSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";

async function serveApp(request) {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", { status: 405 });
  try {
    const asset = resolveAppAsset(request.url, clientRoot);
    const actualPath = await realpath(asset);
    if (!containedPath(await realpath(clientRoot), actualPath))
      return new Response("Forbidden", { status: 403 });
    const content = await readFile(actualPath);
    return new Response(request.method === "HEAD" ? null : content, {
      headers: {
        "Content-Type":
          contentTypes[path.extname(actualPath)] || "application/octet-stream",
        "Content-Security-Policy": productionCSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new Response(
      "App asset not found. Run npm run build before launching.",
      { status: 404 },
    );
  }
}

async function loadFolderPermissions() {
  try {
    const folders = JSON.parse(
      await readFile(
        path.join(app.getPath("userData"), "selected-folders.json"),
        "utf8",
      ),
    );
    if (Array.isArray(folders))
      for (const folder of folders) {
        if (typeof folder === "string" && path.isAbsolute(folder))
          selectedFolders.add(folder);
      }
  } catch {
    /* A first launch has no previously selected folders. */
  }
}

async function rememberFolder(folder) {
  const canonical = await realpath(folder);
  if (!(await lstat(canonical)).isDirectory())
    throw new Error("Select a project folder.");
  selectedFolders.add(canonical);
  await writeFile(
    path.join(app.getPath("userData"), "selected-folders.json"),
    JSON.stringify([...selectedFolders]),
    { mode: 0o600 },
  );
  return canonical;
}

async function selectFolder(title) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || !result.filePaths.length
    ? null
    : result.filePaths[0];
}

async function withPicker(operation) {
  if (pickerBusy) throw new Error("Finish the open folder dialog first.");
  pickerBusy = true;
  try {
    return await operation();
  } finally {
    pickerBusy = false;
  }
}

async function cloneRepository(value) {
  const repo = validateRepositoryName(value);
  return withPicker(async () => {
    const parent = await selectFolder(`Choose where to clone ${repo}`);
    if (!parent) return { canceled: true };
    const destination = path.join(await realpath(parent), repo.split("/")[1]);
    try {
      await lstat(destination);
      throw new Error(
        "That folder already exists. Choose another parent folder.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await execute(
        "git",
        ["clone", "--", `https://github.com/${repo}.git`, destination],
        {
          timeout: 300_000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      );
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error("Git is not installed. Install Git and try again.");
      throw new Error(
        "Cloning failed. Check repository access and your connection. A partial folder may remain in the location you selected.",
      );
    }
    return { canceled: false, path: await rememberFolder(destination) };
  });
}

async function openIDE(value) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("Choose a project folder first.");
  let canonical;
  try {
    canonical = await realpath(value);
  } catch {
    throw new Error("That project folder is no longer available.");
  }
  if (
    !selectedFolders.has(canonical) ||
    !(await lstat(canonical)).isDirectory()
  )
    throw new Error("Choose this folder with the project folder picker first.");
  if (process.platform === "darwin") {
    for (const application of ["Cursor.app", "Visual Studio Code.app"]) {
      for (const base of [
        "/Applications",
        path.join(os.homedir(), "Applications"),
      ]) {
        const appPath = path.join(base, application);
        try {
          await access(appPath);
        } catch {
          continue;
        }
        await execute("/usr/bin/open", ["-a", appPath, canonical], {
          timeout: 15_000,
        });
        return;
      }
    }
  }
  const error = await shell.openPath(canonical);
  if (error) throw new Error("Could not open the selected project folder.");
}

function installIPC() {
  const register = (channel, action) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, mainWindow?.webContents, devOrigin);
      return action(...args);
    });
  register("pink:repository", (repo) =>
    getRepository(validateRepositoryName(repo)),
  );
  register("pink:repositories", () => listRepositories());
  register("pink:list-branches", (repo) =>
    listBranches(validateRepositoryName(repo)),
  );
  register("pink:compare-branches", (repo, input) =>
    compareBranches(validateRepositoryName(repo), input),
  );
  register("pink:create-pull-request", (repo, input) =>
    createPullRequest(validateRepositoryName(repo), input),
  );
  register("pink:pull-request", (repo, number) =>
    getPullRequest(validateRepositoryName(repo), number),
  );
  register("pink:merge-pull-request", (repo, number, input) =>
    mergePullRequest(validateRepositoryName(repo), number, input),
  );
  register("pink:open-external", (url) =>
    shell.openExternal(validateExternalURL(url)),
  );
  register("pink:write-clipboard", (text) =>
    clipboard.writeText(validateClipboardText(text)),
  );
  register("pink:clone", cloneRepository);
  register("pink:choose-folder", () =>
    withPicker(async () => {
      const folder = await selectFolder("Choose a project folder");
      return folder ? rememberFolder(folder) : null;
    }),
  );
  register("pink:open-ide", openIDE);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Pink Labs",
    width: 1440,
    height: 960,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: "#151619",
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 17, y: 18 },
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.on("will-redirect", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(devOrigin ? `${devOrigin}/` : "pink://app/");
}

const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      protocol.handle("pink", serveApp);
      await loadFolderPermissions();
      installIPC();
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox("Pink Labs could not start", error.message);
      app.quit();
    });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
