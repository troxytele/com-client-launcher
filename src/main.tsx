import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LogsWindow from "./LogsWindow";
import "./styles.css";
import { applyLook } from "./theme";
import { installSounds } from "./sounds";

applyLook(); // before the first paint, so there is no colour flash
installSounds();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {(window as unknown as { __CC_WINDOW?: string }).__CC_WINDOW === "logs" ? <LogsWindow /> : <App />}
  </React.StrictMode>,
);
