// Data shapes shared by the background service worker and the UI.
// Nothing in this file ever carries a token: secrets stay in the background.

export interface PublicAccount {
  id: string; // `${origin}${path}|${userId}`
  baseUrl: string; // e.g. https://acme.youtrack.cloud  or  https://host/youtrack
  userId: string;
  login: string;
  name: string;
  /** true when the stored token could not be decrypted or was rejected (401) */
  needsLogin: boolean;
}

export interface IssueRef {
  idReadable: string;
  summary: string;
  projectId: string;
  projectName: string;
  resolved: boolean;
  section?: string | null;
}

export interface WorkType {
  id: string;
  name: string;
}

export interface RunningTimer {
  issue: IssueRef;
  start: number; // epoch ms
  workType: WorkType | null;
}

export interface QueuedWorkItem {
  localId: string;
  accountId: string;
  issue: IssueRef;
  start: number;
  end: number;
  workType: WorkType | null;
  attempts: number;
  lastError: string | null;
}

export interface PageIssues {
  kind: "none" | "single-issue" | "issue-list" | "agile-board";
  title: string;
  issues: IssueRef[];
  sections: string[];
  error?: string;
}

export interface RecentItem {
  workItemId: string;
  issue: IssueRef;
  date: number; // epoch ms of the work date
  minutes: number;
  text: string;
  workType: WorkType | null;
}

export type Theme = "system" | "light" | "dark";
export type PanelMode = "app" | "always" | "off";

export interface Settings {
  theme: Theme;
  recentDays: number;
  panelMode: PanelMode;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  recentDays: 14,
  panelMode: "app",
};

/** Everything the UI needs to render. Pushed from background on every change. */
export interface UiState {
  accounts: PublicAccount[];
  currentAccountId: string | null;
  settings: Settings;
  timer: RunningTimer | null;
  queue: QueuedWorkItem[];
  page: PageIssues;
}
