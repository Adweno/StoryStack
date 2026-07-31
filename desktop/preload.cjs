const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("storyStackDesktop", {
  saveServer: (serverUrl) => ipcRenderer.invoke("server:save", serverUrl),
  openInvite: (inviteUrl) => ipcRenderer.invoke("invite:open", inviteUrl)
});
