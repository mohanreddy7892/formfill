import React from "react";
import { createRoot } from "react-dom/client";
import { installDemo } from "./demo/mock.js";
import App from "./App.jsx";
import "./styles.css";

installDemo(JSON.parse(document.getElementById("demo-data").textContent));
createRoot(document.getElementById("root")).render(<App />);
