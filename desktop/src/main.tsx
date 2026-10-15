import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
if (window.pink) document.documentElement.classList.add("electron");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
