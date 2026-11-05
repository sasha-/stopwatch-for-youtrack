"use strict";
(() => {
  // src/shared/messages.ts
  var PANEL_PORT = "ytsw:panel-status";

  // src/shared/time.ts
  var pad = (n) => String(n).padStart(2, "0");
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1e3));
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60 % 60))}:${pad(total % 60)}`;
  }

  // src/content/panel.ts
  (async () => {
    if (window.top !== window || window.__ytswPanel) return;
    window.__ytswPanel = true;
    let show = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: "panel:should-show", payload: {} });
      show = !!res?.ok && !!res.data?.show;
    } catch {
      return;
    }
    if (!show) return;
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483646;right:16px;bottom:16px;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .pill {
        display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 10px;
        border-radius: 20px; border: 1px solid rgba(0,0,0,.12); cursor: pointer;
        background: #fff; color: #1f2328; font-size: 13px; font-weight: 600;
        box-shadow: 0 4px 16px rgba(0,0,0,.18); user-select: none;
      }
      .pill:hover { box-shadow: 0 6px 20px rgba(0,0,0,.24); }
      .pill:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
      .pill.running { background: #e8710a; color: #fff; border-color: #e8710a; }
      .pill svg { flex: none; }
      .pill { --acc: #0f7b6c; } .pill svg .b, .pill svg .h circle { fill: var(--acc); } .pill svg .h path { stroke: var(--acc); } .pill svg .f { fill: #fff; }
      .pill.running svg .b { fill: #fff; } .pill.running svg .f { fill: #e8710a; } .pill.running svg .h circle { fill: #fff; } .pill.running svg .h path { stroke: #fff; }
      .time { font-variant-numeric: tabular-nums; }
      .frame {
        position: absolute; right: 0; bottom: 52px; width: 400px; height: min(620px, calc(100vh - 90px));
        border: 1px solid rgba(0,0,0,.15); border-radius: 12px; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.28); background: #fff; display: none;
      }
      .frame.open { display: block; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
      @media (prefers-color-scheme: dark) {
        .pill:not(.running) { background: #2b2d30; color: #dfe1e5; border-color: #43454a; }
        .frame { background: #1e1f22; border-color: #43454a; }
      }
    </style>
    <div class="frame" part="frame"></div>
    <button class="pill" type="button" title="Stopwatch for YouTrack" aria-expanded="false">
      <svg viewBox="0 0 128 128" width="22" height="22" aria-hidden="true"><g class="b"><rect x="52" y="4" width="24" height="14" rx="5"/><rect x="59" y="14" width="10" height="12"/><rect x="96" y="22" width="18" height="12" rx="4" transform="rotate(45 105 28)"/><circle cx="64" cy="74" r="50"/></g><circle class="f" cx="64" cy="74" r="38"/><g class="h"><path d="M64 74 L64 44" stroke-width="10" stroke-linecap="round"/><path d="M64 74 L84 86" stroke-width="8" stroke-linecap="round"/><circle cx="64" cy="74" r="8"/></g></svg>
      <span class="label">Stopwatch</span>
    </button>`;
    document.documentElement.appendChild(host);
    const pill = root.querySelector(".pill");
    const label = root.querySelector(".label");
    const frameBox = root.querySelector(".frame");
    let iframe = null;
    const setOpen = (open) => {
      if (open && !iframe) {
        iframe = document.createElement("iframe");
        iframe.src = chrome.runtime.getURL("panel.html");
        iframe.allow = "";
        iframe.referrerPolicy = "no-referrer";
        frameBox.appendChild(iframe);
      }
      frameBox.classList.toggle("open", open);
      pill.setAttribute("aria-expanded", String(open));
    };
    pill.addEventListener("click", () => setOpen(!frameBox.classList.contains("open")));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && frameBox.classList.contains("open")) setOpen(false);
    });
    let status = { running: false, issueId: null, start: null, accent: "#0f7b6c" };
    let tick;
    const render = () => {
      pill.classList.toggle("running", status.running);
      if (/^#[0-9a-f]{6}$/i.test(status.accent)) pill.style.setProperty("--acc", status.accent);
      if (status.running && status.start) {
        label.innerHTML = "";
        const id = document.createElement("span");
        id.textContent = status.issueId ?? "";
        const t = document.createElement("span");
        t.className = "time";
        t.textContent = formatElapsed(Date.now() - status.start);
        label.append(id, " ", t);
      } else {
        label.textContent = "Stopwatch";
      }
    };
    let retry = 1e3;
    const connect = () => {
      let port;
      try {
        port = chrome.runtime.connect({ name: PANEL_PORT });
      } catch {
        return;
      }
      port.onMessage.addListener((s) => {
        retry = 1e3;
        status = s;
        clearInterval(tick);
        if (s.running) tick = setInterval(render, 1e3);
        render();
      });
      port.onDisconnect.addListener(() => {
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 6e4);
      });
    };
    connect();
  })();
})();
