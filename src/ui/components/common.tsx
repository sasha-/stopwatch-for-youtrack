import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

const paths: Record<string, string> = {
  play: "M8 5v14l11-7z",
  stop: "M6 6h12v12H6z",
  trash: "M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9z",
  refresh: "M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  gear: "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z",
  back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  lock: "M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V7z",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={paths[name]} />
    </svg>
  );
}

export function IconButton(props: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${props.tone === "danger" ? "danger" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/** First click arms, second click (within 3 s) confirms. No modal dialogs. */
export function ConfirmIconButton(props: { icon: string; label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <button
        type="button"
        className="confirm-btn"
        onClick={() => {
          setArmed(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel}
      </button>
    );
  }
  return <IconButton icon={props.icon} label={props.label} tone="danger" onClick={() => setArmed(true)} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="error" role="alert">
      {children}
    </div>
  );
}

/**
 * Opens a YouTrack issue in the same tab:
 * - in-page panel: navigates the YouTrack page the panel sits in (target=_top);
 * - toolbar popup: navigates the current tab if it's showing that YouTrack,
 *   otherwise opens a new tab, then closes the popup;
 * - setup/options tab: opens a new tab (so the settings tab isn't lost).
 * Ctrl/Cmd/Shift/middle-click keep the browser's normal behaviour.
 */
export function IssueLink({ baseUrl, id }: { baseUrl: string; id: string }) {
  const href = `${baseUrl}/issue/${encodeURIComponent(id)}`;
  const cls = document.documentElement.classList;
  const panel = cls.contains("mode-panel");
  const popup = cls.contains("mode-popup");

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!popup || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // tab.url is only visible for sites the extension has access to, i.e. YouTrack
      if (tab?.id !== undefined && tab.url && new URL(tab.url).origin === new URL(baseUrl).origin) {
        await chrome.tabs.update(tab.id, { url: href });
      } else {
        await chrome.tabs.create({ url: href });
      }
      window.close();
    })();
  };

  return (
    <a
      className="issue-id"
      href={href}
      target={panel ? "_top" : "_blank"}
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {id}
    </a>
  );
}
