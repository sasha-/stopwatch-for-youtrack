import { useEffect, useMemo, useState } from "react";
import type { IssueRef } from "../shared/types";
import type { UiState } from "../shared/types";
import { accentPalette } from "../shared/color";
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

  useEffect(() => {
    const p = accentPalette(state?.settings.accent ?? "");
    const st = document.documentElement.style;
    st.setProperty("--ua-light", p.light);
    st.setProperty("--ua-light-fg", p.lightFg);
    st.setProperty("--ua-light-soft", p.lightSoft);
    st.setProperty("--ua-dark", p.dark);
    st.setProperty("--ua-dark-fg", p.darkFg);
    st.setProperty("--ua-dark-soft", p.darkSoft);
  }, [state?.settings.accent]);

  if (!state) {
    return <div className="loading">{loadError ? <ErrorNote>{loadError}</ErrorNote> : "Loading…"}</div>;
  }

  const account = state.accounts.find((a) => a.id === state.currentAccountId) ?? null;

  const header = (
    <header className="top">
      <div className="brand">
        <Logo />
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

/** Stopwatch mark drawn in the current accent colour. */
function Logo() {
  return (
    <svg viewBox="0 0 128 128" width={22} height={22} aria-hidden="true" style={{ color: "var(--accent)" }}>
      <g fill="currentColor">
        <rect x="52" y="4" width="24" height="14" rx="5" />
        <rect x="59" y="14" width="10" height="12" />
        <rect x="96" y="22" width="18" height="12" rx="4" transform="rotate(45 105 28)" />
        <circle cx="64" cy="74" r="50" />
      </g>
      <circle cx="64" cy="74" r="38" fill="#fff" />
      <path d="M64 74 L64 44" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      <path d="M64 74 L84 86" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.35" />
      <circle cx="64" cy="74" r="8" fill="currentColor" />
    </svg>
  );
}
