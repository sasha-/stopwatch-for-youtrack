// Works out which issues the active YouTrack tab is showing.

import type { PageIssues } from "../shared/types";
import { NO_PAGE } from "./store";
import type { YouTrack } from "./youtrack";

type Target =
  | { kind: "single-issue"; id: string }
  | { kind: "agile-board"; board: string; sprint: string }
  | { kind: "issue-list"; query: string; title: string }
  | { kind: "saved-search"; id: string; extra: string; title: string }
  | null;

/** Pure URL parser (exported for tests). */
export function parsePageUrl(pageUrl: string, baseUrl: string): Target {
  let u: URL;
  let base: URL;
  try {
    u = new URL(pageUrl);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!u.pathname.startsWith(basePath + "/")) return null;
  const parts = u.pathname
    .slice(basePath.length + 1)
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
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

export async function loadPageIssues(yt: YouTrack, pageUrl: string, baseUrl: string): Promise<PageIssues> {
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
          /* fall back to the visible filter only */
        }
        return { kind: "issue-list", title: t.title, issues: await yt.issues(query), sections: [] };
      }
    }
  } catch (e) {
    return { ...NO_PAGE, error: (e as Error).message };
  }
}
