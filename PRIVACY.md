# Privacy Policy — Stopwatch for YouTrack

_Last updated: November 5, 2026_

Stopwatch for YouTrack ("the extension") is a Chrome extension that lets you time your work and log it to your own YouTrack server. It is open source; you can read exactly what it does in this repository.

## What the extension stores, and where

Everything stays in your own Chrome profile on your own computer:

| Data | Why | How it is stored |
|---|---|---|
| Your YouTrack address, user id, login and display name | To know which server and account to use | `chrome.storage.local` |
| Your YouTrack permanent token | To sign API requests to your server | Encrypted with AES-256-GCM using a key generated in your browser that cannot be exported; only the ciphertext is saved |
| The running timer (issue, start time, work type) and work items waiting to be sent | So a timer survives a browser restart and nothing is lost offline | `chrome.storage.local` |
| Your settings (theme, panel mode, days of recent work) | Preferences | `chrome.storage.local` |
| Issues of the YouTrack page you are viewing | To offer them in the issue picker | Session memory, cleared when Chrome closes |

Signing out deletes the account and its token. Removing the last account also deletes the encryption key and the extension's permission to contact the server. Uninstalling the extension removes all of it.

## What the extension sends, and to whom

The extension talks **only to the YouTrack server you enter**, using the YouTrack REST API, to:

- confirm your token and read your name;
- read issues, projects, work types and your recent work items;
- create or delete work items when you stop a timer or press delete.

It does **not** send any data to the developer or to any other party. There are no analytics, no tracking, no ads, no remote code, and no third-party services. Browser cookies are never sent with its requests.

## Permissions

- **storage**: saves the settings, timer and encrypted token described above.
- **alarms**: retries unsent work items every few minutes.
- **scripting**: adds the small in-page stopwatch button on your YouTrack pages (only on the server you connected).
- **Access to your YouTrack site** (requested when you connect, for that site only): lets the extension call your server's API and see which issue page you have open.

## Data sale and use

The developer does not collect, sell, transfer or use your data for any purpose. The extension's use of data is limited to providing its single purpose: tracking time to your YouTrack server.

## Changes and contact

Changes to this policy are published in this repository. Questions: open an issue on the GitHub repository.

YouTrack is a trademark of JetBrains s.r.o. This extension is an independent project and is not affiliated with or endorsed by JetBrains.
