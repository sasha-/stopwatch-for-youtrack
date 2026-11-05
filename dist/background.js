// src/shared/messages.ts
var STATE_EVENT = "ytsw:state";
var PANEL_PORT = "ytsw:panel-status";

// src/shared/time.ts
var pad = (n) => String(n).padStart(2, "0");
function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function durationMinutes(start, end) {
  const m = Math.round((end - start) / 6e4);
  return m > 0 ? m : 1;
}

// src/shared/types.ts
var DEFAULT_SETTINGS = {
  theme: "system",
  recentDays: 14,
  panelMode: "app"
};

// src/background/store.ts
var KEY = "ytsw";
var empty = () => ({
  schema: 2,
  accounts: {},
  currentAccountId: null,
  settings: { ...DEFAULT_SETTINGS },
  timers: {},
  queue: []
});
var chain = Promise.resolve();
async function read() {
  const got = await chrome.storage.local.get(KEY);
  const data = got[KEY];
  if (!data || data.schema !== 2) return empty();
  return { ...empty(), ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
}
function mutate(fn) {
  const run = chain.then(async () => {
    const s = await read();
    const result = await fn(s);
    await chrome.storage.local.set({ [KEY]: s });
    return result;
  });
  chain = run.catch(() => void 0);
  return run;
}
function currentAccount(s) {
  return s.currentAccountId && s.accounts[s.currentAccountId] || null;
}
function publicAccount(a) {
  const { sealed: _omit, ...rest } = a;
  return rest;
}
var PAGE_KEY = "page";
var NO_PAGE = { kind: "none", title: "", issues: [], sections: [] };
async function readPage() {
  const got = await chrome.storage.session.get(PAGE_KEY);
  return got[PAGE_KEY] || NO_PAGE;
}
async function writePage(p) {
  await chrome.storage.session.set({ [PAGE_KEY]: p });
}

// src/background/page.ts
function parsePageUrl(pageUrl, baseUrl) {
  let u;
  let base;
  try {
    u = new URL(pageUrl);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!u.pathname.startsWith(basePath + "/")) return null;
  const parts = u.pathname.slice(basePath.length + 1).split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? "";
  switch (parts[0]) {
    case "issue":
      return parts[1] ? { kind: "single-issue", id: parts[1] } : null;
    case "agiles":
      return parts[1] ? { kind: "agile-board", board: parts[1], sprint: parts[2] || "current" } : null;
    case "issues":
      return { kind: "issue-list", query: q, title: q ? `Issues: ${q}` : "Issues" };
    case "tag": {
      if (!parts[1]) return null;
      const name = parts[1].replace(/-\d+(-\d+)?$/, "");
      return { kind: "issue-list", query: `tag: {${name}} ${q}`.trim(), title: `Tag: ${name}` };
    }
    case "search": {
      if (!parts[1]) return null;
      const m = parts[1].match(/-(\d+-\d+)$/) || parts[1].match(/-(\d+)$/);
      const name = parts[1].replace(/-\d+(-\d+)?$/, "");
      if (!m) return { kind: "issue-list", query: q, title: name };
      const id = m[1].includes("-") ? m[1] : `7-${m[1]}`;
      return { kind: "saved-search", id, extra: q, title: name };
    }
    default:
      return null;
  }
}
async function loadPageIssues(yt, pageUrl, baseUrl) {
  const t = parsePageUrl(pageUrl, baseUrl);
  if (!t) return NO_PAGE;
  try {
    switch (t.kind) {
      case "single-issue": {
        const issue = await yt.issue(t.id);
        return { kind: "single-issue", title: issue.idReadable, issues: [issue], sections: [] };
      }
      case "agile-board": {
        const s = await yt.sprint(t.board, t.sprint);
        return { kind: "agile-board", ...s };
      }
      case "issue-list":
        return { kind: "issue-list", title: t.title, issues: await yt.issues(t.query), sections: [] };
      case "saved-search": {
        let query = t.extra;
        try {
          query = `${await yt.savedQuery(t.id)} ${t.extra}`.trim();
        } catch {
        }
        return { kind: "issue-list", title: t.title, issues: await yt.issues(query), sections: [] };
      }
    }
  } catch (e) {
    return { ...NO_PAGE, error: e.message };
  }
}

// src/background/vault.ts
var DB_NAME = "ytsw-vault";
var STORE = "keys";
var KEY_ID = "master-v1";
var memory = /* @__PURE__ */ new Map();
var keyPromise = null;
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idb(mode, fn) {
  return openDb().then(
    (db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    })
  );
}
async function loadOrCreateKey() {
  const existing = await idb("readonly", (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
  await idb("readwrite", (s) => s.put(key, KEY_ID));
  return key;
}
function getKey() {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((e) => {
      keyPromise = null;
      throw e;
    });
  }
  return keyPromise;
}
var enc = new TextEncoder();
var dec = new TextDecoder();
function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function seal(accountId, token) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(accountId) },
    key,
    enc.encode(token)
  );
  memory.set(accountId, token);
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}
async function unseal(accountId, sealed) {
  const cached = memory.get(accountId);
  if (cached) return cached;
  if (!sealed || sealed.v !== 1) return null;
  try {
    const key = await getKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: enc.encode(accountId) },
      key,
      fromB64(sealed.ct)
    );
    const token = dec.decode(pt);
    memory.set(accountId, token);
    return token;
  } catch {
    return null;
  }
}
function forget(accountId) {
  memory.delete(accountId);
}
async function destroyKey() {
  memory.clear();
  keyPromise = null;
  await idb("readwrite", (s) => s.delete(KEY_ID));
}

// src/background/youtrack.ts
var ApiError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
  /** Worth retrying later (offline, timeout, server trouble). */
  get transient() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
};
var ISSUE_FIELDS = "idReadable,summary,resolved,project(id,name),customFields(name,value(name))";
function toIssueRef(i, section = null) {
  return {
    idReadable: i.idReadable,
    summary: i.summary ?? "",
    projectId: i.project?.id ?? "",
    projectName: i.project?.name ?? "",
    resolved: i.resolved != null,
    section
  };
}
function normaliseBaseUrl(input) {
  let s = input.trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (u.protocol !== "https:") throw new Error("Only https:// YouTrack addresses are allowed.");
  if (u.username || u.password) throw new Error("The address must not contain credentials.");
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(issue|issues|agiles|search|tag|dashboard|projects|api)(\/.*)?$/, "");
  return u.origin + path;
}
var YouTrack = class {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }
  baseUrl;
  token;
  async request(method, path, params = {}, body) {
    const url = new URL(this.baseUrl + "/api" + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        // never follow a redirect with our bearer token
        signal: AbortSignal.timeout(2e4),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...body !== void 0 ? { "Content-Type": "application/json" } : {}
        },
        body: body !== void 0 ? JSON.stringify(body) : void 0
      });
    } catch (e) {
      throw new ApiError(`Cannot reach YouTrack (${e.message})`, 0);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.error_description || j.error || detail;
      } catch {
      }
      throw new ApiError(`YouTrack ${res.status}: ${detail}`, res.status);
    }
    const text = await res.text();
    if (!text) return void 0;
    const type = res.headers.get("Content-Type") || "";
    if (!type.includes("application/json")) {
      throw new ApiError("YouTrack returned an unexpected response (not JSON).", 502);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError("YouTrack returned malformed JSON.", 502);
    }
  }
  me() {
    return this.request("GET", "/users/me", {
      fields: "id,login,name"
    });
  }
  async issue(idReadable) {
    const i = await this.request("GET", `/issues/${encodeURIComponent(idReadable)}`, {
      fields: ISSUE_FIELDS
    });
    return toIssueRef(i);
  }
  async issues(query, top = 100) {
    const list = await this.request("GET", "/issues", {
      fields: ISSUE_FIELDS,
      query,
      $top: top
    });
    return list.map((i) => toIssueRef(i)).sort((a, b) => Number(a.resolved) - Number(b.resolved));
  }
  /**
   * Free-text issue search that also matches partial words and project names
   * ("somas" finds SOMASTREAM-297). Several queries run in parallel; a query
   * the server rejects is simply skipped.
   */
  async search(term, top = 40) {
    const t = term.trim();
    const jobs = [];
    if (/^[A-Za-z][\w]*-\d+$/.test(t)) jobs.push(this.issue(t.toUpperCase()).then((i) => [i]));
    jobs.push(this.issues(t, top));
    const words = t.split(/\s+/).filter((w) => /^[\p{L}\p{N}_]+$/u.test(w));
    if (words.length) jobs.push(this.issues(words.map((w) => `${w}*`).join(" "), top));
    jobs.push(
      this.request("GET", "/admin/projects", {
        fields: "id,name,shortName",
        $top: 200
      }).then(async (projects) => {
        const lc = t.toLowerCase();
        const hits = projects.filter((p) => p.shortName.toLowerCase().startsWith(lc) || p.name.toLowerCase().includes(lc)).slice(0, 3);
        const lists = await Promise.all(
          hits.map((p) => this.issues(`project: {${p.name}} #Unresolved sort by: updated desc`, 20))
        );
        return lists.flat();
      })
    );
    const settled = await Promise.allSettled(jobs);
    const ok = settled.filter((r) => r.status === "fulfilled");
    if (!ok.length) throw settled[0].reason;
    const seen = /* @__PURE__ */ new Map();
    for (const r of ok) for (const i of r.value) if (!seen.has(i.idReadable)) seen.set(i.idReadable, i);
    return [...seen.values()].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, top);
  }
  async savedQuery(id) {
    const q = await this.request("GET", `/savedQueries/${encodeURIComponent(id)}`, {
      fields: "query"
    });
    return q.query || "";
  }
  async sprint(boardId, sprintId) {
    const data = await this.request("GET", `/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`, {
      fields: `name,issues(${ISSUE_FIELDS}),agile(name,columnSettings(field(name),columns(presentation,ordinal,isResolved,fieldValues(name))))`
    });
    const settings = data.agile?.columnSettings;
    const columns = [...settings?.columns || []].sort(
      (a, b) => Number(a.isResolved) - Number(b.isResolved) || a.ordinal - b.ordinal
    );
    const fieldName = settings?.field?.name;
    const issues = [];
    for (const i of data.issues || []) {
      if (i.idReadable === "Issue.Draft") continue;
      const f = i.customFields?.find((c) => c.name === fieldName);
      const val = f && !Array.isArray(f.value) ? f.value?.name : void 0;
      const col = columns.find(
        (c) => c.fieldValues?.some((v) => v.name === val) || val !== void 0 && c.presentation.split(", ").includes(val)
      );
      if (!col) continue;
      issues.push(toIssueRef(i, col.presentation));
    }
    return {
      title: [data.agile?.name, data.name].filter(Boolean).join(" \xB7 "),
      issues,
      sections: columns.map((c) => c.presentation)
    };
  }
  async workTypes(projectId) {
    try {
      return await this.request(
        "GET",
        `/admin/projects/${encodeURIComponent(projectId)}/timeTrackingSettings/workItemTypes`,
        { fields: "id,name" }
      );
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        return this.request("GET", "/admin/timeTrackingSettings/workItemTypes", {
          fields: "id,name"
        }).catch(() => []);
      }
      throw e;
    }
  }
  async addWorkItem(idReadable, item) {
    const res = await this.request(
      "POST",
      `/issues/${encodeURIComponent(idReadable)}/timeTracking/workItems`,
      { fields: "id" },
      {
        date: item.start,
        duration: { minutes: item.minutes },
        text: item.text,
        usesMarkdown: true,
        ...item.workType ? { type: { id: item.workType.id } } : {}
      }
    );
    return res.id;
  }
  deleteWorkItem(idReadable, workItemId) {
    return this.request(
      "DELETE",
      `/issues/${encodeURIComponent(idReadable)}/timeTracking/workItems/${encodeURIComponent(workItemId)}`
    );
  }
  async recent(userId, days) {
    const list = await this.request(
      "GET",
      "/issues",
      {
        query: `work author: me work date: {minus ${Math.max(1, Math.floor(days))}d} .. Today`,
        fields: `idReadable,summary,resolved,project(id,name),timeTracking(workItems(id,date,duration(minutes),text,author(id),type(id,name)))`,
        $top: 500
      }
    );
    const since = Date.now() - days * 864e5;
    const out = [];
    for (const i of list) {
      for (const w of i.timeTracking?.workItems || []) {
        if (w.author?.id !== userId || w.date < since - 864e5) continue;
        out.push({
          workItemId: w.id,
          issue: toIssueRef(i),
          date: w.date,
          minutes: w.duration?.minutes ?? 0,
          text: w.text || "",
          workType: w.type?.id ? { id: w.type.id, name: w.type.name || "" } : null
        });
      }
    }
    return out.sort((a, b) => b.date - a.date);
  }
};

// src/background/index.ts
var EXT_ID = chrome.runtime.id;
var QUEUE_ALARM = "ytsw:flush-queue";
var originOf = (baseUrl) => new URL(baseUrl).origin;
var originPattern = (baseUrl) => `https://${new URL(baseUrl).hostname}/*`;
var UserError = class extends Error {
};
async function clientFor(account) {
  const token = await unseal(account.id, account.sealed);
  if (!token) {
    await markNeedsLogin(account.id);
    throw new UserError("Your token for this account can't be read anymore. Please paste it again.");
  }
  return new YouTrack(account.baseUrl, token);
}
async function markNeedsLogin(accountId) {
  forget(accountId);
  await mutate((s) => {
    if (s.accounts[accountId]) s.accounts[accountId].needsLogin = true;
  });
}
async function withClient(fn) {
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
async function buildState() {
  const s = await read();
  const acc = currentAccount(s);
  return {
    accounts: Object.values(s.accounts).map(publicAccount),
    currentAccountId: acc?.id ?? null,
    settings: s.settings,
    timer: acc ? s.timers[acc.id] ?? null : null,
    queue: s.queue,
    page: acc ? await readPage() : NO_PAGE
  };
}
var panelPorts = /* @__PURE__ */ new Set();
async function broadcast() {
  const state = await buildState();
  chrome.runtime.sendMessage({ event: STATE_EVENT, state }).catch(() => {
  });
  const status = {
    running: !!state.timer,
    issueId: state.timer?.issue.idReadable ?? null,
    start: state.timer?.start ?? null
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
async function updateAction(state) {
  const kind = state.timer ? "icon_running" : "icon";
  await chrome.action.setIcon({
    path: {
      16: `/icons/16_${kind}.png`,
      48: `/icons/48_${kind}.png`,
      96: `/icons/96_${kind}.png`,
      128: `/icons/128_${kind}.png`
    }
  });
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
      title: state.timer ? `Stopwatch: tracking ${state.timer.issue.idReadable}` : "Stopwatch for YouTrack"
    });
  }
}
var lastPageUrl = "";
var lastPageAt = 0;
async function refreshPage(pageUrl, force = false) {
  const s = await read();
  const acc = currentAccount(s);
  if (!acc || acc.needsLogin) {
    await writePage(NO_PAGE);
    return;
  }
  if (!pageUrl) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;
    pageUrl = tab.url ?? "";
  }
  if (!pageUrl.startsWith(originOf(acc.baseUrl) + "/")) {
    lastPageUrl = "";
    await writePage(NO_PAGE);
    return;
  }
  if (!force && pageUrl === lastPageUrl && Date.now() - lastPageAt < 3e4) return;
  lastPageUrl = pageUrl;
  lastPageAt = Date.now();
  let page;
  try {
    page = await withClient((yt) => loadPageIssues(yt, pageUrl, acc.baseUrl));
  } catch (e) {
    page = { ...NO_PAGE, error: e.message };
  }
  await writePage(page);
}
var refreshTimer;
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
async function syncContentScripts() {
  const s = await read();
  const origins = [...new Set(Object.values(s.accounts).map((a) => originPattern(a.baseUrl)))];
  const granted = [];
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
      persistAcrossSessions: true
    }
  ]);
}
var flushing = null;
function flushQueue() {
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
    let error = null;
    let done = false;
    if (!acc) {
      done = true;
    } else {
      try {
        const yt = await clientFor(acc);
        const minutes = durationMinutes(item.start, item.end);
        await yt.addWorkItem(item.issue.idReadable, {
          start: item.start,
          minutes,
          text: `${formatClock(new Date(item.start))}\u2013${formatClock(new Date(item.end))}`,
          workType: item.workType
        });
        done = true;
      } catch (e) {
        error = e.message;
        if (e instanceof ApiError && e.status === 401) await markNeedsLogin(acc.id);
      }
    }
    await mutate((st) => {
      const idx = st.queue.findIndex((q) => q.localId === item.localId);
      if (idx < 0) return;
      if (done) st.queue.splice(idx, 1);
      else st.queue[idx] = { ...st.queue[idx], attempts: st.queue[idx].attempts + 1, lastError: error };
    });
    if (!done && error && /Cannot reach/.test(error)) break;
  }
}
async function stopTimer(accountId) {
  await mutate((s) => {
    const t = s.timers[accountId];
    if (!t) return;
    delete s.timers[accountId];
    const item = {
      localId: crypto.randomUUID(),
      accountId,
      issue: t.issue,
      start: t.start,
      end: Date.now(),
      workType: t.workType,
      attempts: 0,
      lastError: null
    };
    s.queue.push(item);
  });
  await flushQueue();
}
function cleanIssue(i) {
  if (!i || typeof i.idReadable !== "string" || !/^[\w.-]+-\d+$/.test(i.idReadable)) {
    throw new UserError("Invalid issue.");
  }
  return {
    idReadable: i.idReadable,
    summary: String(i.summary ?? "").slice(0, 500),
    projectId: String(i.projectId ?? ""),
    projectName: String(i.projectName ?? ""),
    resolved: !!i.resolved
  };
}
function cleanWorkType(w) {
  if (!w) return null;
  return { id: String(w.id), name: String(w.name) };
}
var handlers = {
  "state:get": async (_p, ctx) => {
    await refreshPage(ctx.tabUrl);
    return broadcast();
  },
  "auth:login": async ({ baseUrl, token }) => {
    const url = normaliseBaseUrl(baseUrl);
    token = String(token || "").trim();
    if (!token) throw new UserError("Paste your permanent token.");
    if (!await chrome.permissions.contains({ origins: [originPattern(url)] })) {
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
        sealed
      };
      s.currentAccountId = id;
    });
    await syncContentScripts();
    await refreshPage(void 0, true);
    void flushQueue().then(broadcast);
    return broadcast();
  },
  "auth:logout": async ({ accountId }) => {
    let removedOrigin = null;
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
    await refreshPage(void 0, true);
    return broadcast();
  },
  "account:switch": async ({ accountId }) => {
    await mutate((s) => {
      if (s.accounts[accountId]) s.currentAccountId = accountId;
    });
    await refreshPage(void 0, true);
    return broadcast();
  },
  "settings:set": async ({ settings }) => {
    await mutate((s) => {
      if (settings.theme && ["system", "light", "dark"].includes(settings.theme)) s.settings.theme = settings.theme;
      if (settings.panelMode && ["app", "always", "off"].includes(settings.panelMode))
        s.settings.panelMode = settings.panelMode;
      if (settings.recentDays !== void 0) {
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
      if (workType !== void 0) t.workType = cleanWorkType(workType);
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
    return true;
  }
};
async function accountOrigins() {
  const s = await read();
  return new Set(Object.values(s.accounts).map((a) => originOf(a.baseUrl)));
}
async function classify(sender) {
  if (sender.id !== EXT_ID || !sender.url) return null;
  let u;
  try {
    u = new URL(sender.url);
  } catch {
    return null;
  }
  if (u.protocol === "chrome-extension:") {
    if (u.pathname === "/popup.html") return "ui";
    if (u.pathname === "/panel.html") {
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
async function handleContent(msg, sender) {
  if (msg.type !== "panel:should-show") throw new Error("not allowed");
  const { settings } = await read();
  if (settings.panelMode === "off") return { show: false };
  if (settings.panelMode === "always") return { show: true };
  const win = sender.tab?.windowId !== void 0 ? await chrome.windows.get(sender.tab.windowId) : null;
  return { show: !!win && win.type !== "normal" };
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  (async () => {
    const kind = await classify(sender);
    if (kind === "content") return handleContent(msg, sender);
    if (kind !== "ui") throw new Error("Sender not allowed.");
    const h = handlers[msg.type];
    if (!h) throw new Error("Unknown request.");
    const tabUrl = sender.tab?.url;
    return h(msg.payload ?? {}, { tabUrl });
  })().then(
    (data) => sendResponse({ ok: true, data }),
    (e) => {
      if (!(e instanceof UserError)) console.warn("[Stopwatch]", e);
      sendResponse({ ok: false, error: e.message || "Something went wrong." });
    }
  );
  return true;
});
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== PANEL_PORT) return port.disconnect();
  const kind = await classify(port.sender);
  if (kind !== "content") return port.disconnect();
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  const st = await buildState();
  port.postMessage({
    running: !!st.timer,
    issueId: st.timer?.issue.idReadable ?? null,
    start: st.timer?.start ?? null
  });
});
async function boot() {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {
  });
  await chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 5 });
  await syncContentScripts().catch((e) => console.warn("[Stopwatch] content scripts", e));
  await flushQueue().catch(() => {
  });
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
