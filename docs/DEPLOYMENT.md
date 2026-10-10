# Using it from your phone (HTTPS proxy mode)

The server itself speaks plain HTTP and should stay bound to `127.0.0.1`. To reach it from another
device, put a TLS-terminating proxy in front. The recommended setup is Tailscale Serve: the proxy
adds HTTPS and your phone connects over your private tailnet. The server is never exposed to the
public internet.

> Status: the server-side settings below are covered by automated tests (host allow-list, Secure
> cookie). The Tailscale commands are **not verified by the project's tests**; follow Tailscale's
> current documentation and check `tailscale serve --help` for your version.

## Steps

1. Install Tailscale on the PC and on the phone, signed in to the same tailnet. Enable HTTPS
   certificates for the tailnet in the Tailscale admin console.
2. Find the PC's tailnet name, e.g. `my-pc.tail1234.ts.net`.
3. Configure the server (environment or `.env`):

   ```
   HOST=127.0.0.1
   ALLOWED_HOSTS=my-pc.tail1234.ts.net
   ALLOWED_ORIGINS=https://my-pc.tail1234.ts.net
   COOKIE_SECURE=true
   ```

4. Run `npm run build`, start the server (`npm run start -w @rta/server`), then proxy HTTPS to it with Tailscale Serve (target `127.0.0.1:8787`).
5. On the phone open `https://my-pc.tail1234.ts.net`, type the pairing code printed in the server
   console, and the device is paired.

The server serves the built web client itself, so one port is enough. Run `npm run build` once;
at startup the server prints whether it found `apps/web/dist`. (During development, `npm run dev:web`
proxies the API to the server instead.)

## Quick LAN test (functional check only)

Plain HTTP on your home Wi-Fi, to check that the page, pairing and typing work on a phone. The
pairing code and cookie travel unencrypted on that network, so do this only on a network you trust,
and stop the server afterwards.

1. `npm run build`.
2. Find the PC's Wi-Fi IPv4 address (`ipconfig`), e.g. `192.168.1.20`.
3. In PowerShell, from the repo root:

   ```powershell
   $env:HOST = '192.168.1.20'
   $env:ALLOWED_ORIGINS = 'http://192.168.1.20:8787'
   $env:ALLOW_INSECURE_BIND = 'true'
   npm run start -w @rta/server
   ```

4. Windows Firewall may block inbound connections, especially if the network profile is "Public".
   Allow Node.js on private networks when prompted, or switch the Wi-Fi profile to Private.
5. On the phone (same Wi-Fi) open `http://192.168.1.20:8787` and enter the code from the console.

What to check: pairing form -> prompt; typing; the Esc/Tab/Ctrl/arrow toolbar; refresh keeps the
session; lock and unlock the phone (it should reconnect); the Devices panel; revoking the phone from
a PC browser sends the phone back to the pairing form within about 15 seconds.

## What each setting does

| Setting                | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `ALLOWED_HOSTS`        | Extra hostnames (no port) accepted in the `Host` header. Blocks DNS rebinding. |
| `ALLOWED_ORIGINS`      | Browser origins accepted for requests and WebSockets. Wildcards are rejected.  |
| `COOKIE_SECURE`        | Adds `Secure` to the device cookie so it is only sent over HTTPS.              |
| `ALLOW_INSECURE_BIND`  | Needed to bind beyond loopback. Avoid; use a proxy instead.                    |
| `AUDIT_RETENTION_DAYS` | Audit events older than this are deleted (default 90).                         |
| `AUDIT_MAX_ROWS`       | Upper bound on audit rows kept (default 10000).                                |

Revoked or expired devices are also removed after the retention period. Pruning runs at startup and
hourly.

## Security notes

- Anyone who can reach the proxy URL still needs a pairing code from the PC's console, then a
  device cookie.
- Tailscale sees connection metadata, not terminal content (traffic is end-to-end encrypted
  between your devices). It is still a third-party dependency in your trust chain.
- Do not expose the server through a public tunnel without an additional authentication layer.
- Any paired device can revoke any other and read the audit log.
