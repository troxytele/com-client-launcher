import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LogsWindow from "./LogsWindow";
import "./styles.css";
import { applyLook } from "./theme";
import { installSounds } from "./sounds";
import { installI18n } from "./i18n";

applyLook(); // before the first paint, so there is no colour flash
installSounds();

// the dictionary is a small local chunk; wait for it so the first paint is already in the right language
installI18n().finally(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {(window as unknown as { __CC_WINDOW?: string }).__CC_WINDOW ===
      "logs" ? (
        <LogsWindow />
      ) : (
        <App />
      )}
    </React.StrictMode>,
  ),
);
