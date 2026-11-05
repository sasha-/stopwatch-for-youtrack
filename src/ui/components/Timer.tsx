import { useEffect, useState } from "react";
import type { RunningTimer, UiState, WorkType } from "../../shared/types";
import { formatClock, formatElapsed } from "../../shared/time";
import { call, useAction } from "../rpc";
import { ConfirmIconButton, ErrorNote, Icon, IssueLink } from "./common";

export function useWorkTypes(projectId: string | undefined) {
  const [types, setTypes] = useState<WorkType[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    call("worktypes:get", { projectId }).then(
      (t) => alive && setTypes(t),
      () => alive && setTypes([])
    );
    return () => {
      alive = false;
    };
  }, [projectId]);
  return types;
}

export function Timer({ timer, baseUrl, onState }: { timer: RunningTimer; baseUrl: string; onState: (s: UiState) => void }) {
  const [now, setNow] = useState(Date.now());
  const workTypes = useWorkTypes(timer.issue.projectId);
  const { busy, error, run } = useAction();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const setStart = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const d = new Date(timer.start);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
    void run(async () => onState(await call("timer:update", { start: d.getTime() })));
  };

  const setType = (id: string) => {
    const wt = workTypes.find((w) => w.id === id) ?? null;
    void run(async () => onState(await call("timer:update", { workType: wt })));
  };

  return (
    <section className="card timer">
      <div className="timer-issue">
        <div className="title">
          <IssueLink baseUrl={baseUrl} id={timer.issue.idReadable} /> {timer.issue.summary}
        </div>
        <div className="sub">{timer.issue.projectName}</div>
      </div>

      <div className="timer-controls">
        <button
          type="button"
          className="stop-btn"
          disabled={busy}
          onClick={() => run(async () => onState(await call("timer:stop")))}
          aria-label="Stop and log time"
        >
          {/* both labels stay in the DOM; CSS swaps them on hover so a click never lands on a removed node */}
          <span className="elapsed">{formatElapsed(now - timer.start)}</span>
          <span className="stop-label">
            <Icon name="stop" /> Stop &amp; log
          </span>
        </button>
        <ConfirmIconButton
          icon="close"
          label="Discard timer (nothing is logged)"
          confirmLabel="Discard?"
          onConfirm={() => run(async () => onState(await call("timer:discard")))}
        />
      </div>

      <div className="row">
        <label className="inline">
          Start
          <input
            type="time"
            key={timer.start}
            defaultValue={formatClock(new Date(timer.start))}
            onBlur={(e) => setStart(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className="inline grow">
          Type
          <select value={timer.workType?.id ?? ""} onChange={(e) => setType(e.target.value)}>
            <option value="">No work type</option>
            {timer.workType && !workTypes.some((w) => w.id === timer.workType!.id) && (
              <option value={timer.workType.id}>{timer.workType.name}</option>
            )}
            {workTypes.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
