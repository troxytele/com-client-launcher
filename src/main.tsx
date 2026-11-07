import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyLook } from "./theme";
import { installSounds } from "./sounds";

applyLook(); // before the first paint, so there is no colour flash
installSounds();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
