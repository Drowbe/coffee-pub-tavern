# Tenants: one host, many environments

**Status:** decided September 23, 2026 (the shape, the seam, the URL, the roles); not started. The open decisions are at the end.

## What it is for

One deployment serving several paying groups, each with its own people, spaces, settings and modules, sold as an environment plus a set of modules, reached at its own address. And the same software still sold and given away as a self-hosted install, where there is one group and nobody thinks about tenants at all.

## The model

```
host                 the software, one deployment; run by the host admin
  tenant             one group: its own people, spaces, settings, module data, theme
    space            what exists today (a room)
      panes, modules, items
```

A tenant is three things, and a folder of spaces is not one:

- **Isolation.** A tenant's people, spaces, data, settings and module data never meet another's. The Lobby, "everyone's space", means everyone in this tenant.
- **Entitlement.** What a tenant may use is set above it (which modules, how many people, how much storage, how much AI); the tenant chooses within that and cannot widen it.
- **Delegation.** Someone inside the tenant runs it -- its name and icon, theme, spaces, members, which of the entitled modules are on, module settings -- and nothing outside it: the call service, the AI key, module installs, plans, other tenants.

## Decisions

**One store per tenant, not a tenant id on every record.** Each tenant is its own data directory (`DATA_DIR/tenants/<slug>/`: its own users, spaces, settings, module data, uploads), and a small host-level registry sits above them (`DATA_DIR/host.json`: the tenants, their slugs, their entitlements, the host admin). A request resolves its tenant once, at the door, and everything below runs exactly as today against "the server's" data: to the code under the seam, the tenant is the server. This is what keeps every module unchanged (storage scoped to server, space or person; "server" quietly means "the tenant") and what makes a missed filter impossible, since there is no filter to miss. The alternative, threading a tenant id through every query and every module key, touches every line and leaks data across customers the first time one is forgotten.

**The tenant is the subdomain.** `stayingblonde.<base domain>`. The base domain is configuration (`BASE_DOMAIN`), never code: `magpie.coffeepub.live`, `magpie.coffeepub.com`, or anything a self-hoster owns, and a wildcard certificate at the proxy covers every tenant. The hostname's first label picks the store; the paths under it stay what they are, the session cookie is scoped per subdomain by the browser for free, and nothing in the client (`/api/...`, `/modules/:id`, `/sdk/host.js`, the streams, the popout names, the browser's keys) learns a base path. A path form (`<base>/stayingblonde`) is a redirect to the subdomain, if wanted, never the address itself. A tenant's own domain (`plan.stayingblonde.com`) is a later option: a mapping in the registry from a hostname to a slug, and a certificate for it.

**No base domain, no tenants.** With `BASE_DOMAIN` unset the deployment is one tenant, the "default", at whatever hostname it has: today's install, unchanged, and the self-hosted product. Setting a base domain turns the seam on; the existing data becomes the default tenant, so nothing moves. The same image serves both.

**Roles.** Two things sit above "user", and they are not the same thing:

| Role | Scope | Who |
|---|---|---|
| host admin | the deployment | whoever runs the host; invisible to tenants; signs in at the host console, not inside any tenant |
| owner | one tenant | the customer: today's Manage, minus what is host-level (see below) |
| moderator | one space | unchanged: set on a person's profile for a space |
| user, guest | unchanged | |

"Moderator" keeps its space-level meaning; the tenant's runner is its **owner** (the visible word may differ, see open decisions), and a tenant may have more than one. What an owner sees of Manage: Server (the name, icon, sign-in text, sign-up, language, time and money), Theme, Spaces, Roles, Users, Modules (enable and configure among the entitled ones), About. What only the host admin sees: the call service, the AI service and its key, module installs and updates, the Font Awesome package, the tenants and their plans, the base domain.

**Entitlements are the host's, enforced at the seam.** A plan is a set of caps on the registry entry: the modules a tenant may enable (one installed set on the host, enabled per tenant), how many members, how much storage, how much AI (the key is the host's, the quota the tenant's), how many concurrent calls. An owner sees the caps and what is used; the server refuses past them with a plain message. Billing stays outside the app: a payment provider's hosted pages and a webhook that sets the plan on the registry entry, with a grace period before anything is turned off. The app never sees a card.

**Accounts are per tenant.** A person in two tenants has two accounts, as they would at two servers today. One identity across tenants (sign in once, choose the tenant) is a later step that the registry can carry; it must not be the first, since it is exactly the cross-tenant seam the store-per-tenant design keeps closed.

**The call service is shared, its spaces namespaced.** One LiveKit behind the host; a space's call name is prefixed with the tenant's slug so two tenants' lobbies never meet. Per-tenant concurrent-call limits come from the plan.

**Modules see nothing.** `host.info.context` stays as it is (`server` | `room` | `person`); a module never learns which tenant it runs in and cannot address another. The one thing a module page may want, the tenant's name for a title, is what "the server name" already is.

## Phases

1. **The seam.** The registry, the per-tenant store, the resolver at the door (hostname to store; the default tenant when there is no base domain), the host console (create a tenant, set its slug and plan, see its use), and the migration that makes today's data the default tenant. Everything under the seam untouched.
2. **Roles.** The owner role and the host admin; Manage split into what an owner sees and what only the host sees; the host console's own sign-in.
3. **Entitlements.** The caps on the registry entry, enforced: modules, members, storage, AI, calls; what the owner sees of them.
4. **The call service.** Slug-prefixed call names; per-tenant call limits.
5. **Self-serve.** A tenant signing up at the base domain (a slug, an owner account, a plan), the payment provider's pages, the webhook, the grace period, and a tenant's export and deletion.

Phase 1 is the large one and it is plumbing at the door; the rest is policy on top.

## What the current design already gives

One store file per install, module data scoped to server, space or person, settings as one object, "no secrets in modules" (the AI key is above the seam by construction), the host not being the brand (the platform vocabulary has room for one more noun), and every module already blind to anything outside its own scope.

## Open decisions

- **The visible word for a tenant.** "Environment" is accurate and technical; "club" reads as a paid membership, which matches selling it; "circle" reads as a family or a group of friends. The code says tenant and never shows it.
- **The visible word for the owner.** Owner, manager, or the customer's word.
- **Slugs.** Letters, digits and hyphens, 3 to 30, chosen at sign-up and fixed after (a change is a redirect from the old one), reserved words (`www`, `api`, `host`, `admin`...).
- **The host console's address.** `host.<base domain>` or the base domain itself with no tenant; and whether the host admin is a separate account kind (recommended) or a flag on an account in the default tenant.
- **What the default tenant is called** when a base domain is set later on an install that had data (its slug, its address).
- **Entitlement units.** Members as a count; storage as a size; AI as calls per month or tokens per month; calls as concurrent spaces in a call. And what a tenant sees when it is over: refused with a message, or degraded (AI off, uploads off) while the rest runs.
- **The billing provider and the webhook's shape**, and the grace period's length.
- **Backups.** Per tenant (a tenant's directory is its backup and its export) or the whole data directory; and whether an owner can download their tenant's export themselves.
- **Email.** Invites and sign-up links need sending; SMTP is the host's, the sender name the tenant's.
- **A tenant's own domain**, and who holds the certificate.
