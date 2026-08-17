# Story Stack

Story Stack is a self-hosted audiobook Store and personal library app. It reads an existing audiobook folder in place, keeps its own database, and lets users add Store books to My Library and optional shelves. It does not require Audiobookshelf or any other media server.

## Current MVP

- Store catalog from a read-only audiobook folder scan
- My Library add/remove behavior
- User-specific shelves
- Basic audiobook playback route
- Per-user playback progress API
- Native Story Stack sign-in
- Invite-based sharing
- Remote access settings
- Installable web app support
- Device-local offline downloads for saved books
- Responsive React UI
- Local SQLite database stored outside the source media folder

## Requirements

- Node.js 22 or newer
- Windows or Linux
- An existing audiobook folder to scan

## Install

```powershell
npm install
npm run build
npm start
```

Then open:

```text
http://localhost:4100
```

## Installable Web App

Story Stack is PWA-first. Users open the public HTTPS Story Stack address in a browser, sign in, and install it from the browser as an app.

Typical browser actions:

- Chrome/Edge desktop: use the install icon in the address bar or Story Stack's `Install App` button when shown.
- Android Chrome: open the browser menu and choose `Add to Home screen` or `Install app`.
- iPhone/iPad Safari: use Share, then `Add to Home Screen`.

Downloaded books are saved to that device's browser app storage for offline listening. Browser storage is controlled by the device/browser, so users should treat downloads as a local offline cache rather than a permanent backup.

## Development

Run the API:

```powershell
npm run dev
```

Run the client in another terminal:

```powershell
npm run dev:client
```

Open:

```text
http://localhost:5173
```

## Test

```powershell
npm test
```

## Optional Windows Desktop App

The Windows app is now optional. The preferred cross-device experience is the installable web app above. The desktop app remains a thin client for a Story Stack server; it does not run the audiobook server locally and it does not need the audiobook files on the Windows machine.

For local testing:

```powershell
npm run desktop
```

To build a Windows installer and portable app:

```powershell
npm run desktop:installer
```

The first time the app opens, listeners can paste a Story Stack invite link. The invite link tells the desktop app which Story Stack server to use. Owners can still use the Owner setup panel or app menu to connect directly to a server.

For access from any network, configure a public HTTPS address such as a reverse proxy or tunnel URL, not a local address like `http://server-ip:4100`.

## Configuration

Copy `.env.example` to `.env` if you want to customize local settings.

```text
PORT=4100
HOST=0.0.0.0
STORY_STACK_DATA_DIR=./data
STORY_STACK_LIBRARY_PATH=
STORY_STACK_ADMIN_PASSWORD=
STORY_STACK_USER_PASSWORD=
STORY_STACK_PUBLIC_URL=
CLOUDFLARED_TOKEN=
COMPOSE_PROFILES=
```

The Admin page accepts either Windows-style paths such as `C:\Audiobooks` or Linux-style paths such as `/mnt/media/audiobooks`.

Set `STORY_STACK_LIBRARY_PATH` to the audiobook folder Story Stack should scan. Story Stack treats this folder as read-only.

Set `STORY_STACK_ADMIN_PASSWORD` before exposing a new install outside your home network. If this value is later changed, Story Stack rotates the seeded `admin` account password on restart.

## Hosting On Your Media Server

Story Stack runs independently of other media tooling. Install it on the server machine, point it at the audiobook folder, and expose port `4100` on your home network or through HTTPS.

### Current Live Deployment

For a Linux deployment, copy the project to the server and rebuild the Docker app after changes:

```bash
cd /path/to/story-stack
docker compose up -d --build story-stack
```

Then verify the public app is serving the new build:

```bash
curl https://your-story-stack-domain.example/api/health
curl https://your-story-stack-domain.example/service-worker.js
```

For PWA changes, bump the cache name in `src/client/public/service-worker.js`. Installed phone apps can keep an older service worker until the public server serves a newer one.

### Docker Compose

The included `docker-compose.yml` uses a configurable host audiobook path. Set
`STORY_STACK_HOST_LIBRARY_PATH` in `.env` to the folder containing your audio:

```text
STORY_STACK_HOST_LIBRARY_PATH=/path/to/audiobooks
```

Run on the Linux server:

```bash
cd /path/to/story-stack
docker compose up -d --build
```

Story Stack will store its own database in:

```text
/srv/story-stack/data
```

### Windows Service

Open PowerShell as Administrator from the project folder:

```powershell
.\scripts\install-windows-service.ps1 -LibraryPath "C:\Audiobooks"
Start-Service StoryStack
```

Then open `http://server-ip:4100` on the local network.

### Linux Systemd Service

Copy the project to the server, for example `/opt/story-stack`, install dependencies, and build:

```bash
cd /opt/story-stack
npm install
npm run build
```

Edit `scripts/story-stack.service` so `STORY_STACK_LIBRARY_PATH` points at the audiobook folder, then install:

```bash
sudo ./scripts/install-linux-service.sh /opt/story-stack
sudo systemctl start story-stack
```

Then open:

```text
http://server-ip:4100
```

For internet access, put Story Stack behind HTTPS with a reverse proxy such as Caddy, Nginx, or Traefik.

### Cloudflare Tunnel

If you use Cloudflare Tunnel, set these values in `.env` on the server:

```text
STORY_STACK_PUBLIC_URL=https://app.example.com
CLOUDFLARED_TOKEN=your-cloudflare-tunnel-token
COMPOSE_PROFILES=tunnel
```

Then run:

```bash
docker compose up -d --build
```

The `cloudflared` container is opt-in so local installs do not start a tunnel unless `COMPOSE_PROFILES=tunnel` is set.

## Read-Only Media Rule

Story Stack scans audiobook folders and imports catalog information into its own database. It reads embedded/source-side metadata and cover files when available, including `metadata.json` files written by compatible audiobook managers. It does not move, rename, delete, re-tag, or rewrite source files. Removing a book from My Library only removes that user's library entry.

### Audiobookshelf compatibility

Audiobookshelf is optional. If it saves metadata and cover art beside the audiobook source files, Story Stack reads those files directly. Story Stack does not connect to Audiobookshelf, open its database, mount its configuration, or require its service to be installed. The included Docker deployment only mounts the configured audiobook source folder.

## Notes

The first run creates the configured admin account only when
`STORY_STACK_ADMIN_PASSWORD` is set. There is no built-in default password.
