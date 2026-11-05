import {
  PANEL_PORT,
  STATE_EVENT,
  type ContentRequests,
  type PanelStatus,
  type RequestMessage,
  type RequestType,
  type Requests,
} from "../shared/messages";
import type { IssueRef, PageIssues, QueuedWorkItem, UiState, WorkType } from "../shared/types";
import { durationMinutes, formatClock } from "../shared/time";
import { accentPalette, isHexColor, RUNNING_COLOR } from "../shared/color";
import { loadPageIssues } from "./page";
import {
  currentAccount,
  mutate,
  NO_PAGE,
  publicAccount,
  read,
  readPage,
  writePage,
  type StoredAccount,
} from "./store";
import { destroyKey, forget, seal, unseal } from "./vault";
import { ApiError, normaliseBaseUrl, YouTrack } from "./youtrack";

const EXT_ID = chrome.runtime.id;
const QUEUE_ALARM = "ytsw:flush-queue";

// ---------------------------------------------------------------- helpers

const originOf = (baseUrl: string) => new URL(baseUrl).origin;
// Chrome match patterns can't contain a port; the origin check (with port) is
// done separately wherever it matters.
const originPattern = (baseUrl: string) => `https://${new URL(baseUrl).hostname}/*`;

class UserError extends Error {}

async function clientFor(account: StoredAccount): Promise<YouTrack> {
  const token = await unseal(account.id, account.sealed);
  if (!token) {
    await markNeedsLogin(account.id);
    throw new UserError("Your token for this account can't be read anymore. Please paste it again.");
  }
  return new YouTrack(account.baseUrl, token);
}

async function markNeedsLogin(accountId: string) {
  forget(accountId);
  await mutate((s) => {
    if (s.accounts[accountId]) s.accounts[accountId].needsLogin = true;
  });
}

/** Runs an API call; a 401 flags the account so the UI asks for a new token. */
async function withClient<T>(fn: (yt: YouTrack, acc: StoredAccount) => Promise<T>): Promise<T> {
  const s = await read();
  const acc = currentAccount(s);
  if (!acc) throw new UserError("Not signed in.");
  const yt = await clientFor(acc);
  try {
    return await fn(yt, acc);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await markNeedsLogin(acc.id);
      throw new UserError("YouTrack rejected the token (expired or revoked). Please paste a new one.");
    }
    throw e;
  }
}

// ---------------------------------------------------------------- state

async function buildState(): Promise<UiState> {
  const s = await read();
  const acc = currentAccount(s);
  return {
    accounts: Object.values(s.accounts).map(publicAccount),
    currentAccountId: acc?.id ?? null,
    settings: s.settings,
    timer: acc ? s.timers[acc.id] ?? null : null,
    queue: s.queue,
    page: acc ? await readPage() : NO_PAGE,
  };
}

const panelPorts = new Set<chrome.runtime.Port>();

async function broadcast(): Promise<UiState> {
  const state = await buildState();
  chrome.runtime.sendMessage({ event: STATE_EVENT, state }).catch(() => {
    /* no UI open */
  });
  const status: PanelStatus = {
    running: !!state.timer,
    issueId: state.timer?.issue.idReadable ?? null,
    start: state.timer?.start ?? null,
    accent: state.settings.accent,
  };
  for (const p of panelPorts) {
    try {
      p.postMessage(status);
    } catch {
      panelPorts.delete(p);
    }
  }
  await updateAction(state).catch((e) => console.warn("[Stopwatch] toolbar icon", e));
  return state;
}

/** Draws the stopwatch icon in any colour (same geometry as icons/icon.svg). */
function drawIcon(size: number, color: string): ImageData {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d")!;
  g.scale(size / 128, size / 128);
  g.fillStyle = color;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  rr(52, 4, 24, 14, 5);
  g.fillRect(59, 14, 10, 12);
  g.save();
  g.translate(105, 28);
  g.rotate(Math.PI / 4);
  rr(-9, -6, 18, 12, 4);
  g.restore();
  g.beginPath();
  g.arc(64, 74, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(64, 74, 38, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(64, 74);
  g.lineTo(64, 44);
  g.stroke();
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(64, 74);
  g.lineTo(84, 86);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 74, 8, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, size, size);
}

let lastIconKey = "";
async function updateAction(state: UiState) {
  const color = state.timer ? RUNNING_COLOR : accentPalette(state.settings.accent).light;
  if (color !== lastIconKey) {
    await chrome.action.setIcon({ imageData: { 16: drawIcon(16, color), 32: drawIcon(32, color), 48: drawIcon(48, color) } });
    lastIconKey = color;
  }
  const pending = state.queue.length;
  if (pending > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#e8710a" });
    await chrome.action.setBadgeText({ text: String(pending) });
    await chrome.action.setTitle({ title: `Stopwatch: ${pending} work item(s) waiting to sync` });
  } else {
    const n = state.page.issues.length;
    await chrome.action.setBadgeBackgroundColor({ color: "#888" });
    await chrome.action.setBadgeText({ text: n ? String(n) : "" });
    await chrome.action.setTitle({
      title: state.timer ? `Stopwatch: tracking ${state.timer.issue.idReadable}` : "Stopwatch for YouTrack",
    });
  }
}

// ---------------------------------------------------------------- page tracking

let lastPageUrl = "";
let lastPageAt = 0;

async function refreshPage(pageUrl?: string, force = false): Promise<void> {
  const s = await read();
  const acc = currentAccount(s);
  if (!acc || acc.needsLogin) {
    await writePage(NO_PAGE);
    return;
  }
  if (!pageUrl) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return; // e.g. devtools focused: keep what we have
    pageUrl = tab.url ?? ""; // url is only visible for origins we hold permission for
  }
  if (!pageUrl.startsWith(originOf(acc.baseUrl) + "/")) {
    lastPageUrl = "";
    await writePage(NO_PAGE);
    return;
  }
  if (!force && pageUrl === lastPageUrl && Date.now() - lastPageAt < 30000) return;
  lastPageUrl = pageUrl;
  lastPageAt = Date.now();
  let page: PageIssues;
  try {
    page = await withClient((yt) => loadPageIssues(yt, pageUrl!, acc.baseUrl));
  } catch (e) {
    page = { ...NO_PAGE, error: (e as Error).message };
  }
  await writePage(page);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshPage();
    await broadcast();
  }, 300);
}

chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === "complete" || info.url)) scheduleRefresh();
});
chrome.windows.onFocusChanged.addListener((id) => {
  if (id !== chrome.windows.WINDOW_ID_NONE) scheduleRefresh();
});

// ---------------------------------------------------------------- content scripts

async function syncContentScripts() {
  const s = await read();
  const origins = [...new Set(Object.values(s.accounts).map((a) => originPattern(a.baseUrl)))];
  const granted: string[] = [];
  for (const o of origins) {
    if (await chrome.permissions.contains({ origins: [o] })) granted.push(o);
  }
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts();
  if (!granted.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: "ytsw-panel",
      js: ["dist/content.js"],
      matches: granted,
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

// ---------------------------------------------------------------- queue

let flushing: Promise<void> | null = null;

function flushQueue(): Promise<void> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function doFlush() {
  const s = await read();
  for (const item of s.queue) {
    const acc = s.accounts[item.accountId];
    let error: string | null = null;
    let done = false;
    if (!acc) {
      done = true; // account removed: nothing to post to
    } else {
      try {
        const yt = await clientFor(acc);
        const minutes = durationMinutes(item.start, item.end);
        await yt.addWorkItem(item.issue.idReadable, {
          start: item.start,
          minutes,
          text: `${formatClock(new Date(item.start))}–${formatClock(new Date(item.end))}`,
          workType: item.workType,
        });
        done = true;
      } catch (e) {
        error = (e as Error).message;
        if (e instanceof ApiError && e.status === 401) await markNeedsLogin(acc.id);
      }
    }
    await mutate((st) => {
      const idx = st.queue.findIndex((q) => q.localId === item.localId);
      if (idx < 0) return;
      if (done) st.queue.splice(idx, 1);
      else st.queue[idx] = { ...st.queue[idx], attempts: st.queue[idx].attempts + 1, lastError: error };
    });
    if (!done && error && /Cannot reach/.test(error)) break; // offline: stop for now
  }
}

// ---------------------------------------------------------------- timer

async function stopTimer(accountId: string): Promise<void> {
  await mutate((s) => {
    const t = s.timers[accountId];
    if (!t) return;
    delete s.timers[accountId];
    const item: QueuedWorkItem = {
      localId: crypto.randomUUID(),
      accountId,
      issue: t.issue,
      start: t.start,
      end: Date.now(),
      workType: t.workType,
      attempts: 0,
      lastError: null,
    };
    s.queue.push(item);
  });
  await flushQueue();
}

function cleanIssue(i: IssueRef): IssueRef {
  if (!i || typeof i.idReadable !== "string" || !/^[\w.-]+-\d+$/.test(i.idReadable)) {
    throw new UserError("Invalid issue.");
  }
  return {
    idReadable: i.idReadable,
    summary: String(i.summary ?? "").slice(0, 500),
    projectId: String(i.projectId ?? ""),
    projectName: String(i.projectName ?? ""),
    resolved: !!i.resolved,
  };
}

function cleanWorkType(w: WorkType | null | undefined): WorkType | null {
  if (!w) return null;
  return { id: String(w.id), name: String(w.name) };
}

// ---------------------------------------------------------------- handlers

type Handler<T extends RequestType> = (
  p: Requests[T]["req"],
  ctx: { tabUrl?: string }
) => Promise<Requests[T]["res"]>;

const handlers: { [K in RequestType]: Handler<K> } = {
  "state:get": async (_p, ctx) => {
    await refreshPage(ctx.tabUrl);
    return broadcast();
  },

  "auth:login": async ({ baseUrl, token }) => {
    const url = normaliseBaseUrl(baseUrl);
    token = String(token || "").trim();
    if (!token) throw new UserError("Paste your permanent token.");
    if (!(await chrome.permissions.contains({ origins: [originPattern(url)] }))) {
      throw new UserError(`Chrome permission for ${originOf(url)} was not granted.`);
    }
    let me;
    try {
      me = await new YouTrack(url, token).me();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        throw new UserError("YouTrack rejected this token.");
      }
      throw e;
    }
    const id = `${url}|${me.id}`;
    const sealed = await seal(id, token);
    await mutate((s) => {
      s.accounts[id] = {
        id,
        baseUrl: url,
        userId: me.id,
        login: me.login,
        name: me.name || me.login,
        needsLogin: false,
        sealed,
      };
      s.currentAccountId = id;
    });
    await syncContentScripts();
    await refreshPage(undefined, true);
    void flushQueue().then(broadcast);
    return broadcast();
  },

  "auth:logout": async ({ accountId }) => {
    let removedOrigin: string | null = null;
    let anyLeft = true;
    await mutate((s) => {
      const acc = s.accounts[accountId];
      if (!acc) return;
      delete s.accounts[accountId];
      delete s.timers[accountId];
      s.queue = s.queue.filter((q) => q.accountId !== accountId);
      const left = Object.values(s.accounts);
      anyLeft = left.length > 0;
      if (!left.some((a) => originPattern(a.baseUrl) === originPattern(acc.baseUrl))) {
        removedOrigin = originPattern(acc.baseUrl);
      }
      if (s.currentAccountId === accountId) s.currentAccountId = left[0]?.id ?? null;
    });
    forget(accountId);
    if (!anyLeft) await destroyKey();
    await syncContentScripts();
    if (removedOrigin) await chrome.permissions.remove({ origins: [removedOrigin] }).catch(() => false);
    await writePage(NO_PAGE);
    await refreshPage(undefined, true);
    return broadcast();
  },

  "account:switch": async ({ accountId }) => {
    await mutate((s) => {
      if (s.accounts[accountId]) s.currentAccountId = accountId;
    });
    await refreshPage(undefined, true);
    return broadcast();
  },

  "settings:set": async ({ settings }) => {
    await mutate((s) => {
      if (settings.theme && ["system", "light", "dark"].includes(settings.theme)) s.settings.theme = settings.theme;
      if (settings.panelMode && ["app", "always", "off"].includes(settings.panelMode))
        s.settings.panelMode = settings.panelMode;
      if (settings.accent !== undefined && isHexColor(settings.accent)) s.settings.accent = settings.accent.toLowerCase();
      if (settings.recentDays !== undefined) {
        s.settings.recentDays = Math.min(90, Math.max(1, Math.round(Number(settings.recentDays) || 14)));
      }
    });
    return broadcast();
  },

  "page:refresh": async (_p, ctx) => {
    await refreshPage(ctx.tabUrl, true);
    return broadcast();
  },

  "issues:search": async ({ query }) => {
    const q = String(query || "").trim().slice(0, 500);
    if (!q) return [];
    return withClient((yt) => yt.search(q));
  },

  "timer:start": async ({ issue, workType }) => {
    const clean = cleanIssue(issue);
    const s = await read();
    const acc = currentAccount(s);
    if (!acc) throw new UserError("Not signed in.");
    if (s.timers[acc.id]) await stopTimer(acc.id);
    await mutate((st) => {
      st.timers[acc.id] = { issue: clean, start: Date.now(), workType: cleanWorkType(workType) };
    });
    return broadcast();
  },

  "timer:update": async ({ start, workType }) => {
    await mutate((s) => {
      const acc = currentAccount(s);
      const t = acc && s.timers[acc.id];
      if (!t) return;
      if (typeof start === "number" && Number.isFinite(start)) {
        if (start > Date.now()) throw new UserError("Start time can't be in the future.");
        t.start = start;
      }
      if (workType !== undefined) t.workType = cleanWorkType(workType);
    });
    return broadcast();
  },

  "timer:stop": async () => {
    const acc = currentAccount(await read());
    if (acc) await stopTimer(acc.id);
    return broadcast();
  },

  "timer:discard": async () => {
    await mutate((s) => {
      const acc = currentAccount(s);
      if (acc) delete s.timers[acc.id];
    });
    return broadcast();
  },

  "queue:retry": async () => {
    await flushQueue();
    return broadcast();
  },

  "queue:discard": async ({ localId }) => {
    await mutate((s) => {
      s.queue = s.queue.filter((q) => q.localId !== localId);
    });
    return broadcast();
  },

  "worktypes:get": async ({ projectId }) => withClient((yt) => yt.workTypes(String(projectId))),

  "recent:get": async () => {
    const s = await read();
    return withClient((yt, acc) => yt.recent(acc.userId, s.settings.recentDays));
  },

  "recent:delete": async ({ issueId, workItemId }) => {
    await withClient((yt) => yt.deleteWorkItem(String(issueId), String(workItemId)));
    return true as const;
  },
};

// ---------------------------------------------------------------- sender checks

type SenderKind = "ui" | "content" | null;

async function accountOrigins(): Promise<Set<string>> {
  const s = await read();
  return new Set(Object.values(s.accounts).map((a) => originOf(a.baseUrl)));
}

async function classify(sender: chrome.runtime.MessageSender): Promise<SenderKind> {
  if (sender.id !== EXT_ID || !sender.url) return null;
  let u: URL;
  try {
    u = new URL(sender.url);
  } catch {
    return null;
  }
  if (u.protocol === "chrome-extension:") {
    if (u.pathname === "/popup.html") return "ui";
    if (u.pathname === "/panel.html") {
      // An extension frame embedded in a tab must sit inside a YouTrack page
      // we know about; any other site embedding it gets nothing.
      if (!sender.tab) return "ui";
      const top = sender.tab.url;
      if (!top) return null;
      return (await accountOrigins()).has(new URL(top).origin) ? "ui" : null;
    }
    return null;
  }
  if (u.protocol === "https:" && sender.tab && sender.frameId === 0) {
    return (await accountOrigins()).has(u.origin) ? "content" : null;
  }
  return null;
}

async function handleContent(
  msg: { type: keyof ContentRequests },
  sender: chrome.runtime.MessageSender
): Promise<ContentRequests[keyof ContentRequests]["res"]> {
  if (msg.type !== "panel:should-show") throw new Error("not allowed");
  const { settings } = await read();
  if (settings.panelMode === "off") return { show: false };
  if (settings.panelMode === "always") return { show: true };
  const win = sender.tab?.windowId !== undefined ? await chrome.windows.get(sender.tab.windowId) : null;
  // `chrome --app=URL` and installed web-app windows have no toolbar
  return { show: !!win && win.type !== "normal" };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  (async () => {
    const kind = await classify(sender);
    if (kind === "content") return handleContent(msg, sender);
    if (kind !== "ui") throw new Error("Sender not allowed.");
    const h = handlers[(msg as RequestMessage).type] as Handler<RequestType> | undefined;
    if (!h) throw new Error("Unknown request.");
    const tabUrl = sender.tab?.url;
    return h((msg as RequestMessage).payload ?? {}, { tabUrl });
  })().then(
    (data) => sendResponse({ ok: true, data }),
    (e: Error) => {
      if (!(e instanceof UserError)) console.warn("[Stopwatch]", e);
      sendResponse({ ok: false, error: e.message || "Something went wrong." });
    }
  );
  return true;
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== PANEL_PORT) return port.disconnect();
  const kind = await classify(port.sender!);
  if (kind !== "content") return port.disconnect();
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  const st = await buildState();
  port.postMessage({
    running: !!st.timer,
    issueId: st.timer?.issue.idReadable ?? null,
    start: st.timer?.start ?? null,
    accent: st.settings.accent,
  } satisfies PanelStatus);
});

// ---------------------------------------------------------------- lifecycle

async function boot() {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  await chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 5 });
  await syncContentScripts().catch((e) => console.warn("[Stopwatch] content scripts", e));
  await flushQueue().catch(() => {});
  await broadcast();
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== QUEUE_ALARM) return;
  const s = await read();
  if (s.queue.length) {
    await flushQueue();
    await broadcast();
  }
});
chrome.permissions.onRemoved.addListener(() => void syncContentScripts());
