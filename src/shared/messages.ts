// Request/response protocol between UI pages and the background worker.
// Every request is answered with { ok: true, data } or { ok: false, error }.

import type {
  IssueRef,
  RecentItem,
  Settings,
  UiState,
  WorkType,
} from "./types";

export interface Requests {
  "state:get": { req: {}; res: UiState };
  "auth:login": { req: { baseUrl: string; token: string }; res: UiState };
  "auth:logout": { req: { accountId: string }; res: UiState };
  "account:switch": { req: { accountId: string }; res: UiState };
  "settings:set": { req: { settings: Partial<Settings> }; res: UiState };
  "page:refresh": { req: {}; res: UiState };
  "issues:search": { req: { query: string }; res: IssueRef[] };
  "timer:start": { req: { issue: IssueRef; workType?: WorkType | null }; res: UiState };
  "timer:update": { req: { start?: number; workType?: WorkType | null }; res: UiState };
  "timer:stop": { req: {}; res: UiState };
  "timer:discard": { req: {}; res: UiState };
  "queue:retry": { req: {}; res: UiState };
  "queue:discard": { req: { localId: string }; res: UiState };
  "worktypes:get": { req: { projectId: string }; res: WorkType[] };
  "recent:get": { req: {}; res: RecentItem[] };
  "recent:delete": { req: { issueId: string; workItemId: string }; res: true };
}

export type RequestType = keyof Requests;

export interface RequestMessage<T extends RequestType = RequestType> {
  type: T;
  payload: Requests[T]["req"];
}

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

/** Messages a content script (running inside the YouTrack page) may send. */
export interface ContentRequests {
  "panel:should-show": { req: {}; res: { show: boolean } };
}

/** Pushed over the "panel-status" port to the in-page launcher. */
export interface PanelStatus {
  running: boolean;
  issueId: string | null;
  start: number | null;
  accent: string;
}

export const STATE_EVENT = "ytsw:state";
export const PANEL_PORT = "ytsw:panel-status";
