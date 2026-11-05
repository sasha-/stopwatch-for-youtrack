# Chrome Web Store submission — Stopwatch for YouTrack

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), field by field.

## Upload

- **Package:** `stopwatch-for-youtrack-1.0.0.zip` (built from this repo with `npm run zip`)

## Store listing tab

**Name** (comes from the manifest): Stopwatch for YouTrack

**Summary** (max 132 chars, from the manifest description):
> One-click stopwatch for YouTrack time tracking. Logs work items, works offline, and keeps your token encrypted.

**Description:**

```
Stopwatch for YouTrack adds a one-click timer to YouTrack time tracking.

Pick an issue, start the clock, stop it — the time is logged to YouTrack as a work item, dated when you started.

FEATURES
• Issues from the page you're on: a single issue, an issue list or search, a saved search, a tag, or an agile board (grouped by column).
• Search as you type: the current page, issues you recently worked on, and all of YouTrack — partial words and project names match too.
• Edit the start time if you forgot to press start, choose a work type, or discard a timer.
• Works offline: if YouTrack can't be reached, the work item is kept and sent automatically later.
• Recent work grouped by week and day with totals; restart or delete entries.
• Toolbar popup in normal windows, plus a floating stopwatch inside YouTrack when it runs as an app window (no toolbar).
• Multiple YouTrack accounts; light and dark theme.

SECURITY AND PRIVACY
• Paste your YouTrack permanent token once. It is encrypted (AES-256-GCM) with a key generated in your browser that cannot be exported, and only the extension's background worker can use it.
• The extension talks only to the YouTrack server you enter. Nothing is sent to the developer or any third party. No analytics, no tracking, no ads.
• Access is requested for your YouTrack site only — not for other websites. Your YouTrack admin does not need to enable "Allow all origins".
• Open source (MIT): read exactly what it does on GitHub.

SETUP
1. Click the toolbar icon → Open setup.
2. Enter your YouTrack address (e.g. yourcompany.youtrack.cloud) and a permanent token (YouTrack → Profile → Account Security → Tokens).
3. Allow access to your YouTrack site when Chrome asks.

Works with YouTrack Cloud and self-hosted YouTrack over HTTPS.

YouTrack is a trademark of JetBrains s.r.o. This extension is an independent project and is not affiliated with or endorsed by JetBrains.
```

**Category:** Productivity → Workflow & Planning (or "Productivity" if sub-categories aren't offered)

**Language:** English

**Graphic assets** (all in this folder):

| Field | File |
|---|---|
| Store icon (128×128) | `icon-128.png` |
| Screenshots (1280×800, up to 5) | `screenshot-1.png` … `screenshot-5.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile | optional, leave empty |

**Official URL:** leave empty unless you verify a domain. **Homepage URL:** `https://github.com/<you>/stopwatch-for-youtrack`
**Support URL:** `https://github.com/<you>/stopwatch-for-youtrack/issues`

## Privacy practices tab

**Single purpose:**
> Track time spent on YouTrack issues with a stopwatch and save it to the user's YouTrack server as work items.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, the running timer, work items waiting to be sent while offline, and the user's YouTrack token in encrypted form. |
| `alarms` | Retries sending time entries to YouTrack every few minutes when the server could not be reached. |
| `scripting` | Registers a content script on the user's own YouTrack site only, which shows a small stopwatch button when YouTrack runs in an app window without a browser toolbar. |
| Host permission (`https://*/*`, optional) | Requested at runtime for the single YouTrack address the user enters (self-hosted servers can be on any domain). Used to call that server's REST API and to recognise which issue page is open. No other site is accessed. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package.)

**Data usage** — tick these:
- ☑ **Authentication information** (the user's YouTrack token, stored locally and encrypted, sent only to the user's YouTrack server)
- ☑ **Personally identifiable information** (the user's YouTrack name and login, shown in the extension)
- ☑ **Website content** (issue titles and work items read from the user's YouTrack)
- Leave all others unticked.

Then tick all three certifications:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://<you>.github.io/stopwatch-for-youtrack/privacy.html` (GitHub Pages from the `docs/` folder)

## Distribution tab

- **Visibility:** Public
- **Regions:** All regions

## Test instructions (optional "Test instructions" field for reviewers)

```
The extension needs a YouTrack account. A free YouTrack Cloud instance can be created at jetbrains.com/youtrack.
1. Click the toolbar icon → Open setup.
2. Enter the YouTrack address and a permanent token (Profile → Account Security → Tokens).
3. Open an issue in YouTrack, click the toolbar icon, click an issue to start, then click the timer to stop and log.
```
If you want reviewers to test against your own instance, create a throwaway test user and put its address + token here.

## Before you submit

1. Developer account registered (one-time US$5 fee) and email verified.
2. GitHub repo public, and GitHub Pages turned on (Settings → Pages → Branch `main`, folder `/docs`) so the privacy policy URL works.
3. Replace `<you>` above with your GitHub username.
4. Upload the zip, fill the tabs above, **Submit for review**. First reviews usually take a few days; broad host permissions can add time.
