// YouTrack REST client. Runs only in the background service worker.
// Requests go out with the extension's host permission for the YouTrack
// origin, so the server does NOT need "Allow all origins" (CORS) enabled.
// Cookies are never sent (credentials: "omit"); auth is the bearer token only.

import type { IssueRef, PageIssues, RecentItem, WorkType } from "../shared/types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
  /** Worth retrying later (offline, timeout, server trouble). */
  get transient(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

const ISSUE_FIELDS = "idReadable,summary,resolved,project(id,name),customFields(name,value(name))";

interface ApiIssue {
  idReadable: string;
  summary: string;
  resolved: number | null;
  project: { id: string; name: string };
  customFields?: { name: string; value: null | { name?: string } | { name?: string }[] }[];
}

export function toIssueRef(i: ApiIssue, section: string | null = null): IssueRef {
  return {
    idReadable: i.idReadable,
    summary: i.summary ?? "",
    projectId: i.project?.id ?? "",
    projectName: i.project?.name ?? "",
    resolved: i.resolved != null,
    section,
  };
}

/** Normalises user input to "https://host[/path]" (no trailing slash). */
export function normaliseBaseUrl(input: string): string {
  let s = input.trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (u.protocol !== "https:") throw new Error("Only https:// YouTrack addresses are allowed.");
  if (u.username || u.password) throw new Error("The address must not contain credentials.");
  let path = u.pathname.replace(/\/+$/, "");
  // tolerate people pasting a page URL; keep only a known context path prefix
  path = path.replace(/\/(issue|issues|agiles|search|tag|dashboard|projects|api)(\/.*)?$/, "");
  return u.origin + path;
}

export class YouTrack {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string | number> = {},
    body?: unknown
  ): Promise<T> {
    const url = new URL(this.baseUrl + "/api" + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        credentials: "omit",
        cache: "no-store",
        redirect: "error", // never follow a redirect with our bearer token
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(`Cannot reach YouTrack (${(e as Error).message})`, 0);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.error_description || j.error || detail;
      } catch {
        /* not json */
      }
      throw new ApiError(`YouTrack ${res.status}: ${detail}`, res.status);
    }
    const text = await res.text();
    if (!text) return undefined as T; // e.g. DELETE answers 200 with an empty body
    const type = res.headers.get("Content-Type") || "";
    if (!type.includes("application/json")) {
      // e.g. an HTML login page: report it instead of silently treating it as "{}"
      throw new ApiError("YouTrack returned an unexpected response (not JSON).", 502);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError("YouTrack returned malformed JSON.", 502);
    }
  }

  me() {
    return this.request<{ id: string; login: string; name: string }>("GET", "/users/me", {
      fields: "id,login,name",
    });
  }

  async issue(idReadable: string): Promise<IssueRef> {
    const i = await this.request<ApiIssue>("GET", `/issues/${encodeURIComponent(idReadable)}`, {
      fields: ISSUE_FIELDS,
    });
    return toIssueRef(i);
  }

  async issues(query: string, top = 100): Promise<IssueRef[]> {
    const list = await this.request<ApiIssue[]>("GET", "/issues", {
      fields: ISSUE_FIELDS,
      query,
      $top: top,
    });
    return list
      .map((i) => toIssueRef(i))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved));
  }

  /**
   * Free-text issue search that also matches partial words and project names
   * ("somas" finds SOMASTREAM-297). Several queries run in parallel; a query
   * the server rejects is simply skipped.
   */
  async search(term: string, top = 40): Promise<IssueRef[]> {
    const t = term.trim();
    const jobs: Promise<IssueRef[]>[] = [];
    if (/^[A-Za-z][\w]*-\d+$/.test(t)) jobs.push(this.issue(t.toUpperCase()).then((i) => [i]));
    jobs.push(this.issues(t, top));
    const words = t.split(/\s+/).filter((w) => /^[\p{L}\p{N}_]+$/u.test(w));
    if (words.length) jobs.push(this.issues(words.map((w) => `${w}*`).join(" "), top));
    jobs.push(
      this.request<{ id: string; name: string; shortName: string }[]>("GET", "/admin/projects", {
        fields: "id,name,shortName",
        $top: 200,
      }).then(async (projects) => {
        const lc = t.toLowerCase();
        const hits = projects
          .filter((p) => p.shortName.toLowerCase().startsWith(lc) || p.name.toLowerCase().includes(lc))
          .slice(0, 3);
        const lists = await Promise.all(
          hits.map((p) => this.issues(`project: {${p.name}} #Unresolved sort by: updated desc`, 20))
        );
        return lists.flat();
      })
    );
    const settled = await Promise.allSettled(jobs);
    const ok = settled.filter((r): r is PromiseFulfilledResult<IssueRef[]> => r.status === "fulfilled");
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    const seen = new Map<string, IssueRef>();
    for (const r of ok) for (const i of r.value) if (!seen.has(i.idReadable)) seen.set(i.idReadable, i);
    return [...seen.values()].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, top);
  }

  async savedQuery(id: string): Promise<string> {
    const q = await this.request<{ query: string }>("GET", `/savedQueries/${encodeURIComponent(id)}`, {
      fields: "query",
    });
    return q.query || "";
  }

  async sprint(boardId: string, sprintId: string): Promise<Pick<PageIssues, "issues" | "sections" | "title">> {
    interface Col {
      presentation: string;
      ordinal: number;
      isResolved: boolean;
      fieldValues?: { name: string }[];
    }
    const data = await this.request<{
      name?: string;
      issues: ApiIssue[];
      agile: { name: string; columnSettings: { field: { name: string }; columns: Col[] } };
    }>("GET", `/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`, {
      fields: `name,issues(${ISSUE_FIELDS}),agile(name,columnSettings(field(name),columns(presentation,ordinal,isResolved,fieldValues(name))))`,
    });
    const settings = data.agile?.columnSettings;
    const columns = [...(settings?.columns || [])].sort(
      (a, b) => Number(a.isResolved) - Number(b.isResolved) || a.ordinal - b.ordinal
    );
    const fieldName = settings?.field?.name;
    const issues: IssueRef[] = [];
    for (const i of data.issues || []) {
      if (i.idReadable === "Issue.Draft") continue;
      const f = i.customFields?.find((c) => c.name === fieldName);
      const val = f && !Array.isArray(f.value) ? f.value?.name : undefined;
      const col = columns.find(
        (c) =>
          c.fieldValues?.some((v) => v.name === val) ||
          (val !== undefined && c.presentation.split(", ").includes(val))
      );
      if (!col) continue; // issue not visible on the board
      issues.push(toIssueRef(i, col.presentation));
    }
    return {
      title: [data.agile?.name, data.name].filter(Boolean).join(" · "),
      issues,
      sections: columns.map((c) => c.presentation),
    };
  }

  async workTypes(projectId: string): Promise<WorkType[]> {
    try {
      return await this.request<WorkType[]>(
        "GET",
        `/admin/projects/${encodeURIComponent(projectId)}/timeTrackingSettings/workItemTypes`,
        { fields: "id,name" }
      );
    } catch (e) {
      // non-admins may not read project settings; fall back to global types
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        return this.request<WorkType[]>("GET", "/admin/timeTrackingSettings/workItemTypes", {
          fields: "id,name",
        }).catch(() => []);
      }
      throw e;
    }
  }

  async addWorkItem(
    idReadable: string,
    item: { start: number; minutes: number; text: string; workType: WorkType | null }
  ): Promise<string> {
    const res = await this.request<{ id: string }>(
      "POST",
      `/issues/${encodeURIComponent(idReadable)}/timeTracking/workItems`,
      { fields: "id" },
      {
        date: item.start,
        duration: { minutes: item.minutes },
        text: item.text,
        usesMarkdown: true,
        ...(item.workType ? { type: { id: item.workType.id } } : {}),
      }
    );
    return res.id;
  }

  deleteWorkItem(idReadable: string, workItemId: string) {
    return this.request<void>(
      "DELETE",
      `/issues/${encodeURIComponent(idReadable)}/timeTracking/workItems/${encodeURIComponent(workItemId)}`
    );
  }

  async recent(userId: string, days: number): Promise<RecentItem[]> {
    interface WI {
      id: string;
      date: number;
      duration: { minutes: number };
      text: string | null;
      author: { id: string };
      type: WorkType | null;
    }
    const list = await this.request<(ApiIssue & { timeTracking: { workItems: WI[] } })[]>(
      "GET",
      "/issues",
      {
        query: `work author: me work date: {minus ${Math.max(1, Math.floor(days))}d} .. Today`,
        fields: `idReadable,summary,resolved,project(id,name),timeTracking(workItems(id,date,duration(minutes),text,author(id),type(id,name)))`,
        $top: 500,
      }
    );
    const since = Date.now() - days * 86400000;
    const out: RecentItem[] = [];
    for (const i of list) {
      for (const w of i.timeTracking?.workItems || []) {
        if (w.author?.id !== userId || w.date < since - 86400000) continue;
        out.push({
          workItemId: w.id,
          issue: toIssueRef(i),
          date: w.date,
          minutes: w.duration?.minutes ?? 0,
          text: w.text || "",
          workType: w.type?.id ? { id: w.type.id, name: w.type.name || "" } : null,
        });
      }
    }
    return out.sort((a, b) => b.date - a.date);
  }
}
