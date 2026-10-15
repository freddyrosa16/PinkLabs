const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "pink",
  Object.freeze({
    repository: (fullName) => ipcRenderer.invoke("pink:repository", fullName),
    repositories: () => ipcRenderer.invoke("pink:repositories"),
    listBranches: (fullName) =>
      ipcRenderer.invoke("pink:list-branches", fullName),
    compareBranches: (fullName, input) =>
      ipcRenderer.invoke("pink:compare-branches", fullName, input),
    createPullRequest: (fullName, input) =>
      ipcRenderer.invoke("pink:create-pull-request", fullName, input),
    openExternal: (url) => ipcRenderer.invoke("pink:open-external", url),
    writeClipboard: (text) => ipcRenderer.invoke("pink:write-clipboard", text),
    clone: (fullName) => ipcRenderer.invoke("pink:clone", fullName),
    chooseFolder: () => ipcRenderer.invoke("pink:choose-folder"),
    openIDE: (folder) => ipcRenderer.invoke("pink:open-ide", folder),
  }),
);
