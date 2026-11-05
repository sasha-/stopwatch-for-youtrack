import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecentItem, UiState } from "../../shared/types";
import { dayTitle, formatMinutes, startOfDay, startOfWeek, weekTitle } from "../../shared/time";
import { call, useAction } from "../rpc";
import { ConfirmIconButton, ErrorNote, IconButton, IssueLink } from "./common";

interface Day {
  key: number;
  items: RecentItem[];
  total: number;
}
interface Week {
  key: number;
  days: Day[];
  total: number;
}

function group(items: RecentItem[]): Week[] {
  const weeks = new Map<number, Map<number, RecentItem[]>>();
  for (const it of items) {
    const d = new Date(it.date);
    const wk = startOfWeek(d).getTime();
    const day = startOfDay(d).getTime();
    if (!weeks.has(wk)) weeks.set(wk, new Map());
    const days = weeks.get(wk)!;
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(it);
  }
  return [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, days]) => {
      const ds = [...days.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([k, its]) => ({ key: k, items: its, total: its.reduce((s, i) => s + i.minutes, 0) }));
      return { key, days: ds, total: ds.reduce((s, d) => s + d.total, 0) };
    });
}

/** Loads recent work once for the whole UI (picker + list). */
export function useRecent(state: UiState) {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const action = useAction();
  const load = useCallback(() => action.run(async () => setItems(await call("recent:get"))), []);
  // reload when a timer finishes, the queue drains, the account or range changes
  const trigger = `${state.currentAccountId}|${state.timer?.start ?? ""}|${state.queue.length}|${state.settings.recentDays}`;
  const ready = !!state.currentAccountId && !state.accounts?.find((a) => a.id === state.currentAccountId)?.needsLogin;
  useEffect(() => {
    if (ready) void load();
    else setItems(null);
  }, [trigger, ready]);
  return { items, setItems, load, busy: action.busy, error: action.error };
}

export type RecentData = ReturnType<typeof useRecent>;

export function Recent(props: { state: UiState; baseUrl: string; onState: (s: UiState) => void; data: RecentData }) {
  const { state, baseUrl, onState } = props;
  const { items, setItems, load } = props.data;
  const { busy, error, run } = useAction();
  const loadError = props.data.error;

  const weeks = useMemo(() => group(items ?? []), [items]);

  return (
    <section className="recent">
      <div className="row between recent-head">
        <h3>Recent work</h3>
        <IconButton icon="refresh" label="Reload recent work" onClick={load} disabled={busy || props.data.busy} />
      </div>
      <ErrorNote>{error || loadError}</ErrorNote>
      {items && items.length === 0 && <div className="empty">No work logged in the last {state.settings.recentDays} days.</div>}
      {weeks.map((w) => (
        <div key={w.key} className="week">
          <div className="week-title">
            <span>{weekTitle(new Date(w.key))}</span>
            <span>{formatMinutes(w.total)}</span>
          </div>
          {w.days.map((d) => (
            <div key={d.key} className="day">
              <div className="day-title">
                <span>{dayTitle(new Date(d.key))}</span>
                <span>{formatMinutes(d.total)}</span>
              </div>
              <ul>
                {d.items.map((it) => (
                  <li key={it.workItemId} className={it.issue.resolved ? "resolved" : ""}>
                    <div className="text">
                      <div className="title">
                        <IssueLink baseUrl={baseUrl} id={it.issue.idReadable} /> {it.issue.summary}
                      </div>
                      <div className="sub">
                        {it.issue.projectName}
                        {it.workType?.name ? ` · ${it.workType.name}` : ""}
                        {it.text ? ` · ${it.text}` : ""}
                      </div>
                    </div>
                    <span className="dur">{formatMinutes(it.minutes)}</span>
                    <IconButton
                      icon="play"
                      label={`Start timer on ${it.issue.idReadable}`}
                      onClick={() =>
                        run(async () => onState(await call("timer:start", { issue: it.issue, workType: it.workType })))
                      }
                    />
                    <ConfirmIconButton
                      icon="trash"
                      label="Delete this work item from YouTrack"
                      confirmLabel="Delete?"
                      onConfirm={() =>
                        run(async () => {
                          await call("recent:delete", { issueId: it.issue.idReadable, workItemId: it.workItemId });
                          setItems((cur) => (cur ?? []).filter((x) => x.workItemId !== it.workItemId));
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
