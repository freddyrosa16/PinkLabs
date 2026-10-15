const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "pink",
  Object.freeze({
    repository: (fullName) => ipcRenderer.invoke("pink:repository", fullName),
    repositories: () => ipcRenderer.invoke("pink:repositories"),
    openExternal: (url) => ipcRenderer.invoke("pink:open-external", url),
    writeClipboard: (text) => ipcRenderer.invoke("pink:write-clipboard", text),
    clone: (fullName) => ipcRenderer.invoke("pink:clone", fullName),
    chooseFolder: () => ipcRenderer.invoke("pink:choose-folder"),
    openIDE: (folder) => ipcRenderer.invoke("pink:open-ide", folder),
  }),
);
