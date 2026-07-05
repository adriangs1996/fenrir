# Remote Access Setup

Use this when you want to open Fenrir from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The Fenrir CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                | Env var               | Notes                                                                                |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `--mode <web\|desktop>` | `FENRIR_MODE`         | Runtime mode.                                                                        |
| `--port <number>`       | `FENRIR_PORT`         | HTTP/WebSocket port.                                                                 |
| `--host <address>`      | `FENRIR_HOST`         | Bind interface/address.                                                              |
| `--base-dir <path>`     | `FENRIR_HOME`         | Base directory.                                                                      |
| `--dev-url <url>`       | `VITE_DEV_SERVER_URL` | Dev web URL redirect/proxy target.                                                   |
| `--no-browser`          | `FENRIR_NO_BROWSER`   | Disable auto-open browser.                                                           |
| `--bootstrap-fd <fd>`   | `FENRIR_BOOTSTRAP_FD` | Read a one-shot bootstrap envelope from an inherited file descriptor during startup. |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Enabling Network Access

Two ways to expose the server: desktop app or CLI.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **Manage Local Backend**, toggle **Network access** on. This restarts the app and binds the backend on all network interfaces.
3. The settings panel shows the address the server is reachable at (e.g. `http://192.168.x.y:3773`).
4. Use **Create Link** to generate a pairing link you can share with another device.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

## Security First

- Create a pairing link or bearer session before exposing a headless server
  outside localhost. Treat pairing credentials and bearer sessions like
  passwords.
- When you control the process launcher, `--bootstrap-fd <fd>` can pass a
  one-shot JSON bootstrap envelope with `desktopBootstrapToken`. The server
  treats that token as a one-use owner bootstrap credential, not as a steady
  bearer session.
- Prefer binding to trusted interfaces (LAN IP or Tailnet IP) instead of opening all interfaces unless needed.

## Pairing And Client Sessions

Fenrir separates bootstrap/pairing from steady-state session auth:

- Owners create short-lived pairing links from the Connections settings or auth
  control-plane commands.
- Browser clients can exchange a pairing token for a session cookie.
- Native terminal, CLI, and other non-cookie clients can either use an
  owner-issued bearer session from `auth session issue`, or exchange a pairing
  token for a bearer session with `POST /api/auth/bootstrap/bearer`.
- WebSocket clients should mint a short-lived WebSocket token through `POST
/api/auth/ws-token` before opening `/ws?wsToken=...`.
- Owner sessions can revoke pairing links and paired client sessions. Revocation
  invalidates future HTTP and WebSocket authentication for that session; already
  connected clients should reconnect and reauthenticate.

Current scopes are intentionally small:

- `owner`: can create pairing links and revoke client sessions.
- `client`: can use authenticated server capabilities but cannot manage access.

Future per-project permissions should extend the auth/session contracts
explicitly. Do not infer permissions from whether a client is web, Electron,
native terminal, local, or remote.

## 1) Build + run server for remote access

Remote access should use the built web app (not local Vite redirect mode).

```bash
bun run build
BASE_DIR="$HOME/.fenrir-remote"
bun run --cwd apps/server start -- auth pairing create --base-dir "$BASE_DIR" --base-url "http://<your-machine-ip>:3773"
bun run --cwd apps/server start -- --host 0.0.0.0 --port 3773 --base-dir "$BASE_DIR" --no-browser
```

Then open the printed pair URL on your phone.

Example:

`http://192.168.1.42:3773`

Notes:

- `--host 0.0.0.0` listens on all IPv4 interfaces.
- `auth pairing create` writes the one-time pairing credential into the same
  `--base-dir` used by the server.
- `--no-browser` prevents local auto-open, which is usually better for headless/remote sessions.
- Ensure your OS firewall allows inbound TCP on the selected port.
- For native terminal or other non-cookie clients, issue a bearer token instead:

  ```bash
  bun run --cwd apps/server start -- auth session issue --base-dir "$BASE_DIR" --role owner --label "native terminal" --token-only
  ```

## Native terminal against a remote server

The native macOS terminal can attach to a remote Fenrir server instead of
spawning a local one. When a remote target is configured the app skips local
server discovery/spawn and the local tmux dependency check — tmux and the
PTYs live on the remote host.

Configure the target one of two ways:

1. **Environment variable** (wins over settings):

   ```bash
   FENRIR_REMOTE_SERVER_URL="http://<your-machine-ip>:3773" \
   FENRIR_NATIVE_BOOTSTRAP_TOKEN="<pairing token or bearer>" \
   open -a FenrirNative   # or run the dev binary
   ```

2. **Settings file** (`~/Library/Application Support/FenrirNative/settings.json`):

   ```json
   {
     "serverConnection": {
       "startupMode": "connectToRemoteProfile",
       "defaultRemoteProfileID": "workbox",
       "remoteProfiles": [
         {
           "id": "workbox",
           "displayName": "Workbox",
           "endpointURL": "http://192.168.1.42:3773"
         }
       ]
     }
   }
   ```

Credentials: `FENRIR_NATIVE_BOOTSTRAP_TOKEN` accepts either a one-time pairing
token (`auth pairing create`) or an owner-issued bearer session
(`auth session issue --token-only`). A pairing token is exchanged once and the
resulting bearer is persisted in the macOS Keychain per endpoint, so the token
only needs to be supplied on first launch; later launches (and bearer
expiry/revocation recovery) read the Keychain and re-pair only when that
session is rejected. Only `http`/`https` endpoint URLs are accepted; prefer
`https` or a Tailnet address — bearer tokens transit in the clear over plain
HTTP.

## 2) Tailnet / Tailscale access

If you use Tailscale, you can bind directly to your Tailnet address.

```bash
TAILNET_IP="$(tailscale ip -4)"
BASE_DIR="$HOME/.fenrir-tailnet"
bun run --cwd apps/server start -- auth pairing create --base-dir "$BASE_DIR" --base-url "http://$TAILNET_IP:3773"
bun run --cwd apps/server start -- --host "$TAILNET_IP" --port 3773 --base-dir "$BASE_DIR" --no-browser
```

Open the printed pair URL from any device in your tailnet.

You can also bind `--host 0.0.0.0` and connect through the Tailnet IP, but binding directly to the Tailnet IP limits exposure.
