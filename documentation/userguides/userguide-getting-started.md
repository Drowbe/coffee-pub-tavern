# Getting Started

**Audience:** someone setting up a Coffee Pub Tavern server for the first time and signing in as its
admin.

Tavern is two services: the Tavern web app and a LiveKit media server that carries the video and
audio. This guide sets both up on a QNAP NAS with Container Station and Nginx Proxy Manager, then
signs in. Any machine that runs Docker works the same way; only the router and proxy steps differ.

## Set it up

Everything the NAS needs is in `docker-compose.yml`, which you paste into Container Station. The app
image is built by GitHub and pulled from `ghcr.io/drowbe/coffee-pub-tavern`.

1. **Make the secrets** in Terminal on your Mac and keep them in a note:
   ```bash
   openssl rand -hex 8    # LiveKit API key
   openssl rand -hex 32   # LiveKit API secret
   openssl rand -hex 8    # your admin password
   ```
2. **DNS.** Add two records at your DNS provider pointing at your public IP, the same address your
   Foundry hostname uses: `tavern.<domain>` and `livekit.<domain>`. If the provider offers proxying
   (Cloudflare's orange cloud), turn it off for these two: media has to reach the NAS directly.
3. **Router.** Forward to the NAS's LAN address: `7881` TCP, `7882` UDP, `3478` UDP. Ports 80 and 443
   already reach Nginx Proxy Manager.
4. **Container Station.** Applications, Create, give it the name `tavern`, paste the contents of
   `docker-compose.yml`, replace the `CHANGE_ME` values (domain, API key, API secret, admin
   password), and click Create. Both containers should show green within a minute.
5. **Nginx Proxy Manager.** Two proxy hosts, each with a Let's Encrypt certificate and Force SSL:
   - `livekit.<domain>` to scheme http, forward host = NAS LAN address, port `7880`, **Websockets
     Support on**.
   - `tavern.<domain>` to scheme http, NAS LAN address, port `3000`.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser. LiveKit
1.12 or newer is required; the compose file pulls the latest release.

## Sign in as the admin

Open `https://tavern.<domain>/`, sign in as `gm` with the admin password from the compose file, and
choose the gear icon to open the Manage page. Add your players under **Users** and send each of them
a login and password, or a personal link; see [Accounts, roles and permissions](userguide-accounts.md).

The admin account named in the compose file is checked on every start: it is created if missing, and
its password is reset to the compose value if it differs. If you forget the admin password, change
`TAVERN_ADMIN_PASSWORD` in Container Station and restart the container.

## Update it later

In Container Station, pull the new image for the `tavern` application and recreate it. Users,
images and settings live in `/share/appdata/tavern`, so nothing is lost.

## Run it on another machine

The app itself has nothing that is specific to a NAS. To run both services on a Windows or Mac
computer, use the same `docker-compose.yml` under Docker Desktop, forward the same ports on your
router, and point the two hostnames at your public address.
