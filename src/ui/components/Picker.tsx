import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { IssueRef, PageIssues, UiState } from "../../shared/types";
import { call, useAction } from "../rpc";
import { ErrorNote, Icon } from "./common";

function matches(i: IssueRef, term: string) {
  const t = term.toLowerCase();
  return (
    i.idReadable.toLowerCase().includes(t) ||
    i.summary.toLowerCase().includes(t) ||
    i.projectName.toLowerCase().includes(t)
  );
}

export function Picker(props: { page: PageIssues; recent: IssueRef[]; onState: (s: UiState) => void }) {
  const { page, recent, onState } = props;
  const [term, setTerm] = useState("");
  const [remote, setRemote] = useState<IssueRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const q = term.trim();
  const pageHits = useMemo(() => (q ? page.issues.filter((i) => matches(i, q)) : page.issues), [page, q]);
  const pageIds = useMemo(() => new Set(page.issues.map((i) => i.idReadable)), [page]);
  const recentHits = useMemo(() => {
    const list = recent.filter((i) => !pageIds.has(i.idReadable));
    return q ? list.filter((i) => matches(i, q)) : list.slice(0, 8);
  }, [recent, pageIds, q]);
  const shownIds = useMemo(
    () => new Set([...pageHits, ...recentHits].map((i) => i.idReadable)),
    [pageHits, recentHits]
  );
  const remoteHits = useMemo(() => (remote ?? []).filter((i) => !shownIds.has(i.idReadable)), [remote, shownIds]);

  const runSearch = async (text: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      setRemote(await call("issues:search", { query: text }));
    } catch (e) {
      setSearchError((e as Error).message);
      setRemote([]);
    } finally {
      setSearching(false);
    }
  };

  // search YouTrack automatically while typing (debounced)
  useEffect(() => {
    setRemote(null);
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) void runSearch(q);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const start = (issue: IssueRef) => run(async () => onState(await call("timer:start", { issue })));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const first = pageHits[0] ?? recentHits[0] ?? remoteHits[0];
    if (q && first && pageHits.length + recentHits.length + remoteHits.length === 1) void start(first);
    else if (q.length >= 1) void runSearch(q);
  };

  const groups: [string, IssueRef[]][] = useMemo(() => {
    if (!page.sections.length) return [["", pageHits]];
    return page.sections
      .map((sec) => [sec, pageHits.filter((i) => i.section === sec)] as [string, IssueRef[]])
      .filter(([, list]) => list.length);
  }, [pageHits, page.sections]);

  const nothing = q && !searching && remote !== null && !pageHits.length && !recentHits.length && !remoteHits.length;

  return (
    <section className="card picker">
      <form className="search" onSubmit={submit}>
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder="Search issues, projects or IDs"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
      </form>
      <ErrorNote>{error || page.error}</ErrorNote>

      <div className="picker-results">
        {pageHits.length > 0 && (
          <>
            {page.title && <div className="page-title">On this page · {page.title}</div>}
            {groups.map(([name, issues]) => (
              <div key={name}>
                {name && <div className="section-title">{name}</div>}
                <IssueList issues={issues} onPick={start} disabled={busy} />
              </div>
            ))}
          </>
        )}

        {recentHits.length > 0 && (
          <>
            <div className="section-title">Recently worked on</div>
            <IssueList issues={recentHits} onPick={start} disabled={busy} />
          </>
        )}

        {q.length >= 2 && (
          <>
            {(remoteHits.length > 0 || searching) && <div className="section-title">In YouTrack</div>}
            {searching && <div className="empty">Searching…</div>}
            {!searching && <IssueList issues={remoteHits} onPick={start} disabled={busy} />}
            <ErrorNote>{searchError}</ErrorNote>
          </>
        )}

        {nothing && <div className="empty">No issues match “{q}”.</div>}
        {!q && page.kind === "none" && recentHits.length === 0 && (
          <div className="empty">Open an issue, board or search in YouTrack, or type to search.</div>
        )}
      </div>
    </section>
  );
}

function IssueList({ issues, onPick, disabled }: { issues: IssueRef[]; onPick: (i: IssueRef) => void; disabled: boolean }) {
  return (
    <ul className="issues">
      {issues.map((i) => (
        <li key={i.idReadable} className={i.resolved ? "resolved" : ""}>
          <button type="button" onClick={() => onPick(i)} disabled={disabled} title={`Start timer on ${i.idReadable}`}>
            <span className="play">
              <Icon name="play" size={16} />
            </span>
            <span className="text">
              <span className="issue-id">{i.idReadable}</span> {i.summary}
              <span className="proj"> · {i.projectName}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
