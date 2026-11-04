import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import "./styles.css";

const theme = createTheme({
  palette: { primary: { main: "#2458a6" }, background: { default: "#f6f8fb" }, text: { primary: "#172033", secondary: "#697586" } },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', button: { textTransform: "none", fontWeight: 700 } },
  shape: { borderRadius: 10 },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>
);
