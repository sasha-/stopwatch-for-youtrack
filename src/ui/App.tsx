import { useEffect, useMemo, useState } from "react";
import type { IssueRef } from "../shared/types";
import type { UiState } from "../shared/types";
import { Icon, IconButton, ErrorNote } from "./components/common";
import { Login } from "./components/Login";
import { Picker } from "./components/Picker";
import { Queue } from "./components/Queue";
import { Recent, useRecent } from "./components/Recent";
import { Settings } from "./components/Settings";
import { Timer } from "./components/Timer";
import { call, useAction, useUiState } from "./rpc";

export type Mode = "popup" | "panel" | "page";

export function App({ mode }: { mode: Mode }) {
  const [state, setState, loadError] = useUiState();
  const [view, setView] = useState<"main" | "settings" | "login">("main");
  const refresh = useAction();
  const recent = useRecent(
    state ?? ({ currentAccountId: null, timer: null, queue: [], settings: { recentDays: 0 } } as unknown as UiState)
  );
  const recentIssues = useMemo(() => {
    const seen = new Map<string, IssueRef>();
    for (const it of recent.items ?? []) if (!seen.has(it.issue.idReadable)) seen.set(it.issue.idReadable, it.issue);
    return [...seen.values()];
  }, [recent.items]);

  useEffect(() => {
    const theme = state?.settings.theme ?? "system";
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [state?.settings.theme]);

  if (!state) {
    return <div className="loading">{loadError ? <ErrorNote>{loadError}</ErrorNote> : "Loading…"}</div>;
  }

  const account = state.accounts.find((a) => a.id === state.currentAccountId) ?? null;

  const header = (
    <header className="top">
      <div className="brand">
        <img src="icons/icon.svg" alt="" width={22} height={22} />
        <span>Stopwatch</span>
        {account && <span className="who" title={account.baseUrl}>{account.name}</span>}
      </div>
      {account && !account.needsLogin && (
        <div className="actions">
          {view === "main" && (
            <IconButton
              icon="refresh"
              label="Reload issues from this page"
              disabled={refresh.busy}
              onClick={() => refresh.run(async () => setState(await call("page:refresh")))}
            />
          )}
          <IconButton
            icon={view === "main" ? "gear" : "back"}
            label={view === "main" ? "Settings" : "Back"}
            onClick={() => setView(view === "main" ? "settings" : "main")}
          />
        </div>
      )}
    </header>
  );

  if (!account || view === "login") {
    return (
      <div className={`app mode-${mode}`}>
        {header}
        <Login
          mode={mode}
          onDone={(s) => {
            setState(s);
            setView("main");
            if (mode === "page" && new URLSearchParams(location.search).get("view") === "setup") {
              // finished first-time setup in a tab
              document.title = "Stopwatch for YouTrack connected";
            }
          }}
          onCancel={account ? () => setView("settings") : undefined}
        />
      </div>
    );
  }

  if (account.needsLogin) {
    return (
      <div className={`app mode-${mode}`}>
        {header}
        <Login mode={mode} presetUrl={account.baseUrl} onDone={setState} />
      </div>
    );
  }

  return (
    <div className={`app mode-${mode}`}>
      {header}
      {view === "settings" ? (
        <Settings state={state} onState={setState} onAddAccount={() => setView("login")} />
      ) : (
        <main>
          <Queue queue={state.queue} onState={setState} />
          {state.timer ? (
            <Timer timer={state.timer} baseUrl={account.baseUrl} onState={setState} />
          ) : (
            <Picker page={state.page} recent={recentIssues} onState={setState} />
          )}
          <ErrorNote>{refresh.error}</ErrorNote>
          <Recent state={state} baseUrl={account.baseUrl} onState={setState} data={recent} />
        </main>
      )}
      {mode === "page" && view === "main" && (
        <p className="hint center">
          <Icon name="lock" size={14} /> Connected. You can close this tab and use Stopwatch from the toolbar.
        </p>
      )}
    </div>
  );
}
