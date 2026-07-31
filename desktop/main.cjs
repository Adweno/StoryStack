const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE = "desktop-config.json";
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 840;

let mainWindow;

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function normalizeServerUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function configuredServerUrl() {
  return normalizeServerUrl(process.env.STORY_STACK_SERVER_URL) || normalizeServerUrl(readConfig().serverUrl);
}

function setupHtml(message = "") {
  const escapedMessage = escapeHtml(message);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Story Stack</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, Segoe UI, system-ui, sans-serif;
        background: #161016;
        color: #fff7df;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 20%, rgba(151, 82, 111, 0.35), transparent 34%),
          linear-gradient(145deg, #130d14 0%, #10201f 100%);
      }
      main {
        width: min(560px, calc(100vw - 40px));
        display: grid;
        gap: 18px;
        padding: 30px;
        border: 1px solid #604154;
        border-radius: 10px;
        background: rgba(31, 22, 31, 0.92);
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0;
        font-size: 38px;
        line-height: 1;
      }
      p {
        margin: 0;
        color: #d9c6b5;
        font-size: 17px;
        line-height: 1.45;
      }
      label {
        display: grid;
        gap: 8px;
        color: #f4c168;
        font-weight: 750;
      }
      form {
        display: grid;
        gap: 12px;
      }
      input {
        width: 100%;
        min-height: 50px;
        border-radius: 8px;
        border: 1px solid #79536a;
        background: #110f0d;
        color: #fff7df;
        padding: 0 14px;
        font: inherit;
      }
      button {
        min-height: 48px;
        border: 0;
        border-radius: 8px;
        background: #9a5264;
        color: #fff7df;
        font: inherit;
        font-weight: 780;
        cursor: pointer;
      }
      .message {
        min-height: 22px;
        color: #ffcf8c;
      }
      details {
        border-top: 1px solid #604154;
        padding-top: 14px;
      }
      summary {
        color: #d9c6b5;
        cursor: pointer;
        font-weight: 700;
        margin-bottom: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Story Stack</h1>
      <p>Sign in with a Story Stack invite. The invite tells the app which server to use, so listeners do not need to know a local IP address.</p>
      <form id="invite-form">
        <label>
          Invite link
          <input id="invite-url" placeholder="https://story-stack.example.com/?invite=..." autocomplete="url" autofocus />
        </label>
        <button>Continue</button>
      </form>
      <details>
        <summary>Owner setup</summary>
        <form id="server-form">
          <label>
            Story Stack server address
            <input id="server-url" placeholder="https://story-stack.example.com" autocomplete="url" />
          </label>
          <button>Connect Server</button>
        </form>
      </details>
      <p class="message" id="message">${escapedMessage}</p>
    </main>
    <script>
      const form = document.getElementById("server-form");
      const inviteForm = document.getElementById("invite-form");
      const input = document.getElementById("server-url");
      const inviteInput = document.getElementById("invite-url");
      const message = document.getElementById("message");
      inviteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "Checking invite...";
        const result = await window.storyStackDesktop.openInvite(inviteInput.value);
        if (!result.ok) {
          message.textContent = result.error;
        }
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "Checking server...";
        const result = await window.storyStackDesktop.saveServer(input.value);
        if (!result.ok) {
          message.textContent = result.error;
        }
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 940,
    minHeight: 680,
    title: "Story Stack",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  installMenu();
  loadConfiguredServer();
}

async function loadConfiguredServer() {
  const serverUrl = configuredServerUrl();
  if (!serverUrl) {
    loadSetup();
    return;
  }
  try {
    await verifyServer(serverUrl);
    await mainWindow.loadURL(serverUrl);
  } catch (error) {
    loadSetup(`Could not reach ${serverUrl}. Check the address or choose another server.`);
  }
}

function loadSetup(message = "") {
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHtml(message))}`);
}

async function verifyServer(serverUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}.`);
    }
    const data = await response.json();
    if (data.app !== "Story Stack") {
      throw new Error("This does not look like a Story Stack server.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function installMenu() {
  const template = [
    {
      label: "Story Stack",
      submenu: [
        {
          label: "Change Server",
          click: () => loadSetup()
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => loadConfiguredServer()
        },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "Alt+F4",
          click: () => app.quit()
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("server:save", async (_event, rawServerUrl) => {
  const serverUrl = normalizeServerUrl(rawServerUrl);
  if (!serverUrl) {
    return { ok: false, error: "Enter a valid http or https address." };
  }
  try {
    await verifyServer(serverUrl);
  } catch {
    return { ok: false, error: "Story Stack was not reachable at that address." };
  }
  writeConfig({ ...readConfig(), serverUrl });
  await mainWindow.loadURL(serverUrl);
  return { ok: true };
});

ipcMain.handle("invite:open", async (_event, rawInviteUrl) => {
  let inviteUrl;
  try {
    inviteUrl = new URL(String(rawInviteUrl ?? "").trim());
  } catch {
    return { ok: false, error: "Paste the full invite link." };
  }
  const token = inviteUrl.searchParams.get("invite");
  if (!token) {
    return { ok: false, error: "That link does not include a Story Stack invite." };
  }
  const serverUrl = `${inviteUrl.protocol}//${inviteUrl.host}`;
  try {
    await verifyServer(serverUrl);
  } catch {
    return { ok: false, error: "Story Stack was not reachable from that invite link." };
  }
  writeConfig({ ...readConfig(), serverUrl });
  await mainWindow.loadURL(`${serverUrl}/?invite=${encodeURIComponent(token)}`);
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
