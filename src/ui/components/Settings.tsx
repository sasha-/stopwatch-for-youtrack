import type { PanelMode, Theme, UiState } from "../../shared/types";
import { call, useAction } from "../rpc";
import { ConfirmIconButton, ErrorNote, Icon } from "./common";

export function Settings(props: { state: UiState; onState: (s: UiState) => void; onAddAccount: () => void }) {
  const { state, onState } = props;
  const { error, run } = useAction();
  const set = (settings: Partial<UiState["settings"]>) => run(async () => onState(await call("settings:set", { settings })));

  return (
    <section className="settings">
      <h3>Accounts</h3>
      <ul className="accounts">
        {state.accounts.map((a) => (
          <li key={a.id} className={a.id === state.currentAccountId ? "current" : ""}>
            <label>
              <input
                type="radio"
                name="account"
                checked={a.id === state.currentAccountId}
                onChange={() => run(async () => onState(await call("account:switch", { accountId: a.id })))}
              />
              <span>
                <b>{a.name}</b> <span className="sub">({a.login})</span>
                <div className="sub">{new URL(a.baseUrl).host + new URL(a.baseUrl).pathname.replace(/\/$/, "")}</div>
                {a.needsLogin && <div className="sub err">Token needs to be pasted again</div>}
              </span>
            </label>
            <ConfirmIconButton
              icon="trash"
              label="Sign out and delete the stored token"
              confirmLabel="Sign out?"
              onConfirm={() => run(async () => onState(await call("auth:logout", { accountId: a.id })))}
            />
          </li>
        ))}
      </ul>
      <button className="btn small" onClick={props.onAddAccount}>
        Add account
      </button>

      <h3>Appearance</h3>
      <label className="inline">
        Theme
        <select value={state.settings.theme} onChange={(e) => set({ theme: e.target.value as Theme })}>
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>

      <h3>In-page panel</h3>
      <label className="inline">
        Show on YouTrack pages
        <select value={state.settings.panelMode} onChange={(e) => set({ panelMode: e.target.value as PanelMode })}>
          <option value="app">Only in app windows (no toolbar)</option>
          <option value="always">In every YouTrack tab</option>
          <option value="off">Never</option>
        </select>
      </label>
      <p className="hint">Takes effect when the YouTrack page is reloaded.</p>

      <h3>Recent work</h3>
      <label className="inline">
        Show the last
        <input
          type="number"
          min={1}
          max={90}
          value={state.settings.recentDays}
          onChange={(e) => set({ recentDays: Number(e.target.value) })}
          style={{ width: 64 }}
        />
        days
      </label>

      <ErrorNote>{error}</ErrorNote>

      <p className="hint security">
        <Icon name="lock" size={14} /> Tokens are encrypted (AES-256-GCM) with a non-exportable key kept in this
        browser profile. Signing out deletes the token; removing the last account also deletes the key and Chrome's
        access to the server.
      </p>
    </section>
  );
}
