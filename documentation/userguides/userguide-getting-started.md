# Getting Started

**Audience:** someone setting up a Coffee Pub Magpie server for the first time and signing in as its
admin.

Magpie is two services: the Magpie web app and a LiveKit media server that carries the video and
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
   Foundry hostname uses: `magpie.<domain>` and `livekit.<domain>`. If the provider offers proxying
   (Cloudflare's orange cloud), turn it off for these two: media has to reach the NAS directly.
3. **Router.** Forward to the NAS's LAN address: `7881` TCP, `7882` UDP, `3478` UDP. Ports 80 and 443
   already reach Nginx Proxy Manager.
4. **Container Station.** Applications, Create, give it the name `magpie`, paste the contents of
   `docker-compose.yml`, replace the `CHANGE_ME` values (domain, API key, API secret, admin
   password), and click Create. Both containers should show green within a minute.
5. **Nginx Proxy Manager.** Two proxy hosts, each with a Let's Encrypt certificate and Force SSL:
   - `livekit.<domain>` to scheme http, forward host = NAS LAN address, port `7880`, **Websockets
     Support on**.
   - `magpie.<domain>` to scheme http, NAS LAN address, port `3000`.

Camera access requires HTTPS, which the proxy provides. Players need nothing but a browser. LiveKit
1.12 or newer is required; the compose file pulls the latest release.

## Sign in as the admin

Open `https://magpie.<domain>/`, sign in as `gm` with the admin password from the compose file, and
choose the gear icon to open the Manage page. Add your players under **Users** and send each of them
a login and password, or a personal link; see [Accounts, roles and permissions](userguide-accounts.md).

The admin account named in the compose file is checked on every start: it is created if missing, and
its password is reset to the compose value if it differs. If you forget the admin password, change
`ADMIN_PASSWORD` in Container Station and restart the container.

## Update it later

An install made before the product's rename keeps its old names: the containers `tavern-app` and
`tavern-livekit`, the data path `/share/appdata/tavern` and the `TAVERN_ADMIN_*` variables all still work
(the old variable names are honoured, and the old session cookie and data file are carried over on start).
Do not change the volume path of an existing install: the data lives there.


In Container Station, pull the new image for the `magpie` application and recreate it. Users,
images and settings live in `/share/appdata/magpie`, so nothing is lost.

Take a copy of `/share/appdata/magpie` before you update. An update can bring the data up to date for the
new version, and an older version then refuses to open it rather than misread it: going back to an older
image means putting back that copy as well.

## Environments: one server, several groups

One server can serve several groups, each with its own address, people, spaces, settings and modules: an
**environment**. A group's environment is `<slug>.<base domain>`, and the whole server is run from a
host console at `admin.<base domain>`. With no base domain set, the server is one environment at whatever
address it has, which is everything above; nothing here is needed for that.

To switch environments on, with the server already running as above:

1. **DNS.** Add a wildcard record at your DNS provider, so every subdomain of the base resolves to the same
   place: host `*.<base>` (relative to your domain, the way the provider shows your other records), a CNAME
   to the base hostname. Check with `dig +short admin.<base>`: it should end in the same address as the base.
2. **The proxy host.** Edit the proxy host for the base hostname: add `*.<base>` as a second domain name
   and request a new Let's Encrypt certificate covering both. A wildcard certificate needs the **DNS
   challenge**: turn it on, pick your DNS provider from the list, and give it the API credentials it asks for
   (your provider may need API access enabled and the server's public IP whitelisted first). If your provider
   is not in the list, name each environment explicitly on the certificate instead (`admin.<base>`,
   `<slug>.<base>`, one per environment) with the ordinary challenge, and add a name whenever you create one.
   Force SSL and HTTP/2 as before.
3. **The container, for one start.** Take a copy of `/share/appdata/magpie` first. Remove
   `ADMIN_USER` and `ADMIN_PASSWORD` (they apply only to a server without a base domain) and
   add:
   ```yaml
   BASE_DOMAIN: "magpie.example.com"
   MIGRATE_ENVIRONMENT_SLUG: "thepub" # what your existing server becomes; used once
   HOST_ADMIN_LOGIN: "yourlogin"       # the host console account; seeded once
   HOST_ADMIN_PASSWORD: "a strong one"
   ```
   Recreate the container. On that start the existing data moves into `environments/<slug>/` on the same
   volume and the environment is recorded; everyone's accounts, spaces and layouts come with it, at
   `https://<slug>.<base>`. If you used the older name, `MIGRATE_TENANT_SLUG`, it still works for now, and the
   log says to change it.

**Two-step sign-in, and getting back in.** Three switches, one inside the other. `ENABLE_MFA` (in the
compose file, `"true"` by default) says whether the server offers a second step at all; with it off nobody is
asked and nobody can set one up. When it is offered, each environment's admin chooses on Manage > Server
whether to **require** it of everyone, and otherwise each person chooses on their own profile. Host admins
set theirs up on the console's Host tab, and `HOST_MFA_REQUIRED: "true"` makes it mandatory for them. The
secrets are encrypted with a key the server makes on first start (`secrets.key` beside the data on a single
server, inside `host.json` with environments), so an environment's export carries nothing readable. If an
admin is locked out, set `ADMIN_MFA_LOCKOUT_BYPASS: "true"` and recreate the container: admins and host
admins are then signed in on the password alone (members are still asked), their profile offers **Reset my
second factor** with the password, and Manage and the console show a banner until you set it back to
`"false"`. Nothing is deleted by either switch.

**Plans, sign-up and billing.** The host console's **Plans** panel is the catalog: `free` (what sign-up
makes, and what a lapsed environment goes back to) and any named plans, each with its caps (members,
storage, assistant calls a month, calls at once, modules). An environment is put on a plan from its card,
which fills its caps from the catalog to adjust on its own. The product page at the base domain lists the
plans and, only when the server has `SIGNUP: "on"`, makes a free environment for anyone who asks (an
address, a name, an owner account); without it the page offers no sign-up form, just the plans and a way to
write to you. Selling a plan is the payment provider's own hosted page: set `BILLING_CHECKOUT_<PLAN>`
(the plan id in capitals, `BILLING_CHECKOUT_STANDARD`, say) to that page's address, and the product page's
plan buttons and an owner's Upgrade go there with `?environment=<slug>`. The provider tells the server
what happened through the webhook at `https://admin.<base>/api/host/billing`: a JSON body
`{ "slug", "plan", "event" }` with `event` one of `paid`, `lapsed` and `cancelled`, signed with
`BILLING_SECRET` as an `x-billing-signature` header (HMAC-SHA256 of the raw body, in hex). A provider's
own webhook shape is adapted to that outside the app, by a small relay, which is what keeps every
provider's card handling out of it. A lapsed environment is past due for fourteen days, with a banner
for its owners, then goes to the free plan's caps; nothing is ever deleted by billing. An owner can
download a copy of their environment and ask for its deletion from Manage; a host admin carries the
deletion out from the console.
4. **Then** remove the last three variables, keep `BASE_DOMAIN`, and recreate again. They were read once.

A server that already had environments before this version renames its folders on its first start:
`tenants/` becomes `environments/` and `tenants-deleted/` becomes `environments-deleted/`. Nothing else
changes, the change is noted in `host.json`, and a copy of `host.json` as it was is kept in
`pre-names-host/names-environment/`. If the start stops with a line saying `host.json` lists environments
under both "tenants" and "environments", open `host.json`, remove whichever list is out of date, and start again.

From there: `https://admin.<base>` is the host console (create an environment with its first owner, set its
plan, back it up and restore it, suspend it and **Resume** it, or delete it aside, which keeps its data under
`environments-deleted/`), `https://<slug>.<base>` each environment, and the bare
`https://<base>` the product page. Two optional variables feed that page: `PRODUCT_NAME` (the name it shows;
the default is the app's own) and `CONTACT_EMAIL` (where "ask for an environment" writes to). If the base
domain ever changes, set the new one as `BASE_DOMAIN` and list the old one in `PREVIOUS_BASE_DOMAINS`;
every old address redirects to the new.

## Back up and restore an environment

A host admin does this from the host console's **Environments** tab. Each environment's card has
**Backup** and **Restore backup**.

To back one up, click **Backup** on its card. The browser saves the whole environment as a zip named
`<slug>-<date>.zip`: every setting, account, space, picture and module's data.

To restore one from a backup:

1. Click **Restore backup** on the environment's card, and choose the zip.
2. The button now reads **Replace its data?**. Click it again within eight seconds to go ahead; after that
   it goes back to **Restore backup** and nothing happens.
3. Everything in that environment is replaced by what is in the zip. The message beside the **Environments** heading says
   "<slug> was restored from <file>." when it worked, or "<slug> was not restored:" and the reason when it
   did not, in which case nothing was changed.

A backup made by a newer version of Magpie than the one running is refused ("This backup is from a newer
version of Magpie."), and the environment is left as it was.

## An environment that won't open

An environment's card can carry the tag **won't open**, with a red edge and a dash for every count. Its
people see a page saying the environment's data is from a newer version of Magpie, or could not be updated;
every other environment keeps working. The card says which, and names the file and when it happened:

- **Won't open: its data is from a newer version of Magpie.** A newer version of Magpie has run on this
  environment's data, and this one cannot read it. Run the newer version again, or restore a backup made
  before it.
- **Won't open: its data could not be updated.** The data could not be brought up to date on this start.
  Restore a good backup. The server's log has the details.

After a restore the environment opens straight away, with no restart. If the restored data won't open
either, the message says "<slug> was restored, but still won't open", and an older backup is the next thing
to try.

A server with no base domain is one environment, and has no console: if its data is from a newer version,
the server does not start, and its log says so and names the file. Run the newer version again, or put back
the copy of the data folder you took before the update.

## Run it on another machine

The app itself has nothing that is specific to a NAS. To run both services on a Windows or Mac
computer, use the same `docker-compose.yml` under Docker Desktop, forward the same ports on your
router, and point the two hostnames at your public address.
