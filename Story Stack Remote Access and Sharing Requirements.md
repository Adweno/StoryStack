# Story Stack Remote Access and Sharing Requirements

## Purpose

Story Stack should be a self-contained audiobook server and client platform that can be installed by regular users, accessed outside the home network, and shared with invited listeners through Story Stack accounts.

## Product Goals

1. Let an owner access their audiobook library from outside their home network.
2. Let an owner share selected access with other people.
3. Make setup approachable for non-technical users on Windows or Linux.
4. Keep audiobook files read-only and avoid disrupting existing folder organization or media tooling.
5. Provide a clean Store and My Library experience with user-specific shelves, progress, and downloads.

## Guiding Product Decision

Story Stack should own the app experience end to end:

- Story Stack owns users and roles.
- Story Stack owns sharing and invite flows.
- Story Stack owns Store visibility, My Library, shelves, and progress.
- Story Stack serves audiobook playback and downloads directly.
- Remote access is handled through a supported network exposure option managed by Story Stack.

This reduces setup complexity for shared users because they only need a Story Stack account or invite.

## Core User Types

### Owner / Admin

The person who installs Story Stack and controls the audiobook catalog.

Admin can:

- Configure the audiobook folder.
- Configure remote access.
- Create, invite, disable, or remove users.
- Decide whether new users can browse the Store.
- Hide books from the Store.
- Run metadata scans.
- Manage server health and settings.

### Listener / User

A person invited to use the owner's Story Stack library.

User can:

- Sign in to Story Stack.
- Browse the Store if allowed.
- Add books to My Library.
- Remove books from My Library.
- Create and manage personal shelves.
- Listen remotely.
- Download books for offline listening where supported.
- Track personal progress.

### Guest

An unauthenticated visitor.

Guest can:

- See only the login or invite acceptance screen.
- Not browse Store content unless public browsing is explicitly added later.

## Remote Access Strategy

### Preferred Approach

Story Stack should offer a guided remote access setup using one or more supported methods:

1. Cloudflare Tunnel as the recommended beginner-friendly option.
2. Manual reverse proxy with HTTPS for users who already have a domain.
3. Local-only mode for users who only want home-network access.

### Remote Access Requirements

- The server must be reachable through a stable URL.
- Remote access must use HTTPS for production use.
- The app should clearly show whether remote access is configured.
- The app should validate the public URL with a health check.
- The app should warn when the configured URL is a private LAN address such as `192.168.x.x`, `10.x.x.x`, or `localhost`.
- The Windows desktop app should connect to the configured Story Stack URL.
- Mobile and browser users should use the same public URL.

### Non-Goals

- Story Stack should not require router port forwarding as the default setup path.
- Story Stack should not require a separate media-service account for remote access.
- Story Stack should not require listeners to be added to an external sharing service.

## Authentication Requirements

### Primary Authentication

Story Stack should provide native authentication.

MVP options:

- Email and password.
- Admin-created users.
- Invite links that let users finish account setup.

Future options:

- Passwordless email login.
- OAuth providers.

### Account Requirements

- Every user must have a unique account.
- Every user must have a role: `admin` or `user`.
- At least one admin account must always exist.
- Admins must be able to disable users without deleting their history.
- Passwords must be securely hashed.
- Sessions must persist safely across app restarts.
- Users must be able to sign out.

## Sharing Requirements

### Invite-Based Sharing

Admins should be able to invite users from Story Stack without managing external media-service shares.

Invite requirements:

- Admin can create an invite for an email address.
- Admin can choose the user's role, defaulting to `user`.
- Admin can set optional invite expiration.
- Admin can revoke unused invites.
- Invite acceptance creates or activates a Story Stack account.
- Invite status should be visible in Settings.

### User Management

Admins should be able to:

- Add users manually.
- Send or copy invite links.
- Change user role.
- Disable or re-enable users.
- Remove users.
- View last login date.
- View whether the user has accepted an invite.

### Access Control

- Users can only access their own My Library, shelves, downloads, and progress.
- Admins can manage Store/catalog settings.
- Admins should not automatically see or modify user shelves unless an explicit support/admin mode is added later.
- Removing a user should not modify source audiobook files.

## Audiobook Serving Requirements

Story Stack should serve audio directly from the configured audiobook folder.

Requirements:

- Support HTTP range requests for seeking and resumable playback.
- Support common audiobook/audio formats such as `m4b`, `mp3`, `m4a`, `aac`, `flac`, `ogg`, `opus`, `wav`, and `wma` where the client can play them.
- Never move, rename, delete, or rewrite source media files.
- Use server-side authorization before serving audio.
- Allow sample playback in Store if desired.
- Allow full playback for books in a user's My Library.
- Support offline downloads for authorized users.

## Catalog and Metadata Requirements

### Catalog Source

The owner configures one or more audiobook folders. Story Stack scans those folders recursively and imports catalog entries into its own database.

Requirements:

- Folder scanning must include subfolders.
- Store entries must remain stable across scans when files move minimally or metadata changes.
- Removed source files should be marked unavailable or removed from Store according to admin settings.
- Scan results should be displayed in plain, user-friendly language.

### Metadata

Story Stack should build metadata from multiple sources in this order:

1. Existing embedded media tags.
2. Existing sidecar metadata files, if present.
3. Audiobookshelf metadata, if configured.
4. Online metadata lookup, such as Google Books or other providers.
5. Manual admin edits in a future release.

Requirements:

- Missing covers should use a clean generated placeholder cover.
- Metadata enrichment should not overwrite good existing metadata without admin approval.
- Metadata lookup should be batchable and resumable.
- Admin should see a readable summary of what changed.

## Store Requirements

The Store is the full shared catalog available to users.

Requirements:

- Store should visually feel distinct from My Library.
- Store should support browsing by title, series, author, and genre.
- Store Home should include category rows similar to Audiobookshelf-style organization.
- Store should highlight a random featured book each time it opens.
- Users can add a single book to My Library.
- Users can add an entire series to My Library.
- Users can add all books by an author to My Library.
- Standalone books should not appear in the Series tab.
- Store playback should be sample-oriented, not full shared-space playback, unless the book is in My Library.

## My Library Requirements

My Library is user-specific.

Requirements:

- Users can browse by title, series, author, genre, shelves, and downloads.
- Users can remove a single book from My Library.
- Users can remove all books in a series or author group with confirmation.
- Users can move books to shelves.
- Users can create and browse shelves.
- Users can download books for offline listening where supported.
- The Downloads tab should let users see and manage downloaded books.

## Desktop App Requirements

The Windows app should be a desktop client for Story Stack, not a local server.

Requirements:

- The first screen should be a Story Stack login or invite screen, not a server-address form for normal users.
- The app should use a configured server URL supplied by the installer, managed device configuration, or first-run owner setup.
- If no server is configured, the app should show a friendly setup screen for owners/admins.
- The app should remember the chosen server.
- The app should allow changing servers from the menu.
- The app should support offline downloads using local app storage.
- The app should not require audiobook files to exist on the Windows machine.

### Publishable App Expectation

For a future public release, the Windows app should be installable by any listener. The listener should only need:

1. The app.
2. A Story Stack invite or account.
3. Internet access.

They should not need:

- Access to the owner's file system.
- Access to the owner's file system.
- Knowledge of the owner's local IP address.

## Admin Setup Workflow

1. Admin installs Story Stack server on Windows, Linux, NAS, or Docker.
2. Admin creates the first admin account.
3. Admin chooses audiobook folder.
4. Story Stack scans the folder and builds the Store catalog.
5. Admin reviews scan results and missing metadata.
6. Admin enables remote access.
7. Story Stack verifies the public URL.
8. Admin invites users.
9. Users accept invites and start listening.

## Listener Workflow

1. Listener receives an invite link or account.
2. Listener opens the web app or installs the desktop app.
3. Listener signs in to Story Stack.
4. Listener browses the Store.
5. Listener adds books to My Library.
6. Listener listens, tracks progress, and optionally downloads for offline use.

## Remote Access Setup Workflow

1. Admin opens Settings.
2. Admin chooses Remote Access.
3. Admin selects setup method:
   - Cloudflare Tunnel
   - Manual HTTPS reverse proxy
   - Local-only
4. Story Stack guides the admin through required steps.
5. Admin enters or confirms the public URL.
6. Story Stack checks `/api/health` from the configured URL.
7. Story Stack marks remote access as ready.

## User Invite Workflow

1. Admin enters the listener's email address.
2. Admin chooses role.
3. Story Stack creates an invite link.
4. Admin sends the invite.
5. Listener opens the invite.
6. Listener sets password or signs in through the chosen authentication method.
7. Story Stack activates the user.
8. Listener lands in My Library or Store.

## Risks and Open Questions

- Remote access setup must be simple enough for non-technical owners.
- Public sharing requires strong account security and HTTPS.
- Offline downloads may need different behavior in browser, desktop, and mobile contexts.
- Email delivery may be needed for polished invite workflows.
- Some audiobook formats may not play natively in all clients.
- Metadata providers may have rate limits or inconsistent results.
- A future hosted relay or managed setup service could simplify remote access but would add operating costs.

## MVP Recommendation

The next clean build phase should focus on making Story Stack fully self-contained:

1. Add native Story Stack authentication.
2. Add invite-based user sharing.
3. Add direct authorized audio streaming.
4. Add Remote Access settings with public URL validation.
This path best supports a future public release where anyone can install Story Stack, invite listeners, and share an audiobook library without requiring a separate media account.
