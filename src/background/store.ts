// Persistent, non-secret state (plus sealed token blobs) in chrome.storage.local.
// All mutations go through `mutate`, which serialises read-modify-write so two
// events can never overwrite each other's changes (a bug in the old add-on).

import type { Sealed } from "./vault";
import {
  DEFAULT_SETTINGS,
  type PageIssues,
  type PublicAccount,
  type QueuedWorkItem,
  type RunningTimer,
  type Settings,
} from "../shared/types";

export interface StoredAccount extends PublicAccount {
  sealed?: Sealed;
}

export interface Persisted {
  schema: 2;
  accounts: Record<string, StoredAccount>;
  currentAccountId: string | null;
  settings: Settings;
  timers: Record<string, RunningTimer>;
  queue: QueuedWorkItem[];
}

const KEY = "ytsw";

const empty = (): Persisted => ({
  schema: 2,
  accounts: {},
  currentAccountId: null,
  settings: { ...DEFAULT_SETTINGS },
  timers: {},
  queue: [],
});

let chain: Promise<unknown> = Promise.resolve();

export async function read(): Promise<Persisted> {
  const got = await chrome.storage.local.get(KEY);
  const data = got[KEY] as Persisted | undefined;
  if (!data || data.schema !== 2) return empty();
  return { ...empty(), ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
}

export function mutate<T>(fn: (s: Persisted) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await read();
    const result = await fn(s);
    await chrome.storage.local.set({ [KEY]: s });
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function currentAccount(s: Persisted): StoredAccount | null {
  return (s.currentAccountId && s.accounts[s.currentAccountId]) || null;
}

export function publicAccount(a: StoredAccount): PublicAccount {
  const { sealed: _omit, ...rest } = a;
  return rest;
}

// Page issues are derived data: kept in session storage (memory only, cleared
// when the browser closes, not reachable from content scripts).
const PAGE_KEY = "page";
export const NO_PAGE: PageIssues = { kind: "none", title: "", issues: [], sections: [] };

export async function readPage(): Promise<PageIssues> {
  const got = await chrome.storage.session.get(PAGE_KEY);
  return (got[PAGE_KEY] as PageIssues) || NO_PAGE;
}

export async function writePage(p: PageIssues): Promise<void> {
  await chrome.storage.session.set({ [PAGE_KEY]: p });
}
