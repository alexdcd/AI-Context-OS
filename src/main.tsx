import "./i18n"; // must be first — initializes i18next before React renders
import i18n from "./i18n";
import { useSettingsStore } from "./lib/settingsStore";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Keep i18next in sync whenever settingsStore.language changes
let _prevLanguage = useSettingsStore.getState().language;
useSettingsStore.subscribe((state) => {
  if (state.language !== _prevLanguage) {
    _prevLanguage = state.language;
    void i18n.changeLanguage(state.language);
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
