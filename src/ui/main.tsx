import { createRoot } from "react-dom/client";
import { App, type Mode } from "./App";
import "./styles.css";

const mode: Mode = location.pathname.endsWith("/panel.html")
  ? "panel"
  : new URLSearchParams(location.search).has("view")
    ? "page"
    : "popup";

document.documentElement.classList.add(`mode-${mode}`);
createRoot(document.getElementById("root")!).render(<App mode={mode} />);
