# Google Calendar Sync Plan

**Audience:** whoever builds the sync, and the author who needs to supply the Google credentials.

**Status:** Designed, not started. The approach was decided with the author (one way, each person connects their own account). Building it needs a Google Cloud OAuth client, which only the author can create; without one nothing here can run against Google.

## Decided

- **One way, Google to Tavern.** Each person links their own Google account and chooses which of its calendars to show. Their events appear in the Calendar for them only, read only. Nothing is written back to Google, and nobody sees another person's Google events.
- **Server side.** Modules run only in the browser and never hold a credential (a module in the page could take one). So the connection, the tokens and the fetching live on the server, and a module only ever asks for the events.
- **No secrets in modules.** The Google client id and secret are server settings (environment), never anything a module or a page can read.

## How it works

1. **Setup (admin, once).** Create an OAuth client in Google Cloud (a web application, with the calendar read-only scope), set its redirect address to the server's `/api/google/callback`, and give the server its id and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and its public address as `PUBLIC_URL`. Until they are set, the feature is off and offers nothing.
2. **Connect (each person).** On their profile page, **Connect Google Calendar** sends them to Google to allow read-only access, and back. The server keeps the refresh token, encrypted with a key derived from the server's session secret, in its data folder. **Disconnect** deletes it.
3. **Choose calendars.** The profile lists the account's calendars with a tick for each; only ticked ones are read.
4. **Sync.** The server refreshes each connected person's events every 15 minutes (and on a button) for a window of 30 days back to 180 days ahead, expanding repeating events, and keeps them per person.
5. **Show.** The Calendar asks Tavern for the viewer's own external events (a generic "feed of dated items", so a later source needs no change to the Calendar) and draws them among its own, marked with the calendar's name and read only. The dashboard's Coming up and the Travel suggestions can use the same feed.

## The feed conduit

Tavern names no module and no provider. A provider registers a per-person feed of dated items (title, start, end, all day, source name); a module that declares it may read that kind of feed (approved by an admin, as reading events is) can ask for the viewer's items between two dates. Google is the first provider.

## Phases

1. The server: the connection, token storage, calendar list, sync and the events route, checked against a local stand-in for Google.
2. The profile page: connect, disconnect, choose calendars, sync now, and its status.
3. The feed conduit and the Calendar showing external events.
4. Coming up and Travel suggestions using the feed.

## Open

- Whether to also offer choosing a colour per calendar (Google supplies one).
- Whether an admin should be able to turn the feature off per role.
- Two-way sync (writing Calendar events to Google) was left out on purpose; it needs a shared account or per-person write scope and conflict rules.
