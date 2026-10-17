const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "pink",
  Object.freeze({
    repository: (fullName) => ipcRenderer.invoke("pink:repository", fullName),
    repositories: () => ipcRenderer.invoke("pink:repositories"),
    repositoryCreationOptions: () =>
      ipcRenderer.invoke("pink:repository-creation-options"),
    createRepository: (input) =>
      ipcRenderer.invoke("pink:create-repository", input),
    checkCreatedRepository: (input) =>
      ipcRenderer.invoke("pink:created-repository", input),
    listBranches: (fullName) =>
      ipcRenderer.invoke("pink:list-branches", fullName),
    compareBranches: (fullName, input) =>
      ipcRenderer.invoke("pink:compare-branches", fullName, input),
    createPullRequest: (fullName, input) =>
      ipcRenderer.invoke("pink:create-pull-request", fullName, input),
    getPullRequest: (fullName, number) =>
      ipcRenderer.invoke("pink:pull-request", fullName, number),
    mergePullRequest: (fullName, number, input) =>
      ipcRenderer.invoke("pink:merge-pull-request", fullName, number, input),
    listPullRequests: (fullName, state) =>
      ipcRenderer.invoke("pink:list-pull-requests", fullName, state),
    getPullRequestFiles: (fullName, number, sha) =>
      ipcRenderer.invoke("pink:pull-request-files", fullName, number, sha),
    getPullRequestComments: (fullName, number) =>
      ipcRenderer.invoke("pink:pull-request-comments", fullName, number),
    createPullRequestComment: (fullName, number, input) =>
      ipcRenderer.invoke(
        "pink:create-pull-request-comment",
        fullName,
        number,
        input,
      ),
    deletePullRequestBranch: (fullName, number, input) =>
      ipcRenderer.invoke("pink:delete-pull-branch", fullName, number, input),
    openExternal: (url) => ipcRenderer.invoke("pink:open-external", url),
    writeClipboard: (text) => ipcRenderer.invoke("pink:write-clipboard", text),
    clone: (fullName, method) =>
      ipcRenderer.invoke("pink:clone", fullName, method),
    chooseFolder: () => ipcRenderer.invoke("pink:choose-folder"),
    openIDE: (folder) => ipcRenderer.invoke("pink:open-ide", folder),
  }),
);
