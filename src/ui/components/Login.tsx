import { useState, type FormEvent } from "react";
import { normaliseBaseUrl } from "../../background/youtrack";
import type { UiState } from "../../shared/types";
import { call, useAction } from "../rpc";
import { ErrorNote, Icon } from "./common";

export function Login(props: {
  onDone: (s: UiState) => void;
  onCancel?: () => void;
  presetUrl?: string;
  mode: "popup" | "panel" | "page";
}) {
  const [url, setUrl] = useState(props.presetUrl ?? "");
  const [token, setToken] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let base: string;
    try {
      base = normaliseBaseUrl(url);
    } catch (err) {
      setError((err as Error).message || "That doesn't look like a web address.");
      return;
    }
    const origin = `https://${new URL(base).hostname}/*`; // match patterns carry no port
    // Must be called synchronously inside the click/submit gesture.
    chrome.permissions.request({ origins: [origin] }).then(
      (granted) => {
        if (!granted) {
          setError(`Stopwatch for YouTrack needs permission to talk to ${new URL(base).host}.`);
          return;
        }
        void run(async () => {
          const s = await call("auth:login", { baseUrl: base, token });
          setToken("");
          props.onDone(s);
        });
      },
      (err: Error) => setError(err.message)
    );
  };

  // Chrome closes a toolbar popup when its permission prompt appears, so a
  // brand-new connection is set up in a normal tab instead.
  if (props.mode === "popup" && !props.presetUrl) {
    return (
      <div className="login">
        <h2>Connect to YouTrack</h2>
        <p className="hint">Setting up opens in a tab, because Chrome will ask you to allow the extension to talk to your YouTrack server.</p>
        <div className="row end">
          {props.onCancel && (
            <button type="button" className="btn ghost" onClick={props.onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=setup") });
              window.close();
            }}
          >
            Open setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="login" onSubmit={submit} autoComplete="off">
      <h2>Connect to YouTrack</h2>
      <label>
        YouTrack address
        <input
          type="text"
          inputMode="url"
          placeholder="yourcompany.youtrack.cloud"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          spellCheck={false}
          autoFocus={!props.presetUrl}
        />
      </label>
      <label>
        Permanent token
        <input
          type="password"
          placeholder="perm:…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          spellCheck={false}
          autoComplete="off"
          autoFocus={!!props.presetUrl}
        />
      </label>
      <ErrorNote>{error}</ErrorNote>
      <div className="row end">
        {props.onCancel && (
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </div>
      <p className="hint">
        <Icon name="lock" size={14} /> The token is checked against YouTrack, then stored encrypted with a key that
        never leaves this browser and can't be exported. Only the extension's background worker ever reads it.
      </p>
      <p className="hint">
        Create a token in YouTrack under <b>Profile → Account Security → Tokens</b> (scope: YouTrack). This extension does{" "}
        <b>not</b> need "Allow all origins" on the server.
      </p>
    </form>
  );
}
