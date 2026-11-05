import { useState } from "react";
import type { QueuedWorkItem, UiState } from "../../shared/types";
import { durationMinutes, formatClock, formatMinutes } from "../../shared/time";
import { call, useAction } from "../rpc";
import { ConfirmIconButton } from "./common";

export function Queue({ queue, onState }: { queue: QueuedWorkItem[]; onState: (s: UiState) => void }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  if (!queue.length) return null;
  return (
    <section className="card queue">
      <div className="row between">
        <button className="link" onClick={() => setOpen(!open)}>
          {queue.length} work item{queue.length > 1 ? "s" : ""} not yet in YouTrack
        </button>
        <button className="btn small" disabled={busy} onClick={() => run(async () => onState(await call("queue:retry")))}>
          {busy ? "Syncing…" : "Retry now"}
        </button>
      </div>
      {open && (
        <ul className="queue-list">
          {queue.map((q) => (
            <li key={q.localId}>
              <div>
                <b>{q.issue.idReadable}</b> {formatMinutes(durationMinutes(q.start, q.end))} ·{" "}
                {new Date(q.start).toLocaleDateString()} {formatClock(new Date(q.start))}
                {q.lastError && <div className="sub err">{q.lastError}</div>}
              </div>
              <ConfirmIconButton
                icon="trash"
                label="Drop this entry (it won't be logged)"
                confirmLabel="Drop?"
                onConfirm={() => run(async () => onState(await call("queue:discard", { localId: q.localId })))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
